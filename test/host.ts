// Stands in for ChatGPT: frames the panel and speaks the MCP Apps side of the
// conversation, recording what the panel asks for.

import { page } from 'vitest/browser';

import { env, waitFor } from './common';

type Message = {
    readonly jsonrpc ?: string,
    readonly id ?: number | string,
    readonly method ?: string,
    readonly params ?: Readonly<Record<string, unknown>>,
};

export type ChatMessage = {
    readonly target : string | undefined,
    readonly text : string,
    readonly data : unknown,
};

// How the fake ChatGPT answers a ui/message, by its target ('active' or
// undefined, meaning steer): accept, or refuse with this message.
export type MessagePolicy = (target : string | undefined) => true | string;

export type FakeHostOptions = {
    // The demo URL the panel is configured with; 'none' for no Try button.
    readonly demo ?: string,
    readonly capabilities ?: Readonly<Record<string, unknown>>,
    readonly hostContext ?: Readonly<Record<string, unknown>>,
    readonly policy ?: MessagePolicy,
    readonly refuseContext ?: boolean,
    readonly refuseInitialize ?: boolean,
    // Refuse the handshake with an error that has no message.
    readonly refuseInitializeBare ?: boolean,
    // Answer the handshake with this instead of capabilities and context.
    readonly initializeResult ?: unknown,
};

export const CHATGPT_CAPABILITIES = {
    updateModelContext: {},
    experimental:       { 'openai/message': {}, 'openai/modelContext': {} }
};

type CallToolOptions = {
    readonly url : string,
    readonly tool : string,
    readonly args ?: unknown,
    readonly callId ?: string,
    readonly openedAt ?: number,
};

export type FakeHost = {
    readonly frame : HTMLIFrameElement,
    readonly received : Array<Message>,
    readonly chat : Array<ChatMessage>,
    readonly contexts : Array<string>,
    readonly sizes : Array<unknown>,
    readonly send : (method : string, params : unknown) => void,
    readonly ping : () => Promise<unknown>,
    readonly openBrowser : (options ?: { readonly url ?: string, readonly openedAt ?: number }) => void,
    readonly callTool : (options : CallToolOptions) => string,
    readonly panelDocument : () => Document,
    // The panel's element with this id; throws if there is none.
    readonly byId : (id : string) => HTMLElement,
    readonly text : (id : string) => string,
    readonly waitForChat : (count : number) => Promise<ChatMessage>,
    readonly waitForText : (id : string, text : string | RegExp) => Promise<void>,
    readonly setPolicy : (policy : MessagePolicy) => void,
    readonly frameLocator : () => ReturnType<typeof page.frameLocator>,
    readonly siteLocator : () => ReturnType<typeof page.frameLocator>,
};

let frames = 0;

export const createFakeHost = async ({
    demo = `${ env.foreignOrigin }/examples/shop/index.html`,
    capabilities = CHATGPT_CAPABILITIES,
    hostContext = { theme: 'light' },
    policy: initialPolicy = () => true,
    refuseContext = false,
    refuseInitialize = false,
    refuseInitializeBare = false,
    initializeResult
} : FakeHostOptions = {}) : Promise<FakeHost> => {
    frames += 1;
    const title = `panel-${ frames }`;
    const frame = document.createElement('iframe');

    frame.title = title;
    frame.allow = 'tools';
    frame.style.width = '400px';
    frame.style.height = '480px';
    frame.src = `${ env.origin }/test/pages/panel.html?demo=${ encodeURIComponent(demo) }`;

    const received : Array<Message> = [];
    const chat : Array<ChatMessage> = [];
    const contexts : Array<string> = [];
    const sizes : Array<unknown> = [];
    const pings = new Map<number | string, (value : unknown) => void>();
    let policy = initialPolicy;

    const post = (message : Readonly<Record<string, unknown>>) : void => {
        frame.contentWindow?.postMessage({ jsonrpc: '2.0', ...message }, '*');
    };

    window.addEventListener('message', event => {
        if (event.source !== frame.contentWindow) {
            return;
        }

        const message = event.data as Message;

        if (message.jsonrpc !== '2.0') {
            return;
        }

        received.push(message);

        if (message.id !== undefined && message.method === undefined) {
            pings.get(message.id)?.(message);

            return;
        }

        const reply = (result : unknown) : void => post({ id: message.id, result });
        const refuse = (text : string) : void => post({ id: message.id, error: { code: -1, message: text } });

        switch (message.method) {
            case 'ui/initialize':
                if (refuseInitialize) {
                    refuse('No apps here');
                } else if (refuseInitializeBare) {
                    post({ id: message.id, error: { code: -1 } });
                } else {
                    reply(initializeResult === undefined
                        ? { hostCapabilities: capabilities, hostContext }
                        : initializeResult);
                }

                break;

            case 'ui/notifications/size-changed':
                sizes.push(message.params);
                break;

            case 'ui/update-model-context': {
                const content = message.params?.content as ReadonlyArray<{ readonly text : string }>;

                if (refuseContext) {
                    refuse('No context');
                } else {
                    contexts.push(content[0]?.text ?? '');
                    reply({});
                }

                break;
            }

            case 'ui/message': {
                type Meta = { readonly 'openai/message' ?: { readonly target ?: string } };

                const meta = message.params?._meta as Meta | undefined;
                const target = meta?.['openai/message']?.target;
                const verdict = policy(target);

                if (verdict === true) {
                    type Part = { readonly text ?: string, readonly resource ?: { readonly text : string } };

                    const content = message.params?.content as ReadonlyArray<Part> | Part;

                    // One part, or a list of them.
                    const parts = [ content ].flat();

                    chat.push({
                        target,
                        text: parts[0]?.text ?? '',
                        data: parts[1]?.resource
                            ? JSON.parse(parts[1].resource.text) as unknown
                            : undefined
                    });

                    reply({});
                } else {
                    refuse(verdict);
                }

                break;
            }

            case undefined:
            default:
                break;
        }
    });

    document.body.append(frame);

    await new Promise(resolve => {
        frame.addEventListener('load', resolve, { once: true });
    });

    const panelDocument = () : Document => {
        const found = frame.contentDocument;

        if (!found) {
            throw new Error('The panel has no document');
        }

        return found;
    };

    const byId = (id : string) : HTMLElement => {
        const found = panelDocument().getElementById(id);

        if (!found) {
            throw new Error(`The panel has no #${ id }`);
        }

        return found;
    };

    const text = (id : string) : string => panelDocument().getElementById(id)?.textContent ?? '';

    const send : FakeHost['send'] = (method, params) => {
        post({ method, params });
    };

    return {
        frame,
        received,
        chat,
        contexts,
        sizes,
        send,

        ping: () => new Promise(resolve => {
            pings.set('ping-1', resolve);
            post({ id: 'ping-1', method: 'ping' });
        }),

        openBrowser: ({ url, openedAt = Date.now() } = {}) => {
            send('ui/notifications/tool-input', {
                arguments: url
                    ? { url }
                    : {}
            });

            send('ui/notifications/tool-result', { structuredContent: { url: url ?? null, opened_at: openedAt } });
        },

        callTool: ({ url, tool, args = {}, callId = crypto.randomUUID(), openedAt = Date.now() }) => {
            send('ui/notifications/tool-input', { arguments: { url, tool, arguments: args } });
            send(`ui/notifications/tool-result`, { structuredContent: { call_id: callId, url, tool, arguments: args, opened_at: openedAt } });

            return callId;
        },

        panelDocument,
        byId,
        text,

        waitForChat: async count => {
            await waitFor({ check: () => chat.length >= count, what: `${ count } chat messages`, timeout: 20_000 });

            const message = chat[count - 1];

            if (!message) {
                throw new Error(`No chat message ${ count }`);
            }

            return message;
        },

        waitForText: async (id, expected) => {
            await waitFor({
                check: () => (typeof expected === 'string'
                    ? text(id).includes(expected)
                    : expected.test(text(id))),

                what:    `#${ id } to show ${ String(expected) } (it shows "${ text(id) }")`,
                timeout: 20_000
            });
        },

        setPolicy: next => {
            policy = next;
        },

        frameLocator: () => page.frameLocator(page.getByTitle(title)),
        siteLocator:  () => page.frameLocator(page.frameLocator(page.getByTitle(title)).getByTitle('Page'))
    };
};

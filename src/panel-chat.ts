// Posting into the conversation, and describing a page's tools for the model.

import type { Host } from './panel-host';

export type PageTool = {
    readonly name : string,
    readonly description : string,
    readonly inputSchema : Readonly<Record<string, unknown>>,
};

type SchemaProperty = { readonly type ?: unknown };

// "- add_to_cart(product_id: string, quantity: integer?): Adds a product…"
export const describeTools = (tools : ReadonlyArray<PageTool>) : string => tools.map(tool => {
    const properties = (tool.inputSchema.properties ?? {}) as Readonly<Record<string, SchemaProperty>>;
    const required = (tool.inputSchema.required ?? []) as ReadonlyArray<string>;

    const parameters = Object.entries(properties)
        .map(([ name, schema ]) => `${ name }: ${
            typeof schema.type === 'string'
                ? schema.type
                : 'any'
            }${
                required.includes(name)
                    ? ''
                    : '?'
            }`)
        .join(', ');

    return `- ${ tool.name }(${ parameters }): ${ tool.description }`;
}).join('\n');

const sleep = (ms : number) : Promise<void> => new Promise(resolve => {
    setTimeout(resolve, ms);
});

type SendToChatOptions = {
    readonly host : Host,
    // What the message is about, for the attachment's name and the status line.
    readonly name : string,
    // One line a person can read; ChatGPT shows it briefly.
    readonly text : string,
    // Attached as JSON, for the model.
    readonly data ?: unknown,
    readonly onStatus : (status : string) => void,
    readonly attempts ?: number,
    readonly retryDelay ?: number,
};

// How ChatGPT takes a message from the panel depends on whether the model is
// still writing (measured; ChatGPT does not document it):
// - target 'active' starts a new turn once the model is done, but is refused
//   while it is still replying (and ChatGPT shows "Steering requires an
//   active compatible turn");
// - no target steers the message into the reply that is running, but is
//   refused once that turn is over ("The composer is unavailable").
// Right after a turn ends both can refuse for a moment. So: try a new turn,
// then steering, and if both refuse, wait and try again.
export const sendToChat = async ({
    host,
    name,
    text,
    data,
    onStatus,
    attempts = 40,
    retryDelay = 2000
} : SendToChatOptions) : Promise<boolean> => {
    const content = [
        { type: 'text', text },
        ...data === undefined
            ? []
            : [ { type: 'resource', resource: { uri: `webmcp-bridge://${ name }/${ crypto.randomUUID() }.json`, mimeType: 'application/json', text: JSON.stringify(data) } } ]
    ];

    // A host without ChatGPT's message extensions takes one plain message.
    if (!host.capabilities().experimental?.['openai/message']) {
        try {
            await host.request({ method: 'ui/message', params: { role: 'user', content: { type: 'text', text } } });
            onStatus(`${ name }: sent`);

            return true;
        } catch (err) {
            onStatus(`Could not send: ${ (err as Error).message }`);

            return false;
        }
    }

    const send = (target ?: string) : Promise<unknown> => host.request({
        method: 'ui/message',
        params: {
            role:  'user',
            content,
            _meta: {
                'openai/message': target
                    ? { target, send: true }
                    : { send: true }
            }
        }
    });

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            // eslint-disable-next-line no-await-in-loop -- each try depends on the last one failing
            await send('active');
            onStatus(`${ name }: sent`);

            return true;
        } catch {
            // Mid-reply: steer it in instead, below.
            onStatus('ChatGPT is replying; adding it to the reply…');
        }

        try {
            // eslint-disable-next-line no-await-in-loop -- as above
            await send();
            onStatus(`${ name }: sent into the reply`);

            return true;
        } catch {
            onStatus(`Waiting for ChatGPT (${ attempt })…`);
            // eslint-disable-next-line no-await-in-loop -- as above
            await sleep(retryDelay);
        }
    }

    onStatus('Could not send: ChatGPT kept refusing the message');

    return false;
};

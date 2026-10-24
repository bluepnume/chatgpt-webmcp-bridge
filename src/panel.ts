// The panel: a small browser ChatGPT shows inside the conversation.
//
// 1. It loads a page into its iframe, finds the page's tools (over glottis,
//    or native WebMCP; see panel-pages.ts) and hands them to ChatGPT.
// 2. When the model calls call_site_tool, ChatGPT opens a new panel with the
//    call's arguments and the server's reply (which carries a call id). That
//    panel loads the page and runs the tool there.
// 3. It posts the result into the conversation (panel-chat.ts), which the
//    model reads to answer the user.
// The server never sees a page or a result; it only hands out call ids.

import { connect } from 'glottis';

import { CONFIG_ELEMENT_ID, DEFAULT_DEMO_URL, PACKAGE_NAME, TOOL_NAME, VERSION } from './constants';

import type { PageApi } from './panel-pages';

import { reportError } from './log';
import { describeTools, sendToChat } from './panel-chat';
import { createHost } from './panel-host';
import { getModelContext, normalizeUrl, openPage } from './panel-pages';

type PanelConfig = { readonly demoUrl : string | null };

const element = <T extends HTMLElement>(id : string) : T => {
    const found = document.getElementById(id);

    if (!found) {
        throw new Error(`The panel has no #${ id }`);
    }

    return found as T;
};

// "1 tool", "3 tools".
const toolCount = (count : number) : string => `${ count } tool${
    count === 1
        ? ''
        : 's'
    }`;

type PageNameOptions = { readonly url : string, readonly title : string };

// The page's title, or its host when it has none.
const pageName = ({ url, title } : PageNameOptions) : string =>
    (title.length > 0
        ? title
        : new URL(url).host);

const readConfig = () : PanelConfig => {
    try {
        return JSON.parse(element(CONFIG_ELEMENT_ID).textContent) as PanelConfig;
    } catch {
        return { demoUrl: DEFAULT_DEMO_URL };
    }
};

const config = readConfig();
const host = createHost();
const modelContext = getModelContext();

const site = element<HTMLIFrameElement>('site');

const setStatus = (text : string) : void => {
    element('status').textContent = text;
};

// ---- what this panel is for, and what it is doing ----

let toolInput : Readonly<Record<string, unknown>> | undefined;
let toolResult : { readonly structuredContent ?: Readonly<Record<string, unknown>> } | undefined;
let connected = false;
let started = false;
// A call is running in this panel; its own messages take priority.
let calling = false;
// The model opened the page; its own message lists the tools.
let modelOpening = false;

// ---- the browser: address bar, history, loading pages ----

const visits = { entries: [] as Array<string>, index: -1 };
let loads = 0;
let disconnectCurrent : (() => Promise<void>) | undefined;
// Why the last load has no tools, for the messages to the model.
const NO_TOOLS = `it offers no tools (it needs glottis tools or WebMCP tools exposed to this panel, and its origin must be in the server's frame domains)`;
let refusal = NO_TOOLS;

const renderNav = () : void => {
    element<HTMLButtonElement>('back').disabled = visits.index <= 0;
    element<HTMLButtonElement>('forward').disabled = visits.index >= visits.entries.length - 1;
    element<HTMLButtonElement>('reload').disabled = visits.index < 0;
};

const ROUTE_LABEL = { glottis: 'glottis', native: 'native WebMCP' } as const;

// Tells the model what the page offers. ChatGPT shows it as context for the
// user's next message.
const shareTools = async (api : PageApi) : Promise<void> => {
    const { tools, page: { url, title } } = api;
    const toolsElement = element('tools');

    toolsElement.replaceChildren();

    if (tools.length) {
        toolsElement.append('Tools: ');

        tools.forEach((tool, index) => {
            const code = document.createElement('code');

            code.textContent = tool.name;

            toolsElement.append(...index
                ? [ ', ', code ]
                : [ code ]);
        });
    } else {
        toolsElement.append('The page offers no tools');
    }

    const via = document.createElement('span');

    via.className = 'via';
    via.textContent = `· ${ ROUTE_LABEL[api.route] }`;
    toolsElement.append(via);

    if (!calling) {
        setStatus('Ready');
    }

    const capabilities = host.capabilities();

    if (!capabilities.updateModelContext && !capabilities.experimental?.['openai/modelContext']) {
        return;
    }

    const text = tools.length
        ? `The page open in the WebMCP bridge browser is ${ url }${
            title
                ? ` ("${ title }")`
                : ''
            }. It offers these tools. Call them with ${ TOOL_NAME.CALL_SITE_TOOL }, passing "url" ("${ url }"), "tool" (the name) and "arguments" (an object matching the parameters):\n${ describeTools(tools) }`
        : `The page open in the WebMCP bridge browser is ${ url }. It offers no tools.`;

    await host.request({
        method: 'ui/update-model-context',
        params: { content: [ { type: 'text', text, _meta: { 'openai/title': `Tools on ${ new URL(url).host }` } } ] }
    }).catch(reportError('could not share the tools'));
};

const introduced = new Set<string>();

// A page the user opened (the Try button, the address bar, a link inside it)
// gets a short message with its tools, so ChatGPT says what it can do there.
// Once per page (its path, so the shop's ?cart= does not count). Pages the
// model opened, or a call is running in, have messages of their own.
const introducePage = (api : PageApi) : void => {
    const { url, title } = api.page;
    const key = new URL(url).origin + new URL(url).pathname;

    if (calling || modelOpening || introduced.has(key) || !api.tools.length) {
        return;
    }

    introduced.add(key);

    sendToChat({
        host,
        name: 'page',
        text: `✓ Opened ${ pageName({ url, title }) }: ${ toolCount(api.tools.length) } (attached).`,
        data: {
            opened_by:    'user',
            url,
            title,
            tools:        api.tools,
            instructions: `Call these tools with ${ TOOL_NAME.CALL_SITE_TOOL }, passing url "${ url }". Reply with a short, friendly list of what you can do for the user on this page (plain language, no tool names), then ask what they would like to do.`
        },
        onStatus: setStatus
    }).catch(reportError('could not introduce the page'));
};

// The page reports its own URL and title, so links clicked inside it keep the
// address bar and history in step. A page that only rewrote its own address
// as it loaded (same path; the shop adds ?cart=) replaces its history entry.
const showPage = (api : PageApi) : void => {
    const { url, title } = api.page;
    const shown = visits.entries[visits.index];

    if (shown !== undefined && url !== shown) {
        const pathOf = (address : string) : string => new URL(address).origin + new URL(address).pathname;
        const samePage = pathOf(url) === pathOf(shown);

        if (samePage) {
            visits.entries[visits.index] = url;
        } else {
            visits.entries = [ ...visits.entries.slice(0, visits.index + 1), url ];
            visits.index = visits.entries.length - 1;
        }

        renderNav();
    }

    element<HTMLInputElement>('address').value = url;
    element('tab').textContent = pageName({ url, title });
    shareTools(api).catch(reportError('could not share the tools'));
    introducePage(api);
};

const showNoTools = () : void => {
    refusal = NO_TOOLS;
    element(`tools`).textContent = `No tools found on this page (blank? its origin may not be in the server's frame domains)`;

    if (!calling) {
        setStatus('Loaded');
    }
};

const showDeclined = (message : string) : void => {
    refusal = `the user declined the page's permission prompt (${ message })`;
    element('tools').textContent = 'Access declined in the page';

    if (!calling) {
        setStatus('Declined');
    }
};

type LoadOptions = { readonly url : string, readonly push ?: boolean };

const load = async ({ url, push = true } : LoadOptions) : Promise<PageApi | undefined> => {
    if (push) {
        visits.entries = [ ...visits.entries.slice(0, visits.index + 1), url ];
        visits.index = visits.entries.length - 1;
    }

    renderNav();
    element<HTMLInputElement>('address').value = url;
    element('tab').textContent = new URL(url).host;
    element('start').hidden = true;
    site.hidden = false;
    element('tools').textContent = 'Looking for tools…';
    setStatus('Loading…');
    refusal = NO_TOOLS;

    loads += 1;
    const mine = loads;
    const previous = disconnectCurrent;

    disconnectCurrent = undefined;
    await previous?.();

    await new Promise(resolve => {
        site.addEventListener('load', resolve, { once: true });
        site.src = url;
    });

    if (mine !== loads) {
        return undefined;
    }

    setStatus('Connecting… (the page may ask you first)');

    const opened = await openPage({
        frame:   site,
        url,
        connect: options => connect({ ...options }),
        modelContext,

        onPage: api => {
            if (mine === loads) {
                showPage(api);
            }
        },

        onGone: () => {
            if (mine === loads) {
                showNoTools();
            }
        }
    });

    if (mine !== loads) {
        if (opened.kind === 'page') {
            await opened.disconnect();
        }

        return undefined;
    }

    if (opened.kind === 'page') {
        disconnectCurrent = opened.disconnect;

        return opened.api;
    }

    if (opened.kind === 'declined') {
        showDeclined(opened.message);
    } else {
        showNoTools();
    }

    return undefined;
};

// ---- browser controls ----

element('go').addEventListener('submit', event => {
    event.preventDefault();
    const url = normalizeUrl(element<HTMLInputElement>('address').value);

    if (url) {
        load({ url }).catch(reportError('could not load the page'));
    }
});

// Moves to a history entry and loads it; nothing happens past either end.
const visit = (index : number) : void => {
    const url = visits.entries[index];

    if (url !== undefined) {
        visits.index = index;
        load({ url, push: false }).catch(reportError('could not load the page'));
    }
};

element('back').addEventListener('click', () => {
    visit(visits.index - 1);
});

element('forward').addEventListener('click', () => {
    visit(visits.index + 1);
});

element('reload').addEventListener('click', () => {
    visit(visits.index);
});

const tryButton = element<HTMLButtonElement>('try');

if (config.demoUrl) {
    const demoUrl = config.demoUrl;

    tryButton.textContent = `Try the demo shop (${ new URL(demoUrl).host })`;
    tryButton.hidden = false;

    tryButton.addEventListener('click', () => {
        load({ url: demoUrl }).catch(reportError('could not load the demo'));
    });
}

// ---- one live browser at a time ----
// ChatGPT renders a new panel for every call, and a panel cannot remove
// itself. This app's panels share an origin, so they tell each other when
// they open: an older one folds to a one-line note and lets its page go,
// leaving the newest as the browser. "Newest" is the server's opened_at
// stamp, which stays the same when ChatGPT re-renders a conversation.

const panelChannel = new BroadcastChannel(`${ PACKAGE_NAME }-panels`);
const panelId = crypto.randomUUID();
let openedAt : number | undefined;
let folded = false;

const fold = () : void => {
    if (folded) {
        return;
    }

    folded = true;
    element('window').hidden = true;
    element('moved').hidden = false;

    // A call still sending its result keeps its page.
    if (!calling) {
        disconnectCurrent?.().catch(reportError('could not disconnect from the page'));
        disconnectCurrent = undefined;
        site.removeAttribute('src');
    }
};

const announce = () : void => {
    if (openedAt !== undefined) {
        return;
    }

    const stamp = toolResult?.structuredContent?.opened_at;

    openedAt = typeof stamp === 'number'
        ? stamp
        : Date.now();

    // eslint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel has no target origin
    panelChannel.postMessage({ type: 'opened', id: panelId, openedAt });
};

panelChannel.addEventListener(`message`, ({ data } : MessageEvent<{ readonly type ?: string, readonly id ?: string, readonly openedAt ?: number }>) => {
    if (openedAt === undefined || data.id === undefined || data.openedAt === undefined || data.type !== `opened` || data.id === panelId) {
        return;
    }

    const theirsIsNewer = data.openedAt > openedAt || (data.openedAt === openedAt && data.id > panelId);

    if (theirsIsNewer) {
        fold();
    } else {
        // An older panel that opened after this one (a re-render): tell it a newer one is here.
        // eslint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel has no target origin
        panelChannel.postMessage({ type: 'opened', id: panelId, openedAt });
    }
});

// ---- calls ----

// ChatGPT re-renders every panel when a conversation reloads, so a call that
// already ran is remembered and not run again.
const DONE_KEY = `${ PACKAGE_NAME }-done-calls`;

const readDone = () : Readonly<Record<string, true>> => {
    try {
        return JSON.parse(localStorage.getItem(DONE_KEY) ?? '{}') as Readonly<Record<string, true>>;
    } catch {
        return {};
    }
};

const markDone = (callId : string) : void => {
    try {
        localStorage.setItem(DONE_KEY, JSON.stringify({ ...readDone(), [ callId ]: true }));
    } catch (err) {
        reportError('could not remember the call')(err);
    }
};

type RunCallOptions = {
    readonly url : string,
    readonly name : string,
    readonly args : Readonly<Record<string, unknown>>,
    readonly callId : string,
};

const runCall = async ({ url, name, args, callId } : RunCallOptions) : Promise<void> => {
    calling = true;
    const shortId = callId.slice(0, 8);

    const alreadyRun = Boolean(readDone()[callId]);
    const api = await load({ url });

    if (alreadyRun) {
        setStatus(`${ name }: already run`);

        return;
    }

    if (!api) {
        setStatus(`${ name }: not run`);

        await sendToChat({
            host,
            name,
            text:     `✗ ${ name } was not run on ${ new URL(url).host } (call ${ shortId }).`,
            data:     { call_id: callId, tool: name, ok: false, error: `The page loaded, but ${ refusal }.` },
            onStatus: setStatus
        });

        return;
    }

    setStatus(`Running ${ name }…`);
    const outcome = await api.callTool({ name, args });

    markDone(callId);

    setStatus(outcome.ok
        ? `${ name }: done`
        : `${ name }: failed`);

    const where = pageName(api.page);

    await sendToChat({
        host,
        name,
        text: outcome.ok
            ? `✓ ${ name } ran on ${ where } (call ${ shortId }). Result attached.`
            : `✗ ${ name } failed on ${ where } (call ${ shortId }): ${ outcome.error }`,
        data:     { call_id: callId, tool: name, arguments: args, ...outcome },
        onStatus: setStatus
    });
};

// open_browser with a url comes from the model in the middle of a request
// ("open the shop and add a mug"). The page's tools only exist once it loads,
// after the model's turn has ended, so they are posted into the conversation,
// which starts the next turn and lets the model carry on.
type OpenForModelOptions = { readonly url : string };

const openForModel = async ({ url } : OpenForModelOptions) : Promise<void> => {
    modelOpening = true;
    const api = await load({ url });
    const loadedUrl = api?.page.url ?? url;

    const where = api
        ? pageName(api.page)
        : new URL(loadedUrl).host;

    await sendToChat({
        host,
        name: TOOL_NAME.OPEN_BROWSER,
        text: api?.tools.length
            ? `✓ Opened ${ where }: ${ toolCount(api.tools.length) } (attached).`
            : `✗ Opened ${ where }, but it offers no tools.`,
        data: api?.tools.length
            ? { opened_by: 'model', url: loadedUrl, tools: api.tools, instructions: `Call these tools with ${ TOOL_NAME.CALL_SITE_TOOL }, passing url "${ loadedUrl }". Continue with what the user asked for. If they only asked to open the page, reply with a short list of what you can do for them on it (plain language, no tool names).` }
            : { opened_by: 'model', url: loadedUrl, tools: [], error: `The page loaded, but ${ refusal }.` },
        onStatus: setStatus
    });
};

// Starts once the handshake is done and both the call's input and the
// server's reply have arrived: a call with a call id runs; open_browser opens
// its url, or shows the start page.
const start = () : void => {
    if (started || !connected || !toolInput || !toolResult) {
        return;
    }

    started = true;
    const callId = toolResult.structuredContent?.call_id;

    const url = normalizeUrl(typeof toolInput.url === 'string'
        ? toolInput.url
        : '');

    const tool = typeof toolInput.tool === 'string'
        ? toolInput.tool
        : undefined;

    if (tool && url && typeof callId === 'string') {
        const args = (toolInput.arguments ?? {}) as Readonly<Record<string, unknown>>;

        runCall({ url, name: tool, args, callId }).catch(reportError('could not run the call'));
    } else if (url) {
        openForModel({ url }).catch(reportError('could not open the page'));
    } else {
        setStatus('Ready');
    }
};

host.on({
    method: 'ui/notifications/tool-input',

    listener: params => {
        toolInput = (params.arguments ?? {}) as Readonly<Record<string, unknown>>;
        start();
    }
});

host.on({
    method: 'ui/notifications/tool-result',

    listener: params => {
        toolResult = params;
        announce();
        start();
    }
});

host.on({
    method: 'ui/notifications/host-context-changed',

    listener: params => {
        if (typeof params.theme === 'string') {
            document.documentElement.dataset.theme = params.theme;
        }
    }
});

const reportSize = () : void => {
    const { width, height } = document.body.getBoundingClientRect();

    host.notify({ method: `ui/notifications/size-changed`, params: { width: Math.ceil(width), height: Math.ceil(height) } });
};

(async () : Promise<void> => {
    try {
        const context = await host.initialize({ name: PACKAGE_NAME, version: VERSION });

        if (typeof context.theme === 'string') {
            document.documentElement.dataset.theme = context.theme;
        }

        new ResizeObserver(reportSize).observe(document.body);
        reportSize();
        connected = true;
        setStatus('Connected');
        start();
    } catch (err) {
        setStatus(`Could not connect to ChatGPT: ${ (err as Error).message }`);
    }
})().catch(reportError('could not start'));

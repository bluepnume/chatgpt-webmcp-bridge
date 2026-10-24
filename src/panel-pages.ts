// Reaching a page's tools from the panel, by two routes:
// - glottis: the page serves tool() functions; the panel connects over
//   postMessage and reads them from the manifest. Works in every browser.
// - native WebMCP: the page registers tools with document.modelContext and
//   exposes them to the panel's origin; the panel lists them with
//   getTools({ fromOrigins }). Needs a browser with WebMCP turned on, and the
//   "tools" permission on every frame from ChatGPT down to the page.
// Both are tried. Native tools show as soon as they are found; if the page
// also answers over glottis, glottis takes over, because it carries real
// error messages and checks arguments.

import type { Connection, Manifest } from 'glottis';

import type { PageTool } from './panel-chat';

import { reportError } from './log';

type ToolOutcome =
    | { readonly ok : true, readonly result : unknown }
    | { readonly ok : false, readonly error : string };

type PageRoute = 'glottis' | 'native';

export type PageApi = {
    readonly page : { readonly url : string, readonly title : string },
    readonly route : PageRoute,
    readonly tools : ReadonlyArray<PageTool>,
    readonly callTool : (call : ToolCall) => Promise<ToolOutcome>,
};

type ToolCall = { readonly name : string, readonly args : Readonly<Record<string, unknown>> };

const errorMessage = (err : unknown) : string => (err instanceof Error
    ? err.message
    : String(err));

type GlottisPageApiOptions = {
    readonly exports : unknown,
    readonly manifest : Manifest,
    readonly url : string,
};

// A glottis page: its tools are the tool() functions in its manifest, under
// the names glottis gives them for WebMCP. A page may also export a constant
// `page: { url, title }`, so the panel can follow it to a new address (the
// demo shop adds its cart id to its URL as it loads).
export const glottisPageApi = ({ exports, manifest, url } : GlottisPageApiOptions) : PageApi => {
    const found = Object.entries(manifest.functions)
        .filter(([ , meta ]) => meta.tool)
        .map(([ path, meta ]) => ({
            path,
            tool: {
                name:        meta.name ?? path.replaceAll('.', '_'),
                description: meta.description ?? '',
                inputSchema: (meta.input ?? { type: 'object', properties: {} })
            }
        }));

    const values = exports as Readonly<Record<string, unknown>>;
    const page = values.page as { readonly url ?: unknown, readonly title ?: unknown } | undefined;

    return {
        page: {
            url: typeof page?.url === 'string'
                ? page.url
                : url,
            title: typeof page?.title === 'string'
                ? page.title
                : ''
        },
        route: 'glottis',
        tools: found.map(({ tool }) => tool),

        callTool: async ({ name, args }) => {
            const match = found.find(({ tool }) => tool.name === name);

            if (!match) {
                return { ok: false, error: `Unknown tool "${ name }".` };
            }

            const call = match.path.split(`.`).reduce<unknown>((value, key) => (value as Readonly<Record<string, unknown>> | undefined)?.[key], values) as (args : unknown) => Promise<unknown>;

            try {
                return { ok: true, result: await call(args) };
            } catch (err) {
                return { ok: false, error: errorMessage(err) };
            }
        }
    };
};

type NativeTool = {
    readonly name : string,
    readonly description ?: string,
    readonly inputSchema ?: unknown,
};

type GetToolsOptions = { readonly fromOrigins ?: ReadonlyArray<string> };

export type ModelContext = {
    readonly getTools : (options ?: GetToolsOptions) => Promise<ReadonlyArray<NativeTool>>,
    readonly executeTool : (tool : NativeTool, args : Readonly<Record<string, unknown>>) => Promise<unknown>,
    readonly addEventListener ?: (type : 'toolchange', listener : () => void) => void,
    readonly removeEventListener ?: (type : 'toolchange', listener : () => void) => void,
};

const parseJson = (text : string) : unknown => {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
};

type McpResult = {
    readonly content : ReadonlyArray<{ readonly type ?: string, readonly text ?: string }>,
    readonly structuredContent ?: unknown,
    readonly isError ?: boolean,
};

const isMcpResult = (value : unknown) : value is McpResult =>
    typeof value === 'object' && value !== null && Array.isArray((value as McpResult).content);

// What executeTool returns varies: Chrome hands back the tool's result as a
// JSON string, and a glottis page (0.4 and later) returns MCP's tool result
// shape, with failures marked isError rather than thrown, so their message
// survives. Both become an outcome here.
export const readNativeResult = (raw : unknown) : ToolOutcome => {
    const value = typeof raw === 'string'
        ? parseJson(raw)
        : raw;

    if (!isMcpResult(value)) {
        return { ok: true, result: value };
    }

    const text = value.content.map(part => part.text ?? '').join('\n');

    return value.isError
        ? { ok: false, error: text || `The tool failed.` }
        : { ok: true, result: value.structuredContent ?? parseJson(text) };
};

const parseSchema = (schema : unknown) : Readonly<Record<string, unknown>> => {
    const value = typeof schema === 'string'
        ? parseJson(schema)
        : schema;

    return value !== null && typeof value === `object`
        ? value as Readonly<Record<string, unknown>>
        : { type: `object`, properties: {} };
};

type NativePageApiOptions = {
    readonly modelContext : ModelContext,
    readonly tools : ReadonlyArray<NativeTool>,
    readonly url : string,
};

export const nativePageApi = ({ modelContext, tools, url } : NativePageApiOptions) : PageApi => ({
    page:  { url, title: '' },
    route: 'native',
    tools: tools.map(tool => ({ name: tool.name, description: tool.description ?? ``, inputSchema: parseSchema(tool.inputSchema) })),

    callTool: async ({ name, args }) => {
        const tool = tools.find(candidate => candidate.name === name);

        if (!tool) {
            return { ok: false, error: `Unknown tool "${ name }".` };
        }

        try {
            return readNativeResult(await modelContext.executeTool(tool, args));
        } catch (err) {
            return { ok: false, error: errorMessage(err) };
        }
    }
});

// The browser's WebMCP, when it has one.
export const getModelContext = () : ModelContext | undefined => {
    const found = (document as unknown as { readonly modelContext ?: Partial<ModelContext> }).modelContext;

    return typeof found?.getTools === `function` && typeof found.executeTool === `function`
        ? found as ModelContext
        : undefined;
};

// Native tools the page at `url` exposes to this panel, or none. Asking for
// them by origin is required: a plain getTools() leaves other origins' tools
// out. Without the "tools" permission, getTools throws.
type FindNativeToolsOptions = { readonly modelContext : ModelContext | undefined, readonly url : string };

export const findNativeTools = async ({
    modelContext,
    url
} : FindNativeToolsOptions) : Promise<ReadonlyArray<NativeTool>> => {
    if (!modelContext) {
        return [];
    }

    try {
        return await modelContext.getTools({ fromOrigins: [ new URL(url).origin ] });
    } catch {
        return [];
    }
};

export type GlottisConnect = (options : {
    readonly target : HTMLIFrameElement,
    readonly domain : string,
    readonly timeout : number,
    readonly onExportsChange : (info : { readonly exports : unknown, readonly manifest : Manifest }) => void,
    readonly onReconnect : (info : { readonly exports : unknown, readonly manifest : Manifest }) => void,
    readonly onDisconnect : (info : { readonly reason : string }) => void,
}) => Promise<Connection>;

type OpenedPage =
    | { readonly kind : 'page', readonly api : PageApi, readonly disconnect : () => Promise<void> }
    | { readonly kind : 'none' }
    | { readonly kind : 'declined', readonly message : string };

const delay = (ms : number) : Promise<'late'> => new Promise(resolve => {
    setTimeout(() => {
        resolve('late');
    }, ms);
});

type UseGlottisOptions = {
    readonly connection : Connection,
    readonly url : string,
    readonly onPage : (api : PageApi) => void,
    readonly disconnect : () => Promise<void>,
};

const useGlottis = ({ connection, url, onPage, disconnect } : UseGlottisOptions) : OpenedPage => {
    const api = glottisPageApi({ exports: connection.exports, manifest: connection.manifest, url });

    onPage(api);

    return { kind: 'page', api, disconnect };
};

type WatchNativeToolsOptions = {
    readonly modelContext : ModelContext | undefined,
    readonly url : string,
    // Stop looking once this settles.
    readonly until : Promise<unknown>,
};

// Resolves with the page's native tools as soon as there are some, looking
// again whenever the browser says tools changed; resolves with none once
// `until` settles.
const watchNativeTools = ({
    modelContext,
    url,
    until
} : WatchNativeToolsOptions) : Promise<ReadonlyArray<NativeTool>> => new Promise(resolve => {
    let done = false;

    const finish = (tools : ReadonlyArray<NativeTool>) : void => {
        if (!done) {
            done = true;
            // eslint-disable-next-line @typescript-eslint/no-use-before-define -- finish and look call each other
            modelContext?.removeEventListener?.('toolchange', look);
            resolve(tools);
        }
    };

    const look = () : void => {
        findNativeTools({ modelContext, url }).then(tools => {
            if (tools.length) {
                finish(tools);
            }
        }).catch(reportError('could not list native tools'));
    };

    modelContext?.addEventListener?.('toolchange', look);
    look();

    until.then(() => {
        finish([]);
    }).catch(reportError('could not wait for glottis'));
});

type OpenPageOptions = {
    readonly frame : HTMLIFrameElement,
    readonly url : string,
    readonly connect : GlottisConnect,
    readonly modelContext : ModelContext | undefined,
    // Called whenever the page's tools are known or change.
    readonly onPage : (api : PageApi) => void,
    // Called when the page navigated somewhere that offers no tools.
    readonly onGone : () => void,
    readonly timeout ?: number,
    // How long to wait for glottis once native tools were found.
    readonly nativeGrace ?: number,
};

// Connects to the page loaded in `frame`. Resolves with the route to use for
// calls: glottis if it answers, else native, else none or declined.
export const openPage = async ({
    frame,
    url,
    connect,
    modelContext,
    onPage,
    onGone,
    timeout = 6000,
    nativeGrace = 1500
} : OpenPageOptions) : Promise<OpenedPage> => {
    let current : Connection | undefined;
    let closed = false;

    const glottis = connect({
        target: frame,
        domain: '*',
        timeout,

        onExportsChange: ({ exports, manifest }) => {
            if (!closed) {
                onPage(glottisPageApi({ exports, manifest, url }));
            }
        },

        onReconnect: ({ exports, manifest }) => {
            if (!closed) {
                onPage(glottisPageApi({ exports, manifest, url }));
            }
        },

        onDisconnect: ({ reason }) => {
            if (!closed && reason === 'gone') {
                onGone();
            }
        }
    }).then(connection => {
        current = connection;

        return { ok: true as const, connection };
    }, (err : unknown) => ({ ok: false as const, err }));

    const disconnect = async () : Promise<void> => {
        closed = true;

        await current?.disconnect().catch(reportError('could not disconnect from the page'));
    };

    // A page may register its tools after it has loaded, so native tools are
    // looked for until glottis has answered or given up.
    const nativeSearch = watchNativeTools({ modelContext, url, until: glottis });

    const first = await Promise.race([
        glottis.then(result => ({ via: 'glottis' as const, result })),
        nativeSearch.then(tools => ({ via: 'native' as const, tools }))
    ]);

    const nativeTools = first.via === 'native'
        ? first.tools
        : [];

    if (modelContext && nativeTools.length) {
        const native = nativePageApi({ modelContext, tools: nativeTools, url });

        onPage(native);

        const answer = await Promise.race([ glottis, delay(nativeGrace) ]);

        if (answer !== 'late' && answer.ok) {
            return useGlottis({ connection: answer.connection, url, onPage, disconnect });
        }

        // glottis may still answer later; if it does, it takes over.
        glottis.then(late => {
            if (!closed && late.ok) {
                onPage(glottisPageApi({ exports: late.connection.exports, manifest: late.connection.manifest, url }));
            }
        }).catch(reportError('could not switch to glottis'));

        return { kind: 'page', api: native, disconnect };
    }

    const answer = await glottis;

    if (answer.ok) {
        return useGlottis({ connection: answer.connection, url, onPage, disconnect });
    }

    // One last look, for tools registered just as glottis gave up.
    const lateTools = await findNativeTools({ modelContext, url });

    if (modelContext && lateTools.length) {
        const native = nativePageApi({ modelContext, tools: lateTools, url });

        onPage(native);

        return { kind: 'page', api: native, disconnect };
    }

    return answer.err instanceof Error && answer.err.name !== 'ConnectTimeoutError'
        ? { kind: 'declined', message: answer.err.message }
        : { kind: 'none' };
};

// What the user typed in the address bar, as a URL: "shop.example" becomes
// https://shop.example/. Undefined when it cannot be one.
export const normalizeUrl = (input : string) : string | undefined => {
    const text = input.trim();

    if (!text) {
        return undefined;
    }

    try {
        return new URL((/^[a-z][\d+.a-z-]*:/i).test(text)
            ? text
            : `https://${ text }`).href;
    } catch {
        return undefined;
    }
};

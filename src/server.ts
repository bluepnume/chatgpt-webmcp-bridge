// The bridge's MCP server: one standard request handler.
//
// It does almost nothing on purpose. ChatGPT calls its two tools, and the
// server answers with text for the model plus a little structured data for
// the panel. All the real work happens in the panel, in the user's browser:
// it loads the page, runs the page's tools there and posts their results
// back into the conversation. The server never sees a page or a result.
//
// The handler speaks MCP over streamable HTTP without sessions or streams,
// in both protocol generations ChatGPT uses: the 2026 one (no handshake, a
// version in each request's _meta, results marked complete and cacheable)
// and the 2025 one (an initialize handshake first).

import { DEFAULT_DEMO_URL, PACKAGE_NAME, PANEL_MIME_TYPE, PANEL_URI, TOOL_NAME, VERSION } from './constants';

import { renderPanelHtml } from './panel-html';

export type BridgeServerOptions = {
    // Where the server lives under its origin, e.g. '/chatgpt-webmcp-bridge'.
    // The MCP endpoint is `${ basePath }/mcp`. Defaults to the root.
    readonly basePath ?: string,
    // The page the panel's "Try" button opens. null removes the button.
    readonly demoUrl ?: string | null,
    // Origins of the pages the panel may show, besides the demo's. ChatGPT
    // only lets the panel frame origins listed here, exactly: no wildcards.
    readonly frameDomains ?: ReadonlyArray<string>,
};

export type BridgeHandler = (request : Request) => Promise<Response>;

type JsonRpcId = string | number | null;

type JsonRpcMessage = {
    readonly jsonrpc ?: string,
    readonly id ?: JsonRpcId,
    readonly method ?: string,
    readonly params ?: Readonly<Record<string, unknown>>,
};

const MODERN_VERSIONS : ReadonlyArray<string> = [ '2026-07-28' ];
const LEGACY_VERSIONS : ReadonlyArray<string> = [ '2025-11-25', '2025-06-18', '2025-03-26' ];
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

const SERVER_INFO = { name: PACKAGE_NAME, title: 'ChatGPT WebMCP bridge', version: VERSION };
const CAPABILITIES = { tools: {}, resources: {} };

// ChatGPT's 2026 protocol refuses lists and reads without these.
const CACHE = { ttlMs: 300_000, cacheScope: 'public' };

const CORS_HEADERS = {
    'access-control-allow-origin':  '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': `content-type, accept, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, authorization`
};

const JSON_RPC_ERROR = {
    PARSE:            -32_700,
    INVALID_REQUEST:  -32_600,
    METHOD_NOT_FOUND: -32_601,
    INVALID_PARAMS:   -32_602
} as const;

type RpcErrorOptions = { readonly code : number, readonly message : string };

class RpcError extends Error {
    readonly code : number;

    constructor({ code, message } : RpcErrorOptions) {
        super(message);
        this.name = 'RpcError';
        this.code = code;
    }
}

type InstructionsForOptions = { readonly demoUrl : string | null, readonly framedOrigins : ReadonlyArray<string> };

const instructionsFor = ({ demoUrl, framedOrigins } : InstructionsForOptions) : string => [
    'This server lets you use the tools a web page offers, in a small browser panel in the chat.',
    `Call ${ TOOL_NAME.OPEN_BROWSER } to open the panel, optionally at a url; with no url the user picks a page${
        demoUrl
            ? ` (a demo shop, ${ demoUrl }, is one click away)`
            : ''
        }. The panel can only show pages on these origins: ${ framedOrigins.join(', ') || 'none' }.`,
    `With a url, the page's tools arrive afterwards as a short message beginning "✓ Opened" with the tools attached as JSON: end your turn briefly, then carry on with the user's request when it arrives. The tools of a page the user opened arrive the same way, and are also in the conversation context.`,
    `To use one, call ${ TOOL_NAME.CALL_SITE_TOOL } with "url" (that page), "tool" (the tool name) and "arguments" (an object). The page runs it in the user's browser, and its real result arrives afterwards as a short message naming the call, with the result attached as JSON. Do not guess the result, and write nothing after the call: end your turn without any text, then answer from that message when it arrives.`
].join(' ');

type ServerSetup = {
    readonly demoUrl : string | null,
    readonly framedOrigins : ReadonlyArray<string>,
    readonly panelUri : string,
    readonly panelMeta : Readonly<Record<string, unknown>>,
};

// A short, stable hash, to tell one set of settings from another.
const shortHash = (text : string) : string => {
    let hash = 7;

    for (const character of text) {
        hash = ((hash * 31) + (character.codePointAt(0) ?? 0)) % 2_147_483_647;
    }

    return hash.toString(36);
};

type Tool = Readonly<Record<string, unknown>>;

const toolsFor = ({ demoUrl, framedOrigins, panelUri } : ServerSetup) : ReadonlyArray<Tool> => {
    // Which panel ChatGPT opens for the tool. The panel's own settings ride on the resource.
    const uiMeta = { ui: { resourceUri: panelUri } };

    return [
        {
            name:        TOOL_NAME.OPEN_BROWSER,
            title:       'WebMCP browser',
            description: `Opens a small browser panel, at url if given. When the page loads, its tools are listed in the conversation context; call them with ${ TOOL_NAME.CALL_SITE_TOOL }. With no url the user enters one${
                demoUrl
                    ? ' or tries the demo shop'
                    : ''
                }. Only pages on these origins can be shown: ${ framedOrigins.join(', ') || 'none' }.`,
            inputSchema: {
                type:       'object',
                properties: {
                    url: {
                        type:        'string',
                        description: `The page to open${
                            demoUrl
                                ? `, e.g. "${ demoUrl }"`
                                : ''
                            }. Omit it to let the user choose.`
                    }
                },
                additionalProperties: false
            },
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
            _meta:       { ...uiMeta, 'openai/toolInvocation/invoking': `Opening the browser…`, 'openai/toolInvocation/invoked': `Browser` }
        },
        {
            name:        TOOL_NAME.CALL_SITE_TOOL,
            title:       'WebMCP browser',
            description: `Runs a tool offered by a page (listed in the conversation context after the page loads in ${ TOOL_NAME.OPEN_BROWSER }). A panel loads the url and the page runs the tool in the user's browser; the result is not returned here but arrives afterwards as a short message naming the call, with the result attached as JSON.`,
            inputSchema: {
                type:       'object',
                properties: {
                    url:       { type: `string`, description: `The page whose tool to run, as given in the conversation context.` },
                    tool:      { type: 'string', description: 'The tool to run, e.g. "add_to_cart".' },
                    arguments: { type: `object`, description: `Arguments for that tool, matching its parameters.`, additionalProperties: true }
                },
                required:             [ 'url', 'tool' ],
                additionalProperties: false
            },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
            _meta:       { ...uiMeta, 'openai/toolInvocation/invoking': `Handing the call to the page…`, 'openai/toolInvocation/invoked': `Sent to the page` }
        }
    ];
};

type ToolResultOptions = { readonly text : string, readonly structured : Readonly<Record<string, unknown>> };

const toolResult = ({ text, structured } : ToolResultOptions) : Readonly<Record<string, unknown>> => ({
    content:           [ { type: 'text', text } ],
    structuredContent: structured
});

type CallToolOptions = {
    readonly name : string,
    readonly args : Readonly<Record<string, unknown>>,
};

// The panel tells panels apart by when they opened (opened_at), so it is
// stamped here: ChatGPT keeps a tool result, so the stamp survives a reload.
const callTool = ({ name, args } : CallToolOptions) : Readonly<Record<string, unknown>> => {
    switch (name) {
        case TOOL_NAME.OPEN_BROWSER: {
            const url = typeof args.url === 'string' && args.url
                ? args.url
                : null;

            return toolResult({
                text: url
                    ? `Opening ${ url } in the panel. Its tools are not known yet: they arrive as the next message, beginning "✓ Opened", with the tools attached as JSON. Say briefly that the page is opening and wait for that message, then continue with the user's request using ${ TOOL_NAME.CALL_SITE_TOOL }.`
                    : `Opened the browser panel. The user can enter a URL or try the demo shop; the page's tools then arrive as a message.`,
                structured: { url, opened_at: Date.now() }
            });
        }

        case TOOL_NAME.CALL_SITE_TOOL: {
            const url = typeof args.url === 'string'
                ? args.url
                : '';

            const tool = typeof args.tool === 'string'
                ? args.tool
                : '';

            if (!url || !tool) {
                throw new RpcError({ code: JSON_RPC_ERROR.INVALID_PARAMS, message: 'url and tool are required' });
            }

            const callId = crypto.randomUUID();

            return toolResult({
                text:       `Handed ${ tool } to ${ url } in the panel (call ${ callId.slice(0, 8) }). Its result is not available yet: it arrives as the next message, naming "call ${ callId.slice(0, 8) }", with the result attached as JSON. Write nothing now: end your turn without any text, and answer the user from that message when it arrives, instead of guessing the outcome.`,
                structured: { call_id: callId, url, tool, arguments: args.arguments ?? {}, opened_at: Date.now() }
            });
        }

        default:
            throw new RpcError({ code: JSON_RPC_ERROR.INVALID_PARAMS, message: `Unknown tool: ${ name }` });
    }
};

type DispatchOptions = {
    readonly message : JsonRpcMessage,
    readonly setup : ServerSetup,
    readonly panelHtml : string,
};

const dispatch = ({ message, setup, panelHtml } : DispatchOptions) : Readonly<Record<string, unknown>> => {
    const params = message.params ?? {};
    const instructions = instructionsFor({ demoUrl: setup.demoUrl, framedOrigins: setup.framedOrigins });

    const panelResource = {
        uri:      setup.panelUri,
        name:     'panel',
        title:    'WebMCP bridge panel',
        mimeType: PANEL_MIME_TYPE,
        _meta:    setup.panelMeta
    };

    switch (message.method ?? '') {
        case 'initialize': {
            const requested = typeof params.protocolVersion === 'string'
                ? params.protocolVersion
                : '';

            return {
                protocolVersion: LEGACY_VERSIONS.includes(requested)
                    ? requested
                    : LEGACY_VERSIONS[0],
                capabilities: CAPABILITIES,
                serverInfo:   SERVER_INFO,
                instructions
            };
        }

        case 'server/discover':
            return { supportedVersions: MODERN_VERSIONS, capabilities: CAPABILITIES, instructions, ...CACHE };

        case 'ping':
            return {};

        case 'tools/list':
            return { tools: toolsFor(setup), ...CACHE };

        case 'tools/call':
            return callTool({
                name: typeof params.name === 'string'
                    ? params.name
                    : '',
                args: typeof params.arguments === `object` && params.arguments !== null
                    ? params.arguments as Readonly<Record<string, unknown>>
                    : {}
            });

        case 'resources/list':
            return { resources: [ panelResource ], ...CACHE };

        case 'resources/templates/list':
            return { resourceTemplates: [] };

        case 'resources/read': {
            const uri = typeof params.uri === 'string'
                ? params.uri
                : '';

            if (uri !== setup.panelUri) {
                throw new RpcError({ code: JSON_RPC_ERROR.INVALID_PARAMS, message: `Unknown resource: ${ uri }` });
            }

            return { contents: [ { ...panelResource, text: panelHtml } ], ...CACHE };
        }

        default:
            throw new RpcError({
                code:    JSON_RPC_ERROR.METHOD_NOT_FOUND,
                message: `Method not found: ${ String(message.method) }`
            });
    }
};

type JsonResponseOptions = { readonly body : unknown, readonly status ?: number };

const jsonResponse = ({ body, status = 200 } : JsonResponseOptions) : Response =>
    Response.json(body, { status, headers: { 'content-type': 'application/json', ...CORS_HEADERS } });

type RpcErrorResponseOptions = {
    readonly id : JsonRpcId,
    readonly code : number,
    readonly message : string,
    readonly status ?: number,
};

const rpcErrorResponse = ({ id, code, message, status = 200 } : RpcErrorResponseOptions) : Response =>
    jsonResponse({ status, body: { jsonrpc: '2.0', id, error: { code, message } } });

// A request is in the 2026 protocol when it says so in its _meta, or sends a
// version header that is not one of the 2025 ones.
type IsModernOptions = { readonly request : Request, readonly message : JsonRpcMessage };

const isModern = ({ request, message } : IsModernOptions) : boolean => {
    const meta = (message.params?._meta ?? {}) as Readonly<Record<string, unknown>>;
    const header = request.headers.get('mcp-protocol-version');

    return typeof meta[META_VERSION] === 'string' ||
        (header !== null && !LEGACY_VERSIONS.includes(header) && message.method !== 'initialize');
};

type HandleRpcOptions = {
    readonly request : Request,
    readonly setup : ServerSetup,
    readonly panelHtml : string,
};

const handleRpc = async ({ request, setup, panelHtml } : HandleRpcOptions) : Promise<Response> => {
    let body : unknown;

    try {
        body = await request.json();
    } catch {
        return rpcErrorResponse({ id: null, code: JSON_RPC_ERROR.PARSE, message: `Parse error: the body must be JSON`, status: 400 });
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return rpcErrorResponse({ id: null, code: JSON_RPC_ERROR.INVALID_REQUEST, message: `Invalid request: send one JSON-RPC message`, status: 400 });
    }

    const message = body as JsonRpcMessage;
    const id = message.id ?? null;

    // A notification: nothing to answer.
    if (id === null) {
        return new Response(null, { status: 202, headers: CORS_HEADERS });
    }

    try {
        const result = dispatch({ message, setup, panelHtml });

        return jsonResponse({
            body: {
                jsonrpc: '2.0',
                id,
                result:  isModern({ request, message })
                    ? { resultType: 'complete', ...result, _meta: { [ META_SERVER_INFO ]: SERVER_INFO } }
                    : result
            }
        });
    } catch (err) {
        if (err instanceof RpcError) {
            return rpcErrorResponse({ id, code: err.code, message: err.message });
        }

        throw err;
    }
};

const normalizeBasePath = (basePath : string) : string => {
    const trimmed = basePath.replace(/\/+$/, '');

    if (!trimmed) {
        return '';
    }

    return trimmed.startsWith('/')
        ? trimmed
        : `/${ trimmed }`;
};

// Builds the request handler. Run it anywhere that speaks the standard
// Request and Response: Cloudflare Workers, Deno, Bun, or Node with the
// adapter in ./node.
export const createBridgeHandler = ({ basePath = ``, demoUrl = DEFAULT_DEMO_URL, frameDomains = [] } : BridgeServerOptions = {}) : BridgeHandler => {
    const base = normalizeBasePath(basePath);
    const endpoint = `${ base }/mcp`;

    // The demo's origin is always framed, so the Try button works.
    const framedOrigins = [ ...new Set([ ...demoUrl
        ? [ new URL(demoUrl).origin ]
        : [], ...frameDomains ]) ];

    const setup : ServerSetup = {
        demoUrl,
        framedOrigins,
        panelUri:  `${ PANEL_URI }-${ shortHash(JSON.stringify({ demoUrl, framedOrigins })) }`,
        panelMeta: {
            'ui': {
                prefersBorder: true,
                csp:           { resourceDomains: [], connectDomains: [], frameDomains: framedOrigins }
            },
            'openai/ui': { availableDisplayModes: [ 'inline' ], preferredDisplayMode: 'inline' }
        }
    };

    const panelHtml = renderPanelHtml({ demoUrl });

    return async (request : Request) : Promise<Response> => {
        const { pathname, origin } = new URL(request.url);

        if (pathname === endpoint) {
            switch (request.method) {
                case 'POST':
                    return await handleRpc({ request, setup, panelHtml });

                case 'OPTIONS':
                    return new Response(null, { status: 204, headers: CORS_HEADERS });

                // Streamable HTTP clients probe with GET for an event stream; there is none.
                default:
                    return new Response(null, { status: 405, headers: { allow: 'POST, OPTIONS', ...CORS_HEADERS } });
            }
        }

        if (request.method === 'GET' && (pathname === base || pathname === `${ base }/`)) {
            return new Response(
                `This is a ${ PACKAGE_NAME } ${ VERSION } server.\n\nIn ChatGPT's developer mode, add a custom MCP server with this URL:\n\n  ${ origin }${ endpoint }\n\nDocs: https://github.com/bluepnume/${ PACKAGE_NAME }\n`,
                { headers: { 'content-type': 'text/plain; charset=utf-8' } }
            );
        }

        return new Response('Not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    };
};

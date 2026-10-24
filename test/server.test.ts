import { createBridgeHandler, DEFAULT_DEMO_URL, PANEL_URI, TOOL_NAME, VERSION } from '../src';

type RpcBody = {
    readonly id ?: number | string | null,
    readonly result ?: Readonly<Record<string, unknown>>,
    readonly error ?: { readonly code : number, readonly message : string },
};

const ORIGIN = 'https://bridge.example';

type RpcOptions = {
    readonly method : string,
    readonly params ?: Readonly<Record<string, unknown>>,
    readonly id ?: number | null,
    readonly path ?: string,
    readonly headers ?: Readonly<Record<string, string>>,
    readonly handler ?: ReturnType<typeof createBridgeHandler>,
};

const rpc = async ({ method, params, id = 1, path = `/mcp`, headers = {}, handler = createBridgeHandler() } : RpcOptions) : Promise<{ readonly status : number, readonly body : RpcBody }> => {
    const response = await handler(new Request(`${ ORIGIN }${ path }`, {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body:    JSON.stringify({
            jsonrpc: '2.0',
            ...id === null
                ? {}
                : { id },
            method,
            ...params
                ? { params }
                : {}
        })
    }));

    const text = await response.text();

    return {
        status: response.status,
        body:   text
            ? JSON.parse(text) as RpcBody
            : {}
    };
};

const MODERN = { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } };

describe('the 2025 protocol', () => {
    it('answers initialize with the version asked for, or the newest it knows', async () => {
        const known = await rpc({ method: 'initialize', params: { protocolVersion: '2025-06-18' } });
        const unknown = await rpc({ method: 'initialize', params: { protocolVersion: '1999-01-01' } });

        expect(known.body.result).toMatchObject({ protocolVersion: `2025-06-18`, serverInfo: { name: `chatgpt-webmcp-bridge`, version: VERSION } });
        expect(unknown.body.result?.protocolVersion).toBe('2025-11-25');
        expect(String(unknown.body.result?.instructions)).toContain(TOOL_NAME.OPEN_BROWSER);
    });

    it('lists the two tools, each pointing at the panel', async () => {
        const { body } = await rpc({ method: 'tools/list' });
        type Tool = { readonly name : string, readonly _meta : { readonly ui : { readonly resourceUri : string } } };

        const tools = body.result?.tools as ReadonlyArray<Tool>;

        expect(tools.map(tool => tool.name)).toEqual([ TOOL_NAME.OPEN_BROWSER, TOOL_NAME.CALL_SITE_TOOL ]);
        expect(tools.every(tool => tool._meta.ui.resourceUri === PANEL_URI)).toBe(true);
        // The 2025 protocol has no result wrapper.
        expect(body.result?.resultType).toBeUndefined();
    });

    it('answers ping and an empty template list', async () => {
        expect((await rpc({ method: 'ping' })).body.result).toEqual({});
        expect((await rpc({ method: 'resources/templates/list' })).body.result).toEqual({ resourceTemplates: [] });
    });

    it('accepts notifications without answering', async () => {
        const { status } = await rpc({ method: 'notifications/initialized', id: null });

        expect(status).toBe(202);
    });
});

describe('the 2026 protocol', () => {
    it('wraps results and marks them cacheable, by _meta or by header', async () => {
        const byMeta = await rpc({ method: 'tools/list', params: MODERN });
        const byHeader = await rpc({ method: 'tools/list', headers: { 'mcp-protocol-version': '2026-07-28' } });

        for (const { body } of [ byMeta, byHeader ]) {
            expect(body.result).toMatchObject({ resultType: 'complete', ttlMs: 300_000, cacheScope: 'public' });

            expect(body.result?._meta).toEqual({
                'io.modelcontextprotocol/serverInfo': expect.objectContaining({ version: VERSION }) as unknown
            });
        }
    });

    it('treats a 2025 version header as the 2025 protocol', async () => {
        const { body } = await rpc({ method: 'tools/list', headers: { 'mcp-protocol-version': '2025-06-18' } });

        expect(body.result?.resultType).toBeUndefined();
    });

    it('answers server/discover', async () => {
        const { body } = await rpc({ method: 'server/discover', params: MODERN });

        expect(body.result).toMatchObject({ supportedVersions: [ '2026-07-28' ], ttlMs: 300_000 });
    });
});

describe('the panel resource', () => {
    it('is listed and read, with the demo URL in the panel', async () => {
        const listed = await rpc({ method: 'resources/list', params: MODERN });
        const read = await rpc({ method: 'resources/read', params: { ...MODERN, uri: PANEL_URI } });
        type Content = { readonly text : string, readonly mimeType : string, readonly uri : string };

        const [ content ] = read.body.result?.contents as ReadonlyArray<Content>;

        expect((listed.body.result?.resources as ReadonlyArray<{ readonly uri : string }>)[0]?.uri).toBe(PANEL_URI);
        expect(read.body.result).toMatchObject({ ttlMs: 300_000, cacheScope: 'public' });
        expect(content?.mimeType).toBe('text/html;profile=mcp-app');
        expect(content?.text).toContain('<!doctype html>');
        expect(content?.text).toContain(JSON.stringify(DEFAULT_DEMO_URL));
    });

    it('carries no demo button when demoUrl is null', async () => {
        const handler = createBridgeHandler({ demoUrl: null });
        const read = await rpc({ method: 'resources/read', params: { uri: PANEL_URI }, handler });
        const [ content ] = read.body.result?.contents as ReadonlyArray<{ readonly text : string }>;

        expect(content?.text).toContain('{"demoUrl":null}');
        expect(String((await rpc({ method: `initialize`, handler })).body.result?.instructions)).not.toContain(`demo shop`);
    });

    it('declares the frame domains it was given', async () => {
        const handler = createBridgeHandler({ frameDomains: [ 'https://shop.example' ] });
        const { body } = await rpc({ method: 'resources/list', handler });

        type Resource = {
            readonly _meta : { readonly ui : { readonly csp : { readonly frameDomains : ReadonlyArray<string> } } },
        };

        const [ resource ] = body.result?.resources as ReadonlyArray<Resource>;

        expect(resource?._meta.ui.csp.frameDomains).toEqual([ 'https://shop.example' ]);
    });

    it('refuses an unknown resource', async () => {
        const { body } = await rpc({ method: 'resources/read', params: { uri: 'ui://something/else' } });

        expect(body.error).toMatchObject({ code: -32_602, message: 'Unknown resource: ui://something/else' });
    });
});

describe('tools/call', () => {
    it('opens the browser, with or without a url, stamping when', async () => {
        const before = Date.now();
        const withUrl = await rpc({ method: `tools/call`, params: { name: TOOL_NAME.OPEN_BROWSER, arguments: { url: `https://shop.example/` } } });
        const without = await rpc({ method: 'tools/call', params: { name: TOOL_NAME.OPEN_BROWSER } });

        expect(withUrl.body.result?.structuredContent).toMatchObject({ url: 'https://shop.example/' });
        const opened = withUrl.body.result?.structuredContent as { readonly opened_at : number };

        expect(opened.opened_at).toBeGreaterThanOrEqual(before);
        expect(JSON.stringify(withUrl.body.result?.content)).toContain('✓ Opened');
        expect(without.body.result?.structuredContent).toMatchObject({ url: null });
    });

    it('hands a call to the panel with a fresh call id', async () => {
        const params = { name: TOOL_NAME.CALL_SITE_TOOL, arguments: { url: `https://shop.example/`, tool: `add_to_cart`, arguments: { product_id: `mug-blue` } } };
        const first = await rpc({ method: 'tools/call', params });
        const second = await rpc({ method: 'tools/call', params });
        const firstContent = first.body.result?.structuredContent as Readonly<Record<string, unknown>>;
        const secondContent = second.body.result?.structuredContent as Readonly<Record<string, unknown>>;

        expect(firstContent).toMatchObject({ url: `https://shop.example/`, tool: `add_to_cart`, arguments: { product_id: `mug-blue` } });
        expect(firstContent.call_id).toMatch(/^[\da-f-]{36}$/);
        expect(firstContent.call_id).not.toBe(secondContent.call_id);
        expect(JSON.stringify(first.body.result?.content)).toContain(`call ${ String(firstContent.call_id).slice(0, 8) }`);
    });

    it('defaults a call\'s arguments to none', async () => {
        const { body } = await rpc({ method: `tools/call`, params: { name: TOOL_NAME.CALL_SITE_TOOL, arguments: { url: `https://shop.example/`, tool: `view_cart` } } });

        expect(body.result?.structuredContent).toMatchObject({ arguments: {} });
    });

    it('needs a url and a tool', async () => {
        const { body } = await rpc({ method: `tools/call`, params: { name: TOOL_NAME.CALL_SITE_TOOL, arguments: { tool: `view_cart` } } });

        expect(body.error).toMatchObject({ code: -32_602, message: 'url and tool are required' });
    });

    it('needs the tool to be a name, and the call to name a tool', async () => {
        const notAName = await rpc({ method: `tools/call`, params: { name: TOOL_NAME.CALL_SITE_TOOL, arguments: { url: `https://shop.example/`, tool: 7 } } });
        const noName = await rpc({ method: 'tools/call', params: {} });
        const noUri = await rpc({ method: 'resources/read', params: {} });

        expect(notAName.body.error?.message).toBe('url and tool are required');
        expect(noName.body.error?.message).toBe('Unknown tool: ');
        expect(noUri.body.error?.message).toBe('Unknown resource: ');
    });

    it('describes the tools without a demo when there is none', async () => {
        const { body } = await rpc({ method: 'tools/list', handler: createBridgeHandler({ demoUrl: null }) });

        expect(JSON.stringify(body.result?.tools)).not.toContain('demo');
    });

    it('refuses an unknown tool', async () => {
        const { body } = await rpc({ method: 'tools/call', params: { name: 'nope', arguments: 'not an object' } });

        expect(body.error?.message).toBe('Unknown tool: nope');
    });
});

describe('HTTP', () => {
    it('refuses an unknown method', async () => {
        const { body } = await rpc({ method: 'nope/nope' });

        expect(body.error).toMatchObject({ code: -32_601, message: 'Method not found: nope/nope' });
    });

    it('answers a request with no method', async () => {
        const handler = createBridgeHandler();
        const response = await handler(new Request(`${ ORIGIN }/mcp`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 3 }) }));

        expect(((await response.json()) as RpcBody).error?.message).toBe('Method not found: undefined');
    });

    it('rejects a body that is not one JSON-RPC message', async () => {
        const handler = createBridgeHandler();
        const notJson = await handler(new Request(`${ ORIGIN }/mcp`, { method: 'POST', body: '{' }));
        const batch = await handler(new Request(`${ ORIGIN }/mcp`, { method: 'POST', body: '[]' }));

        expect(notJson.status).toBe(400);
        expect(((await notJson.json()) as RpcBody).error?.code).toBe(-32_700);
        expect(batch.status).toBe(400);
        expect(((await batch.json()) as RpcBody).error?.code).toBe(-32_600);
    });

    it('answers CORS preflight and refuses GET on the endpoint', async () => {
        const handler = createBridgeHandler();
        const preflight = await handler(new Request(`${ ORIGIN }/mcp`, { method: 'OPTIONS' }));
        const probe = await handler(new Request(`${ ORIGIN }/mcp`));

        expect(preflight.status).toBe(204);
        expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
        expect(probe.status).toBe(405);
        expect(probe.headers.get('allow')).toBe('POST, OPTIONS');
    });

    it('serves under a base path, with a help page at the base', async () => {
        const handler = createBridgeHandler({ basePath: 'chatgpt-webmcp-bridge/' });
        const help = await handler(new Request(`${ ORIGIN }/chatgpt-webmcp-bridge/`));
        const helpNoSlash = await handler(new Request(`${ ORIGIN }/chatgpt-webmcp-bridge`));
        const { body } = await rpc({ method: 'ping', path: '/chatgpt-webmcp-bridge/mcp', handler });
        const elsewhere = await handler(new Request(`${ ORIGIN }/mcp`, { method: 'POST', body: '{}' }));

        expect(await help.text()).toContain(`${ ORIGIN }/chatgpt-webmcp-bridge/mcp`);
        expect(helpNoSlash.status).toBe(200);
        expect(body.result).toEqual({});
        expect(elsewhere.status).toBe(404);
    });

    it('serves a help page at the root by default', async () => {
        const handler = createBridgeHandler({ basePath: '/' });
        const help = await handler(new Request(`${ ORIGIN }/`));

        expect(await help.text()).toContain(`${ ORIGIN }/mcp`);
    });
});

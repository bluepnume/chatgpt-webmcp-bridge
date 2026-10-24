import worker, { optionsFromEnv } from './worker';

describe('the Cloudflare Worker', () => {
    it('reads its settings from the environment', () => {
        expect(optionsFromEnv({})).toEqual({});

        expect(optionsFromEnv({ BASE_PATH: `/bridge`, DEMO_URL: `none`, FRAME_DOMAINS: `https://a.example, ,https://b.example` })).toEqual({
            basePath:     '/bridge',
            demoUrl:      null,
            frameDomains: [ 'https://a.example', 'https://b.example' ]
        });

        expect(optionsFromEnv({ DEMO_URL: 'https://demo.example/' })).toEqual({ demoUrl: 'https://demo.example/' });
    });

    it('serves under its base path, reusing one handler per environment', async () => {
        const env = { BASE_PATH: '/chatgpt-webmcp-bridge', DEMO_URL: 'none' };

        type ListResult = { readonly result : { readonly resources : ReadonlyArray<{ readonly uri : string }> } };

        const listed = await (await worker.fetch(new Request('https://w.example/chatgpt-webmcp-bridge/mcp', {
            method: 'POST',
            body:   JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/list' })
        }), env)).json() as ListResult;

        const uri = listed.result.resources[0]?.uri;

        const call = () : Promise<Response> => worker.fetch(new Request('https://w.example/chatgpt-webmcp-bridge/mcp', {
            method: 'POST',
            body:   JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri } })
        }), env);

        type ReadResult = { readonly result : { readonly contents : ReadonlyArray<{ readonly text : string }> } };

        const first = await (await call()).json() as ReadResult;
        const second = await call();

        expect(first.result.contents[0]?.text).toContain('{"demoUrl":null}');
        expect(second.status).toBe(200);
        expect((await worker.fetch(new Request('https://w.example/mcp'))).status).toBe(405);
    });
});

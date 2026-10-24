import type { Connection, Manifest } from 'glottis';

import type { GlottisConnect, ModelContext } from './panel-pages';

import {
    findNativeTools, getModelContext, glottisPageApi, nativePageApi, normalizeUrl,
    openPage, readNativeResult
} from './panel-pages';

const manifest = (functions : Manifest['functions']) : Manifest => ({ service: 'default', protocol: 1, functions });

describe('normalizeUrl', () => {
    it('adds https to a bare host, and refuses what cannot be a URL', () => {
        expect(normalizeUrl(' shop.example ')).toBe('https://shop.example/');
        expect(normalizeUrl('http://a.example/x')).toBe('http://a.example/x');
        expect(normalizeUrl('')).toBeUndefined();
        expect(normalizeUrl('http://')).toBeUndefined();
    });
});

describe('a glottis page', () => {
    it('lists only tool() functions, under their WebMCP names', () => {
        const api = glottisPageApi({
            exports:  { a: { b: () => Promise.resolve(1) }, plain: () => Promise.resolve(2) },
            manifest: manifest({ 'a.b': { tool: true }, 'plain': {}, 'named': { tool: true, name: `given`, description: `D`, input: { type: `object` } } }),
            url:      'https://p.example/'
        });

        expect(api.tools).toEqual([
            { name: 'a_b', description: '', inputSchema: { type: 'object', properties: {} } },
            { name: 'given', description: 'D', inputSchema: { type: 'object' } }
        ]);

        expect(api.page).toEqual({ url: 'https://p.example/', title: '' });
    });

    it('ignores a page constant of the wrong shape', () => {
        const api = glottisPageApi({ exports: { page: { url: 1, title: 2 } }, manifest: manifest({}), url: `https://p.example/` });

        expect(api.page).toEqual({ url: 'https://p.example/', title: '' });
    });

    it('turns a non-Error throw into a message', async () => {
        const api = glottisPageApi({
            exports: {
                odd: () => Promise.reject(new Error('plain')),

                weird: () => {
                    // eslint-disable-next-line no-throw-literal, @typescript-eslint/only-throw-error -- the test is of a throw that is not an Error
                    throw 'a string';
                }
            },
            manifest: manifest({ odd: { tool: true }, weird: { tool: true } }),
            url:      'https://p.example/'
        });

        expect(await api.callTool({ name: 'odd', args: {} })).toEqual({ ok: false, error: 'plain' });
        expect(await api.callTool({ name: 'weird', args: {} })).toEqual({ ok: false, error: 'a string' });
    });
});

describe('native results', () => {
    it('reads Chrome\'s JSON strings, MCP results and plain values', () => {
        expect(readNativeResult('{"a":1}')).toEqual({ ok: true, result: { a: 1 } });
        expect(readNativeResult('not json')).toEqual({ ok: true, result: 'not json' });
        expect(readNativeResult({ content: [ { type: `text`, text: `{"b":2}` } ] })).toEqual({ ok: true, result: { b: 2 } });
        expect(readNativeResult({ content: [ { type: `text`, text: `x` } ], structuredContent: { c: 3 } })).toEqual({ ok: true, result: { c: 3 } });
        expect(readNativeResult({ content: [ { type: `text`, text: `Out of stock` } ], isError: true })).toEqual({ ok: false, error: `Out of stock` });
        expect(readNativeResult({ content: [ {} ], isError: true })).toEqual({ ok: false, error: 'The tool failed.' });
        expect(readNativeResult(5)).toEqual({ ok: true, result: 5 });
    });

    it('lists native tools, parsing string schemas, and reports failures', async () => {
        const modelContext : ModelContext = {
            getTools: () => Promise.resolve([]),

            executeTool: tool => (tool.name === 'bad'
                ? Promise.reject(new Error('UnknownError'))
                : Promise.resolve('{"ok":1}'))
        };

        const api = nativePageApi({
            modelContext,
            tools: [ { name: `good`, inputSchema: `{"type":"object"}` }, { name: `bad`, description: `B`, inputSchema: `nonsense` }, { name: `none` } ],
            url:   'https://n.example/'
        });

        expect(api.tools.map(tool => tool.inputSchema)).toEqual([ { type: `object` }, { type: `object`, properties: {} }, { type: `object`, properties: {} } ]);
        expect(await api.callTool({ name: 'good', args: {} })).toEqual({ ok: true, result: { ok: 1 } });
        expect(await api.callTool({ name: 'bad', args: {} })).toEqual({ ok: false, error: 'UnknownError' });
        expect(await api.callTool({ name: `missing`, args: {} })).toEqual({ ok: false, error: `Unknown tool "missing".` });
    });

    it('finds no tools without WebMCP, or when listing throws', async () => {
        expect(await findNativeTools({ modelContext: undefined, url: 'https://n.example/' })).toEqual([]);

        const refusing : ModelContext = {
            getTools:    () => Promise.reject(new Error(`NotAllowedError`)),
            executeTool: () => Promise.resolve(null)
        };

        expect(await findNativeTools({ modelContext: refusing, url: `https://n.example/` })).toEqual([]);
    });

    it('sees this browser\'s WebMCP, and none where there is none', () => {
        expect(getModelContext()).toBeDefined();

        Object.defineProperty(document, 'modelContext', { value: undefined, configurable: true });

        try {
            expect(getModelContext()).toBeUndefined();
        } finally {
            Reflect.deleteProperty(document, 'modelContext');
        }
    });
});

describe('opening a page', () => {
    const frame = document.createElement('iframe');

    it('reports a refusal that is not an Error as no tools', async () => {
        // eslint-disable-next-line prefer-promise-reject-errors, @typescript-eslint/prefer-promise-reject-errors -- the test is of a refusal that is not an Error
        const connect : GlottisConnect = () => Promise.reject('just a string');

        const opened = await openPage({ frame, url: `https://x.example/`, connect, modelContext: undefined, onPage: () => undefined, onGone: () => undefined });

        expect(opened).toEqual({ kind: 'none' });
    });

    it('uses native tools found as glottis gives up, and ignores glottis events once closed', async () => {
        let calls = 0;
        const pages : Array<string> = [];
        let events : Parameters<GlottisConnect>[0] | undefined;

        const modelContext : ModelContext = {
            getTools: () => {
                const tools = calls > 0
                    ? [ { name: 'late' } ]
                    : [];

                calls += 1;

                return Promise.resolve(tools);
            },

            executeTool: () => Promise.resolve(null)
        };

        const connect : GlottisConnect = options => {
            events = options;

            return Promise.reject(Object.assign(new Error('timed out'), { name: 'ConnectTimeoutError' }));
        };

        const opened = await openPage({ frame, url: `https://x.example/`, connect, modelContext, onPage: api => pages.push(api.route), onGone: () => pages.push(`gone`) });

        expect(opened.kind).toBe('page');
        expect(pages).toEqual([ 'native' ]);

        if (opened.kind === 'page') {
            await opened.disconnect();
        }

        events?.onExportsChange({ exports: {}, manifest: manifest({}) });
        events?.onReconnect({ exports: {}, manifest: manifest({}) });
        events?.onDisconnect({ reason: 'gone' });
        expect(pages).toEqual([ 'native' ]);
    });

    it('follows glottis events while open', async () => {
        const pages : Array<string> = [];
        let events : Parameters<GlottisConnect>[0] | undefined;

        const connection = {
            exports:    {},
            manifest:   manifest({}),
            disconnect: () => Promise.reject(new Error(`already gone`))
        } as unknown as Connection;

        const connect : GlottisConnect = options => {
            events = options;

            return Promise.resolve(connection);
        };

        const opened = await openPage({ frame, url: `https://x.example/`, connect, modelContext: undefined, onPage: api => pages.push(api.route), onGone: () => pages.push(`gone`) });

        events?.onExportsChange({ exports: {}, manifest: manifest({}) });
        events?.onReconnect({ exports: {}, manifest: manifest({}) });
        events?.onDisconnect({ reason: 'navigated' });
        events?.onDisconnect({ reason: 'gone' });

        expect(pages).toEqual([ 'glottis', 'glottis', 'glottis', 'gone' ]);

        if (opened.kind === 'page') {
            await opened.disconnect();
        }
    });
});

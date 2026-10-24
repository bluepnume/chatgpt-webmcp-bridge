import { strFromU8, unzipSync } from 'fflate';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { RunningBridge } from './node';

import { main, USAGE } from './cli';

type Captured = { readonly logs : Array<string>, readonly errors : Array<string> };

type Output = { readonly log : (text : string) => void, readonly error : (text : string) => void };

const capture = () : Captured & { readonly output : Output } => {
    const logs : Array<string> = [];
    const errors : Array<string> = [];

    return { logs, errors, output: { log: text => logs.push(text), error: text => errors.push(text) } };
};

describe('the command line', () => {
    it('prints usage for --help, and fails with usage for no command', async () => {
        const help = capture();
        const none = capture();

        expect(await main({ argv: [ '--help' ], output: help.output })).toBe(0);
        expect(help.logs[0]).toBe(USAGE);
        expect(await main({ argv: [], output: none.output })).toBe(1);
    });

    it('fails on an unknown command or option', async () => {
        const unknown = capture();
        const badOption = capture();

        expect(await main({ argv: [ 'fly' ], output: unknown.output })).toBe(1);
        expect(unknown.errors[0]).toContain('Unknown command "fly"');
        expect(await main({ argv: [ 'serve', '--nope' ], output: badOption.output })).toBe(1);
        expect(badOption.errors[0]).toContain('--nope');
    });

    it('serves with the options given, until stopped', async () => {
        const { output, logs } = capture();
        const calls : Array<unknown> = [];
        let closed = false;

        const code = await main({
            argv: [ 'serve', '--port', '9000', '--host', '0.0.0.0', '--base-path', '/bridge', '--demo-url', 'none' ],
            output,
            deps: {
                serve: options => {
                    calls.push(options);

                    return Promise.resolve({
                        server: {} as never,
                        url:    'http://0.0.0.0:9000',

                        close: () => {
                            closed = true;

                            return Promise.resolve();
                        }
                    });
                },

                untilStopped: () => Promise.resolve()
            }
        });

        expect(code).toBe(0);
        expect(calls).toEqual([ { port: 9000, hostname: '0.0.0.0', basePath: '/bridge', demoUrl: null } ]);
        expect(logs[0]).toContain('http://0.0.0.0:9000/bridge/mcp');
        expect(closed).toBe(true);
    });

    it('serves with defaults, and passes a demo URL through', async () => {
        const calls : Array<unknown> = [];

        const serve = (options : unknown) : Promise<RunningBridge> => {
            calls.push(options);

            return Promise.resolve({
                server: {} as never,
                url:    'http://127.0.0.1:8787',
                close:  () => Promise.resolve()
            });
        };

        const untilStopped = () : Promise<void> => Promise.resolve();

        await main({ argv: [ `serve` ], output: capture().output, deps: { serve, untilStopped } });

        await main({
            argv:   [ `serve`, `--demo-url`, `https://demo.example/` ],
            output: capture().output,
            deps:   { serve, untilStopped }
        });

        expect(calls).toEqual([ {}, { demoUrl: 'https://demo.example/' } ]);
    });

    it('rejects a port that is not a number', async () => {
        const { output, errors } = capture();

        expect(await main({ argv: [ 'serve', '--port', 'eighty' ], output })).toBe(1);
        expect(errors[0]).toContain('--port must be a number');
    });

    it('opens Chrome with the options given', async () => {
        const calls : Array<unknown> = [];

        const chrome = (options : unknown) : Promise<void> => {
            calls.push(options);

            return Promise.resolve();
        };

        expect(await main({ argv: [ 'chrome' ], output: capture().output, deps: { chrome } })).toBe(0);

        expect(await main({
            argv:   [ `chrome`, `--profile`, `/p`, `--url`, `https://u.example/`, `--channel`, `chrome-beta` ],
            output: capture().output,
            deps:   { chrome }
        })).toBe(0);

        expect(calls).toEqual([ {}, { profile: '/p', url: 'https://u.example/', channel: 'chrome-beta' } ]);
    });

    it('builds the plugin ZIP with the packaged icon', async () => {
        const { output, logs } = capture();
        const written : Array<{ readonly file : string, readonly data : Uint8Array }> = [];

        const code = await main({
            argv: [ 'plugin-zip', '--app-id', 'asdk_app_abc' ],
            output,
            deps: {
                writeZip: (file, data) => {
                    written.push({ file, data });

                    return Promise.resolve();
                }
            }
        });

        // eslint-disable-next-line n/no-sync -- reading back a few kilobytes
        const files = unzipSync(written[0]?.data ?? new Uint8Array());

        expect(code).toBe(0);
        expect(written[0]?.file).toBe('dev-abc.zip');
        expect(strFromU8(files['.app.json'] ?? new Uint8Array())).toContain('asdk_app_abc');
        // The real 256px icon from assets/.
        expect(files['assets/icon.png']?.byteLength).toBeGreaterThan(1000);
        expect(logs[0]).toContain('Upload new version');
    });

    it('writes the ZIP where asked, with a given icon', async () => {
        const written : Array<string> = [];

        await main({
            argv:   [ 'plugin-zip', '--app-id', 'asdk_app_abc', '--out', '/tmp/x.zip' ],
            output: capture().output,
            deps:   {
                readIcon: () => Promise.resolve(new Uint8Array([ 1 ])),

                writeZip: file => {
                    written.push(file);

                    return Promise.resolve();
                }
            }
        });

        expect(written).toEqual([ '/tmp/x.zip' ]);
    });

    it('needs an app id, and a valid one', async () => {
        const missing = capture();
        const invalid = capture();

        expect(await main({ argv: [ 'plugin-zip' ], output: missing.output })).toBe(1);
        expect(missing.errors[0]).toContain('--app-id is required');
        expect(await main({ argv: [ 'plugin-zip', '--app-id', 'nope' ], output: invalid.output })).toBe(1);
        expect(invalid.errors[0]).toContain('is not a ChatGPT app id');
    });
});

describe('the command line\'s defaults', () => {
    afterEach(() => {
        vi.doUnmock('playwright-core');
        vi.resetModules();
        vi.restoreAllMocks();
    });

    it('prints to the console, and writes the ZIP to disk', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const folder = await mkdtemp(path.join(tmpdir(), 'bridge-zip-'));
        const out = path.join(folder, 'plugin.zip');

        expect(await main({ argv: [ 'plugin-zip', '--app-id', 'asdk_app_abc', '--out', out ] })).toBe(0);
        expect((await readFile(out)).byteLength).toBeGreaterThan(1000);
        expect(log).toHaveBeenCalled();
    });

    it('serves for real until Ctrl-C', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const running = main({ argv: [ 'serve', '--port', '0' ] });

        await new Promise(resolve => {
            setTimeout(resolve, 300);
        });

        process.emit('SIGINT');

        expect(await running).toBe(0);
    });

    it('opens Chrome through playwright-core', async () => {
        const visited : Array<string> = [];

        vi.spyOn(console, 'log').mockImplementation(() => undefined);

        vi.doMock('playwright-core', () => ({
            chromium: {
                launchPersistentContext: () => {
                    let close = () : void => undefined;

                    const tab = {
                        goto: (url : string) : Promise<void> => {
                            visited.push(url);

                            setTimeout(() => {
                                close();
                            }, 0);

                            return Promise.resolve();
                        }
                    };

                    return Promise.resolve({
                        addInitScript: () => Promise.resolve(),
                        pages:         () => [ tab ],
                        newPage:       () => Promise.resolve(tab),

                        on: (_event : string, listener : () => void) => {
                            close = listener;
                        }
                    });
                }
            }
        }));

        const fresh = await import('./cli');

        expect(await fresh.main({ argv: [ 'chrome' ] })).toBe(0);
        expect(visited).toEqual([ 'https://chatgpt.com/' ]);
    });
});

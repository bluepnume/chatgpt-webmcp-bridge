// npx chatgpt-webmcp-bridge <command>
//
//   serve        run the MCP server locally (put a tunnel in front of it)
//   chrome       open Chrome with WebMCP on, for true WebMCP mode
//   plugin-zip   build the plugin ZIP for your ChatGPT connection

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { PACKAGE_NAME, VERSION } from './constants';

import { launchChrome } from './chrome';
import { serveBridge } from './node';
import { createPluginZip, pluginNameFor } from './plugin-zip';

export const USAGE = `${ PACKAGE_NAME } ${ VERSION }

Usage: npx ${ PACKAGE_NAME } <command> [options]

Commands:
  serve        Run the MCP server locally.
                 --port <n>          default 8787
                 --host <name>       default 127.0.0.1
                 --base-path <path>  e.g. /chatgpt-webmcp-bridge (default: none)
                 --demo-url <url>    the panel's Try button, or "none"
                 --frame-domains <origins>  comma-separated origins the panel may show
  chrome       Open Chrome with WebMCP on and the "tools" permission on every frame.
                 --profile <dir>     default ~/.chatgpt-webmcp-bridge/chrome-profile
                 --url <url>         default https://chatgpt.com/
                 --channel <name>    default chrome
  plugin-zip   Build the plugin ZIP for your ChatGPT connection.
                 --app-id <id>       required: asdk_app_… from ChatGPT's plugin settings
                 --out <file>        default ./<plugin name>.zip

Docs: https://github.com/bluepnume/${ PACKAGE_NAME }
`;

type CliOutput = {
    readonly log : (text : string) => void,
    readonly error : (text : string) => void,
};

type CliDependencies = {
    readonly serve ?: typeof serveBridge,
    readonly chrome ?: typeof launchChrome,
    readonly readIcon ?: () => Promise<Uint8Array>,
    readonly writeZip ?: (file : string, data : Uint8Array) => Promise<void>,
    // Resolves when the server should stop (by default, on Ctrl-C).
    readonly untilStopped ?: () => Promise<void>,
};

// assets/ sits at the package root: two levels up from dist/src/cli.js, one from src/cli.ts.
const readPackagedIcon = async () : Promise<Uint8Array> => {
    const here = path.dirname(new URL(import.meta.url).pathname);

    for (const root of [ path.resolve(here, '..', '..'), path.resolve(here, '..') ]) {
        try {
            // eslint-disable-next-line no-await-in-loop -- the first location that exists wins
            return await readFile(path.join(root, 'assets', 'icon-256.png'));
        } catch {
            // Not here; try the next location.
            continue;
        }
    }

    throw new Error('Could not find assets/icon-256.png in the package');
};

// Runs until Ctrl-C.
const untilInterrupted = () : Promise<void> => new Promise<void>(resolve => {
    process.once('SIGINT', () => {
        resolve();
    });
});

const OPTIONS = {
    'port':          { type: 'string' },
    'host':          { type: 'string' },
    'base-path':     { type: 'string' },
    'demo-url':      { type: 'string' },
    'frame-domains': { type: 'string' },
    'profile':       { type: 'string' },
    'url':           { type: 'string' },
    'channel':       { type: 'string' },
    'app-id':        { type: 'string' },
    'out':           { type: 'string' },
    'help':          { type: 'boolean', short: 'h' }
} as const;

type MainOptions = {
    readonly argv : ReadonlyArray<string>,
    readonly output ?: CliOutput,
    readonly deps ?: CliDependencies,
};

export const main = async ({ argv, output = console, deps = {} } : MainOptions) : Promise<number> => {
    let parsed;

    try {
        parsed = parseArgs({ args: [ ...argv ], options: OPTIONS, allowPositionals: true });
    } catch (err) {
        output.error(`${ (err as Error).message }\n\n${ USAGE }`);

        return 1;
    }

    const { values, positionals } = parsed;
    const [ command ] = positionals;

    if (!command || values.help) {
        output.log(USAGE);

        return values.help
            ? 0
            : 1;
    }

    try {
        switch (command) {
            case 'serve': {
                const port = values.port === undefined
                    ? undefined
                    : Number(values.port);

                if (port !== undefined && !Number.isInteger(port)) {
                    throw new Error(`--port must be a number, not "${ String(values.port) }"`);
                }

                const running = await (deps.serve ?? serveBridge)({
                    ...port === undefined
                        ? {}
                        : { port },
                    ...values.host === undefined
                        ? {}
                        : { hostname: values.host },
                    ...values['base-path'] === undefined
                        ? {}
                        : { basePath: values['base-path'] },
                    ...values[`demo-url`] === undefined
                        ? {}
                        : {
                            demoUrl: values[`demo-url`] === `none`
                                ? null
                                : values[`demo-url`]
                        },
                    ...values['frame-domains'] === undefined
                        ? {}
                        : { frameDomains: values[`frame-domains`].split(`,`).map(origin => origin.trim()).filter(Boolean) }
                });

                output.log(`${ PACKAGE_NAME } is running at ${ running.url }${ values['base-path'] ?? '' }/mcp\nChatGPT needs public https: put a tunnel in front of it, then add the tunnel's URL (ending in /mcp) as a custom MCP server.`);
                await (deps.untilStopped ?? untilInterrupted)();
                await running.close();

                return 0;
            }

            case 'chrome':
                output.log(`Opening Chrome with WebMCP on. Log in to ChatGPT in this window the first time; close the window to finish.`);

                await (deps.chrome ?? launchChrome)({
                    ...values.profile === undefined
                        ? {}
                        : { profile: values.profile },
                    ...values.url === undefined
                        ? {}
                        : { url: values.url },
                    ...values.channel === undefined
                        ? {}
                        : { channel: values.channel }
                });

                return 0;

            case 'plugin-zip': {
                const appId = values['app-id'];

                if (!appId) {
                    throw new Error('--app-id is required: the asdk_app_… id from ChatGPT\'s plugin settings');
                }

                const name = pluginNameFor(appId);
                const zip = createPluginZip({ appId, icon: await (deps.readIcon ?? readPackagedIcon)() });
                const out = values.out ?? `${ name }.zip`;

                await (deps.writeZip ?? writeFile)(out, zip);
                output.log(`Wrote ${ out }. Upload it in ChatGPT: Plugins › your plugin › ⋯ › Upload new version.`);

                return 0;
            }

            default:
                output.error(`Unknown command "${ command }".\n\n${ USAGE }`);

                return 1;
        }
    } catch (err) {
        output.error((err as Error).message);

        return 1;
    }
};

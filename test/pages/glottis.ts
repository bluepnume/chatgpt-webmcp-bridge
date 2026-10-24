// A page serving tools with glottis, shaped by its query string:
//   ?reportedUrl=<url>  export page.url as this (the panel follows it)
//   ?noPage=1           export no page constant
//   ?delay=<ms>         start serving only after this long
//   ?native=1           also expose the tools natively to whoever frames it
//   ?decline=1          refuse every caller
//   ?noTools=1          offer constants only, no tools
import { serve, tool } from 'glottis';

const params = new URLSearchParams(location.search);
const calls = document.querySelector('#calls');

const tools = {
    ...params.get('noPage')
        ? {}
        : { page: { url: params.get('reportedUrl') ?? location.href, title: document.title } },
    version: '1',
    plain:   () => 'not a tool',
    shelf:   {
        count: tool({
            description: 'Counts the items on the shelf.',
            handler:     () => 3
        })
    },
    echo: tool({
        name:        'echo_back',
        description: 'Echoes its arguments.',
        input:       { type: 'object', properties: { word: { type: 'string' } } },

        handler: (args : unknown) => {
            if (calls) {
                calls.textContent = JSON.stringify(args);
            }

            return args;
        }
    }),
    broken: tool({
        description: 'Always fails.',

        handler: () => {
            throw new Error('Shelf collapsed');
        }
    })
};

const exports = params.get('noTools')
    ? { page: { url: location.href, title: document.title }, version: '1' }
    : tools;

const [ embedder ] = location.ancestorOrigins;

const start = () : void => {
    serve({
        clients: {
            remoteWindow: { allowed: true, domain: '*' },
            ...embedder && params.get('native')
                ? { webMcp: { allowed: true, domain: embedder } }
                : {}
        },

        exports: () => {
            if (params.get('decline')) {
                throw new Error('Not today');
            }

            return exports;
        }
    });
};

const delay = Number(params.get('delay') ?? 0);

type ModelContext = {
    readonly registerTool : (
        tool : Readonly<Record<string, unknown>>,
        options : Readonly<Record<string, unknown>>
    ) => Promise<void>,
};

// A slow page that also has a native tool right away: the panel shows the
// native tool first, then switches to glottis when it answers.
const modelContext = (document as unknown as { readonly modelContext ?: ModelContext }).modelContext;

const registerEarlyTool = () : Promise<void> => (delay && modelContext && embedder && params.get('native')
    ? modelContext.registerTool({
        name:        `early`,
        description: `Here before glottis.`,
        inputSchema: { type: `object`, properties: {} },
        execute:     () => `early`
    }, { exposedTo: [ embedder ] })
    : Promise.resolve());

// Serves once the early tool, if any, is registered.
registerEarlyTool().then(() => {
    if (delay) {
        setTimeout(start, delay);
    } else {
        start();
    }
}).catch((error : unknown) => {
    // Fails as loudly as a page whose script threw.
    setTimeout(() => {
        throw error;
    }, 0);
});

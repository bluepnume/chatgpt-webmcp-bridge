// A page that registers WebMCP tools the plain way, exposed to whoever frames
// it, with no glottis.

type ModelContext = {
    readonly registerTool : (
        tool : Readonly<Record<string, unknown>>,
        options : Readonly<Record<string, unknown>>
    ) => Promise<void>,
};

const modelContext = (document as unknown as { readonly modelContext ?: ModelContext }).modelContext;
const [ embedder ] = location.ancestorOrigins;

type RegisterToolsOptions = { readonly context : ModelContext, readonly origin : string };

// Registers the tools one after the other, exposed to `origin`.
const registerTools = async ({ context, origin } : RegisterToolsOptions) : Promise<void> => {
    await context.registerTool({
        name:        'say_hello',
        description: 'Writes a greeting on the page.',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: [ 'name' ] },

        execute: ({ name } : { readonly name : string }) => {
            const item = document.createElement('li');

            item.textContent = `Hello, ${ name }!`;
            document.querySelector('#greetings')?.append(item);

            return { greeted: name };
        }
    }, { exposedTo: [ origin ] });

    await context.registerTool({
        name:        'fail',
        description: 'Always fails.',
        inputSchema: JSON.stringify({ type: 'object', properties: {} }),

        execute: () => {
            throw new Error('Out of stock');
        }
    }, { exposedTo: [ origin ] });
};

if (modelContext && embedder) {
    registerTools({ context: modelContext, origin: embedder }).catch((error : unknown) => {
        // Fails as loudly as a page whose script threw.
        setTimeout(() => {
            throw error;
        }, 0);
    });
}

export {};

// The plugin ZIP for ChatGPT's developer mode: the plugin page's long
// description, suggested prompts and logo, for a connection that already
// exists.
//
// ChatGPT creates a plugin for every custom MCP server added in developer
// mode, with a generated internal name (dev-<id>). "Upload new version" only
// accepts a ZIP with that exact name and the connection's app id, so the ZIP
// is built per connection, from its app id.

import { strToU8, zipSync } from 'fflate';

import { DEFAULT_DEMO_URL, PACKAGE_NAME, VERSION } from './constants';

export type PluginZipOptions = {
    // The connection's app id, from ChatGPT's settings: "asdk_app_…".
    readonly appId : string,
    // The PNG used as the plugin's logo and composer icon.
    readonly icon : Uint8Array,
    readonly displayName ?: string,
    readonly developerName ?: string,
    readonly websiteUrl ?: string,
};

const APP_ID_PATTERN = /^asdk_app_[\da-f]+$/;

export const pluginNameFor = (appId : string) : string => {
    if (!APP_ID_PATTERN.test(appId)) {
        throw new Error(`"${ appId }" is not a ChatGPT app id. It looks like asdk_app_ followed by letters and digits; find it in ChatGPT under Settings › Plugins › your plugin › App ID.`);
    }

    return `dev-${ appId.slice('asdk_app_'.length) }`;
};

export const createPluginZip = ({
    appId,
    icon,
    displayName = 'ChatGPT WebMCP bridge',
    developerName = 'Daniel Brain',
    websiteUrl = `https://github.com/bluepnume/${ PACKAGE_NAME }`
} : PluginZipOptions) : Uint8Array => {
    const name = pluginNameFor(appId);

    const manifest = {
        name,
        version:     VERSION,
        description: 'Lets ChatGPT use the tools a web page offers, in a small browser panel inside the chat.',
        author:      { name: developerName },
        apps:        './.app.json',
        interface:   {
            displayName,
            shortDescription: 'Use a web page\'s tools from the chat',
            longDescription:  `Opens a small browser panel in the chat. Load a page that offers tools, served with glottis or registered with WebMCP, and ChatGPT can see and use them: the page runs each call in your browser and the result comes back into the conversation. Try the demo shop (${ DEFAULT_DEMO_URL }), which has list_products, add_to_cart, view_cart and clear_cart.`,
            developerName,
            category:         'Developer tools',
            capabilities:     [ 'Interactive' ],
            websiteURL:       websiteUrl,
            brandColor:       '#4f5bff',
            logo:             './assets/logo.png',
            composerIcon:     './assets/icon.png',
            defaultPrompt:    [
                'Open the WebMCP browser.',
                'Open the demo shop and add Sunshower to my cart.',
                'What tools does the page in the browser have?'
            ]
        }
    };

    // fflate's async zip uses workers; the files here are a few kilobytes.
    // eslint-disable-next-line n/no-sync -- see above
    return zipSync({
        '.codex-plugin/plugin.json': strToU8(`${ JSON.stringify(manifest, null, 2) }\n`),
        '.app.json':                 strToU8(`${ JSON.stringify({ apps: { [ name ]: { id: appId } } }, null, 2) }\n`),
        'assets/logo.png':           icon,
        'assets/icon.png':           icon
    });
};

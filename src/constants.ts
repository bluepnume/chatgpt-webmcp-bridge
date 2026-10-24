// Names and defaults shared by the server, the panel and the command line.

export const PACKAGE_NAME = 'chatgpt-webmcp-bridge';

// Kept in step with package.json by a test. ChatGPT caches the panel by its
// URI, so the URI carries the version and a new release loads a new panel.
export const VERSION = '0.1.0';

export const PANEL_URI = `ui://${ PACKAGE_NAME }/panel-${ VERSION }`;

export const PANEL_MIME_TYPE = 'text/html;profile=mcp-app';

// The demo shop, hosted once on GitHub Pages from this repo's examples/.
export const DEFAULT_DEMO_URL = 'https://bluepnume.github.io/chatgpt-webmcp-bridge/examples/shop/';

export const TOOL_NAME = {
    OPEN_BROWSER:   'open_browser',
    CALL_SITE_TOOL: 'call_site_tool'
} as const;

// The element in the panel's HTML that carries its settings as JSON.
export const CONFIG_ELEMENT_ID = 'webmcp-bridge-config';

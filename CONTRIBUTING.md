# Contributing

## Setup

```sh
npm install
npx playwright install chromium
```

Node 24 or later.

## Layout

| Path | What |
| --- | --- |
| `src/server.ts` | The MCP server: one standard request handler. |
| `src/worker.ts`, `src/node.ts` | The server on Cloudflare Workers and in Node. |
| `src/panel.ts` | The panel: the browser ChatGPT shows in the chat. |
| `src/panel-host.ts` | The panel's line to ChatGPT (MCP Apps over `postMessage`). |
| `src/panel-pages.ts` | Reaching a page's tools, over glottis or native WebMCP. |
| `src/panel-chat.ts` | Posting into the conversation. |
| `src/panel-html.ts` | The panel's HTML, with its script inline. |
| `src/cli.ts`, `src/chrome.ts`, `src/plugin-zip.ts`, `src/grant-tools.ts` | The command line and what it runs. |
| `scripts/build-panel.ts` | Bundles `src/panel.ts` with glottis into `src/panel-script.generated.ts` (git-ignored). |
| `examples/shop/` | The demo shop, published to GitHub Pages. |
| `test/` | Browser tests that drive the real panel against a fake ChatGPT (`test/host.ts`), and test pages. |

## Checks

```sh
npm test              # everything: static checks, build, tests with coverage
npm run test:static   # types, lint, dead code
npm run test:unit     # node and browser tests, with coverage (95% minimum)
npm run fix           # format what you changed
```

The browser tests run in Playwright's Chromium with WebMCP switched on. Frames run on a second origin (`[::1]`) to keep them cross-origin, and post their coverage up to the test page.

## Trying a change in ChatGPT

1. `npx chatgpt-webmcp-bridge serve` (or `node --run build && node bin/chatgpt-webmcp-bridge.js serve` from a checkout), behind a tunnel.
2. Add the tunnel's URL as a custom MCP server, or **Refresh tools** on one you already have.
3. Start a new chat.

## Releasing

1. Bump `version` in `package.json` and `VERSION` in `src/constants.ts` (a test keeps them in step).
2. Commit, tag `v<version>`, and push the tag. The publish workflow runs the checks and publishes to npm.
3. Redeploy the demo instance: `npm run deploy:worker`.

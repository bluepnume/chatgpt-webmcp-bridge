# 3. True WebMCP mode

Test a page that offers its tools through WebMCP itself, the draft browser API, with no glottis connection in between.

## What changes

In this mode the panel asks the browser for the page's tools (`document.modelContext.getTools()`) and runs them through the browser (`executeTool()`). The status bar shows "· native WebMCP".

It needs three things that are not true by default:

1. **A browser with WebMCP.** Chrome has it behind a flag.
2. **The `tools` permission on every frame**, from ChatGPT's page down to yours. ChatGPT does not grant it to its plugin frames, so something has to add it.
3. **Your page exposing its tools to the panel.** A page's WebMCP tools are private to it unless it lists, by exact origin, who else may use them.

The launcher below takes care of 1 and 2. Your page does 3.

## Step 1: open Chrome with the launcher

```sh
npx chatgpt-webmcp-bridge chrome
```

This opens your installed Google Chrome:

- in a profile of its own, at `~/.chatgpt-webmcp-bridge/chrome-profile`, so your everyday Chrome is untouched;
- with WebMCP switched on;
- with a small script in every page that adds `tools *` to each iframe's `allow` attribute before the frame loads. That is the `tools` permission ChatGPT leaves out.

It needs `playwright-core`, which `npx` installs with the package. Options: `--profile <dir>`, `--url <url>`, `--channel <name>` (e.g. `chrome-beta`).

The first time, log in to ChatGPT in that window. The profile keeps the login. If Google sign-in refuses ("this browser may not be secure"), log in with email instead: Google blocks sign-in from browsers under automation.

## Step 2: expose your page's tools to the panel

Register each tool with `exposedTo`, naming the page that frames yours, which is the bridge's panel:

```js
const embedder = location.ancestorOrigins[0];   // the panel's origin, in Chrome

await document.modelContext.registerTool({
  name:        'say_hello',
  description: 'Writes a greeting on the page.',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: [ 'name' ] },
  execute:     ({ name }) => ({ greeted: name })
}, { exposedTo: [ embedder ] });
```

- `exposedTo` takes exact https origins only; `'*'` is refused.
- With glottis, the same is `clients: { webMcp: { allowed: true, domain: embedder } }` (see [2. Your page with glottis](2-your-page-with-glottis.md)).

## Step 3: load your page

1. In the launcher's Chrome, open the bridge in ChatGPT, using a server whose frame domains include your page's origin (see [4. Run your own server](4-run-your-own-server.md)).
2. Type your page's address into the panel's address bar.
3. The status bar lists your tools with "· native WebMCP".

## How the panel picks a route

The panel tries both routes at once:

- Native tools show as soon as the browser lists them.
- If the page also answers over glottis, glottis takes over, because it brings real error messages and argument checks.
- The status bar always says which route is in use.

## What native WebMCP does differently

| | glottis | native WebMCP |
| --- | --- | --- |
| Works in | every browser | Chrome with the WebMCP flag, plus the launcher |
| Asks the user first | yes, if the page does | no connection to ask about |
| Error messages | the page's own | Chrome hides a thrown error's message; glottis 0.4+ pages return it as an error result instead |
| Argument checks | yes, with a zod `input` | no; the page must check |

## Without the launcher

- **WebMCP:** start Chrome with `--enable-features=WebMCP`, or turn on **WebMCP for testing** at `chrome://flags/#enable-webmcp-testing`.
- **The `tools` permission:** it must be on each iframe before the frame loads, so it has to come from a script that runs at document start in every frame. The launcher's script is exported for Playwright, Puppeteer or an extension: `import { GRANT_SCRIPT } from 'chatgpt-webmcp-bridge/chrome'`.
- **DevTools can't do it.** A snippet pasted in DevTools is too late: by then ChatGPT has already created its frames.

## Next

- Why the server can't do this for you: [6. How it works](6-how-it-works.md).
- Native tools don't show up: [7. Troubleshooting](7-troubleshooting.md).

# 7. Troubleshooting

## Adding the server

**"Couldn't complete MCP setup", or the form won't create the connection.**
Open your server's base URL in a browser (`https://…/` without `/mcp`). It should show "This is a chatgpt-webmcp-bridge … server". If it doesn't, the URL or the deployment is wrong. ChatGPT needs the URL ending in `/mcp`.

**"Connector with name … already exists".**
Connection names must be unique. Rename the old one, or pick another name.

**The icon is missing or shows as a broken image.**
The icon can only be set when the connection is created; see [5. The ChatGPT connection](5-chatgpt-connection.md#changing-the-icon-later).

## In the chat

**The model talks about the panel but no panel appears.**
ChatGPT is still using an older tool list. Open **Settings › Plugins › your plugin**, click **Refresh tools**, and start a new chat.

**Changes to the server don't show up.**
Same fix: **Refresh tools**, then a new chat. ChatGPT caches the panel by a URI that includes the package version.

**A red "Steering requires an active compatible turn" line appears.**
The panel tried to post a result while the model was still replying. It then slips the result into the reply instead, so nothing is lost. At most one such line appears per call.

**A JSON-looking line flashes up and disappears.**
That is the panel's message on its way in: ChatGPT shows it briefly, then folds it into the reply.

**A panel shows "↓ This browser continues in the newest panel below".**
ChatGPT opens a new panel for every tool call; older ones fold away so only one browser is open. Scroll down to the newest.

**The model guesses instead of waiting for a result.**
Results arrive as a message after the call, so the model must wait for it. The server's instructions tell it to; if it still guesses, ask it to wait for the result.

## In the panel

**"No tools found on this page".**
The page answered neither route. Check that:
- it serves tools with glottis (see [2. Your page with glottis](2-your-page-with-glottis.md)), and that `tool()` wraps them;
- its `clients.remoteWindow.domain` allows the panel's origin (`'*'` allows everyone);
- for native WebMCP, see the next item.

**The page shows a blank frame, or "refused to connect".**
The page doesn't allow being framed. Remove `X-Frame-Options`, and make `frame-ancestors` allow `https://*.web-sandbox.oaiusercontent.com`.

**"Access declined in the page".**
The page asked and the user declined. Load the page again to be asked again.

**Native WebMCP tools don't show up.**
- Use the launcher (`npx chatgpt-webmcp-bridge chrome`); in normal Chrome, ChatGPT's frames lack the `tools` permission.
- Register with `exposedTo: [location.ancestorOrigins[0]]`; without it, other frames can't see the page's tools.
- `exposedTo` needs exact https origins. `'*'` throws a `SecurityError`.
- If `registerTool` throws `NotAllowedError … disallowed by permissions policy`, a frame in the chain is missing `tools`.

**A native tool's error says only "invocation failed".**
Chrome hides the messages of errors thrown in WebMCP tools. Return an error result instead (glottis 0.4+ does this for you), or use the glottis route.

## The Chrome launcher

**"The chrome command needs playwright-core".**
`npm install playwright-core`, or run it through `npx chatgpt-webmcp-bridge chrome`, which installs it.

**Google sign-in says the browser may not be secure.**
Google blocks sign-in from automated browsers. Log in to ChatGPT with email (or Apple or Microsoft) in the launcher's window instead.

## Still stuck

Open an issue: https://github.com/bluepnume/chatgpt-webmcp-bridge/issues

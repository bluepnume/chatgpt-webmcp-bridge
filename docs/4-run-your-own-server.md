# 4. Run your own server

The bridge's MCP server is small and stateless: it answers ChatGPT's calls and hands it the panel. It never sees your pages or their results. Run your own copy when you don't want to depend on the demo instance, or to change its settings.

ChatGPT has to reach it over public https.

## Option A: Cloudflare Workers

Free tier, one command to deploy.

1. Make a folder with two files:

   `worker.js`
   ```js
   export { default } from 'chatgpt-webmcp-bridge/worker';
   ```

   `wrangler.toml`
   ```toml
   name = "my-webmcp-bridge"
   main = "worker.js"
   compatibility_date = "2026-10-01"
   ```

2. Install and deploy:

   ```sh
   npm install chatgpt-webmcp-bridge
   npx wrangler login
   npx wrangler deploy
   ```

3. Wrangler prints your Worker's address. Your MCP URL is that address plus `/mcp`, e.g. `https://my-webmcp-bridge.you.workers.dev/mcp`.

### Settings

Set these as variables in `wrangler.toml`:

```toml
[vars]
BASE_PATH = "/chatgpt-webmcp-bridge"            # the URL becomes …/chatgpt-webmcp-bridge/mcp
DEMO_URL = "none"                               # no Try button; or your own demo page's URL
FRAME_DOMAINS = "https://shop.example"          # the pages the panel may show (see below)
```

To serve it on your own domain, add a route, e.g. `routes = [ { pattern = "bridge.example.com", custom_domain = true } ]`.

## Option B: Node, for development

```sh
npx chatgpt-webmcp-bridge serve
```

This starts the server at `http://127.0.0.1:8787/mcp`. ChatGPT can't reach `localhost`, so put a tunnel in front of it:

- ChatGPT's own **Tunnel** option in the "Add custom MCP server" form, or
- `cloudflared tunnel --url http://127.0.0.1:8787`, or
- `ngrok http 8787`.

Then add the tunnel's https URL, ending in `/mcp`, as a custom MCP server.

Options: `--port <n>`, `--host <name>`, `--base-path <path>`, `--demo-url <url|none>`, `--frame-domains <origin,origin>`. Ctrl-C stops it.

From code:

```js
import { serveBridge } from 'chatgpt-webmcp-bridge/node';

const running = await serveBridge({ port: 8787, demoUrl: null });
// later: await running.close();
```

## Option C: anywhere else

The server is one standard request handler (`Request` in, `Response` out), so it runs anywhere that has those: Deno, Bun, Vercel or Netlify edge functions.

```js
import { createBridgeHandler } from 'chatgpt-webmcp-bridge';

const handle = createBridgeHandler({ basePath: '', demoUrl: null });

Deno.serve(handle);
```

## The settings

| Option | Worker variable | Default | What it does |
| --- | --- | --- | --- |
| `basePath` | `BASE_PATH` | none | Where the server lives; the MCP endpoint is `<basePath>/mcp`. |
| `demoUrl` | `DEMO_URL` | the hosted demo shop | The page the panel's **Try** button opens. `null` (or `none`) removes the button. |
| `frameDomains` | `FRAME_DOMAINS` | none | The origins of the pages the panel may show, besides the demo's (always included). ChatGPT only lets the panel frame origins listed here: exact origins such as `https://shop.example`, no wildcards. The model is told the list. |

A GET on `<basePath>/` shows a short page with the URL to add to ChatGPT, handy for checking a deployment.

Changing the settings changes the panel's identity, so ChatGPT picks the new settings up after **Refresh tools**.

## After you deploy

1. Add your URL in ChatGPT (see [5. The ChatGPT connection and plugin ZIP](5-chatgpt-connection.md)).
2. Whenever you deploy a new version, open the plugin's settings in ChatGPT and click **Refresh tools**: ChatGPT caches the tool list and the panel.

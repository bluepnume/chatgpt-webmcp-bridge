# 8. Reference

## Package entry points

| Import | What |
| --- | --- |
| `chatgpt-webmcp-bridge` | `createBridgeHandler`, `renderPanelHtml`, `createPluginZip`, and the constants below |
| `chatgpt-webmcp-bridge/worker` | the Cloudflare Worker (default export), and `optionsFromEnv` |
| `chatgpt-webmcp-bridge/node` | `serveBridge`, the server in Node |
| `chatgpt-webmcp-bridge/chrome` | `launchChrome` and `GRANT_SCRIPT`, for true WebMCP mode |

## `createBridgeHandler(options)`

Returns `(request : Request) => Promise<Response>`.

| Option | Default | |
| --- | --- | --- |
| `basePath` | `''` | The MCP endpoint is `<basePath>/mcp`; a GET on `<basePath>/` shows a help page. |
| `demoUrl` | the hosted demo shop | The panel's **Try** button; `null` removes it. |
| `frameDomains` | `[]` | Origins of the pages the panel may show, besides the demo's. Exact origins only: ChatGPT ignores wildcards. |

The endpoint takes MCP over streamable HTTP, in both of ChatGPT's protocol generations (2025, with `initialize`; and 2026, with the version in `_meta`). It answers `initialize`, `server/discover`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/templates/list` and `resources/read`. GET on the endpoint answers 405, because there is no event stream.

## `serveBridge(options)` (Node)

The handler's options, plus `port` (default `8787`; `0` for any free port) and `hostname` (default `127.0.0.1`). Resolves with `{ server, url, close }`.

## The CLI

```
npx chatgpt-webmcp-bridge serve [--port <n>] [--host <name>] [--base-path <path>] [--demo-url <url|none>] [--frame-domains <origin,…>]
npx chatgpt-webmcp-bridge chrome [--profile <dir>] [--url <url>] [--channel <name>]
npx chatgpt-webmcp-bridge plugin-zip --app-id <asdk_app_…> [--out <file>]
```

## The two tools

### `open_browser`

| Argument | |
| --- | --- |
| `url` (optional) | The page to open. Without it, the panel shows its start page. |

Result: `{ url, opened_at }`. With a url, the page's tools follow as a message (below).

### `call_site_tool`

| Argument | |
| --- | --- |
| `url` | The page whose tool to run. |
| `tool` | The tool's name. |
| `arguments` (optional) | An object for the tool. |

Result: `{ call_id, url, tool, arguments, opened_at }`. The tool's real result follows as a message.

`opened_at` lets panels tell which is newest, so only that one stays open.

## Messages the panel posts

Each is one readable line, plus JSON attached as a `resource` content block (`application/json`).

| When | Line | Attached JSON |
| --- | --- | --- |
| The user opened a page | `✓ Opened <title>: <n> tools (attached).` | `{ opened_by: 'user', url, title, tools, instructions }` |
| The model opened a page | `✓ Opened <title>: <n> tools (attached).` or `✗ Opened <title>, but it offers no tools.` | `{ opened_by: 'model', url, tools, instructions }` or `{ …, error }` |
| A call ran | `✓ <tool> ran on <title> (call <id>). Result attached.` | `{ call_id, tool, arguments, ok: true, result }` |
| A call failed | `✗ <tool> failed on <title> (call <id>): <error>` | `{ call_id, tool, arguments, ok: false, error }` |
| A call could not run | `✗ <tool> was not run on <host> (call <id>).` | `{ call_id, tool, ok: false, error }` |

Each tool is listed as `{ name, description, inputSchema }`.

## What a page offers

**Over glottis.** The page serves its default service, allowing `clients.remoteWindow`. Its tools are the `tool()` functions in its exports, named as glottis names them for WebMCP. An optional constant `page: { url, title }` sets the address and title the panel shows and calls.

**Over native WebMCP.** The page registers tools with `document.modelContext.registerTool(tool, { exposedTo: [panelOrigin] })`. The panel lists them with `getTools({ fromOrigins: [pageOrigin] })`.

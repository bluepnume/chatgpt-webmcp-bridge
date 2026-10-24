# 6. How it works

Three parties take part:

- **ChatGPT**: the model, plus ChatGPT's web page.
- **The plugin**: its MCP server, and its **panel**, the sandboxed frame ChatGPT shows in the chat.
- **The store**: the page whose tools are used, framed inside the panel.

Below is one run, the demo shop with "add the blue mug to my cart", step by step.

## 1. Mentioning the plugin

- I type "@" and pick the ChatGPT WebMCP bridge.
- ChatGPT already knows the plugin's two tools, `open_browser` and `call_site_tool`, and its instructions, from the MCP server's tool list (`tools/list`).
- When I ask for the browser, the model calls `open_browser`. ChatGPT sends that call to the MCP server (`tools/call`), which only replies "browser opened". The server can't reach my browser, so everything real happens on my side.
- The tool comes with a UI, so ChatGPT loads the panel's HTML (`resources/read`) and mounts it in the chat as a sandboxed iframe. Sandboxed, because ChatGPT keeps plugin code walled off from the chat.

## 2. The panel starts up

- The panel runs the MCP Apps handshake with ChatGPT over `postMessage` (`ui/initialize`). It says which protocol version it speaks, and ChatGPT replies with what it allows the panel to do, such as posting messages into the chat.
- Only then does ChatGPT send the panel the tool call's input and the server's reply. The panel needs both to decide what to show.
- With no URL to open, it shows its start page with the **Try the demo shop** button.

## 3. Opening the store

- The click stays inside the panel. Neither ChatGPT nor the server hears about it.
- The panel loads the store in its own iframe, so the store runs in my browser like any page I'd visit.
- The store gives itself a fresh cart id in its URL. The cart starts empty, and any later panel that loads the same URL finds the same cart.
- The store defines its tools with glottis `tool()` and serves them.
- Why glottis: the panel and the store are on different domains, so the panel can't call the store's code directly. They can only exchange messages, and glottis turns those messages into ordinary function calls.

## 4. The store asks permission

- The panel connects with `glottis.connect()`, which carries everything over `postMessage`.
- The store holds that connection open and shows its own dialog: "Let ChatGPT use your cart?" The buttons live inside the store, so only my click can answer it, not ChatGPT or the plugin.
- I click Allow, and the store answers the connection with its tools.

## 5. ChatGPT learns the tools

- The panel hands the tool list to ChatGPT with `ui/update-model-context`, which shows up as the Context chip. That makes the tools available with my next message, but doesn't make the model say anything.
- So the panel also posts a message (`ui/message`): one readable line, "✓ Opened Kiln & Cotton: 4 tools (attached)", with the tools and instructions attached as JSON. The line is for me; the attachment is for the model.
- The model's turn is already over, so this starts a new one, and the model lists what it can do in the shop.

## 6. Asking for the blue mug

- I say "add the blue mug to my cart".
- The model calls `call_site_tool` with the store's URL, the tool name `add_to_cart` and the arguments.
- ChatGPT sends that to the MCP server, which only hands back a call id. The server can't run anything in my browser, so its job is just to say the result will arrive separately.
- ChatGPT mounts a new panel for this call, because it gives every tool call with a UI a panel of its own. That is also the only way the call's arguments reach my browser.
- A panel can't remove itself from the chat, but all of this plugin's panels share an origin, so they talk over a `BroadcastChannel`. The new panel announces itself, and the first one folds to a single line and lets its store go.

## 7. The new panel runs the tool

- It loads the same store URL, cart id included, so the store finds the same cart.
- It connects with glottis again. The store remembers my Allow for this cart, so there's no second question.
- It calls `add_to_cart` in the store, and the blue mug appears in my cart.
- The panel remembers the call id. ChatGPT re-renders every panel when a chat is reloaded, and this stops the mug being added twice.

## 8. The result reaches ChatGPT

- The panel posts a message: "✓ add_to_cart ran on Kiln & Cotton (call 3f2a1b9c). Result attached", with the result as JSON.
- The model is usually still writing its reply, and ChatGPT won't start a new turn on top of one in progress. So the panel sends it again without asking for a new turn, which slips it into the reply that's running.
- The model reads the result and confirms: "1 blue mug added, $12". It answers from what actually happened on the page.

## Native WebMCP instead of glottis

In [true WebMCP mode](3-true-webmcp-mode.md), steps 4 and 7 change:

- The store registers its tools with `document.modelContext.registerTool()` and exposes them to the panel's origin.
- The panel lists them with `getTools({ fromOrigins: [store origin] })` and runs them with `executeTool()`.

No connection is opened, so there's no permission dialog. This only works when every frame between ChatGPT and the store has the `tools` permission, which ChatGPT doesn't grant today.

## Who talks to whom

| Between | Over | What |
| --- | --- | --- |
| ChatGPT and the MCP server | HTTPS, MCP | `tools/list`, `tools/call`, `resources/read`. The server only hands out call ids. |
| ChatGPT and the panel | `postMessage`, MCP Apps JSON-RPC | the handshake, tool input and result, model context, messages |
| The panel and the store | glottis over `postMessage`, or native WebMCP | connecting, the permission question, tool calls |
| Panel and panel | `BroadcastChannel` | "I'm newest", so only one browser stays open |

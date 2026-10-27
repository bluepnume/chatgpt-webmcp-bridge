# 1. Try it

Five minutes, nothing to install.

## Before you start

You need ChatGPT with developer mode, which lets you add MCP servers that are not in ChatGPT's app directory. If **Plugins › Add** has no **Add custom MCP server** option, turn developer mode on first (OpenAI's [Apps SDK guide](https://developers.openai.com/apps-sdk) explains how).

## Add the plugin

1. Open **Plugins › Add › Add custom MCP server**.
2. Fill in the form:

   | Field | Value |
   | --- | --- |
   | Icon | [`assets/icon-256.png`](../assets/icon-256.png) (optional; it can only be set now, not later) |
   | Name | `ChatGPT WebMCP bridge` |
   | Server URL | `https://webmcp.danielbrain.ai/chatgpt-webmcp-bridge/mcp` |
   | Authentication | No authentication |

3. Tick **I understand and want to continue**, then **Create**.

## Open the browser

1. Start a new chat.
2. Type `@`, pick **ChatGPT WebMCP bridge**, and ask it to `open the browser`.
3. A small browser appears in the chat, with a **Try the demo shop** button.

## Use the demo shop

1. Click **Try the demo shop**. The shop, Rising Sun Records, loads in the panel.
2. The shop asks **Let ChatGPT use your cart?** Click **Allow**.
3. ChatGPT replies with what it can do in the shop.
4. Ask: *add Sunshower to my cart*.

A fresh panel opens for the call, the older one folds away to one line, the record appears in the cart, and ChatGPT confirms.

## Things to try next

- *What's in my cart?*
- *Add For You and two copies of Mint Jams, then tell me the total.*
- *Empty my cart.*

## Next

- Make your own page work like the shop: [2. Your page with glottis](2-your-page-with-glottis.md).
- Something not working: [7. Troubleshooting](7-troubleshooting.md).

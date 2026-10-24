# 5. The ChatGPT connection and plugin ZIP

How to add a bridge server to ChatGPT, and give it a proper plugin page.

## Add the connection

1. In ChatGPT (with developer mode), open **Plugins › Add › Add custom MCP server**.
2. Fill in the form:
   - **Icon:** [`assets/icon-256.png`](../assets/icon-256.png). It must be a PNG of at least 256 × 256 and at most 10 KB. **It can only be set here**: ChatGPT has no way to change a connection's icon later.
   - **Name:** anything, but it must be unique among your connections.
   - **Description:** optional.
   - **Server URL:** your server's MCP URL, ending in `/mcp`.
   - **Authentication:** No authentication.
3. Tick **I understand and want to continue**, then **Create as a plugin**.

ChatGPT checks the server straight away; if the form complains, see [7. Troubleshooting](7-troubleshooting.md).

The first time you use it in a chat, ChatGPT asks you to **Connect** it. That only links it to your account; there is no login.

## Give it a plugin page

Without more, the plugin's page in ChatGPT is bare. A plugin ZIP adds a long description, three suggested prompts, and the logo on the page.

1. Find the connection's app id: **Settings › Plugins › your plugin**, under **App ID**. It looks like `asdk_app_6adc523d…`.
2. Build the ZIP:

   ```sh
   npx chatgpt-webmcp-bridge plugin-zip --app-id asdk_app_6adc523d…
   ```

   It writes `dev-<id>.zip`. Add `--out <file>` to choose the name.
3. Open the plugin's page (**Plugins › your plugin**), click **⋯ › Upload new version**, and choose the ZIP.

Why the app id: ChatGPT gives each developer-mode plugin a generated internal name (`dev-<id>`), and only accepts a ZIP that carries that exact name and the connection's id. So every connection needs its own ZIP.

## After you change the server

ChatGPT caches the tool list and the panel. After deploying a new version, open **Settings › Plugins › your plugin** and click **Refresh tools**, then start a new chat.

## Changing the icon later

You can't, short of making a new connection:

1. Rename the old connection (names must be unique).
2. Add a new connection with the new icon.
3. Build and upload a ZIP for the new app id.
4. Delete the old connection.

Chats that used the old connection lose their panels when it is deleted.

## Publishing to ChatGPT's app directory

Not possible today. The directory rejects apps that embed other pages, and embedding a page is this plugin's whole job. It stays a developer-mode plugin until that changes.

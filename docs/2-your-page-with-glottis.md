# 2. Your page with glottis

Make your own page offer tools that ChatGPT can use through the bridge. This route works in every browser today.

The finished example is the demo shop: [`examples/shop/shop.js`](../examples/shop/shop.js).

## What your page needs

- **https.** ChatGPT only frames secure pages.
- **To allow being framed.** No `X-Frame-Options: DENY` or `SAMEORIGIN`, and no `Content-Security-Policy: frame-ancestors` that leaves out ChatGPT's sandbox. To allow only ChatGPT's frames, use `frame-ancestors https://*.web-sandbox.oaiusercontent.com`.

## Step 1: load glottis

With a script tag, which defines `window.glottis`:

```html
<script src="https://cdn.jsdelivr.net/npm/glottis@0.4/dist/glottis.min.js"></script>
```

Or as a module:

```html
<script type="importmap">{ "imports": { "glottis": "https://cdn.jsdelivr.net/npm/glottis@0.4/+esm" } }</script>
<script type="module">
  import { serve, tool } from 'glottis';
</script>
```

Or from npm: `npm install glottis`.

## Step 2: define a tool and serve it

```js
const { serve, tool } = window.glottis;

serve({
  clients: { remoteWindow: { allowed: true, domain: '*' } },
  exports: {
    say_hello: tool({
      description: 'Writes a greeting on the page for the given name.',
      input:       { type: 'object', properties: { name: { type: 'string' } }, required: [ 'name' ] },
      handler:     ({ name }) => {
        document.body.append(`Hello, ${ name }!`);
        return { greeted: name };
      }
    })
  }
});
```

- Only functions made with `tool()` become tools. Plain functions and constants stay private to glottis callers.
- The tool's name is its path in `exports` (`say_hello`). Nested ones are joined with `_` (`cart.add` becomes `cart_add`).
- Write the `description` for a model to read: ChatGPT picks tools by it.
- A plain JSON Schema `input` only describes the arguments; your handler must check them itself. Pass a zod schema instead to have glottis check them.
- What the handler returns goes back to ChatGPT; what it throws reaches ChatGPT as the error message.

`domain: '*'` lets any site connect. To allow only ChatGPT's frames, use `domain: /^https:\/\/[\w-]+\.web-sandbox\.oaiusercontent\.com$/`.

## Step 3: try it

1. Open the bridge in ChatGPT (see [1. Try it](1-try-it.md)).
2. Type your page's address into the panel's address bar.
3. The status bar lists your tools, with "· glottis" after them, and ChatGPT says what it can do.

## Step 4 (optional): ask the user first

Make `exports` an async function: glottis holds the connection open until it returns, and a thrown error refuses the caller.

```js
serve({
  clients: { remoteWindow: { allowed: true, domain: '*' } },
  exports: async ({ client }) => {
    if (!await askTheUser(`Let ${ client.origin } use this page?`)) {
      throw new Error('The user declined.');
    }
    return tools;
  }
});
```

Show the question inside your page, so only the user's click can answer it. The demo shop's `askUser` is a full example: it names ChatGPT, and remembers the answer.

## Step 5 (optional): tell the panel where your page is

Export a constant `page: { url, title }`. The panel shows that address and title, and uses the address for later calls. The demo shop uses this to keep its cart id (`?cart=…`) in the URL, so every call reaches the same cart.

## Step 6 (optional): offer the same tools to native WebMCP

Add the `webMcp` client, and glottis also registers your tools with the browser's WebMCP:

```js
clients: {
  remoteWindow: { allowed: true, domain: '*' },
  webMcp:       { allowed: true, domain: location.ancestorOrigins[0] }
}
```

`domain` is the page that frames yours (the bridge's panel) and must be an exact origin. See [3. True WebMCP mode](3-true-webmcp-mode.md).

## Coming from `registerTool()`

If your page already registers WebMCP tools, wrap each one in `tool()`:

```js
// Before: WebMCP only
document.modelContext.registerTool({
  name:        'say_hello',
  description: 'Writes a greeting on the page.',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
  execute:     ({ name }) => greet(name)
});

// After: glottis, which also registers it with WebMCP
serve({
  clients: { remoteWindow: { allowed: true, domain: '*' }, webMcp: { allowed: true } },
  exports: {
    say_hello: tool({
      description: 'Writes a greeting on the page.',
      input:       { type: 'object', properties: { name: { type: 'string' } } },
      handler:     ({ name }) => greet(name)
    })
  }
});
```

`name` becomes the key in `exports`, `inputSchema` becomes `input`, and `execute` becomes `handler`.

## Next

- Test native WebMCP as well: [3. True WebMCP mode](3-true-webmcp-mode.md).
- The tools don't show up: [7. Troubleshooting](7-troubleshooting.md).

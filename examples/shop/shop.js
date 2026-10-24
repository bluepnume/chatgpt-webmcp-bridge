// Kiln & Cotton: a demo shop whose actions are tools, served with glottis.
//
// This is the example to copy. It shows a page offering tools to ChatGPT
// through the bridge:
// - over glottis, which works in every browser: the panel connects, the shop
//   asks the user first, and calls arrive as ordinary function calls;
// - over native WebMCP, which glottis also registers the tools with, for
//   browsers that have it.
// The Add buttons run the same code as the add_to_cart tool, so the user and
// the model share one cart.

import { CLIENT_TYPE, serve, tool } from 'glottis';

const ART = {
    mug: color => `<svg viewBox="0 0 100 100"><path d="M22 28h46v40a14 14 0 0 1-14 14H36a14 14 0 0 1-14-14z" fill="${ color }"/><path d="M68 38h6a12 12 0 0 1 0 24h-6" fill="none" stroke="${ color }" stroke-width="7"/><ellipse cx="45" cy="28" rx="23" ry="5" fill="#000" opacity=".12"/><path d="M36 14c0 5 5 5 5 10M48 12c0 5 5 5 5 10" fill="none" stroke="#a8998a" stroke-width="3" stroke-linecap="round"/></svg>`,
    tee: color => `<svg viewBox="0 0 100 100"><path d="M36 16l-22 10 7 18 9-4v44h40V40l9 4 7-18-22-10c-2 7-8 11-14 11s-12-4-14-11z" fill="${ color }"/><path d="M38 17c3 5 7 8 12 8s9-3 12-8" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/></svg>`,
    stickers: () => '<svg viewBox="0 0 100 100"><rect x="16" y="22" width="44" height="44" rx="10" fill="#e9b949" transform="rotate(-10 38 44)"/><circle cx="62" cy="58" r="22" fill="#5b8def"/><path d="M52 58l7 7 13-14" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 76l6-12 6 12z" fill="#b4532a"/></svg>'
};

const PRODUCTS = [
    { id: 'mug-blue', name: 'Blue mug', price: 12, art: ART.mug('#3d6fb6') },
    { id: 'mug-red', name: 'Red mug', price: 12, art: ART.mug('#c2452d') },
    { id: 'tee-black', name: 'Black T-shirt', price: 25, art: ART.tee('#2a2724') },
    { id: 'stickers', name: 'Sticker pack', price: 5, art: ART.stickers() }
];

const element = id => document.getElementById(id);

// ---- the cart ----

// Every visit starts with an empty cart. The cart's id rides in the URL
// (?cart=…), so the bridge's later calls, which reload this URL in a new
// panel, find the same cart; opening the shop afresh gets a new one.
const pageUrl = new URL(location.href);

if (!pageUrl.searchParams.get('cart')) {
    pageUrl.searchParams.set('cart', crypto.randomUUID().slice(0, 8));
    history.replaceState(null, '', pageUrl);
}

const cartId = pageUrl.searchParams.get('cart');
const CART_KEY = `kiln-and-cotton-cart:${ cartId }`;
const CONSENT_KEY = `kiln-and-cotton-consent:${ cartId }`;

// Storage can be unavailable in some frames; the shop still works, it just forgets.
const load = ({ key, fallback }) => {
    try {
        return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
    } catch {
        return fallback;
    }
};

const save = ({ key, value }) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
        console.warn('Kiln & Cotton: could not save', err);
    }
};

let cart = load({ key: CART_KEY, fallback: {} });

const cartLines = () => Object.entries(cart).map(([ id, quantity ]) => {
    const product = PRODUCTS.find(candidate => candidate.id === id);

    return { product_id: id, name: product?.name ?? id, quantity, line_total: (product?.price ?? 0) * quantity };
});

const render = ({ flash } = {}) => {
    const lines = cartLines();
    const list = element('cart');

    list.replaceChildren(...lines.length
        ? lines.map(line => {
            const item = document.createElement('li');
            const label = document.createElement('span');
            const quantity = document.createElement('span');
            const price = document.createElement('span');

            item.className = line.product_id === flash ? 'flash' : '';
            quantity.className = 'qty';
            quantity.textContent = `${ line.quantity } ×`;
            label.append(quantity, ` ${ line.name }`);
            price.textContent = `$${ line.line_total }`;
            item.append(label, price);

            return item;
        })
        : [ Object.assign(document.createElement('li'), { className: 'empty', textContent: 'Your cart is empty' }) ]);

    element('count').textContent = String(lines.reduce((sum, line) => sum + line.quantity, 0));
    element('total').hidden = !lines.length;
    element('total-amount').textContent = `$${ lines.reduce((sum, line) => sum + line.line_total, 0) }`;
    element('checkout').disabled = !lines.length;

    if (flash) {
        const bag = element('bag');

        bag.classList.remove('bump');
        void bag.offsetWidth;
        bag.classList.add('bump');
    }
};

const addToCart = ({ productId, quantity }) => {
    if (!PRODUCTS.some(product => product.id === productId)) {
        throw new Error(`Unknown product_id "${ productId }". Valid ids: ${ PRODUCTS.map(product => product.id).join(', ') }.`);
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error('quantity must be a positive integer.');
    }

    cart = { ...cart, [ productId ]: (cart[productId] ?? 0) + quantity };
    save({ key: CART_KEY, value: cart });
    render({ flash: productId });
};

const clearCart = () => {
    cart = {};
    save({ key: CART_KEY, value: cart });
    render();
};

element('products').innerHTML = PRODUCTS.map(product => `
  <article class="card">
    <div class="art">${ product.art }</div>
    <div class="info">
      <span class="name">${ product.name }</span>
      <div class="row"><span class="price">$${ product.price }</span><button class="add" type="button" data-id="${ product.id }">Add</button></div>
    </div>
  </article>`).join('');

element('products').addEventListener('click', event => {
    const id = event.target.closest('.add')?.dataset.id;

    if (id) {
        addToCart({ productId: id, quantity: 1 });
    }
});

// ---- the tools ----

// Plain JSON Schema: glottis lists it for the model but does not check it, so
// the handlers check their own arguments.
const NO_ARGUMENTS = { type: 'object', properties: {}, additionalProperties: false };

const tools = {
    // Not a tool: where this page is, cart id included, so the bridge can come back to the same cart.
    page: { url: location.href, title: document.title },

    list_products: tool({
        description: 'Lists the products the shop sells, with their ids and prices.',
        input:       NO_ARGUMENTS,
        annotations: { readOnlyHint: true },
        handler:     () => ({ products: PRODUCTS.map(({ id, name, price }) => ({ id, name, price })) })
    }),

    add_to_cart: tool({
        description: 'Adds a product to the shopping cart. Use a product_id from list_products.',
        input:       {
            type:                 'object',
            properties:           { product_id: { type: 'string' }, quantity: { type: 'integer', minimum: 1, default: 1 } },
            required:             [ 'product_id' ],
            additionalProperties: false
        },
        handler: ({ product_id: productId, quantity = 1 }) => {
            addToCart({ productId, quantity });

            return { added: { product_id: productId, quantity }, cart: cartLines() };
        }
    }),

    view_cart: tool({
        description: 'Returns the current contents of the shopping cart.',
        input:       NO_ARGUMENTS,
        annotations: { readOnlyHint: true },
        handler:     () => ({ cart: cartLines() })
    }),

    clear_cart: tool({
        description: 'Empties the shopping cart.',
        input:       NO_ARGUMENTS,
        handler:     () => {
            clearCart();

            return { cart: [] };
        }
    })
};

// ---- asking first ----

// Before another site gets the tools over glottis, the shop asks. The
// buttons are in this page, so only the user's click here can answer. An
// allowed site is remembered for this cart, so the bridge's later calls on
// the same cart go straight in.
const siteName = origin => (/\.oaiusercontent\.com$/.test(new URL(origin).hostname) ? 'ChatGPT' : new URL(origin).hostname);

const askUser = async ({ origin }) => {
    if (load({ key: CONSENT_KEY, fallback: {} })[origin]) {
        return true;
    }

    element('consent-who').textContent = siteName(origin);
    element('consent').hidden = false;

    const allowed = await new Promise(resolve => {
        element('consent-allow').onclick = () => resolve(true);
        element('consent-deny').onclick = () => resolve(false);
    });

    element('consent').hidden = true;

    if (allowed) {
        save({ key: CONSENT_KEY, value: { ...load({ key: CONSENT_KEY, fallback: {} }), [ origin ]: true } });
    }

    return allowed;
};

// ---- serving ----

// Native WebMCP tools reach another site only if exposed to it by exact
// origin. This demo exposes them to whatever frames it, which in ChatGPT is
// the bridge's panel, without asking: fine for a pretend cart, not a pattern
// to copy for a real one.
const embedder = location.ancestorOrigins?.[0];

serve({
    description: 'Kiln & Cotton, a demo shop',
    clients:     {
        remoteWindow: { allowed: true, domain: '*' },
        webMcp:       { allowed: true, ...embedder?.startsWith('https://') ? { domain: embedder } : {} }
    },
    exports: async ({ client }) => {
        if (client.type === CLIENT_TYPE.REMOTE_WINDOW && !await askUser({ origin: client.origin })) {
            throw new Error('The user declined to let this site use the shop.');
        }

        return tools;
    }
});

render();

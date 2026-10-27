// Rising Sun Records: a demo shop whose actions are tools, served with glottis.
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

const PRODUCTS = [
    { id: 'sunshower-1977', name: 'Taeko Ohnuki, Sunshower', price: 64, image: 'images/sunshower.jpg' },
    { id: 'for-you-1982', name: 'Tatsuro Yamashita, For You', price: 120, image: 'images/for-you.jpg' },
    { id: 'variety-1984', name: 'Mariya Takeuchi, Variety', price: 95, image: 'images/variety.jpg' },
    { id: 'mint-jams-1982', name: 'Casiopea, Mint Jams', price: 45, image: 'images/mint-jams.jpg' }
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
const CART_KEY = `rising-sun-records-cart:${ cartId }`;
const CONSENT_KEY = `rising-sun-records-consent:${ cartId }`;

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
        console.warn('Rising Sun Records: could not save', err);
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
    <div class="art"><img src="${ product.image }" alt=""></div>
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
        description: 'Lists the records the shop sells, with their ids and prices.',
        input:       NO_ARGUMENTS,
        annotations: { readOnlyHint: true },
        handler:     () => ({ products: PRODUCTS.map(({ id, name, price }) => ({ id, name, price })) })
    }),

    add_to_cart: tool({
        description: 'Adds a record to the shopping cart. Use a product_id from list_products.',
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
    description: 'Rising Sun Records, a demo record shop',
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

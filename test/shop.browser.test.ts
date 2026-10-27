// The demo shop on its own: framed on the second origin, reached with glottis
// from this page, the way the panel reaches it.

import type { Connection } from 'glottis';

import { connect } from 'glottis';
import { page } from 'vitest/browser';

import { cleanFrames, env, waitFor } from './common';

type CartLine = { readonly product_id : string, readonly quantity : number };

type Shop = {
    readonly list_products : () => Promise<{ readonly products : ReadonlyArray<{ readonly id : string }> }>,
    readonly add_to_cart : (
        args : Readonly<Record<string, unknown>>
    ) => Promise<{ readonly cart : ReadonlyArray<CartLine> }>,
    readonly view_cart : () => Promise<{ readonly cart : ReadonlyArray<unknown> }>,
    readonly clear_cart : () => Promise<{ readonly cart : ReadonlyArray<unknown> }>,
};

let frames = 0;

type OpenedShop = { readonly frame : HTMLIFrameElement, readonly title : string };

type OpenShopOptions = { readonly cart : string };

const openShop = async ({ cart } : OpenShopOptions) : Promise<OpenedShop> => {
    frames += 1;
    const title = `shop-${ frames }`;
    const frame = document.createElement('iframe');

    frame.title = title;
    frame.style.width = '400px';
    frame.style.height = '480px';
    frame.src = `${ env.foreignOrigin }/examples/shop/index.html?cart=${ cart }`;
    document.body.append(frame);

    await new Promise(resolve => {
        frame.addEventListener('load', resolve, { once: true });
    });

    return { frame, title };
};

const shopConnect = (frame : HTMLIFrameElement) : Promise<Connection<Shop>> =>
    connect<Shop>({ target: frame, domain: env.foreignOrigin, timeout: 10_000 });

afterEach(cleanFrames);

describe('the demo shop', () => {
    it('asks first, then runs every tool', async () => {
        const cart = crypto.randomUUID().slice(0, 8);
        const { frame, title } = await openShop({ cart });
        const shopFrame = page.frameLocator(page.getByTitle(title));
        const connecting = shopConnect(frame);

        await shopFrame.getByRole('button', { name: 'Allow' }).click();

        const shop = (await connecting).exports;

        expect((await shop.list_products()).products.map(product => product.id)).toEqual([ `sunshower-1977`, `for-you-1982`, `variety-1984`, `mint-jams-1982` ]);
        expect((await shop.add_to_cart({ product_id: `for-you-1982` })).cart).toEqual([ expect.objectContaining({ product_id: `for-you-1982`, quantity: 1 }) as unknown ]);
        await shop.add_to_cart({ product_id: 'mint-jams-1982', quantity: 3 });
        expect((await shop.view_cart()).cart).toHaveLength(2);

        await expect(shop.add_to_cart({ product_id: `plastic-love-1984` })).rejects.toThrow(`Unknown product_id "plastic-love-1984"`);
        await expect(shop.add_to_cart({ product_id: `for-you-1982`, quantity: 0 })).rejects.toThrow(`quantity must be a positive integer.`);

        // The Add buttons share the cart; a click elsewhere in the list does nothing.
        await shopFrame.getByRole('button', { name: 'Add' }).first().click();
        await shopFrame.getByText('Taeko Ohnuki, Sunshower').first().click();
        expect((await shop.view_cart()).cart).toHaveLength(3);

        expect((await shop.clear_cart()).cart).toEqual([]);
        expect((await shop.view_cart()).cart).toEqual([]);
    });

    it('refuses a caller the user declines, and remembers one they allowed', async () => {
        const cart = crypto.randomUUID().slice(0, 8);
        const declined = await openShop({ cart });
        const refusing = shopConnect(declined.frame);

        // Handle the refusal before clicking, so it never rejects unhandled.
        const refused = expect(refusing).rejects.toThrow('The user declined to let this site use the shop.');

        await page.frameLocator(page.getByTitle(declined.title)).getByRole('button', { name: 'Don\'t allow' }).click();
        await refused;

        const allowed = await openShop({ cart });
        const allowing = shopConnect(allowed.frame);

        await page.frameLocator(page.getByTitle(allowed.title)).getByRole('button', { name: 'Allow' }).click();
        await (await allowing).disconnect();

        // Same cart, same site: no question this time.
        const again = await openShop({ cart });
        const connection = await shopConnect(again.frame);

        expect(await connection.exports.view_cart()).toEqual({ cart: [] });
    });

    it('starts a fresh cart for a visit without one', async () => {
        const frame = document.createElement('iframe');
        let reported = '';

        frame.style.width = '400px';
        frame.style.height = '480px';
        frame.src = `${ env.foreignOrigin }/examples/shop/index.html`;
        document.body.append(frame);

        await new Promise(resolve => {
            frame.addEventListener('load', resolve, { once: true });
        });

        const connecting = connect<{ readonly page : { readonly url : string } }>({
            target:  frame,
            domain:  env.foreignOrigin,
            timeout: 10_000
        });

        await page.frameLocator(page.elementLocator(frame)).getByRole('button', { name: 'Allow' }).click();
        reported = (await connecting).exports.page.url;
        await waitFor({ check: () => reported.includes('?cart=') });
    });
});

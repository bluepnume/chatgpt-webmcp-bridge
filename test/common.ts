// Helpers every browser suite shares.

import { collectChildCoverage } from './coverage';
import { getTestEnv } from './env';

collectChildCoverage();

export const env = getTestEnv();

type WaitForOptions = {
    readonly check : () => boolean,
    readonly timeout ?: number,
    readonly what ?: string,
};

export const waitFor = async ({ check, timeout = 10_000, what = 'condition' } : WaitForOptions) : Promise<void> => {
    const deadline = Date.now() + timeout;

    while (!check()) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${ what }`);
        }

        // eslint-disable-next-line no-await-in-loop -- polling
        await new Promise(resolve => {
            setTimeout(resolve, 20);
        });
    }
};

export const delay = (ms : number) : Promise<void> => new Promise(resolve => {
    setTimeout(resolve, ms);
});

export const cleanFrames = () : void => {
    for (const frame of document.querySelectorAll('iframe')) {
        frame.remove();
    }
};

// The demo shop, on the second origin.
export const shopUrl = () : string => `${ env.foreignOrigin }/examples/shop/index.html`;

// A test page on the second origin.
export const pageUrl = (name : string) : string => `${ env.foreignOrigin }/test/pages/${ name }.html`;

// `npx chatgpt-webmcp-bridge chrome`: opens Chrome ready for true WebMCP mode.
//
// - Your installed Google Chrome, in a profile of its own, so your everyday
//   browser and its tabs are untouched. Log in to ChatGPT there once.
// - WebMCP turned on (--enable-features=WebMCP).
// - Every iframe given the "tools" permission (grant-tools.ts), which
//   ChatGPT's own frames leave out.
//
// It drives Chrome with playwright-core, an optional dependency.

import { homedir } from 'node:os';
import path from 'node:path';

import { grantToolsToFrames } from './grant-tools';

type BrowserContext = {
    readonly addInitScript : (script : { readonly content : string }) => Promise<void>,
    readonly pages : () => ReadonlyArray<{ readonly goto : (url : string) => Promise<unknown> }>,
    readonly newPage : () => Promise<{ readonly goto : (url : string) => Promise<unknown> }>,
    readonly on : (event : 'close', listener : () => void) => unknown,
};

export type Chromium = {
    readonly launchPersistentContext : (
        userDataDir : string,
        options : Readonly<Record<string, unknown>>
    ) => Promise<BrowserContext>,
};

export const DEFAULT_PROFILE = path.join(homedir(), '.chatgpt-webmcp-bridge', 'chrome-profile');

export const GRANT_SCRIPT = `(${ grantToolsToFrames.toString() })();`;

const loadChromium = async () : Promise<Chromium> => {
    try {
        const playwright = await import('playwright-core') as unknown as { readonly chromium : Chromium };

        return playwright.chromium;
    } catch {
        throw new Error('The chrome command needs playwright-core. Install it with: npm install playwright-core');
    }
};

type LaunchChromeOptions = {
    readonly profile ?: string,
    readonly url ?: string,
    // A Playwright channel, e.g. 'chrome' (your Google Chrome) or 'chrome-beta'.
    readonly channel ?: string,
    readonly chromium ?: Chromium,
};

// Resolves once the window has been closed.
export const launchChrome = async ({ profile = DEFAULT_PROFILE, url = `https://chatgpt.com/`, channel = `chrome`, chromium } : LaunchChromeOptions = {}) : Promise<void> => {
    const browser = chromium ?? await loadChromium();

    const context = await browser.launchPersistentContext(profile, {
        channel,
        headless:          false,
        viewport:          null,
        args:              [ '--enable-features=WebMCP' ],
        // Chrome's own keychain, so a login made in this profile is kept.
        ignoreDefaultArgs: [ '--use-mock-keychain', '--enable-automation' ]
    });

    await context.addInitScript({ content: GRANT_SCRIPT });

    const closed = new Promise<void>(resolve => {
        context.on('close', resolve);
    });

    const page = context.pages()[0] ?? await context.newPage();

    await page.goto(url);
    await closed;
};

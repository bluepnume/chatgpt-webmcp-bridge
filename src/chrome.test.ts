import type { Chromium } from './chrome';

import { DEFAULT_PROFILE, GRANT_SCRIPT, launchChrome } from './chrome';

type Recorded = {
    profile ?: string,
    options ?: Readonly<Record<string, unknown>>,
    script ?: string,
    visited ?: string,
};

type FakeChromiumOptions = { readonly recorded : Recorded, readonly existingPage ?: boolean };

const fakeChromium = ({ recorded, existingPage = true } : FakeChromiumOptions) : Chromium => ({
    launchPersistentContext: (profile, options) => {
        recorded.profile = profile;
        recorded.options = options;
        let onClose = () : void => undefined;

        const page = {
            goto: (url : string) : Promise<void> => {
                recorded.visited = url;

                // The user closes the window right away.
                setTimeout(() => {
                    onClose();
                }, 0);

                return Promise.resolve();
            }
        };

        return Promise.resolve({
            addInitScript: ({ content }) => {
                recorded.script = content;

                return Promise.resolve();
            },

            pages: () => (existingPage
                ? [ page ]
                : []),

            newPage: () => Promise.resolve(page),

            on: (_event, listener) => {
                onClose = listener;
            }
        });
    }
});

describe('the Chrome launcher', () => {
    it('opens ChatGPT in its own profile with WebMCP on and the tools grant installed', async () => {
        const recorded : Recorded = {};

        await launchChrome({ chromium: fakeChromium({ recorded }) });

        expect(recorded.profile).toBe(DEFAULT_PROFILE);
        expect(recorded.options).toMatchObject({ channel: `chrome`, headless: false, args: [ `--enable-features=WebMCP` ] });
        expect(recorded.options?.ignoreDefaultArgs).toContain('--use-mock-keychain');
        expect(recorded.script).toBe(GRANT_SCRIPT);
        expect(recorded.visited).toBe('https://chatgpt.com/');
    });

    it('takes a profile, a url and a channel, and opens a page when there is none', async () => {
        const recorded : Recorded = {};

        await launchChrome({ profile: `/tmp/profile`, url: `https://example.com/`, channel: `chrome-beta`, chromium: fakeChromium({ recorded, existingPage: false }) });

        expect(recorded).toMatchObject({ profile: `/tmp/profile`, visited: `https://example.com/`, options: { channel: `chrome-beta` } });
    });

    it('sends the grant as one self-contained script', () => {
        expect(GRANT_SCRIPT.startsWith('(')).toBe(true);
        expect(GRANT_SCRIPT.endsWith(')();')).toBe(true);
        expect(GRANT_SCRIPT).toContain('tools *');
    });
});

describe('loading playwright-core', () => {
    afterEach(() => {
        vi.doUnmock('playwright-core');
        vi.resetModules();
    });

    it('uses playwright-core\'s Chromium when none is passed in', async () => {
        const recorded : Recorded = {};

        vi.doMock('playwright-core', () => ({ chromium: fakeChromium({ recorded }) }));
        const fresh = await import('./chrome');

        await fresh.launchChrome();

        expect(recorded.visited).toBe('https://chatgpt.com/');
    });

    it('says how to install playwright-core when it is missing', async () => {
        vi.doMock('playwright-core', () => {
            throw new Error('Cannot find module');
        });

        const fresh = await import('./chrome');

        await expect(fresh.launchChrome()).rejects.toThrow('npm install playwright-core');
    });
});

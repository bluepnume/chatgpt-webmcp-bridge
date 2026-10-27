import { cleanFrames, delay, env, pageUrl, shopUrl, waitFor } from './common';
import { CHATGPT_CAPABILITIES, createFakeHost } from './host';

afterEach(cleanFrames);

type ToolCallData = {
    readonly call_id : string,
    readonly ok : boolean,
    readonly result ?: unknown,
    readonly error ?: string,
};

describe('starting up', () => {
    it('runs the handshake, reports its size and takes the theme', async () => {
        const host = await createFakeHost({ hostContext: { theme: 'dark' } });

        await host.waitForText('status', 'Connected');

        const methods = host.received.map(message => message.method);

        expect(methods).toContain('ui/initialize');
        expect(methods).toContain('ui/notifications/initialized');
        expect(host.sizes.length).toBeGreaterThan(0);
        expect(host.panelDocument().documentElement.dataset.theme).toBe('dark');

        host.send('ui/notifications/host-context-changed', { theme: 'light' });
        await waitFor({ check: () => host.panelDocument().documentElement.dataset.theme === 'light' });
        host.send('ui/notifications/host-context-changed', {});
        // Messages the panel does not handle, or that are not JSON-RPC, are ignored.
        host.send('ui/notifications/something-new', {});
        host.frame.contentWindow?.postMessage('not json-rpc', '*');
        host.frame.contentWindow?.postMessage({ jsonrpc: '2.0', id: 999, result: {} }, '*');

        expect(await host.ping()).toMatchObject({ result: {} });
    });

    it('says when ChatGPT refuses the handshake', async () => {
        const host = await createFakeHost({ refuseInitialize: true });

        await host.waitForText('status', 'Could not connect to ChatGPT: No apps here');
    });

    it('waits for the handshake before acting on a tool call', async () => {
        const host = await createFakeHost({ demo: 'none' });

        host.openBrowser();
        await host.waitForText('status', 'Ready');

        expect((host.byId('try') as HTMLButtonElement).hidden).toBe(true);
        expect(host.panelDocument().getElementById('start')?.hidden).toBe(false);
    });

    it('takes a host context with no theme', async () => {
        const host = await createFakeHost({ hostContext: {} });

        await host.waitForText('status', 'Connected');

        expect(host.panelDocument().documentElement.dataset.theme).toBeUndefined();
    });
});

describe('the user opening a page', () => {
    it('opens the demo shop from Try, asks first, then hands its tools to ChatGPT', async () => {
        const host = await createFakeHost({ demo: shopUrl() });

        host.openBrowser();
        await host.waitForText('status', 'Ready');

        const tryButton = host.byId('try') as HTMLButtonElement;

        expect(tryButton.textContent).toContain('[::1]');
        tryButton.click();

        await host.siteLocator().getByRole('button', { name: 'Allow' }).click();
        await host.waitForText('tools', 'add_to_cart');

        expect(host.text('tools')).toContain('glottis');
        expect(host.text('tab')).toBe('Rising Sun Records');
        // The shop added its cart id to its address; the panel follows it.
        expect((host.byId(`address`) as HTMLInputElement).value).toMatch(/\?cart=[\da-f]{8}$/);

        const intro = await host.waitForChat(1);

        expect(intro.text).toBe('✓ Opened Rising Sun Records: 4 tools (attached).');
        expect(intro.data).toMatchObject({ opened_by: 'user', title: 'Rising Sun Records' });
        await waitFor({ check: () => host.contexts.length > 0 });
        expect(host.contexts[0]).toContain('add_to_cart(product_id: string, quantity: integer?)');
    });

    it('types an address, then goes back, forward and reloads', async () => {
        const host = await createFakeHost({ demo: 'none' });

        const go = (address : string) : void => {
            (host.byId('address') as HTMLInputElement).value = address;
            (host.byId('go') as HTMLFormElement).requestSubmit();
        };

        const button = (id : string) : HTMLButtonElement => host.byId(id) as HTMLButtonElement;

        host.openBrowser();
        await host.waitForText('status', 'Ready');

        // Nothing happens for an empty or impossible address.
        go('   ');
        go('http://');
        await delay(100);
        expect(host.text('status')).toBe('Ready');

        go(pageUrl('glottis'));
        await host.waitForText('tools', 'echo_back');
        expect(host.text('tools')).toContain('shelf_count');
        expect(host.text('tools')).not.toContain('plain');

        go(`${ pageUrl('glottis') }?noPage=1`);
        await host.waitForText('tools', 'echo_back');
        expect(host.text('tab')).toBe(`[::1]:${ location.port }`);
        expect(button('back').disabled).toBe(false);

        button('back').click();
        await host.waitForText('tab', 'A glottis page');
        expect(button('forward').disabled).toBe(false);

        button('forward').click();
        await host.waitForText('tab', '[::1]');

        button('reload').click();
        await host.waitForText('status', 'Ready');

        // Nothing further back than the first page, or forward of the last.
        button('forward').click();
        button('back').click();
        button('back').click();
        await host.waitForText('tab', 'A glottis page');
        expect(button('back').disabled).toBe(true);
        button('back').click();
    });

    it('follows a page that reports a different address', async () => {
        const host = await createFakeHost({ demo: 'none' });
        const elsewhere = `${ env.foreignOrigin }/elsewhere/`;

        host.openBrowser();
        await host.waitForText('status', 'Ready');
        (host.byId('address') as HTMLInputElement).value = `${ pageUrl('glottis') }?reportedUrl=${ encodeURIComponent(elsewhere) }`;
        (host.byId('go') as HTMLFormElement).requestSubmit();

        await waitFor({ check: () => (host.byId(`address`) as HTMLInputElement).value === elsewhere });
        expect((host.byId('back') as HTMLButtonElement).disabled).toBe(false);
    });

    it('says when a page offers no tools', async () => {
        const host = await createFakeHost({ demo: 'none' });

        host.openBrowser({ url: pageUrl('empty') });

        const message = await host.waitForChat(1);

        expect(host.text('tools')).toContain('No tools found on this page');
        expect(message.text).toContain('✗ Opened [::1]');
        expect(message.data).toMatchObject({ opened_by: 'model', tools: [] });
    });
});

describe('the model opening a page', () => {
    it('posts the page\'s tools so the model can carry on', async () => {
        const host = await createFakeHost();

        host.openBrowser({ url: `${ pageUrl('glottis') }?x=1` });

        const message = await host.waitForChat(1);

        expect(message.text).toBe('✓ Opened A glottis page: 3 tools (attached).');
        expect(message.data).toMatchObject({ opened_by: 'model' });
        // Only the model's own message, no introduction as well.
        await delay(300);
        expect(host.chat).toHaveLength(1);
    });

    it('says when the page refused', async () => {
        const host = await createFakeHost();

        host.openBrowser({ url: `${ pageUrl('glottis') }?decline=1` });

        const message = await host.waitForChat(1);

        expect(host.text('tools')).toBe('Access declined in the page');
        // The status moves on once ChatGPT accepts the message, a moment after it arrives.
        await expect.poll(() => host.text('status')).not.toBe('Declined');
        expect(JSON.stringify(message.data)).toContain('declined');
    });
});

describe('running a call', () => {
    it('runs a tool in the shop and reports its result', async () => {
        const host = await createFakeHost();
        const callId = host.callTool({ url: shopUrl(), tool: `add_to_cart`, args: { product_id: `sunshower-1977`, quantity: 2 } });

        await host.siteLocator().getByRole('button', { name: 'Allow' }).click();

        const message = await host.waitForChat(1);
        const data = message.data as ToolCallData;

        expect(message.text).toBe(`✓ add_to_cart ran on Rising Sun Records (call ${ callId.slice(0, 8) }). Result attached.`);
        expect(data).toMatchObject({ call_id: callId, ok: true, result: { added: { product_id: `sunshower-1977`, quantity: 2 } } });
        await host.waitForText('status', 'sent');
    });

    it('reports a tool\'s error', async () => {
        const host = await createFakeHost();

        host.callTool({ url: pageUrl('glottis'), tool: 'broken' });

        const message = await host.waitForChat(1);

        expect(message.text).toContain('✗ broken failed on A glottis page');
        expect(message.text).toContain('Shelf collapsed');
        expect(message.data).toMatchObject({ ok: false, error: 'Shelf collapsed' });
    });

    it('reports an unknown tool', async () => {
        const host = await createFakeHost();

        host.callTool({ url: pageUrl('glottis'), tool: 'nope' });

        expect((await host.waitForChat(1)).data).toMatchObject({ ok: false, error: 'Unknown tool "nope".' });
    });

    it('calls a tool under a nested name, and one with its own name', async () => {
        const first = await createFakeHost();

        first.callTool({ url: pageUrl('glottis'), tool: 'shelf_count' });
        expect((await first.waitForChat(1)).data).toMatchObject({ ok: true, result: 3 });

        const second = await createFakeHost();

        second.callTool({ url: pageUrl('glottis'), tool: 'echo_back', args: { word: 'hi' } });
        expect((await second.waitForChat(1)).data).toMatchObject({ ok: true, result: { word: 'hi' } });
    });

    it('does not run a call when the user declines', async () => {
        const host = await createFakeHost();
        const callId = host.callTool({ url: shopUrl(), tool: 'view_cart' });

        await host.siteLocator().getByRole('button', { name: 'Don\'t allow' }).click();

        const message = await host.waitForChat(1);

        expect(message.text).toBe(`✗ view_cart was not run on [::1]:${ location.port } (call ${ callId.slice(0, 8) }).`);
        expect((message.data as ToolCallData).error).toContain('declined');
        expect(host.text('status')).toContain('view_cart');
    });

    it('does not run a call on a page with no tools', async () => {
        const host = await createFakeHost();

        host.callTool({ url: pageUrl('empty'), tool: 'anything' });

        expect((await host.waitForChat(1)).data).toMatchObject({ ok: false, error: expect.stringContaining(`The page loaded, but it offers no tools`) as unknown });
    });

    it('does not run a call twice when ChatGPT shows the panel again', async () => {
        const first = await createFakeHost();
        const callId = first.callTool({ url: pageUrl('glottis'), tool: 'echo_back', args: { word: 'once' } });

        await first.waitForChat(1);

        const again = await createFakeHost();

        again.callTool({ url: pageUrl('glottis'), tool: 'echo_back', args: { word: 'once' }, callId });
        await again.waitForText('status', 'echo_back: already run');
        expect(again.chat).toHaveLength(0);
    });

    it('ignores a tool call missing its call id', async () => {
        const host = await createFakeHost();

        host.send('ui/notifications/tool-input', { arguments: { url: pageUrl('glottis'), tool: 'echo_back' } });
        host.send('ui/notifications/tool-result', { structuredContent: {} });

        // Without a call id it is treated as opening the page.
        expect((await host.waitForChat(1)).text).toContain('✓ Opened A glottis page');
    });
});

describe('sending into the conversation', () => {
    it('steers a result into the reply when ChatGPT refuses a new turn', async () => {
        const host = await createFakeHost({
            policy: target => (target === `active`
                ? `Steering requires an active compatible turn`
                : true)
        });

        host.callTool({ url: pageUrl('glottis'), tool: 'shelf_count' });

        const message = await host.waitForChat(1);

        expect(message.target).toBeUndefined();
        await host.waitForText('status', 'sent into the reply');
    });

    it('waits and tries again when ChatGPT refuses both for a moment', async () => {
        let refusals = 2;

        const host = await createFakeHost({
            policy: () => {
                refusals -= 1;

                return refusals >= 0
                    ? 'The composer is unavailable'
                    : true;
            }
        });

        host.callTool({ url: pageUrl('glottis'), tool: 'shelf_count' });

        const message = await host.waitForChat(1);

        expect(message.target).toBe('active');
    });

    it('sends one plain message to a host without ChatGPT\'s extensions, and shares no context', async () => {
        const host = await createFakeHost({ capabilities: {} });

        host.callTool({ url: pageUrl('glottis'), tool: 'shelf_count' });

        const message = await host.waitForChat(1);

        expect(message.data).toBeUndefined();
        expect(message.text).toContain('✓ shelf_count ran');
        expect(host.contexts).toHaveLength(0);
    });

    it('says when a plain message is refused', async () => {
        const host = await createFakeHost({ capabilities: {}, policy: () => 'No messages' });

        host.callTool({ url: pageUrl('glottis'), tool: 'shelf_count' });
        await host.waitForText('status', 'Could not send: No messages');
    });

    it('carries on when ChatGPT refuses the model context', async () => {
        const host = await createFakeHost({ capabilities: CHATGPT_CAPABILITIES, refuseContext: true });

        host.callTool({ url: pageUrl('glottis'), tool: 'shelf_count' });

        expect((await host.waitForChat(1)).data).toMatchObject({ ok: true });
    });
});

describe('one live browser at a time', () => {
    it('folds an older panel when a newer one opens', async () => {
        const older = await createFakeHost({ demo: 'none' });

        older.openBrowser({ url: pageUrl('glottis'), openedAt: 1000 });
        await older.waitForChat(1);

        const newer = await createFakeHost({ demo: 'none' });

        newer.openBrowser({ openedAt: 2000 });

        await waitFor({ check: () => older.panelDocument().getElementById(`moved`)?.hidden === false, what: `the older panel to fold` });
        expect(older.panelDocument().getElementById('window')?.hidden).toBe(true);
        expect(older.panelDocument().getElementById('site')?.getAttribute('src')).toBeNull();
        expect(newer.panelDocument().getElementById('moved')?.hidden).toBe(true);
    });

    it('folds an older panel that ChatGPT shows after the newer one', async () => {
        const newer = await createFakeHost({ demo: 'none' });

        newer.openBrowser({ openedAt: 5000 });
        await newer.waitForText('status', 'Ready');

        const older = await createFakeHost({ demo: 'none' });

        older.openBrowser({ openedAt: 4000 });

        await waitFor({ check: () => older.panelDocument().getElementById(`moved`)?.hidden === false, what: `the older panel to fold` });
        expect(newer.panelDocument().getElementById('moved')?.hidden).toBe(true);
    });

    it('stamps a panel with no opened_at, and keeps a panel that is mid-call', async () => {
        const calling = await createFakeHost({ policy: () => 'busy' });

        calling.send('ui/notifications/tool-input', { arguments: { url: pageUrl('glottis'), tool: 'shelf_count' } });
        calling.send('ui/notifications/tool-result', { structuredContent: { call_id: crypto.randomUUID() } });
        await calling.waitForText('status', 'Waiting for ChatGPT');

        const newer = await createFakeHost({ demo: 'none' });

        newer.openBrowser({ openedAt: Date.now() + 60_000 });

        await waitFor({ check: () => calling.panelDocument().getElementById(`moved`)?.hidden === false, what: `the calling panel to fold` });
        // Still has its page, to finish sending its result.
        expect(calling.panelDocument().getElementById('site')?.getAttribute('src')).not.toBeNull();
    });
});

describe('native WebMCP', () => {
    it('lists and runs a page\'s exposed tools natively', async () => {
        const host = await createFakeHost({ demo: 'none' });

        host.callTool({ url: pageUrl('native'), tool: 'say_hello', args: { name: 'Ada' } });

        const message = await host.waitForChat(1);

        expect(host.text('tools')).toContain('native WebMCP');
        expect(message.data).toMatchObject({ ok: true, result: { greeted: 'Ada' } });
    });

    it('reports a native tool\'s failure', async () => {
        const host = await createFakeHost({ demo: 'none' });

        host.callTool({ url: pageUrl('native'), tool: 'fail' });

        expect((await host.waitForChat(1)).data).toMatchObject({ ok: false });
    });

    it('prefers glottis when a page offers both', async () => {
        const host = await createFakeHost({ demo: 'none' });

        host.openBrowser({ url: `${ pageUrl('glottis') }?native=1` });
        await host.waitForChat(1);

        expect(host.text('tools')).toContain('glottis');
    });

    it('starts with native tools and switches when glottis answers late', async () => {
        const host = await createFakeHost({ demo: 'none' });

        host.openBrowser({ url: `${ pageUrl('glottis') }?native=1&delay=3000` });

        const message = await host.waitForChat(1);

        // The early native tool came first.
        expect(message.text).toContain('1 tool (attached)');
        expect(host.text('tools')).toContain('native WebMCP');
        await host.waitForText('tools', 'glottis');
    });
});

describe('edges of the protocol', () => {
    it('takes a handshake answered with nothing', async () => {
        const host = await createFakeHost({ initializeResult: null });

        await host.waitForText('status', 'Connected');
    });

    it('says when the handshake is refused without a reason', async () => {
        const host = await createFakeHost({ refuseInitializeBare: true });

        await host.waitForText('status', 'ChatGPT refused the request');
    });

    it('ignores a message with neither a method nor a result, and takes a call with no arguments', async () => {
        const host = await createFakeHost({ demo: 'none' });

        await host.waitForText('status', 'Connected');
        host.frame.contentWindow?.postMessage({ jsonrpc: '2.0' }, '*');
        host.frame.contentWindow?.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-input' }, '*');
        host.send('ui/notifications/tool-result', { structuredContent: { opened_at: 1 } });
        // A second result changes nothing.
        host.send('ui/notifications/tool-result', { structuredContent: { opened_at: 2 } });
        await host.waitForText('status', 'Ready');
    });
});

describe('more of the browser', () => {
    const go = (host : Awaited<ReturnType<typeof createFakeHost>>, address : string) : void => {
        (host.byId('address') as HTMLInputElement).value = address;
        (host.byId('go') as HTMLFormElement).requestSubmit();
    };

    it('says when a glottis page offers no tools', async () => {
        const host = await createFakeHost({ demo: 'none' });

        host.openBrowser();
        await host.waitForText('status', 'Ready');
        go(host, `${ pageUrl('glottis') }?noTools=1`);
        await host.waitForText('tools', 'The page offers no tools');
        await waitFor({ check: () => host.contexts.some(text => text.endsWith('It offers no tools.')) });
    });

    it('notices when the page navigates somewhere with no tools', async () => {
        const host = await createFakeHost({ demo: 'none' });

        host.openBrowser();
        await host.waitForText('status', 'Ready');
        go(host, pageUrl('glottis'));
        await host.waitForText('tools', 'echo_back');
        await host.siteLocator().getByRole('link', { name: 'Leave' }).click();
        await host.waitForText('tools', 'No tools found on this page');
    });

    it('drops a load the user has already moved on from', async () => {
        const host = await createFakeHost({ demo: 'none' });

        host.openBrowser();
        await host.waitForText('status', 'Ready');
        go(host, `${ pageUrl('glottis') }?delay=1500`);
        await delay(400);
        go(host, pageUrl('glottis'));
        await host.waitForText('tools', 'echo_back');
        await delay(2500);

        expect((host.byId('address') as HTMLInputElement).value).toBe(pageUrl('glottis'));
    });

    it('drops a load superseded while it was still loading the frame', async () => {
        const host = await createFakeHost({ demo: 'none' });

        host.openBrowser();
        await host.waitForText('status', 'Ready');
        go(host, pageUrl('empty'));
        go(host, pageUrl('glottis'));
        await host.waitForText('tools', 'echo_back');
    });
});

describe('more panels', () => {
    it('folds once however many newer panels open, breaks ties by id, and ignores stray announcements', async () => {
        const channel = new BroadcastChannel('chatgpt-webmcp-bridge-panels');
        const first = await createFakeHost({ demo: 'none' });

        first.openBrowser({ openedAt: 10 });
        await first.waitForText('status', 'Ready');

        for (const stray of [ { type: 'something-else' }, { type: 'opened', id: 'no-time' } ]) {
            // eslint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel takes no target origin
            channel.postMessage(stray);
        }

        const tie = await createFakeHost({ demo: 'none' });

        tie.openBrowser({ openedAt: 10 });
        await waitFor({ check: () => [ first, tie ].some(host => host.panelDocument().getElementById(`moved`)?.hidden === false), what: `one of the tied panels to fold` });

        const newest = await createFakeHost({ demo: 'none' });

        newest.openBrowser({ openedAt: 20 });
        await waitFor({ check: () => [ first, tie ].every(host => host.panelDocument().getElementById(`moved`)?.hidden === false), what: `both older panels to fold` });
        channel.close();
    });
});

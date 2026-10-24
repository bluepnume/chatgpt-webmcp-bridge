import type { Host } from './panel-host';

import { describeTools, sendToChat } from './panel-chat';

const fakeHost = (request : Host['request']) : Host => ({
    request,
    notify:       () => undefined,
    on:           () => undefined,
    capabilities: () => ({ experimental: { 'openai/message': {} } }),
    initialize:   () => Promise.resolve({})
});

describe('describing tools', () => {
    it('lists parameters, marking the optional ones', () => {
        expect(describeTools([
            { name: `a`, description: `A.`, inputSchema: { properties: { x: { type: `string` }, y: {} }, required: [ `x` ] } },
            { name: 'b', description: 'B.', inputSchema: {} }
        ])).toBe('- a(x: string, y: any?): A.\n- b(): B.');
    });
});

describe('sending into the conversation', () => {
    it('gives up after its attempts when ChatGPT keeps refusing', async () => {
        const statuses : Array<string> = [];

        const sent = await sendToChat({
            host:       fakeHost(() => Promise.reject(new Error('busy'))),
            name:       'x',
            text:       'hello',
            onStatus:   status => statuses.push(status),
            attempts:   2,
            retryDelay: 1
        });

        expect(sent).toBe(false);
        expect(statuses.at(-1)).toBe('Could not send: ChatGPT kept refusing the message');
    });

    it('sends without an attachment when there is no data', async () => {
        const params : Array<unknown> = [];

        const sent = await sendToChat({
            host: fakeHost(message => {
                params.push(message.params);

                return Promise.resolve({});
            }),
            name:     'x',
            text:     'hello',
            onStatus: () => undefined
        });

        expect(sent).toBe(true);
        expect(params).toEqual([ { role: `user`, content: [ { type: `text`, text: `hello` } ], _meta: { 'openai/message': { target: `active`, send: true } } } ]);
    });
});

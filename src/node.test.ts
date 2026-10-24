import { request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';

import { serveBridge } from './node';

describe('the Node server', () => {
    it('serves the handler over HTTP on a free port', async () => {
        const running = await serveBridge({ port: 0, basePath: '/bridge' });

        try {
            const response = await fetch(`${ running.url }/bridge/mcp`, {
                method:  'POST',
                headers: { 'content-type': 'application/json', 'x-list': 'a' },
                body:    JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' })
            });

            const help = await fetch(`${ running.url }/bridge/`);

            expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
            expect(response.headers.get('access-control-allow-origin')).toBe('*');
            expect(await help.text()).toContain('/bridge/mcp');
        } finally {
            await running.close();
        }
    });

    it('answers 500 when a request cannot be handled', async () => {
        const running = await serveBridge({ port: 0 });

        try {
            // fetch's Request refuses the TRACE method, so turning this one into a Request fails.
            const status = await new Promise<number | undefined>((resolve, reject) => {
                const outgoing = httpRequest(`${ running.url }/mcp`, { method: 'TRACE' }, response => {
                    response.resume();
                    resolve(response.statusCode);
                });

                outgoing.on('error', reject);
                outgoing.end();
            });

            expect(status).toBe(500);
        } finally {
            await running.close();
        }
    });

    it('passes repeated headers on', async () => {
        const running = await serveBridge({ port: 0 });

        try {
            const status = await new Promise<number | undefined>((resolve, reject) => {
                const outgoing = httpRequest(`${ running.url }/`, { method: 'GET', headers: { 'set-cookie': [ 'a=1', 'b=2' ] } }, response => {
                    response.resume();
                    resolve(response.statusCode);
                });

                outgoing.on('error', reject);
                outgoing.end();
            });

            expect(status).toBe(200);
        } finally {
            await running.close();
        }
    });

    it('copes with an HTTP/1.0 request that has no Host header', async () => {
        const running = await serveBridge({ port: 0 });

        try {
            const reply = await new Promise<string>((resolve, reject) => {
                const socket = createConnection({ port: Number(new URL(running.url).port), host: '127.0.0.1' }, () => {
                    socket.write('GET / HTTP/1.0\r\n\r\n');
                });

                let received = '';

                socket.on('data', chunk => {
                    received += chunk.toString();
                });

                socket.on('end', () => {
                    resolve(received);
                });

                socket.on('error', reject);
            });

            expect(reply).toContain('http://127.0.0.1:');
        } finally {
            await running.close();
        }
    });

    it('reports an error closing a server that is already closed', async () => {
        const running = await serveBridge({ port: 0 });

        await running.close();
        await expect(running.close()).rejects.toThrow(/not running/);
    });

    it('fails to start on a port already in use', async () => {
        const running = await serveBridge({ port: 0 });
        const port = Number(new URL(running.url).port);

        try {
            await expect(serveBridge({ port })).rejects.toThrow(/EADDRINUSE/);
        } finally {
            await running.close();
        }
    });
});

// The server in Node: wraps the standard request handler in node:http.
//
//   import { serveBridge } from 'chatgpt-webmcp-bridge/node';
//   const server = await serveBridge({ port: 8787 });
//
// ChatGPT has to reach it over public https, so put a tunnel in front of it
// (ChatGPT's own Tunnel option, cloudflared or ngrok).

import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { createServer } from 'node:http';

import type { BridgeServerOptions } from './server';

import { reportError } from './log';
import { createBridgeHandler } from './server';

export type ServeBridgeOptions = BridgeServerOptions & {
    readonly port ?: number,
    readonly hostname ?: string,
};

export type RunningBridge = {
    readonly server : Server,
    readonly url : string,
    readonly close : () => Promise<void>,
};

const readBody = async (request : IncomingMessage) : Promise<Buffer> => {
    const chunks : Array<Buffer> = [];

    for await (const chunk of request) {
        chunks.push(chunk as Buffer);
    }

    return Buffer.concat(chunks);
};

type ToRequestOptions = { readonly request : IncomingMessage, readonly origin : string };

const toRequest = async ({ request, origin } : ToRequestOptions) : Promise<Request> => {
    const headers = new Headers();

    for (const [ name, value ] of Object.entries(request.headers)) {
        if (typeof value === 'string') {
            headers.set(name, value);
        } else if (Array.isArray(value)) {
            headers.set(name, value.join(', '));
        }
    }

    const method = request.method ?? 'GET';

    const body = method === 'GET' || method === 'HEAD'
        ? undefined
        : await readBody(request);

    return new Request(new URL(request.url ?? '/', origin), {
        method,
        headers,
        ...body
            ? { body: new Uint8Array(body) }
            : {}
    });
};

type WriteResponseOptions = { readonly response : Response, readonly target : ServerResponse };

const writeResponse = async ({ response, target } : WriteResponseOptions) : Promise<void> => {
    target.writeHead(response.status, Object.fromEntries(response.headers));
    target.end(Buffer.from(await response.arrayBuffer()));
};

export const serveBridge = async ({ port = 8787, hostname = `127.0.0.1`, ...options } : ServeBridgeOptions = {}) : Promise<RunningBridge> => {
    const handle = createBridgeHandler(options);

    const server = createServer((request, target) => {
        const origin = `http://${ request.headers.host ?? `${ hostname }:${ String(port) }` }`;

        toRequest({ request, origin })
            .then(handle)
            .then(response => writeResponse({ response, target }))
            .catch((err : unknown) => {
                reportError('a request failed')(err);
                target.writeHead(500, { 'content-type': 'text/plain' });
                target.end('Internal error\n');
            });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, hostname, resolve);
    });

    // A server listening on a port (not a pipe) always has an address object.
    const address = server.address();

    if (!address || typeof address === 'string') {
        throw new Error('The server is not listening on a port');
    }

    const { port: actualPort } = address;

    return {
        server,
        url: `http://${ hostname }:${ String(actualPort) }`,

        close: () => new Promise<void>((resolve, reject) => {
            server.close(err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        })
    };
};

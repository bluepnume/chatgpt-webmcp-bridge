// The panel's line to ChatGPT: MCP Apps JSON-RPC over postMessage with the
// window that hosts it. The panel starts the handshake (ui/initialize),
// ChatGPT answers with what it lets the panel do, and only then sends the
// tool call's input and result.

type HostCapabilities = {
    readonly updateModelContext ?: unknown,
    readonly experimental ?: Readonly<Record<string, unknown>>,
};

type HostMessage = { readonly method : string, readonly params ?: unknown };

type HostParams = Readonly<Record<string, unknown>>;

type HostListener = { readonly method : string, readonly listener : (params : HostParams) => void };

type AppInfo = { readonly name : string, readonly version : string };

export type Host = {
    readonly request : (message : HostMessage) => Promise<unknown>,
    readonly notify : (message : HostMessage) => void,
    readonly on : (options : HostListener) => void,
    readonly capabilities : () => HostCapabilities,
    // The handshake. Resolves with ChatGPT's host context (theme and so on).
    readonly initialize : (app : AppInfo) => Promise<HostParams>,
};

type InitializeResult = {
    readonly hostCapabilities ?: HostCapabilities,
    readonly hostContext ?: HostParams,
} | undefined;

type JsonRpcMessage = {
    readonly jsonrpc ?: string,
    readonly id ?: number | string,
    readonly method ?: string,
    readonly params ?: Readonly<Record<string, unknown>>,
    readonly result ?: unknown,
    readonly error ?: { readonly message ?: string },
};

type Waiter = {
    readonly resolve : (value : unknown) => void,
    readonly reject : (error : Error) => void,
};

const MCP_APPS_PROTOCOL_VERSION = '2026-01-26';

type CreateHostOptions = { readonly host ?: Window };

export const createHost = ({ host = window.parent } : CreateHostOptions = {}) : Host => {
    const waiting = new Map<number | string, Waiter>();
    const listeners = new Map<string, (params : Readonly<Record<string, unknown>>) => void>();
    let nextId = 1;
    let capabilities : HostCapabilities = {};

    const post = (message : Readonly<Record<string, unknown>>) : void => {
        host.postMessage(message, '*');
    };

    window.addEventListener('message', event => {
        if (event.source !== host) {
            return;
        }

        const message = event.data as JsonRpcMessage | null;

        if (message?.jsonrpc !== '2.0') {
            return;
        }

        // A response to one of ours.
        if (message.id !== undefined && message.method === undefined) {
            const waiter = waiting.get(message.id);

            if (waiter) {
                waiting.delete(message.id);

                if (message.error) {
                    waiter.reject(new Error(message.error.message ?? 'ChatGPT refused the request'));
                } else {
                    waiter.resolve(message.result);
                }
            }

            return;
        }

        if (message.method === 'ping' && message.id !== undefined) {
            post({ jsonrpc: '2.0', id: message.id, result: {} });

            return;
        }

        if (message.method) {
            listeners.get(message.method)?.(message.params ?? {});
        }
    });

    const request : Host['request'] = ({ method, params }) => new Promise((resolve, reject) => {
        const id = nextId;

        nextId += 1;
        waiting.set(id, { resolve, reject });
        post({ jsonrpc: '2.0', id, method, params });
    });

    const notify : Host['notify'] = ({ method, params }) => {
        post({ jsonrpc: '2.0', method, params });
    };

    const on : Host['on'] = ({ method, listener }) => {
        listeners.set(method, listener);
    };

    const initialize : Host['initialize'] = async ({ name, version }) => {
        const result = await request({
            method: 'ui/initialize',
            params: {
                protocolVersion: MCP_APPS_PROTOCOL_VERSION,
                appInfo:         { name, version },
                appCapabilities: { availableDisplayModes: [ 'inline' ] }
            }
        }) as InitializeResult;

        capabilities = result?.hostCapabilities ?? {};
        notify({ method: 'ui/notifications/initialized', params: {} });

        return result?.hostContext ?? {};
    };

    return { request, notify, on, capabilities: () => capabilities, initialize };
};

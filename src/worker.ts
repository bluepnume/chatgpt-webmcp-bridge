// The server as a Cloudflare Worker. Deploy with `npx wrangler deploy` (see
// wrangler.toml). Settings come from the Worker's environment variables:
//   BASE_PATH       where the server lives, e.g. "/chatgpt-webmcp-bridge"
//   DEMO_URL        the page the panel's Try button opens; "none" for no button
//   FRAME_DOMAINS   comma-separated origins the panel may frame
//   APPS_CHALLENGE_TOKEN   the Directory's domain-verification token, if submitting

import type { BridgeHandler, BridgeServerOptions } from './server';

import { createBridgeHandler } from './server';

export type WorkerEnv = {
    readonly BASE_PATH ?: string,
    readonly DEMO_URL ?: string,
    readonly FRAME_DOMAINS ?: string,
    readonly APPS_CHALLENGE_TOKEN ?: string,
};

export const optionsFromEnv = (env : WorkerEnv) : BridgeServerOptions => ({
    ...env.BASE_PATH === undefined
        ? {}
        : { basePath: env.BASE_PATH },
    ...env.DEMO_URL === undefined
        ? {}
        : {
            demoUrl: env.DEMO_URL === 'none'
                ? null
                : env.DEMO_URL
        },
    ...env.FRAME_DOMAINS === undefined
        ? {}
        : { frameDomains: env.FRAME_DOMAINS.split(`,`).map(domain => domain.trim()).filter(Boolean) },
    ...env.APPS_CHALLENGE_TOKEN === undefined
        ? {}
        : { challengeToken: env.APPS_CHALLENGE_TOKEN }
});

const handlers = new WeakMap<WorkerEnv, BridgeHandler>();

// eslint-disable-next-line import/no-default-export -- Workers read the module's default export
export default {
    fetch: (request : Request, env : WorkerEnv = {}) : Promise<Response> => {
        let handler = handlers.get(env);

        if (!handler) {
            handler = createBridgeHandler(optionsFromEnv(env));
            handlers.set(env, handler);
        }

        return handler(request);
    }
};

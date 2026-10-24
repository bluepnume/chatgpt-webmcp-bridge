import { strFromU8, unzipSync } from 'fflate';

import { createPluginZip, VERSION } from './index';
import { pluginNameFor } from './plugin-zip';

const ICON = new Uint8Array([ 137, 80, 78, 71 ]);

describe('the plugin ZIP', () => {
    it('names the plugin after the connection, as ChatGPT does', () => {
        expect(pluginNameFor('asdk_app_6adc523d10a0819185f42793a9efd073')).toBe('dev-6adc523d10a0819185f42793a9efd073');
        expect(() => pluginNameFor('plugin_asdk_app_1')).toThrow(/is not a ChatGPT app id/);
    });

    it('holds the manifest, the app link and the icons', () => {
        // eslint-disable-next-line n/no-sync -- reading back a few kilobytes
        const files = unzipSync(createPluginZip({ appId: 'asdk_app_abc123', icon: ICON }));
        const manifest = JSON.parse(strFromU8(files[`.codex-plugin/plugin.json`] ?? new Uint8Array())) as { readonly name : string, readonly version : string, readonly interface : { readonly defaultPrompt : ReadonlyArray<string>, readonly logo : string } };
        const app = JSON.parse(strFromU8(files['.app.json'] ?? new Uint8Array())) as unknown;

        expect(Object.keys(files).toSorted()).toEqual([ `.app.json`, `.codex-plugin/plugin.json`, `assets/icon.png`, `assets/logo.png` ]);
        expect(manifest.name).toBe('dev-abc123');
        expect(manifest.version).toBe(VERSION);
        expect(manifest.interface.defaultPrompt).toHaveLength(3);
        expect(manifest.interface.logo).toBe('./assets/logo.png');
        expect(app).toEqual({ apps: { 'dev-abc123': { id: 'asdk_app_abc123' } } });
        expect(files['assets/logo.png']).toEqual(ICON);
    });

    it('takes a different display name, developer and website', () => {
        // eslint-disable-next-line n/no-sync -- reading back a few kilobytes
        const files = unzipSync(createPluginZip({ appId: `asdk_app_1`, icon: ICON, displayName: `My bridge`, developerName: `Ada`, websiteUrl: `https://ada.example` }));
        const manifest = JSON.parse(strFromU8(files[`.codex-plugin/plugin.json`] ?? new Uint8Array())) as { readonly interface : Readonly<Record<string, unknown>> };

        expect(manifest.interface).toMatchObject({ displayName: `My bridge`, developerName: `Ada`, websiteURL: `https://ada.example` });
    });
});

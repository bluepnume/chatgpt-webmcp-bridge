import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { VERSION } from './index';
import { renderPanelHtml } from './panel-html';
import { PANEL_SCRIPT } from './panel-script.generated';

const root = path.resolve(import.meta.dirname, '..');

describe('the build', () => {
    it('keeps VERSION in step with package.json', async () => {
        const packageJson = JSON.parse(await readFile(path.join(root, `package.json`), `utf8`)) as { readonly version : string };

        expect(VERSION).toBe(packageJson.version);
    });

    it('bundles the panel with glottis, safe to place inside a script element', () => {
        expect(PANEL_SCRIPT.length).toBeGreaterThan(20_000);
        expect(PANEL_SCRIPT).not.toContain('</script');
        expect(PANEL_SCRIPT).toContain('ui/initialize');
    });

    it('renders a self-contained panel that loads nothing from elsewhere', () => {
        const html = renderPanelHtml({ demoUrl: 'https://demo.example/</script>' });

        expect(html).not.toMatch(/<script[^>]+src=/);
        expect(html).not.toMatch(/<link[^>]+href=/);
        // The settings cannot end their element early.
        expect(html).toContain(String.raw`\u003c/script>`);
    });
});

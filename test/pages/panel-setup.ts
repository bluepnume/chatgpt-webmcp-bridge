// Builds the panel's page the way the server does, minus the inline bundle:
// its styles, its body and its settings. ?demo=<url> sets the demo URL; ?demo=none
// removes the Try button. Runs before src/panel.ts (see panel.html).
import { CONFIG_ELEMENT_ID, PANEL_BODY, PANEL_STYLE } from '../../src';

const demo = new URLSearchParams(location.search).get('demo');

document.body.innerHTML = PANEL_BODY;

const style = document.createElement('style');

style.textContent = PANEL_STYLE;
document.head.append(style);

const config = document.createElement('script');

config.type = 'application/json';
config.id = CONFIG_ELEMENT_ID;

config.textContent = JSON.stringify({
    demoUrl: demo === 'none'
        ? null
        : demo
});

document.body.append(config);

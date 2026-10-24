// The panel's HTML. Its script (src/panel.ts with glottis, bundled by
// scripts/build-panel.ts into panel-script.generated.ts) is placed inline,
// so the panel loads nothing from anywhere else.

import { CONFIG_ELEMENT_ID } from './constants';

import { PANEL_SCRIPT } from './panel-script.generated';

export type PanelConfig = {
    // The page the "Try" button opens, or null for no button.
    readonly demoUrl : string | null,
};

export const PANEL_STYLE = `
    :root { --ink: #141a22; --muted: #6b7786; --line: #dfe4eb; --accent: #1f5fff; --paper: #fff; --chrome: #eef1f5; --field: #fff; --pill: #e7eeff; }
    :root[data-theme="dark"] { --ink: #e9eef4; --muted: #8b98a8; --line: #2a3542; --accent: #6f95ff; --paper: #121920; --chrome: #1b232d; --field: #0e141a; --pill: #1e2a40; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 13px/1.45 system-ui, -apple-system, sans-serif; color: var(--ink); background: var(--paper); }
    .window { overflow: hidden; }
    .tabbar { display: flex; align-items: center; gap: 6px; padding: 7px 10px 0; background: var(--chrome); }
    .dots { display: flex; gap: 6px; margin-right: 6px; }
    .dots span { width: 10px; height: 10px; border-radius: 50%; background: #ff5f57; }
    .dots span:nth-child(2) { background: #febc2e; }
    .dots span:nth-child(3) { background: #28c840; }
    .tab { max-width: 260px; padding: 6px 12px; border-radius: 8px 8px 0 0; background: var(--paper); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .toolbar { display: flex; align-items: center; gap: 4px; padding: 6px 8px; background: var(--paper); border-bottom: 1px solid var(--line); }
    .toolbar button.nav { width: 28px; height: 28px; border: 0; border-radius: 50%; background: transparent; color: var(--ink); font-size: 15px; cursor: pointer; }
    .toolbar button.nav:hover:not(:disabled) { background: var(--chrome); }
    .toolbar button.nav:disabled { color: var(--muted); opacity: .45; cursor: default; }
    form { flex: 1; display: flex; }
    #address { flex: 1; min-width: 0; height: 30px; padding: 0 14px; border: 1px solid transparent; border-radius: 15px; background: var(--chrome); color: var(--ink); font: inherit; outline: none; }
    #address:focus { border-color: var(--accent); background: var(--field); }
    .viewport { position: relative; height: 330px; background: var(--paper); }
    iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
    .start { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px; text-align: center; color: var(--muted); }
    .start h1 { margin: 0; font-size: 17px; color: var(--ink); }
    .start p { margin: 0; max-width: 440px; }
    .pill { border: 0; border-radius: 999px; padding: 7px 14px; background: var(--pill); color: var(--accent); font: inherit; font-weight: 600; cursor: pointer; }
    .pill:hover { filter: brightness(.97); }
    .statusbar { display: flex; gap: 10px; align-items: baseline; padding: 6px 12px; border-top: 1px solid var(--line); background: var(--chrome); color: var(--muted); font-size: 12px; }
    #tools { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #tools code { color: var(--ink); }
    #tools .via { margin-left: 6px; opacity: .8; }
    #status { white-space: nowrap; }
    .moved { padding: 9px 12px; color: var(--muted); font-size: 12px; background: var(--chrome); }
    [hidden] { display: none !important; }
`;

// The body every panel starts with. src/panel.ts finds its parts by id.
export const PANEL_BODY = `
    <div class="moved" id="moved" hidden>↓ This browser continues in the newest panel below</div>
    <div class="window" id="window">
      <div class="tabbar"><div class="dots"><span></span><span></span><span></span></div><div class="tab" id="tab">New tab</div></div>
      <div class="toolbar">
        <button class="nav" id="back" title="Back" disabled>←</button>
        <button class="nav" id="forward" title="Forward" disabled>→</button>
        <button class="nav" id="reload" title="Reload" disabled>↻</button>
        <form id="go"><input id="address" type="text" placeholder="Enter the URL of a page with tools" autocomplete="off" spellcheck="false"></form>
      </div>
      <div class="viewport">
        <iframe id="site" title="Page" allow="tools *" hidden></iframe>
        <div class="start" id="start">
          <h1>WebMCP bridge browser</h1>
          <p>Load a page that offers tools, served with glottis or registered with WebMCP. Its tools are handed to ChatGPT, which can then use them in this page.</p>
          <button class="pill" id="try" type="button" hidden></button>
        </div>
      </div>
      <div class="statusbar"><span id="tools">No page loaded</span><span id="status">Connecting…</span></div>
    </div>
`;

// JSON inside a script element: "<" is escaped so the data cannot end the element.
const scriptSafeJson = (value : unknown) : string => JSON.stringify(value).replaceAll('<', String.raw`\u003c`);

export const renderPanelHtml = ({ demoUrl } : PanelConfig) : string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ChatGPT WebMCP bridge</title>
<style>${ PANEL_STYLE }</style>
</head>
<body>
${ PANEL_BODY }
<script type="application/json" id="${ CONFIG_ELEMENT_ID }">${ scriptSafeJson({ demoUrl } satisfies PanelConfig) }</script>
<script>${ PANEL_SCRIPT }</script>
</body>
</html>
`;

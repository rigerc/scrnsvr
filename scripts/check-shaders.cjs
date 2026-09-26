// Real Chromium/WebGL checks. Run with `npm run check-shaders` on a desktop or Xvfb.
const path = require('node:path');
const { reexecUnderElectron, createHarness, bundleModule, waitForControls, finish } = require('./lib/electron-harness.cjs');

reexecUnderElectron();

const { app, BrowserWindow, ipcMain } = require('electron');
const browser = require('./lib/browser-checks.cjs');
const root = path.resolve(__dirname, '..');
const temporary = createHarness({ prefix: 'scrnsvr-check-' });
const { shaderRegistry } = bundleModule('src/renderer/shaders/index.ts', { outDir: temporary });
const { defaultConfig } = bundleModule('src/shared/config.ts', { outDir: temporary });

function loadTestRegistry(filter) {
  if (!filter) return shaderRegistry;
  const tested = Object.fromEntries(Object.entries(shaderRegistry).filter(([id]) => id.includes(filter)));
  if (!Object.keys(tested).length) throw Error(`No shaders matched SCRNSVR_SHADER_FILTER=${filter}`);
  return tested;
}

function loadBaseline() {
  const index = process.argv.indexOf('--baseline');
  return index < 0 ? null : require(path.resolve(process.argv[index + 1])).shaderRegistry;
}

function createCheckWindow() {
  const win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { preload: path.join(root, 'dist/preload/index.js'), contextIsolation: true, sandbox: true } });
  win.webContents.on('render-process-gone', (_event, details) => { console.error(details); app.exit(1); });
  return win;
}

/** Compile and render every shader in each available WebGL context. */
async function runContextChecks(win, registry, baseline) {
  if (process.argv.includes('--ui-only')) return;
  for (const context of ['webgl', 'webgl2']) {
    const result = await win.webContents.executeJavaScript(`(() => { ${browser.browserPrelude()}
      try { return renderChecks(${JSON.stringify(registry)}, ${JSON.stringify(baseline)}, ${JSON.stringify(context)}); } catch (error) { return { error: error.stack }; } })()`);
    if (result.error) throw Error(result.error);
    console.log(JSON.stringify(result));
  }
}

/** Exercise the mounted settings UI and assert persisted state through real preload IPC. */
async function runUiChecks(win) {
  await waitForControls(win, { root });
  const ui = await win.webContents.executeJavaScript(`(async () => { ${browser.browserPrelude()}
    return await uiChecks(${JSON.stringify(shaderRegistry)}); })().catch(error => ({ error: error.stack }))`);
  if (ui.error) throw Error(ui.error);
  console.log(ui);
}

function registerSettingsIpc() {
  let saved = structuredClone(defaultConfig);
  ipcMain.handle('config:get', () => saved);
  ipcMain.handle('config:set', (_event, value) => { saved = value; });
  ipcMain.handle('colors:import-noctalia', () => ({ ok: true, palette: { mPrimary: '#ebbcba', mSecondary: '#9ccfd8', mTertiary: '#31748f', mSurface: '#191724', mOnSurface: '#e0def4' } }));
}

async function assertSettingsRestore(win) {
  await waitForControls(win, { root });
  const restored = await win.webContents.executeJavaScript('document.querySelector(".shader-select[data-id=plasma]").getAttribute("aria-pressed") === "true" && document.querySelector("[data-name=speed]").value === "0.5"');
  if (!restored) throw Error('Settings did not restore after reload');
}

app.whenReady().then(async () => {
  const filter = process.env.SCRNSVR_SHADER_FILTER;
  const registry = loadTestRegistry(filter);
  const baseline = loadBaseline();
  const win = createCheckWindow();
  await win.loadURL('data:text/html,<html><body></body></html>');
  await runContextChecks(win, registry, baseline);
  if (filter) { finish(app, { win, temporary }); return; }
  registerSettingsIpc();
  await runUiChecks(win, registry);
  await assertSettingsRestore(win);
  console.log('Shader checks passed');
  finish(app, { win, temporary });
}).catch(error => { console.error(error); app.exit(1); });

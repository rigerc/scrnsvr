// Real settings + preload + OGL integration. Run after build, on a desktop or Xvfb.
const fs = require('node:fs');
const path = require('node:path');
const { reexecUnderElectron, createHarness, bundleModule, waitForControls, finish } = require('./lib/electron-harness.cjs');
reexecUnderElectron();
const { app, BrowserWindow, ipcMain } = require('electron');
const root = path.resolve(__dirname, '..');
const temporary = createHarness({ prefix: 'scrnsvr-effects-settings-' });
const { ConfigSchema } = bundleModule('src/shared/config.ts', { outDir: temporary });
const { effectManifests } = bundleModule('src/shared/effects.ts', { outDir: temporary });
let saved = ConfigSchema.parse({ shader: 'plasma', clock: { enabled: true, showSeconds: false }, shaders: { plasma: { speed: 0 } } });
let rejectNextSave = false;
ipcMain.handle('config:get', () => saved);
ipcMain.handle('config:set', (_event, candidate) => {
  if (rejectNextSave) { rejectNextSave = false; throw Error('Injected write failure'); }
  saved = ConfigSchema.parse(candidate);
});
ipcMain.handle('colors:import-noctalia', () => ({ ok: false, message: 'Not used by effect checks.' }));
const captureIndex = process.argv.indexOf('--captures');
const captures = captureIndex < 0 ? undefined : path.resolve(process.argv[captureIndex + 1]);

async function browserChecks(win) {
  return win.webContents.executeJavaScript(`(${async function checks() {
    const assert = (value, message) => { if (!value) throw Error(message); };
    const canvas = document.querySelector('.preview');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const renderer = gl.renderer;
    const nativeRender = renderer.render;
    const difference = (a, b) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0);
    const frame = change => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { renderer.render = nativeRender; reject(Error('Effect edit did not redraw the main preview')); }, 5000);
      renderer.render = function(options) {
        const result = nativeRender.call(this, options);
        if (gl.getParameter(gl.FRAMEBUFFER_BINDING) === null) {
          const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
          gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          assert(gl.getError() === gl.NO_ERROR, 'GL error in settings effect frame');
          renderer.render = nativeRender; clearTimeout(timeout); resolve(pixels);
        }
        return result;
      };
      change();
    });
    const toggle = (selector, checked) => {
      const input = document.querySelector(selector); input.checked = checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const rows = () => [...document.querySelectorAll('[data-effect-layer]')];
    const edit = (row, name, value) => {
      const input = row.querySelector('[data-effect-name="' + name + '"]');
      input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const pause = document.querySelector('[data-preview-pause]');
    if (pause.getAttribute('aria-pressed') !== 'true') pause.click();
    const clean = await frame(() => toggle('[data-effects-enabled]', false));
    await frame(() => toggle('[data-effects-enabled]', true));
    document.querySelector('#effects-tab').click();
    const first = await frame(() => document.querySelector('[data-action="add-effect"]').click());
    assert(difference(clean, first) > 0, 'Adding VHS did not affect the main image');
    assert(rows().length === 1 && rows()[0].querySelector('details').open, 'Added layer should be expanded');
    const firstId = rows()[0].dataset.effectLayer;
    const second = await frame(() => document.querySelector('[data-action="add-effect"]').click());
    assert(rows().length === 2 && rows()[1].dataset.effectLayer !== firstId, 'Repeated layers need independent IDs');
    assert(difference(first, second) > 0, 'Second VHS pass did not change pixels');
    const edited = await frame(() => edit(rows()[0], 'colorBleed', 0.75));
    assert(difference(second, edited) > 0, 'Layer edit did not affect pixels');
    await frame(() => rows()[0].querySelector('[data-effect-action="down"]').click());
    assert(rows()[1].dataset.effectLayer === firstId, 'Order did not change');
    assert(document.activeElement === rows()[1].querySelector('summary'), 'Reorder lost focus');
    const bypass = await frame(() => toggle('[data-effects-enabled]', false));
    assert(difference(clean, bypass) === 0, 'Global bypass did not restore the unprocessed paused image');
    await frame(() => toggle('[data-effects-enabled]', true));
    await frame(() => toggle('[data-effect-layer="' + firstId + '"] [data-effect-layer-enabled]', false));
    const one = await frame(() => rows()[1].querySelector('[data-effect-action="remove"]').click());
    assert(difference(first, one) === 0, 'Removing the disabled second layer changed the first layer output');
    assert(gl.renderer === renderer, 'Effect edits replaced the renderer');
    assert(document.querySelector('[data-preview-effect-status]').hidden, 'Unexpected effect failure');
    assert(document.querySelector('.clock-overlay'), 'Clock overlay disappeared');
    const thumbnail = document.querySelector('.shader-select canvas');
    assert(thumbnail.getContext('2d'), 'Gallery thumbnail no longer uses the shared clean 2D path');
    window.captureEffectFrame = frame;
    window.effectUiSnapshot = { firstId: rows()[0].dataset.effectLayer };
    return { layers: rows().length, paused: true, clock: true, rendererReused: true, cleanBypass: true };
  }.toString()})()`);
}

async function catalogChecks(win) {
  const report = await win.webContents.executeJavaScript(`(${async function catalog(manifests) {
    const assert = (value, message) => { if (!value) throw Error(message); };
    const frame = window.captureEffectFrame;
    const choice = document.querySelector('[data-effect-choice]');
    assert(choice.options.length === 17, 'Expected the complete seventeen-effect selector');
    const add = async id => {
      choice.value = id;
      await frame(() => document.querySelector('[data-action="add-effect"]').click());
      return [...document.querySelectorAll('[data-effect-layer]')].at(-1);
    };
    const edit = async (row, name, value) => {
      const input = row.querySelector('[data-effect-name="' + name + '"]');
      await frame(() => {
        if (input.type === 'checkbox') input.checked = value;
        else input.value = String(value);
        input.dispatchEvent(new Event(input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      });
      return input;
    };
    for (const manifest of Object.values(manifests)) {
      const row = await add(manifest.id);
      assert(row.querySelectorAll('[data-effect-control]').length === manifest.uniforms.length, manifest.id + ': missing controls');
      for (const def of manifest.uniforms) {
        const input = row.querySelector('[data-effect-name="' + def.name + '"]');
        assert(input, manifest.id + ': missing ' + def.name);
        const kind = def.type === 'select' ? input.tagName === 'SELECT' :
          def.type === 'bool' ? input.type === 'checkbox' : def.type === 'color' ? input.type === 'color' : input.type === 'range';
        assert(kind, manifest.id + ': wrong control type for ' + def.name);
      }
      assert(document.querySelector('[data-preview-effect-status]').hidden, manifest.id + ': unexpected runtime failure');
      await frame(() => row.querySelector('[data-effect-action="remove"]').click());
    }
    // Exercise multipass + temporal + color composition through the actual mounted preview.
    await add('bloom');
    await add('datamosh-trails');
    await add('color-grade');
    const pause = document.querySelector('[data-preview-pause]');
    await frame(() => pause.click());
    for (let step = 0; step < 6; step++) await frame(() => {});
    await frame(() => pause.click());
    assert(pause.getAttribute('aria-pressed') === 'true', 'Mixed-stack playback did not pause');
    assert(document.querySelector('[data-preview-effect-status]').hidden, 'Mixed bloom/trails/color-grade stack failed');
    while (document.querySelectorAll('[data-effect-layer]').length > 1) {
      const row = document.querySelectorAll('[data-effect-layer]')[1];
      await frame(() => row.querySelector('[data-effect-action="remove"]').click());
    }
    const pixel = await add('pixelate');
    await edit(pixel, 'pixelSize', 26);
    const vignette = await add('vignette');
    await edit(vignette, 'edgeColor', '#ff8040');
    const dots = await add('halftone-print');
    await edit(dots, 'invert', true);
    const palette = await add('palette-mapping');
    await edit(palette, 'palette', 'Ocean');
    const trails = await add('datamosh-trails');
    await edit(trails, 'mode', 'Datamosh');
    assert(document.querySelectorAll('[data-effect-layer]').length === 6, 'Typed edits lost layer instances');
    assert(document.querySelector('[data-preview-effect-status]').hidden, 'Typed edits caused runtime failure');
    return { effects: Object.keys(manifests).length, numeric: true, color: true, boolean: true, select: true, mixedStack: true };
  }.toString()})(${JSON.stringify(effectManifests)})`);
  await waitSaved(win);
  const layer = id => saved.effects.layers.find(item => item.effectId === id);
  if (layer('pixelate')?.values.pixelSize !== 26 || layer('vignette')?.values.edgeColor !== '#ff8040' ||
      layer('halftone-print')?.values.invert !== true || layer('palette-mapping')?.values.palette !== 'Ocean' ||
      layer('datamosh-trails')?.values.mode !== 'Datamosh') throw Error('Typed effect edits did not persist through preload/config validation');
  await win.webContents.executeJavaScript(`(async () => {
    while (document.querySelectorAll('[data-effect-layer]').length > 1) {
      const row = document.querySelectorAll('[data-effect-layer]')[1];
      await window.captureEffectFrame(() => row.querySelector('[data-effect-action="remove"]').click());
    }
  })()`);
  await waitSaved(win);
  console.log(JSON.stringify(report));
}

async function waitSaved(win) {
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 5000;
    const check = () => {
      if (document.querySelector('[data-status]').dataset.state === 'saved') resolve();
      else if (performance.now() > deadline) reject(Error('Autosave did not complete'));
      else requestAnimationFrame(check);
    }; check();
  })`);
}

async function saveFailureChecks(win) {
  rejectNextSave = true;
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-effect-name="grain"]'); input.value = '0.61';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 5000;
    const check = () => {
      if (document.querySelector('[data-status]').dataset.state === 'error') resolve();
      else if (performance.now() > deadline) reject(Error('Missing save failure feedback'));
      else requestAnimationFrame(check);
    }; check();
  })`);
  await win.webContents.executeJavaScript(`document.querySelector('[data-action="retry-save"]').click()`);
  await waitSaved(win);
  if (saved.effects.layers[0].values.grain !== 0.61) throw Error('Retry did not save current effect edits');
}

async function screenshots(win) {
  if (!captures) return;
  fs.mkdirSync(captures, { recursive: true });
  const shot = async name => {
    // capturePage observes compositor output, not synchronous DOM mutations.
    await win.webContents.executeJavaScript(`new Promise(resolve => {
      let frames = 4; const next = () => --frames ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next);
    })`);
    fs.writeFileSync(path.join(captures, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  const showEffect = async id => {
    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('#effects-tab').click();
      for (const row of [...document.querySelectorAll('[data-effect-layer]')]) row.querySelector('[data-effect-action="remove"]').click();
      document.querySelector('[data-effect-choice]').value = ${JSON.stringify(id)};
      document.querySelector('[data-action="add-effect"]').click();
    })()`);
  };
  await showEffect('vignette');
  await shot('effects-desktop');
  await showEffect('halftone-print');
  await shot('effects-desktop-checkbox');
  await showEffect('palette-mapping');
  await shot('effects-desktop-select');
  win.setSize(390, 900);
  await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await win.webContents.executeJavaScript(`document.querySelector('.inspector').scrollIntoView({block: 'start', behavior: 'instant'})`);
  await shot('effects-narrow');
  await showEffect('vignette');
  await win.webContents.executeJavaScript(`document.querySelector('[data-effect-name="edgeColor"]').scrollIntoView({block: 'end', behavior: 'instant'})`);
  await shot('effects-narrow-color');
  win.setSize(1280, 900);
  await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await win.webContents.executeJavaScript(`document.querySelector('[data-preview-fullscreen]').click()`, true);
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const end = performance.now() + 3000;
    const check = () => document.fullscreenElement ? resolve() : performance.now() > end ? reject(Error('Fullscreen preview failed')) : requestAnimationFrame(check); check();
  })`);
  await shot('effects-fullscreen');
  await win.webContents.executeJavaScript(`document.exitFullscreen()`);
  console.log('Screenshots: ' + captures);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900,
    webPreferences: { preload: path.join(root, 'dist/preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.on('render-process-gone', (_event, details) => { console.error(details); app.exit(1); });
  await waitForControls(win, { root });
  console.log(JSON.stringify(await browserChecks(win)));
  await waitSaved(win);
  await catalogChecks(win);
  await saveFailureChecks(win);
  const expected = structuredClone(saved.effects);
  await waitForControls(win, { root });
  const restored = await win.webContents.executeJavaScript(`(() => {
    document.querySelector('#effects-tab').click();
    const row = document.querySelector('[data-effect-layer]'); row.querySelector('details').open = true;
    return { id: row.dataset.effectLayer, grain: Number(row.querySelector('[data-effect-name="grain"]').value),
      count: document.querySelectorAll('[data-effect-layer]').length };
  })()`);
  if (restored.id !== expected.layers[0].id || restored.grain !== 0.61 || restored.count !== 1) throw Error('Settings did not restore the effect stack');
  await screenshots(win);
  console.log('Effect settings: GPU edits, bypass, order, focus, clock/gallery exclusion, autosave failure/retry and reload passed');
  finish(app, { win, temporary });
}).catch(error => { console.error(error); app.exit(1); });

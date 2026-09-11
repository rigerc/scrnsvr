// Native Electron integration test, isolated from the user's saved config.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow, ipcMain } = require('electron');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'scrnsvr-custom-check-'));
process.env.XDG_CONFIG_HOME = temporary;
app.setPath('userData', path.join(temporary, 'electron'));
app.commandLine.appendSwitch('disable-vulkan');
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'swiftshader-webgl');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
if (process.env.DISPLAY) app.commandLine.appendSwitch('ozone-platform', 'x11');
const bundle = path.join(temporary, 'config.cjs');
buildSync({ entryPoints: [path.join(root, 'src/shared/config.ts')], outfile: bundle, bundle: true, platform: 'node' });
const { loadConfig, saveConfig, ConfigSchema } = require(bundle);
app.whenReady().then(async () => {
  ipcMain.handle('config:get', loadConfig);
  ipcMain.handle('config:set', (_, config) => saveConfig(ConfigSchema.parse(config)));
  const win = new BrowserWindow({ width: 1180, height: 820, show: false, webPreferences: { preload: path.join(root, 'dist/preload/index.js'), contextIsolation: true, nodeIntegration: false } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const run = fn => win.webContents.executeJavaScript(`(${fn.toString()})()`);
  const waitFor = async predicate => {
    for (let i = 0; i < 150; i++) {
      if (await run(predicate).catch(() => false)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error(`Timed out: ${predicate}`);
  };
  await win.loadFile(path.join(root, 'dist/settings/index.html'));
  await waitFor(() => !!document.querySelector('[data-action="add-shader"]'));
  await run(() => {
    document.querySelector('[data-action="add-shader"]').click();
    document.querySelector('[data-custom-source]').value = 'void main(){ invalid GLSL; }';
    document.querySelector('[data-custom-save]').click();
    if (!document.querySelector('[data-custom-status]').textContent.includes('ERROR')) throw Error('Missing compiler error');
  });
  if ((await loadConfig()).customShaders.length) throw Error('Invalid shader saved');
  await run(async () => {
    const input = document.querySelector('[data-custom-file]');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['void mainImage(out vec4 color, in vec2 p){color=vec4(p/iResolution.xy,0.5+0.5*sin(iTime),1.0);}'], 'My imported shader.glsl', { type: 'text/plain' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  });
  await waitFor(() => document.querySelector('[data-custom-title]').value === 'My imported shader');
  await run(() => {
    document.querySelector('[data-custom-test]').click();
    if (!document.querySelector('[data-custom-status]').textContent.includes('Compiled successfully')) throw Error('Preview failed');
  });
  await run(async () => {
    const canvas = document.querySelector('[data-custom-preview]');
    const sample = document.createElement('canvas');
    sample.width = 48; sample.height = 27;
    const ctx = sample.getContext('2d');
    for (let i = 0; i < 120; i++) {
      await new Promise(requestAnimationFrame);
      ctx.drawImage(canvas, 0, 0, 48, 27);
      const data = ctx.getImageData(0, 0, 48, 27).data;
      if (data.some((v, index) => index % 4 !== 3 && v > 30)) return;
    }
    throw Error('Blank custom preview');
  });
  await run(() => document.querySelector('[data-custom-save]').click());
  await waitFor(() => !!document.querySelector('[data-category="Custom"] .shader-card'));
  let saved = await loadConfig();
  if (saved.customShaders.length !== 1 || saved.shader !== saved.customShaders[0].id) throw Error('Save did not persist');
  const originalId = saved.customShaders[0].id;
  await run(() => {
    document.querySelector('[data-action="edit-source"]').click();
    document.querySelector('[data-custom-title]').value = 'Edited shader';
    document.querySelector('[data-custom-save]').click();
  });
  await waitFor(() => document.querySelector('#preview-title')?.textContent === 'Edited shader' && !document.querySelector('dialog'));
  saved = await loadConfig();
  if (saved.customShaders.length !== 1 || saved.customShaders[0].id !== originalId) throw Error('Edit changed identity');
  await run(() => {
    const toggle = document.querySelector('[data-audio-enabled]');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    if (document.querySelectorAll('[data-category="Reactive"] .shader-card').length !== 3) throw Error('Missing reactive gallery');
  });
  await new Promise(resolve => setTimeout(resolve, 700));
  if (!(await loadConfig()).audio.enabled) throw Error('Audio preference not saved');
  await win.loadFile(path.join(root, 'dist/settings/index.html'));
  await waitFor(() => document.querySelector('#preview-title')?.textContent === 'Edited shader');
  if (!await run(() => document.querySelector('[data-audio-enabled]').checked)) throw Error('Audio preference not restored');
  // The intentional compiler error above is handled before it reaches OGL.
  if (errors.length) throw Error(errors.join('\n'));
  console.log('Custom shader compile rejection, file import, rendered preview, disk save, stable edit identity, reload, reactive gallery and audio preference passed.');
  win.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
app.on('quit', () => fs.rmSync(temporary, { recursive: true, force: true }));

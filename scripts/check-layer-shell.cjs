// Real compositor smoke check. Briefly maps a screensaver on the primary output.
// --shm exercises the CPU fallback; --input tests native pointer dismissal on Hyprland.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { reexecUnderElectron, bundleModule } = require('./lib/electron-harness.cjs');
reexecUnderElectron();
const { app, BrowserWindow, ipcMain, screen } = require('electron');
if (process.argv.includes('--software')) require('./lib/electron-harness.cjs').applySoftwareGl(app.commandLine);
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'scrnsvr-layer-shell-'));
app.setPath('userData', temporary);
const timeout = setTimeout(() => { console.error('Layer-shell check timed out'); app.exit(1); }, 12000);
let windows = [];
let originalCursor;
let error;
function moveCursor(x, y) {
  execFileSync('hyprctl', ['dispatch', `hl.dsp.cursor.move({x=${x},y=${y}})`]);
}
app.on('window-all-closed', () => {});
app.on('quit', () => {
  if (originalCursor) {
    try { moveCursor(originalCursor.x, originalCursor.y); }
    catch (error) { console.error('Could not restore the cursor:', error.message); }
  }
  fs.rmSync(temporary, { recursive: true, force: true });
});
app.whenReady().then(async () => {
  const { createLayerShellWindows } = bundleModule('src/main/layer-shell.ts');
  const { defaultConfig } = bundleModule('src/shared/config.ts');
  const native = require('../dist/native/layer-shell.node');
  const statistics = { gpu: 0, shm: 0, released: 0, dismissed: 0 };
  const host = {
    ...native,
    // N-API descriptors are non-enumerable.
    outputs: native.outputs, open: native.open, close: native.close,
    create: listener => native.create(event => {
      if (event.type === 'release') statistics.released++;
      if (event.type === 'dismiss') statistics.dismissed++;
      if (process.argv.includes('--verbose')) console.log('Wayland:', event);
      listener(event);
    }),
    submit: (...args) => {
      const accepted = native.submit(...args);
      if (accepted) statistics[Buffer.isBuffer(args[4]) ? 'shm' : 'gpu']++;
      return accepted;
    },
  };
  ipcMain.handle('config:get', () => ({ ...defaultConfig, shader: 'plasma', global: { ...defaultConfig.global, fps: 30, fadeSeconds: 0.1 } }));
  ipcMain.on('window:close', event => BrowserWindow.fromWebContents(event.sender)?.close());
  windows = await createLayerShellWindows({
    host, primary: screen.getPrimaryDisplay(), fps: 30, sharedTextures: !process.argv.includes('--shm'),
    createWindow: (width, height, scale, sharedTextures) => new BrowserWindow({ width, height, show: false, frame: false, backgroundColor: '#000000',
      webPreferences: { preload: path.join(root, 'dist/preload/index.js'), sandbox: true, contextIsolation: true,
        backgroundThrottling: false, offscreen: { useSharedTexture: sharedTextures, deviceScaleFactor: scale } } }),
    loadWindow: window => window.loadFile(path.join(root, 'dist/renderer/index.html'), { query: { shader: 'plasma' } }),
    onRuntimeError: value => { error = value; },
  });
  assert.ok(windows.length > 0, 'Screensaver dismissed before the check could run');
  // Wait for compositor release and prove the rendered shader contains color.
  await new Promise(resolve => setTimeout(resolve, 300));
  const hasColor = await windows[0].webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => {
    const sample = document.createElement('canvas'); sample.width = 32; sample.height = 32;
    const context = sample.getContext('2d'); context.drawImage(document.querySelector('canvas'), 0, 0, 32, 32);
    resolve(context.getImageData(0, 0, 32, 32).data.some((value, index) => index % 4 !== 3 && value > 20));
  }))`);
  assert.ok(hasColor, 'Renderer produced a black image');
  if (process.argv.includes('--input')) {
    originalCursor = JSON.parse(execFileSync('hyprctl', ['-j', 'cursorpos'], { encoding: 'utf8' }));
    moveCursor(100, 100);
    await new Promise(resolve => setTimeout(resolve, 30));
    moveCursor(140, 140);
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(statistics.dismissed, 1, 'Native pointer input did not dismiss');
    assert.ok(windows.every(window => window.isDestroyed()), 'Dismiss did not close all surfaces');
  } else for (const window of windows) if (!window.isDestroyed()) window.close();
  assert.ok(statistics.gpu + statistics.shm > 1, 'No continuous frames were presented');
  assert.ok(statistics.released > 0, 'Compositor did not release frames');
  if (process.argv.includes('--shm')) assert.ok(statistics.shm > 0, 'SHM fallback was not exercised');
  if (error) throw error;
  console.log('Layer-shell rendering, frame release and shutdown passed:', statistics);
  clearTimeout(timeout);
  app.quit();
}).catch(value => { console.error(value); for (const window of windows) if (!window.isDestroyed()) window.destroy(); app.exit(1); });

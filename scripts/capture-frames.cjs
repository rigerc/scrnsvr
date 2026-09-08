// Headless shader frame capturer for README assets.
// Usage: npx electron scripts/capture-frames.cjs --shader plasma --out /tmp/frames-plasma --frames 60 --fps 12 --width 640 --height 360
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

const shader = arg('--shader', 'plasma');
const out = path.resolve(arg('--out', `/tmp/frames-${shader}`));
const frames = Number(arg('--frames', '60'));
const fps = Number(arg('--fps', '12'));
const width = Number(arg('--width', '640'));
const height = Number(arg('--height', '360'));

const { app, BrowserWindow, ipcMain } = require('electron');

app.commandLine.appendSwitch('disable-vulkan');
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'swiftshader-webgl');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
if (process.env.DISPLAY) app.commandLine.appendSwitch('ozone-platform', 'x11');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await mkdir(out, { recursive: true });
  // Renderer expects window.scrnsvr IPC; supply a minimal stub.
  ipcMain.handle('config:get', async () => ({
    shader, fps: 60, monitor: 'primary', kiosk: false, settings: false,
    global: { idleThresholdSeconds: 300, fps: 60, fadeSeconds: 0, monitors: 'primary' },
    clock: { enabled: false },
    shaders: {}, presets: {},
  }));
  ipcMain.handle('config:set', async () => undefined);
  ipcMain.on('window:close', () => {});
  const rendererHtml = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');
  const preload = path.join(__dirname, '..', 'dist', 'preload', 'index.js');
  const win = new BrowserWindow({
    show: false, width, height,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadFile(rendererHtml, { query: { shader, nofade: '1' } });
  await sleep(800); // let first frames settle
  const interval = Math.round(1000 / fps);
  for (let i = 0; i < frames; i += 1) {
    const png = (await win.webContents.capturePage()).toPNG();
    await writeFile(path.join(out, `frame-${String(i).padStart(3, '0')}.png`), png);
    await sleep(interval);
  }
  win.destroy();
  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });

import { EventEmitter } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { parseArgs, resolveMode } from './cli';
import { attachPowerResume, IdleDaemon, type RendererChild } from './daemon';
import { ConfigSchema, loadConfig, saveConfig, type Config } from '../shared/config';
import { IPC } from '../shared/ipc';
import { loadNoctaliaColors } from './noctalia';
import { shaderIds, shaderRegistry } from '../renderer/shaders';

const options = parseArgs(process.argv.slice(1));
if (options.thumbnail) {
  app.commandLine.appendSwitch('disable-vulkan');
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader-webgl');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  if (process.env.DISPLAY) app.commandLine.appendSwitch('ozone-platform', 'x11');
}
const rendererHtml = path.join(__dirname, '../renderer/index.html');
const settingsHtml = path.join(__dirname, '../settings/index.html');
const preload = path.join(__dirname, '../preload/index.js');

function webPreferences(): Electron.WebPreferences {
  return { preload, contextIsolation: true, nodeIntegration: false, sandbox: true };
}

async function createRendererWindow(config: Config, bounds: Electron.Rectangle, shaderId: string, preview: boolean): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    x: bounds.x, y: bounds.y,
    width: preview ? 960 : bounds.width,
    height: preview ? 540 : bounds.height,
    fullscreen: !preview,
    kiosk: !preview && config.kiosk,
    frame: preview,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: webPreferences(),
  });
  await window.loadFile(rendererHtml, { query: { shader: shaderId } });
  return window;
}

async function createRendererWindows(shaderOverride?: string, preview = false): Promise<BrowserWindow[]> {
  const config = await loadConfig();
  const shaderId = shaderOverride && shaderRegistry[shaderOverride] ? shaderOverride : config.shader;
  const displays = preview || config.global.monitors === 'primary' ? [screen.getPrimaryDisplay()] : screen.getAllDisplays();
  return Promise.all(displays.map((display) => createRendererWindow(config, display.bounds, shaderId, preview)));
}

async function createSettingsWindow(): Promise<BrowserWindow> {
  const workArea = screen.getPrimaryDisplay().workArea;
  const window = new BrowserWindow({
    width: Math.min(1180, workArea.width), height: Math.min(820, workArea.height),
    minWidth: 760, minHeight: 600, autoHideMenuBar: true,
    backgroundColor: '#080c14', webPreferences: webPreferences(),
  });
  await window.loadFile(settingsHtml);
  return window;
}

async function captureThumbnails(output: string, frames: number): Promise<void> {
  await mkdir(output, { recursive: true });
  for (const shaderId of shaderIds) {
    const window = new BrowserWindow({ show: false, width: 640, height: 360, webPreferences: webPreferences() });
    await window.loadFile(rendererHtml, { query: { shader: shaderId } });
    await new Promise((resolve) => setTimeout(resolve, Math.max(250, frames * 34)));
    let png = (await window.webContents.capturePage()).toPNG();
    if (png.byteLength < 2_048) {
      await window.reload();
      await new Promise((resolve) => setTimeout(resolve, Math.max(350, frames * 34)));
      png = (await window.webContents.capturePage()).toPNG();
    }
    await writeFile(path.join(output, `${shaderId}.png`), png);
    window.destroy();
  }
}

async function launchWindowGroup(): Promise<RendererChild> {
  const windows = await createRendererWindows();
  const emitter = new EventEmitter();
  let remaining = windows.length;
  for (const window of windows) window.once('closed', () => {
    remaining -= 1;
    if (remaining === 0) { emitter.emit('closed'); emitter.emit('exit'); }
  });
  return Object.assign(emitter, { kill: () => windows.forEach((window) => { if (!window.isDestroyed()) window.close(); }) });
}

function registerIpc(): void {
  ipcMain.handle(IPC.getConfig, () => loadConfig());
  ipcMain.handle(IPC.importNoctaliaColors, () => loadNoctaliaColors());
  ipcMain.handle(IPC.setConfig, (_event, candidate: unknown) => saveConfig(ConfigSchema.parse(candidate)));
  ipcMain.on(IPC.close, (event) => BrowserWindow.fromWebContents(event.sender)?.close());
}

app.whenReady().then(async () => {
  registerIpc();
  const mode = resolveMode(options);
  if (mode === 'thumbnail') {
    await captureThumbnails(path.resolve(options.output ?? 'assets/thumbnails'), options.frames);
    app.quit();
    return;
  }
  if (mode === 'daemon') {
    const config = await loadConfig();
    const daemon = new IdleDaemon({ thresholdSeconds: config.global.idleThresholdSeconds, launchRenderer: launchWindowGroup });
    attachPowerResume(daemon);
    daemon.start();
    app.once('before-quit', () => daemon.stop());
    return;
  }
  if (mode === 'screensaver') {
    await createRendererWindows(options.shader, options.preview);
    return;
  }
  await createSettingsWindow();
}).catch((error) => {
  console.error('scrnsvr failed to start', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (!options.daemon && !options.thumbnail) app.quit();
});

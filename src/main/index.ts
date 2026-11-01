import { EventEmitter } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { parseArgs, resolveMode } from './cli';
import { attachPowerResume, IdleDaemon, type RendererChild } from './daemon';
import { ConfigSchema, type Config } from '../shared/config';
import { loadConfig, saveConfig } from './config-store';
import { pickRotationEntry, rotationEntryKey } from '../shared/rotation';
import { shouldInhibitScreensaver } from './inhibit';
import { IPC } from '../shared/ipc';
import { loadNoctaliaColors } from './noctalia';
import { shaderIds, shaderRegistry } from '../renderer/shaders';
import { withCustomShaders } from '../shared/custom-shaders';
import { applySoftwareGl } from '../shared/gpu-flags';
import { PlaybackAudio } from './audio';
import { rendererQuery, rendererWindowOptions, resolveRendererTarget } from './windows';
import { createLayerShellWindows, useLayerShell } from './layer-shell';

const playbackAudio = new PlaybackAudio();
app.once('before-quit', () => playbackAudio.stop());

const options = parseArgs(process.argv.slice(1));
if (options.thumbnail) applySoftwareGl(app.commandLine);
const rendererHtml = path.join(__dirname, '../renderer/index.html');
const settingsHtml = path.join(__dirname, '../settings/index.html');
const preload = path.join(__dirname, '../preload/index.js');
let creatingRenderers = 0;
let layerShellFailed = false;

function webPreferences(): Electron.WebPreferences {
  return { preload, contextIsolation: true, nodeIntegration: false, sandbox: true };
}

async function createRendererWindow(config: Config, bounds: Electron.Rectangle, shaderId: string, preview: boolean, preset?: string): Promise<BrowserWindow> {
  const window = new BrowserWindow({ ...rendererWindowOptions(config, bounds, preview), webPreferences: webPreferences() });
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show(); });
  try { await window.loadFile(rendererHtml, { query: rendererQuery(shaderId, preset) }); }
  catch (error) { window.destroy(); throw error; }
  return window;
}

async function createRendererWindows(shaderOverride?: string, preview = false): Promise<BrowserWindow[]> {
  const config = await loadConfig();
  playbackAudio.setEnabled(config.audio.enabled);
  const available = withCustomShaders(shaderRegistry, config.customShaders);
  const { shaderId, preset } = resolveRendererTarget(config, shaderOverride, preview, available);
  let windows: BrowserWindow[];
  creatingRenderers += 1;
  try {
    const wantsLayerShell = useLayerShell(options.backend, preview) && (!layerShellFailed || options.backend === 'layer-shell');
    if (!preview && options.backend === 'layer-shell' && !wantsLayerShell) throw new Error('The layer-shell backend requires a Linux Wayland session');
    if (wantsLayerShell) {
      try {
        windows = await createLayerShellWindows({
          primary: config.global.monitors === 'primary' ? screen.getPrimaryDisplay() : undefined,
          fps: config.global.fps,
          createWindow: (width, height, scale, sharedTextures) => new BrowserWindow({
            width, height, show: false, frame: false, backgroundColor: '#000000',
            webPreferences: { ...webPreferences(), backgroundThrottling: false, offscreen: { useSharedTexture: sharedTextures, deviceScaleFactor: scale } },
          }),
          loadWindow: window => window.loadFile(rendererHtml, { query: rendererQuery(shaderId, preset) }),
          onRuntimeError: error => {
            layerShellFailed = true;
            console.error('scrnsvr layer-shell stopped; subsequent launches will use fullscreen windows', error);
          },
        });
        console.log('scrnsvr using wlr-layer-shell');
      } catch (error) {
        if (options.backend === 'layer-shell') throw error;
        layerShellFailed = true;
        console.warn('scrnsvr layer-shell unavailable; using fullscreen windows', error);
        windows = await createFullscreenWindows(config, shaderId, preview, preset);
      }
    } else windows = await createFullscreenWindows(config, shaderId, preview, preset);
  } finally { creatingRenderers -= 1; }
  // Dismissing one output closes the complete screensaver group.
  if (!preview) for (const window of windows) window.once('closed', () => {
    for (const other of windows) if (!other.isDestroyed()) other.close();
  });
  // Auto-cycle needs an anchor so --open (one-shot) can swap while it runs too.
  if (!preview && intervalEnabled(config) && windows.length > 0) startWindowGroupCycling(windows);
  return windows;
}

async function createFullscreenWindows(config: Config, shaderId: string, preview: boolean, preset?: string): Promise<BrowserWindow[]> {
  const windows: BrowserWindow[] = [];
  try {
    // Keep ownership of every window even when loading another output fails.
    for (const display of renderDisplays(config, preview)) {
      windows.push(await createRendererWindow(config, display.bounds, shaderId, preview, preset));
      if (windows.some(window => window.isDestroyed())) {
        for (const window of windows) if (!window.isDestroyed()) window.destroy();
        return [];
      }
    }
    return windows;
  } catch (error) {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}

/** Preview and single-monitor mode render on the primary display only. */
function renderDisplays(config: Config, preview: boolean): Electron.Display[] {
  return preview || config.global.monitors === 'primary' ? [screen.getPrimaryDisplay()] : screen.getAllDisplays();
}

/** Screensaver mode (`--open`) has no daemon group; cycle its windows directly. */
function intervalEnabled(config: Config): boolean {
  return config.rotation.enabled && config.rotation.intervalMinutes > 0;
}

function startWindowGroupCycling(windows: BrowserWindow[]): void {
  void loadConfig().then((config) => {
    const intervalMs = config.rotation.intervalMinutes * 60_000;
    if (!(intervalMs > 0)) return;
    let currentKey: string | undefined;
    const timer = setInterval(async () => {
      const latest = await loadConfig();
      const pick = pickRotationEntry(latest.rotation, latest.shaders, latest.presets, Object.keys(withCustomShaders(shaderRegistry, latest.customShaders)), Math.random, currentKey);
      if (!pick) return;
      currentKey = rotationEntryKey(pick.shaderId, pick.preset);
      for (const window of windows) {
        if (!window.isDestroyed()) window.webContents.send(IPC.cycle, { shader: pick.shaderId, preset: pick.preset });
      }
    }, intervalMs);
    timer.unref?.();
    for (const window of windows) {
      window.once('closed', () => {
        if (windows.every((w) => w.isDestroyed())) clearInterval(timer);
      });
    }
  });
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
    await window.loadFile(rendererHtml, { query: { shader: shaderId, nofade: '1' } });
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
  if (!windows.length) throw new Error('Screensaver closed during startup');
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
  ipcMain.handle(IPC.setConfig, async (_event, candidate: unknown) => {
    const config = ConfigSchema.parse(candidate);
    await saveConfig(config);
    playbackAudio.setEnabled(config.audio.enabled);
  });
  const subscriptions = new Map<number, () => void>();
  ipcMain.on(IPC.audioSubscribe, event => {
    const sender = event.sender;
    if (subscriptions.has(sender.id)) return;
    const unsubscribe = playbackAudio.subscribe(frame => { if (!sender.isDestroyed()) sender.send(IPC.audio, frame); });
    const cleanup = () => {
      unsubscribe();
      subscriptions.delete(sender.id);
      sender.removeListener('destroyed', cleanup);
      sender.removeListener('did-start-loading', cleanup);
    };
    subscriptions.set(sender.id, cleanup);
    sender.once('destroyed', cleanup);
    sender.once('did-start-loading', cleanup);
  });
  ipcMain.on(IPC.audioUnsubscribe, event => subscriptions.get(event.sender.id)?.());
  ipcMain.on(IPC.close, (event) => BrowserWindow.fromWebContents(event.sender)?.close());
}

async function startDaemon(): Promise<void> {
  const config = await loadConfig();
  const daemon = new IdleDaemon({
    thresholdSeconds: config.global.idleThresholdSeconds,
    launchRenderer: launchWindowGroup,
    inhibited: async () => {
      const latest = await loadConfig();
      const { inhibited, reasons } = await shouldInhibitScreensaver({
        inhibitOnAudio: latest.global.inhibitOnAudio,
        inhibitOnFullscreen: latest.global.inhibitOnFullscreen,
      });
      if (inhibited) console.log(`scrnsvr inhibited: ${reasons.join(', ')}`);
      return inhibited;
    },
  });
  attachPowerResume(daemon);
  daemon.start();
  app.once('before-quit', () => daemon.stop());
}

async function startThumbnail(): Promise<void> {
  await captureThumbnails(path.resolve(options.output ?? 'assets/thumbnails'), options.frames);
  app.quit();
}

async function start(): Promise<void> {
  registerIpc();
  playbackAudio.setEnabled((await loadConfig()).audio.enabled);
  const mode = resolveMode(options);
  if (mode === 'thumbnail') {
    await startThumbnail();
    return;
  }
  if (mode === 'daemon') {
    await startDaemon();
    return;
  }
  if (mode === 'screensaver') {
    const windows = await createRendererWindows(options.shader, options.preview);
    if (!windows.length) app.quit();
    return;
  }
  await createSettingsWindow();
}

app.whenReady().then(start).catch((error) => {
  console.error('scrnsvr failed to start', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (!creatingRenderers && !options.daemon && !options.thumbnail) app.quit();
});

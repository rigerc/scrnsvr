import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { parseArgs, resolveMode } from './cli';
import { attachPowerResume, IdleDaemon, type RendererChild } from './daemon';
import { ConfigSchema, type Config } from '../shared/config';
import { loadConfig, saveConfig } from './config-store';
import { shouldInhibitScreensaver } from './inhibit';
import { IPC } from '../shared/ipc';
import { loadNoctaliaColors } from './noctalia';
import { shaderIds, shaderRegistry } from '../renderer/shaders';
import { withCustomShaders } from '../shared/custom-shaders';
import { applySoftwareGl } from '../shared/gpu-flags';
import { PlaybackAudio } from './audio';
import { previewWindowOptions, rendererQuery, resolveRendererTarget } from './windows';
import { launchNativeScreensaver, nativeRendererPath, nativeUnavailableReason } from './native-renderer';
import { effectRegistry } from '../renderer/effects';

const playbackAudio = new PlaybackAudio();
app.once('before-quit', () => playbackAudio.stop());

const options = parseArgs(process.argv.slice(1));
if (options.thumbnail) applySoftwareGl(app.commandLine);
const rendererHtml = path.join(__dirname, '../renderer/index.html');
const settingsHtml = path.join(__dirname, '../settings/index.html');
const preload = path.join(__dirname, '../preload/index.js');
/** The service's RestartPreventExitStatus: restarting cannot fix an unsupported session. */
const UNSUPPORTED_EXIT = 2;

function webPreferences(): Electron.WebPreferences {
  return { preload, contextIsolation: true, nodeIntegration: false, sandbox: true };
}

/** The windowed `--preview` on the primary display; it shows the saved shader without rotation. */
async function createPreviewWindow(shaderOverride?: string): Promise<BrowserWindow> {
  const config = await loadConfig();
  playbackAudio.setEnabled(config.audio.enabled);
  const available = withCustomShaders(shaderRegistry, config.customShaders);
  const { shaderId, preset } = resolveRendererTarget(config, shaderOverride, true, available);
  const window = new BrowserWindow({ ...previewWindowOptions(screen.getPrimaryDisplay().bounds), webPreferences: webPreferences() });
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show(); });
  try { await window.loadFile(rendererHtml, { query: rendererQuery(shaderId, preset) }); }
  catch (error) { window.destroy(); throw error; }
  return window;
}

/** Start the screensaver in the native layer-shell renderer; there is no other backend. */
async function launchScreensaver(shaderOverride?: string): Promise<RendererChild> {
  const binary = nativeRendererPath();
  const unavailable = nativeUnavailableReason(binary);
  if (unavailable || !binary) throw new Error(unavailable);
  const config = await loadConfig();
  playbackAudio.setEnabled(config.audio.enabled);
  const registry = (latest: Config) => withCustomShaders(shaderRegistry, latest.customShaders);
  const target = resolveRendererTarget(config, shaderOverride, false, registry(config));
  const primary = screen.getPrimaryDisplay();
  return launchNativeScreensaver({
    binary, config, target, registry, effects: effectRegistry, loadConfig, audio: playbackAudio,
    output: { name: primary.label, x: primary.bounds.x, y: primary.bounds.y },
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
  // Without a usable renderer every idle launch would fail; stop once instead.
  const unavailable = nativeUnavailableReason(nativeRendererPath());
  if (unavailable) {
    console.error(`scrnsvr daemon cannot run: ${unavailable}`);
    app.exit(UNSUPPORTED_EXIT);
    return;
  }
  const config = await loadConfig();
  const daemon = new IdleDaemon({
    thresholdSeconds: config.global.idleThresholdSeconds,
    launchRenderer: () => launchScreensaver(),
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
  if (mode === 'screensaver' && options.preview) {
    await createPreviewWindow(options.shader);
    return;
  }
  if (mode === 'screensaver') {
    const saver = await launchScreensaver(options.shader);
    saver.once('closed', () => app.quit());
    return;
  }
  await createSettingsWindow();
}

app.whenReady().then(start).catch((error) => {
  console.error('scrnsvr failed to start', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (!options.daemon && !options.thumbnail) app.quit();
});

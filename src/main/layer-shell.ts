import path from 'node:path';
import type { BrowserWindow, Display, NativeImage, OffscreenSharedTexture, TextureInfo } from 'electron';
import { IPC } from '../shared/ipc';

export type WindowBackend = 'auto' | 'layer-shell' | 'fullscreen';
export interface LayerOutput { id: number; name: string; description: string; x: number; y: number; scale: number; }
export interface LayerEvent { type: string; output: number; token: number; width: number; height: number; scale: number; message: string; }
interface DmaBuffer { fd: number; stride: number; offset: number; format: number; modifierHi: number; modifierLo: number; }
export interface LayerHost {
  create(callback: (event: LayerEvent) => void): unknown;
  outputs(session: unknown): LayerOutput[];
  open(session: unknown, output: number): void;
  submit(session: unknown, output: number, token: number, size: { width: number; height: number }, frame: Buffer | DmaBuffer): boolean;
  finish(session: unknown, output: number, token: number): void;
  close(session: unknown): void;
}

export function useLayerShell(backend: WindowBackend, preview: boolean, platform = process.platform, env = process.env): boolean {
  return !preview && backend !== 'fullscreen' && platform === 'linux' && !!env.WAYLAND_DISPLAY;
}

/** Electron's label may be the connector name or the monitor's description. */
export function selectLayerOutputs(outputs: LayerOutput[], primary?: Pick<Display, 'label' | 'bounds'>): LayerOutput[] {
  if (!primary) return outputs;
  const selected = outputs.find(output => output.name === primary.label || output.description === primary.label)
    ?? outputs.find(output => output.x === primary.bounds.x && output.y === primary.bounds.y);
  if (!selected) throw new Error('Cannot identify the primary Wayland output');
  return [selected];
}

/** DRM fourcc describes byte order differently from Electron's format names. */
export function dmaBuffer(info: TextureInfo): DmaBuffer | undefined {
  const pixmap = info.handle.nativePixmap;
  if (!pixmap || pixmap.planes.length !== 1 || !['rgba', 'bgra'].includes(info.pixelFormat)) return;
  if (info.visibleRect.x !== 0 || info.visibleRect.y !== 0 || info.visibleRect.width !== info.codedSize.width || info.visibleRect.height !== info.codedSize.height) return;
  try {
    const modifier = BigInt(pixmap.modifier);
    if (modifier < 0n || modifier > 0xffffffffffffffffn) return;
    const plane = pixmap.planes[0];
    if (![plane.fd, plane.stride, plane.offset].every(value => Number.isSafeInteger(value) && value >= 0) || plane.stride < info.codedSize.width * 4) return;
    return { fd: plane.fd, stride: plane.stride, offset: plane.offset,
      format: info.pixelFormat === 'rgba' ? 0x34324241 : 0x34325241,
      modifierHi: Number(modifier >> 32n), modifierLo: Number(modifier & 0xffffffffn) };
  } catch { return; }
}

interface Renderer {
  window: BrowserWindow;
  width: number;
  height: number;
  scale: number;
  gpu: boolean;
  capturing: boolean;
  pending: Set<number>;
  lastCapture: number;
  finalToken?: number;
}
interface LayerShellOptions {
  primary?: Pick<Display, 'label' | 'bounds'>;
  fps: number;
  createWindow: (width: number, height: number, scale: number, sharedTextures: boolean) => BrowserWindow;
  loadWindow: (window: BrowserWindow) => Promise<void>;
  onRuntimeError: (error: Error) => void;
  host?: LayerHost;
  timeoutMs?: number;
  /** Force CPU readback for driver troubleshooting. */
  sharedTextures?: boolean;
}

class SharedTextureUnavailable extends Error {}

/** Retry with Electron's bitmap producer when the driver cannot export textures. */
export async function createLayerShellWindows(options: LayerShellOptions): Promise<BrowserWindow[]> {
  try { return await startLayerShellWindows(options); }
  catch (error) {
    if (!(error instanceof SharedTextureUnavailable) || options.sharedTextures === false) throw error;
    console.warn('scrnsvr GPU texture export unavailable; using layer-shell with bitmap frames');
    return startLayerShellWindows({ ...options, sharedTextures: false });
  }
}

/** Resolve only after every output has a frame; startup failures clean up atomically. */
async function startLayerShellWindows(options: LayerShellOptions): Promise<BrowserWindow[]> {
  const host: LayerHost = options.host ?? require(path.join(__dirname, '../native/layer-shell.node'));
  const renderers = new Map<number, Renderer>();
  const textures = new Map<number, OffscreenSharedTexture>();
  const presented = new Set<number>();
  const loaded = new Set<number>();
  const finished = new Set<number>();
  const windows: BrowserWindow[] = [];
  let session: unknown;
  let selected: LayerOutput[] = [];
  let token = 0;
  let closed = false;
  let ready = false;
  let dismissing = false;
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveReady!: (windows: BrowserWindow[]) => void;
  let rejectReady!: (error: Error) => void;
  const result = new Promise<BrowserWindow[]>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const started = Date.now();
  const timer = setTimeout(() => {
    const ErrorType = options.sharedTextures !== false && renderers.size ? SharedTextureUnavailable : Error;
    fail(new ErrorType('Layer-shell did not present a frame on every output in time'));
  }, options.timeoutMs ?? 8000);
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    clearTimeout(dismissTimer);
    if (session) host.close(session);
    for (const texture of textures.values()) texture.release();
    textures.clear();
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    if (!ready) resolveReady([]);
  };
  const fail = (error: Error) => {
    if (closed) return;
    const wasReady = ready;
    // Let the caller establish its fallback before window-all-closed can quit.
    if (wasReady) options.onRuntimeError(error);
    if (!wasReady) rejectReady(error);
    close();
  };
  const checkReady = () => {
    if (!closed && !ready && selected.length > 0 && selected.every(output => presented.has(output.id) && loaded.has(output.id))) {
      ready = true;
      clearTimeout(timer);
      resolveReady(windows);
    }
  };
  const nextToken = () => { token = token === 0xffffffff ? 1 : token + 1; return token; };
  const dismiss = () => {
    if (dismissing || closed) return;
    dismissing = true;
    // A failed renderer or missing final-frame callback must not retain input.
    dismissTimer = setTimeout(close, 6000);
    for (const window of windows) if (!window.isDestroyed()) window.webContents.send(IPC.dismiss);
  };
  const submit = (id: number, renderer: Renderer, size: { width: number; height: number }, frame: Buffer | DmaBuffer, texture?: OffscreenSharedTexture) => {
    const sequence = nextToken();
    if (!host.submit(session, id, sequence, size, frame)) return false;
    renderer.pending.add(sequence);
    if (texture) textures.set(sequence, texture);
    return true;
  };
  const submitImage = (id: number, renderer: Renderer, image: NativeImage) => {
    const scales = image.getScaleFactors();
    const scale = scales.includes(renderer.scale) ? renderer.scale : Math.max(1, ...scales);
    const size = image.getSize();
    return submit(id, renderer, { width: Math.round(size.width * scale), height: Math.round(size.height * scale) }, image.toBitmap({ scaleFactor: scale }));
  };
  const capture = async (id: number, renderer: Renderer) => {
    if (closed || renderer.finalToken !== undefined || !loaded.has(id) || renderer.capturing || renderer.pending.size >= 2 || Date.now() - renderer.lastCapture < 1000 / options.fps) return;
    renderer.capturing = true;
    renderer.lastCapture = Date.now();
    try {
      const image = await renderer.window.webContents.capturePage();
      if (!closed && renderer.finalToken === undefined && !renderer.window.isDestroyed()) submitImage(id, renderer, image);
    } catch (error) {
      // Chromium can reject readback while the first compositor frame is pending.
      // The startup deadline handles a renderer that never produces usable frames.
      if (renderer.finalToken !== undefined) return;
      if (!closed && ready) fail(error instanceof Error ? error : new Error(String(error)));
      else if (!closed && options.sharedTextures !== false && Date.now() - started > 250) fail(new SharedTextureUnavailable('GPU texture export and readback failed'));
    }
    finally { renderer.capturing = false; }
  };
  const onEvent = (event: LayerEvent) => {
    if (closed) return;
    try {
      const renderer = renderers.get(event.output);
      if (event.type === 'release') {
        renderer?.pending.delete(event.token);
        textures.get(event.token)?.release();
        textures.delete(event.token);
      } else if (event.type === 'presented') {
        presented.add(event.output);
        checkReady();
      } else if (event.type === 'gpu-failed') {
        if (renderer) { renderer.gpu = false; void capture(event.output, renderer); }
      } else if (event.type === 'finished') {
        if (renderer?.finalToken === undefined || renderer.finalToken !== event.token) return;
        finished.add(event.output);
        if (selected.every(output => finished.has(output.id))) close();
      } else if (event.type === 'dismiss') {
        dismiss();
      } else if (event.type === 'closed' || event.type === 'topology') {
        // Closing the group on hotplug avoids keeping stale output geometry.
        close();
      } else if (event.type === 'error') {
        fail(new Error(event.message));
      } else if (event.type === 'configure') {
        if (event.width <= 0 || event.height <= 0 || event.scale < 1) throw new Error('Invalid layer-shell output size');
        if (renderer) {
          renderer.width = event.width; renderer.height = event.height;
          renderer.window.setSize(event.width, event.height);
          return;
        }
        const window = options.createWindow(event.width, event.height, event.scale, options.sharedTextures !== false);
        windows.push(window);
        const state: Renderer = { window, width: event.width, height: event.height, scale: event.scale,
          gpu: options.sharedTextures !== false, capturing: false, pending: new Set(), lastCapture: 0 };
        renderers.set(event.output, state);
        window.webContents.setFrameRate(options.fps);
        window.on('close', closeEvent => {
          closeEvent.preventDefault();
          if (closed || state.finalToken !== undefined) return;
          dismiss();
          // Keep the renderer alive until every native surface has its black
          // buffer. Chromium's final paint can lag behind its close IPC.
          state.finalToken = nextToken();
          try { host.finish(session, event.output, state.finalToken); }
          catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
        });
        window.on('closed', () => {
          close();
        });
        window.webContents.on('render-process-gone', (_event, details) => fail(new Error(`Layer-shell renderer exited: ${details.reason}`)));
        window.webContents.on('paint', (paintEvent, _dirty, image) => {
          const texture = paintEvent.texture;
          if (closed || state.finalToken !== undefined || state.pending.size >= 2) { texture?.release(); return; }
          let retained = false;
          try {
            if (state.gpu && texture) {
              const frame = dmaBuffer(texture.textureInfo);
              if (frame) retained = submit(event.output, state, texture.textureInfo.codedSize, frame, texture);
              if (!retained) state.gpu = false;
            }
            if (!retained) {
              if (image && !image.isEmpty()) submitImage(event.output, state, image);
              else void capture(event.output, state);
            }
          } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
          finally { if (!retained) texture?.release(); }
        });
        void options.loadWindow(window).then(() => {
          if (closed) return;
          loaded.add(event.output);
          if (dismissing) window.webContents.send(IPC.dismiss);
          window.webContents.invalidate();
          checkReady();
        }).catch(error => fail(error instanceof Error ? error : new Error(String(error))));
      }
    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  };
  try {
    session = host.create(onEvent);
    selected = selectLayerOutputs(host.outputs(session), options.primary);
    if (!selected.length) throw new Error('No Wayland outputs are available');
    for (const output of selected) host.open(session, output.id);
  } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  return result;
}

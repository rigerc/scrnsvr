import { EventEmitter } from 'node:events';
import type { BrowserWindow, OffscreenSharedTexture, TextureInfo } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayerShellWindows, dmaBuffer, selectLayerOutputs, useLayerShell, type LayerEvent, type LayerHost } from '../src/main/layer-shell';
import { IPC } from '../src/shared/ipc';

const outputs = [
  { id: 1, name: 'DP-1', description: 'Monitor A', x: 0, y: 0, scale: 1 },
  { id: 2, name: 'DP-2', description: 'Monitor B', x: 1920, y: 0, scale: 2 },
];
function textureInfo(overrides: Partial<TextureInfo> = {}): TextureInfo {
  return {
    pixelFormat: 'bgra', codedSize: { width: 1920, height: 1080 },
    visibleRect: { x: 0, y: 0, width: 1920, height: 1080 },
    handle: { nativePixmap: { modifier: '72057594037927935', planes: [{ fd: 7, stride: 7680, offset: 0, size: 8294400 }], supportsZeroCopyWebGpuImport: true } },
    ...overrides,
  } as TextureInfo;
}
class FakeWindow extends EventEmitter {
  destroyed = false;
  webContents = Object.assign(new EventEmitter(), {
    setFrameRate: vi.fn(), send: vi.fn(), invalidate: vi.fn(),
    capturePage: vi.fn(async () => ({ getSize: () => ({ width: 1920, height: 1080 }), getScaleFactors: () => [1], toBitmap: () => Buffer.alloc(4) })),
  });
  setSize = vi.fn();
  isDestroyed() { return this.destroyed; }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
  paint() {
    const texture = { textureInfo: textureInfo(), release: vi.fn() } as OffscreenSharedTexture;
    this.webContents.emit('paint', { texture });
    return texture;
  }
}
function harness({ count = 1, loadWindow = async () => {}, sharedTextures = true } = {}) {
  let callback!: (event: LayerEvent) => void;
  const windows: FakeWindow[] = [];
  const host: LayerHost = {
    create: vi.fn(listener => { callback = listener; return {}; }),
    outputs: vi.fn(() => outputs.slice(0, count)),
    open: vi.fn(), close: vi.fn(), submit: vi.fn(() => true),
  };
  const runtimeError = vi.fn();
  const emit = (event: Partial<LayerEvent> & Pick<LayerEvent, 'type'>) => callback({ output: 1, token: 0, width: 1920, height: 1080, scale: 1, message: '', ...event });
  const promise = createLayerShellWindows({ host, fps: 60, sharedTextures, timeoutMs: 500,
    createWindow: () => { const window = new FakeWindow(); windows.push(window); return window as unknown as BrowserWindow; },
    loadWindow, onRuntimeError: runtimeError });
  const ready = async () => {
    for (let i = 1; i <= count; i++) emit({ type: 'configure', output: i });
    await Promise.resolve();
  };
  return { host, windows, promise, emit, ready, runtimeError };
}
afterEach(() => vi.useRealTimers());

describe('layer-shell selection and texture import', () => {
  it('uses layer-shell only for Linux Wayland screensavers', () => {
    expect(useLayerShell('auto', false, 'linux', { WAYLAND_DISPLAY: 'wayland-1' })).toBe(true);
    expect(useLayerShell('auto', false, 'linux', {})).toBe(false);
    expect(useLayerShell('fullscreen', false, 'linux', { WAYLAND_DISPLAY: 'wayland-1' })).toBe(false);
    expect(useLayerShell('layer-shell', true, 'linux', { WAYLAND_DISPLAY: 'wayland-1' })).toBe(false);
    expect(useLayerShell('auto', false, 'darwin', { WAYLAND_DISPLAY: 'wayland-1' })).toBe(false);
  });
  it('matches primary connector, description or layout, and refuses an unknown output', () => {
    expect(selectLayerOutputs(outputs)).toEqual(outputs);
    expect(selectLayerOutputs(outputs, { label: 'Monitor B', bounds: { x: 0, y: 0, width: 1, height: 1 } })).toEqual([outputs[1]]);
    expect(selectLayerOutputs(outputs, { label: 'unknown', bounds: { x: 1920, y: 0, width: 1, height: 1 } })).toEqual([outputs[1]]);
    expect(() => selectLayerOutputs(outputs, { label: '', bounds: { x: -100, y: 0, width: 1, height: 1 } })).toThrow('primary');
  });
  it('preserves modifier precision and maps the DRM byte order', () => {
    expect(dmaBuffer(textureInfo())).toMatchObject({ format: 0x34325241, modifierHi: 0x00ffffff, modifierLo: 0xffffffff, fd: 7 });
    expect(dmaBuffer(textureInfo({ pixelFormat: 'rgba' }))?.format).toBe(0x34324241);
    expect(dmaBuffer(textureInfo({ pixelFormat: 'rgbaf16' }))).toBeUndefined();
    expect(dmaBuffer(textureInfo({ handle: {} }))).toBeUndefined();
    expect(dmaBuffer(textureInfo({ visibleRect: { x: 1, y: 0, width: 1919, height: 1080 } }))).toBeUndefined();
    const invalid = textureInfo();
    invalid.handle.nativePixmap!.modifier = 'not a modifier';
    expect(dmaBuffer(invalid)).toBeUndefined();
  });
});

describe('layer-shell lifecycle', () => {
  it('waits for every output, bounds queued frames, and leases textures until release', async () => {
    const h = harness({ count: 2 });
    await h.ready();
    let resolved = false;
    void h.promise.then(() => { resolved = true; });
    const first = h.windows[0].paint();
    const second = h.windows[0].paint();
    const dropped = h.windows[0].paint();
    expect(dropped.release).toHaveBeenCalledOnce();
    expect(first.release).not.toHaveBeenCalled();
    expect(h.host.submit).toHaveBeenCalledTimes(2);
    h.emit({ type: 'presented' });
    await Promise.resolve();
    expect(resolved).toBe(false);
    h.emit({ type: 'presented', output: 2 });
    expect(await h.promise).toHaveLength(2);
    h.emit({ type: 'release', token: 1 });
    expect(first.release).toHaveBeenCalledOnce();
    h.windows[1].destroy();
    expect(h.windows.every(window => window.destroyed)).toBe(true);
    expect(second.release).toHaveBeenCalledOnce();
    expect(h.host.close).toHaveBeenCalledOnce();
  });
  it('destroys surfaces and releases queued textures on startup timeout', async () => {
    vi.useFakeTimers();
    const h = harness({ sharedTextures: false });
    const rejected = expect(h.promise).rejects.toThrow('in time');
    await h.ready();
    const texture = h.windows[0].paint();
    await vi.advanceTimersByTimeAsync(501);
    await rejected;
    expect(texture.release).toHaveBeenCalledOnce();
    expect(h.host.close).toHaveBeenCalledOnce();
    expect(h.windows[0].destroyed).toBe(true);
    expect(h.runtimeError).not.toHaveBeenCalled();
  });
  it('cleans up renderer load failures without resolving early on a presented frame', async () => {
    const h = harness({ loadWindow: async () => { throw new Error('load failed'); } });
    const rejected = expect(h.promise).rejects.toThrow('load failed');
    h.emit({ type: 'configure' });
    h.emit({ type: 'presented' });
    await rejected;
    expect(h.windows[0].destroyed).toBe(true);
    expect(h.host.close).toHaveBeenCalledOnce();
  });
  it('retries with the bitmap producer when shared-texture startup never supplies a frame', async () => {
    vi.useFakeTimers();
    const h = harness();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await h.ready();
    await vi.advanceTimersByTimeAsync(501);
    expect(h.host.create).toHaveBeenCalledTimes(2);
    expect(h.host.close).toHaveBeenCalledOnce();
    h.emit({ type: 'configure' });
    await Promise.resolve();
    h.emit({ type: 'presented' });
    expect(await h.promise).toHaveLength(1);
    expect(h.windows[0].destroyed).toBe(true);
    h.windows[1].destroy();
    warning.mockRestore();
  });
  it('uses physical pixels for bitmap frames on scaled outputs', async () => {
    const h = harness({ sharedTextures: false });
    h.emit({ type: 'configure', width: 960, height: 540, scale: 2 });
    await Promise.resolve();
    const toBitmap = vi.fn(() => Buffer.alloc(4));
    h.windows[0].webContents.emit('paint', {}, {}, {
      isEmpty: () => false, getScaleFactors: () => [2], getSize: () => ({ width: 960, height: 540 }), toBitmap,
    });
    expect(vi.mocked(h.host.submit).mock.calls[0][3]).toEqual({ width: 1920, height: 1080 });
    expect(toBitmap).toHaveBeenCalledWith({ scaleFactor: 2 });
    h.emit({ type: 'presented' }); await h.promise;
    h.windows[0].destroy();
  });
  it('dismisses every renderer and bounds shutdown even if renderers stop responding', async () => {
    vi.useFakeTimers();
    const h = harness({ count: 2 });
    await h.ready();
    h.emit({ type: 'presented', output: 1 }); h.emit({ type: 'presented', output: 2 });
    await h.promise;
    h.emit({ type: 'dismiss' }); h.emit({ type: 'dismiss' });
    for (const window of h.windows) expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(IPC.dismiss);
    await vi.advanceTimersByTimeAsync(6001);
    expect(h.windows.every(window => window.destroyed)).toBe(true);
  });
  it('closes cleanly on output hotplug and reports compositor loss after startup', async () => {
    const h = harness();
    await h.ready(); h.emit({ type: 'presented' }); await h.promise;
    h.emit({ type: 'error', message: 'connection lost' });
    expect(h.runtimeError).toHaveBeenCalledOnce();
    expect(h.host.close).toHaveBeenCalledOnce();
    const changing = harness();
    await changing.ready(); changing.emit({ type: 'topology' });
    expect(await changing.promise).toEqual([]);
    expect(changing.host.close).toHaveBeenCalledOnce();
  });
  it('falls back to paced CPU readback when DMA-BUF import is rejected', async () => {
    const h = harness();
    await h.ready();
    const texture = h.windows[0].paint();
    h.emit({ type: 'gpu-failed' }); h.emit({ type: 'release', token: 1 });
    await Promise.resolve(); await Promise.resolve();
    expect(texture.release).toHaveBeenCalledOnce();
    expect(h.windows[0].webContents.capturePage).toHaveBeenCalledOnce();
    expect(vi.mocked(h.host.submit).mock.calls[1][4]).toBeInstanceOf(Buffer);
    h.emit({ type: 'presented' }); await h.promise;
    h.windows[0].destroy();
  });
});

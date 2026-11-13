import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema, type Config } from '../src/shared/config';
import type { EffectDefinition } from '../src/shared/effects';
import type { ShaderManifest } from '../src/shared/manifest';
import { withCustomShaders } from '../src/shared/custom-shaders';
import { buildScenePlan, clockMessage, launchNativeScreensaver, nativeArguments, nativeRendererPath, NativeStartupError, useNativeRenderer, type NativeScreensaverOptions } from '../src/main/native-renderer';

const manifest: ShaderManifest = {
  id: 'waves', title: 'Waves', fragment: 'shader.glsl', uniforms: [
    { name: 'speed', type: 'float', default: 0.5, min: 0, max: 2 },
    { name: 'count', type: 'int', default: 3, min: 1, max: 9 },
    { name: 'mirror', type: 'bool', default: false },
    { name: 'palette', type: 'select', default: 'ice', options: ['neon', 'ice', 'custom'] },
    { name: 'color1', type: 'color', default: '#ff0000' },
  ],
};
const registry = {
  waves: { manifest, source: 'precision highp float;\nvoid mainImage(out vec4 c, in vec2 p){c=vec4(1.0);}', animationTime: 'integrated' as const },
  reactive: { manifest: { ...manifest, id: 'reactive', uniforms: [] }, source: 'uniform vec4 uAudio;\nvoid mainImage(out vec4 c, in vec2 p){c=uAudio;}' },
};
const effects: Record<string, EffectDefinition> = {
  glow: { id: 'glow', title: 'Glow', description: '', passes: ['pass-a', 'pass-b'], source: 'final', uniforms: [
    { name: 'intensity', type: 'float', default: 0.5, min: 0, max: 1 },
    { name: 'tint', type: 'color', default: '#000000' },
  ] },
  trails: { id: 'trails', title: 'Trails', description: '', history: true, source: 'trails', uniforms: [{ name: 'intensity', type: 'float', default: 0.5, min: 0, max: 1 }] },
};
const config = (value: Record<string, unknown> = {}) => ConfigSchema.parse({ shader: 'waves', clock: { enabled: false }, ...value });

describe('native renderer selection', () => {
  it('runs on Linux Wayland screensavers unless fullscreen windows are forced', () => {
    expect(useNativeRenderer('auto', false, 'linux', { WAYLAND_DISPLAY: 'wayland-1' })).toBe(true);
    expect(useNativeRenderer('auto', false, 'linux', {})).toBe(false);
    expect(useNativeRenderer('fullscreen', false, 'linux', { WAYLAND_DISPLAY: 'wayland-1' })).toBe(false);
    expect(useNativeRenderer('layer-shell', true, 'linux', { WAYLAND_DISPLAY: 'wayland-1' })).toBe(false);
    expect(useNativeRenderer('auto', false, 'darwin', { WAYLAND_DISPLAY: 'wayland-1' })).toBe(false);
  });
  it('finds the executable outside the ASAR archive in packaged builds', () => {
    expect(nativeRendererPath('/opt/Scrnsvr/resources/app.asar/dist/main', () => true)).toBe('/opt/Scrnsvr/resources/app.asar.unpacked/dist/native/scrnsvr-renderer');
    expect(nativeRendererPath('/repo/dist/main', () => true)).toBe('/repo/dist/native/scrnsvr-renderer');
    expect(nativeRendererPath('/repo/dist/main', () => false)).toBeUndefined();
  });
  it('passes timing and output selection as arguments', () => {
    expect(nativeArguments(config({ global: { fps: 30, fadeSeconds: 1.5 } }), { name: 'DP-1', x: 1920, y: 0 }))
      .toEqual(['--fps', '30', '--fade', '1.5', '--output', 'DP-1', '--output-at', '1920,0']);
    expect(nativeArguments(config({ global: { monitors: 'all' } }), { name: 'DP-1', x: 0, y: 0 })).toContain('--all-outputs');
  });
});

describe('scene plans', () => {
  it('converts every control type to the value the WebGL runtime uploads', () => {
    const plan = buildScenePlan(config({ shaders: { waves: { count: 4.6, mirror: true, palette: 'custom', color1: '#336699', speed: 9 } } }), { shaderId: 'waves' }, registry, effects);
    expect(plan.key).toBe('waves');
    // Out-of-range values are clamped exactly as the runtime's binding would.
    expect(plan.shader.uniforms).toEqual({ speed: 2, count: 5, mirror: 1, palette: 2, color1: [0x33 / 255, 0x66 / 255, 0x99 / 255] });
    expect(plan.shader.integrated).toBe(true);
    expect(plan.shader.audio).toBe(false);
    expect(plan.shader.source).toContain('#define SCRNSVR 1');
    expect(plan.shader.source).toContain('mainImage(color, gl_FragCoord.xy)');
  });
  it('uses a saved look, reports audio use, and wraps custom shaders', () => {
    const value = config({ presets: { waves: { Calm: { speed: 0.1 } } }, customShaders: [{ id: 'custom-red', title: 'Red', source: 'void mainImage(out vec4 c, in vec2 p){c=vec4(1.0,0.0,0.0,1.0);}' }] });
    expect(buildScenePlan(value, { shaderId: 'waves', preset: 'Calm' }, registry, effects)).toMatchObject({ key: 'waves/Calm', shader: { uniforms: { speed: 0.1 } } });
    expect(buildScenePlan(value, { shaderId: 'reactive' }, registry, effects).shader.audio).toBe(true);
    const custom = buildScenePlan(value, { shaderId: 'custom-red' }, withCustomShaders(registry, value.customShaders), effects);
    expect(custom.shader).toMatchObject({ integrated: false, audio: false });
    expect(custom.shader.source).toContain('uniform float uTime;');
    expect(() => buildScenePlan(value, { shaderId: 'missing' }, registry, effects)).toThrow('Unknown shader');
  });
  it('includes only active effect layers, with passes in order and resolved values', () => {
    const layers = [
      { id: 'a', effectId: 'glow', enabled: true, values: { tint: '#ff0000' } },
      { id: 'b', effectId: 'glow', enabled: false, values: {} },
      { id: 'c', effectId: 'trails', enabled: true, values: { intensity: 0 } },
      { id: 'd', effectId: 'unknown', enabled: true, values: {} },
      { id: 'e', effectId: 'trails', enabled: true, values: {} },
    ];
    const plan = buildScenePlan(config({ effects: { enabled: true, layers } }), { shaderId: 'waves' }, registry, effects);
    expect(plan.effects).toEqual([
      { id: 'a', passes: ['pass-a', 'pass-b', 'final'], history: false, uniforms: { intensity: 0.5, tint: [1, 0, 0] } },
      { id: 'e', passes: ['trails'], history: true, uniforms: { intensity: 0.5 } },
    ]);
    expect(buildScenePlan(config({ effects: { enabled: false, layers } }), { shaderId: 'waves' }, registry, effects).effects).toEqual([]);
  });
  it('formats clock text here and maps fonts to Pango families', () => {
    const value = config({ clock: { enabled: true, font: 'custom', customFont: 'Inter, Bold', color: '#80ff00', format: '24h', showDate: false } });
    const message = clockMessage(value.clock, new Date(2026, 10, 13, 9, 5));
    expect(message).toMatchObject({ type: 'clock', enabled: true, family: 'Inter  Bold, sans-serif', time: '09:05', period: '', date: '' });
    expect(message.color).toEqual([128 / 255, 1, 0]);
    expect(clockMessage({ ...value.clock, font: 'serif' }).family).toBe('Georgia, Liberation Serif, serif');
  });
});

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
  written: Record<string, unknown>[] = [];
  constructor() {
    super();
    this.stdin.setEncoding('utf8');
    let pending = '';
    this.stdin.on('data', (chunk: string) => {
      pending += chunk;
      for (let index; (index = pending.indexOf('\n')) >= 0; pending = pending.slice(index + 1)) this.written.push(JSON.parse(pending.slice(0, index)));
    });
  }
  ready() { this.stdout.write('{"type":"ready"}\n'); }
  messages(type: string) { return this.written.filter(message => message.type === type); }
}

function launch(overrides: Partial<NativeScreensaverOptions> = {}, value: Config = config()) {
  const child = new FakeChild();
  const unsubscribe = vi.fn();
  const audio = { subscribe: vi.fn((listener: (frame: { level: number; bass: number; mid: number; treble: number; status: string }) => void) => { listener({ level: 0.1, bass: 0.2, mid: 0.3, treble: 0.4, status: '' }); return unsubscribe; }) };
  const spawn = vi.fn(() => child);
  const log = vi.fn();
  const promise = launchNativeScreensaver({
    binary: '/bin/renderer', config: value, target: { shaderId: 'waves' }, registry: () => registry, effects,
    loadConfig: async () => value, audio, spawn: spawn as unknown as NativeScreensaverOptions['spawn'], log, timeoutMs: 1000, ...overrides,
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { child, promise, audio, unsubscribe, spawn, log, flush };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('native screensaver process', () => {
  it('sends the scene and clock, then resolves once every output shows a frame', async () => {
    const { child, promise, spawn, flush } = launch({ output: { name: 'DP-1', x: 0, y: 0 } });
    expect(spawn).toHaveBeenCalledWith('/bin/renderer', ['--fps', '60', '--fade', '1', '--output', 'DP-1', '--output-at', '0,0'], expect.anything());
    await flush();
    expect(child.messages('scene')).toHaveLength(1);
    expect(child.messages('clock')).toEqual([expect.objectContaining({ enabled: false })]);
    child.ready();
    const saver = await promise;
    saver.dismiss();
    await flush();
    expect(child.messages('dismiss')).toHaveLength(1);
    const closed = vi.fn(), exit = vi.fn();
    saver.once('closed', closed).once('exit', exit);
    child.emit('exit', 0);
    expect(closed).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });
  it('rejects with the renderer’s last error when it exits before presenting', async () => {
    const { child, promise } = launch();
    child.stderr.write('scrnsvr-renderer: Compositor does not provide wlr-layer-shell\n');
    await new Promise(resolve => setImmediate(resolve));
    child.emit('exit', 2);
    await expect(promise).rejects.toMatchObject({ code: 2, message: 'scrnsvr-renderer: Compositor does not provide wlr-layer-shell' });
    await expect(promise).rejects.toBeInstanceOf(NativeStartupError);
  });
  it('stops a renderer that never presents a frame', async () => {
    vi.useFakeTimers();
    const { child, promise } = launch();
    const rejected = expect(promise).rejects.toThrow('did not present a frame in time');
    await vi.advanceTimersByTimeAsync(1001);
    await rejected;
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
  it('streams audio only while a reactive scene is on screen', async () => {
    vi.useFakeTimers();
    const value = config({ rotation: { enabled: true, intervalMinutes: 1, entries: [{ shader: 'waves' }, { shader: 'reactive' }] } });
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { child, promise, audio, unsubscribe } = launch({}, value);
    child.ready();
    const saver = await promise;
    expect(audio.subscribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(child.messages('scene').map(message => message.key)).toEqual(['waves', 'reactive']);
    expect(audio.subscribe).toHaveBeenCalledOnce();
    expect(child.messages('audio')).toEqual([{ type: 'audio', value: [0.1, 0.2, 0.3, 0.4] }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(child.messages('scene').map(message => message.key)).toEqual(['waves', 'reactive', 'waves']);
    expect(unsubscribe).toHaveBeenCalledOnce();
    saver.kill();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
  it('keeps the clock text current and stops every update on exit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 13, 9, 5, 58, 500));
    const value = config({ clock: { enabled: true, showSeconds: true, format: '24h' } });
    const { child, promise } = launch({}, value);
    child.ready();
    await promise;
    await vi.advanceTimersByTimeAsync(1000);
    expect(child.messages('clock').map(message => message.time)).toEqual(['09:05:58', '09:05:59']);
    child.emit('exit', 0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.messages('clock')).toHaveLength(2);
  });
});

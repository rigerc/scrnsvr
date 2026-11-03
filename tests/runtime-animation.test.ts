// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountShader, type ShaderDefinition } from '../src/renderer/core/runtime';
import { Renderer, Program, Triangle } from 'ogl';

const state = vi.hoisted(() => ({
  uniforms: {} as Record<string, { value: unknown }>,
  tick: (_delta: number) => {},
  resize: () => {},
  linked: true,
}));
vi.mock('../src/renderer/core/loop', () => ({ startLoop: (tick: (delta: number) => void) => { state.tick = tick; return () => {}; } }));
vi.mock('ogl', () => ({
  Renderer: class {
    gl = { drawingBufferWidth: 100, drawingBufferHeight: 50, deleteShader: vi.fn(),
      LINK_STATUS: 1, getProgramParameter: () => state.linked, getProgramInfoLog: () => 'link failed' };
    state = { uniformLocations: new Map() };
    setSize() {}
    render() {}
  },
  Program: class {
    uniformLocations = new Map();
    constructor(_gl: unknown, options: { uniforms: typeof state.uniforms }) { state.uniforms = options.uniforms; }
    remove() {}
  },
  Triangle: class { remove() {} },
  Mesh: class {},
  Color: class {},
}));

afterEach(() => { state.linked = true; vi.unstubAllGlobals(); vi.restoreAllMocks(); delete window.scrnsvrAudio; });
function mount(integrated: boolean, playback?: { paused: boolean }) {
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('ResizeObserver', class {
    constructor(resize: () => void) { state.resize = resize; }
    observe() {}
    disconnect() {}
  });
  window.scrnsvrAudio = {
    subscribe: callback => {
      callback({ level: 1, bass: 1, mid: 1, treble: 1, status: 'Active' });
      return () => {};
    },
  };
  const definition: ShaderDefinition = {
    manifest: { id: 'test', title: 'Test', fragment: 'test.glsl', uniforms: [{ name: 'speed', type: 'float', default: 1, min: 0, max: 5 }] },
    source: 'uniform vec4 uAudio;',
    ...(integrated ? { animationTime: 'integrated' as const } : {}),
  };
  const values = { speed: 2 };
  const dispose = mountShader(document.createElement('canvas'), definition, values, 60, playback);
  return { values, dispose };
}

describe('runtime animation contract', () => {
  it('rejects and disposes an unlinked shader before attempting to draw it', () => {
    state.linked = false;
    const removeProgram = vi.spyOn(Program.prototype, 'remove');
    const render = vi.spyOn(Renderer.prototype, 'render');
    expect(() => mount(false)).toThrow('link failed');
    expect(render).not.toHaveBeenCalled();
    expect(removeProgram).toHaveBeenCalledOnce();
  });
  it('disposes a replacement scene when its first draw fails', () => {
    const removeProgram = vi.spyOn(Program.prototype, 'remove');
    const removeGeometry = vi.spyOn(Triangle.prototype, 'remove');
    vi.spyOn(Renderer.prototype, 'render').mockImplementationOnce(() => { throw new Error('first draw failed'); });
    expect(() => mount(false)).toThrow('first draw failed');
    expect(removeProgram).toHaveBeenCalledOnce();
    expect(removeGeometry).toHaveBeenCalledOnce();
  });
  it('pauses settings playback independently of speed and keeps edits live', () => {
    const playback = { paused: false };
    const { values, dispose } = mount(false, playback);
    state.tick(100);
    playback.paused = true;
    state.tick(100);
    state.tick(500);
    expect(state.uniforms.uTime.value).toBe(0.1);
    values.speed = 3;
    state.tick(100);
    expect(state.uniforms.speed.value).toBe(3);
    expect(state.uniforms.uTime.value).toBe(0.1);
    state.resize();
    expect(state.uniforms.uTime.value).toBe(0.1);
    playback.paused = false;
    state.tick(500);
    state.tick(100);
    expect(state.uniforms.uTime.value).toBe(0.2);
    dispose();
  });
  it('integrates built-in motion, holds on resize/pause, and smooths audio while paused', () => {
    const { values, dispose } = mount(true);
    const mountedDate = [...state.uniforms.uDate.value as number[]];
    state.tick(100);
    expect(state.uniforms.uTime.value).toBe(0.2);
    expect(state.uniforms.speed.value).toBe(1);
    values.speed = 0;
    state.resize();
    expect(state.uniforms.uTime.value).toBe(0.2);
    const beforeAudio = (state.uniforms.uAudio.value as number[])[0];
    state.tick(100);
    expect(state.uniforms.uTime.value).toBe(0.2);
    expect((state.uniforms.uAudio.value as number[])[0]).toBeGreaterThan(beforeAudio);
    expect(state.uniforms.uDate.value).toEqual(mountedDate);
    values.speed = 3;
    state.tick(100);
    expect(state.uniforms.uTime.value).toBe(0.5);
    dispose();
  });

  it('retains elapsed uTime and actual speed uniforms for custom shaders', () => {
    const { values, dispose } = mount(false);
    state.tick(100);
    expect(state.uniforms.uTime.value).toBe(0.1);
    expect(state.uniforms.speed.value).toBe(2);
    values.speed = 0;
    state.tick(100);
    expect(state.uniforms.uTime.value).toBe(0.2);
    expect(state.uniforms.speed.value).toBe(0);
    dispose();
  });
});

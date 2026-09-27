// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountShader, type ShaderDefinition } from '../src/renderer/core/runtime';

const state = vi.hoisted(() => ({
  uniforms: {} as Record<string, { value: unknown }>,
  tick: (_delta: number) => {},
  resize: () => {},
}));
vi.mock('../src/renderer/core/loop', () => ({ startLoop: (tick: (delta: number) => void) => { state.tick = tick; return () => {}; } }));
vi.mock('ogl', () => ({
  Renderer: class {
    gl = { drawingBufferWidth: 100, drawingBufferHeight: 50, deleteShader: vi.fn() };
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

afterEach(() => { vi.unstubAllGlobals(); delete window.scrnsvrAudio; });
function mount(integrated: boolean) {
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
  const dispose = mountShader(document.createElement('canvas'), definition, values);
  return { values, dispose };
}

describe('runtime animation contract', () => {
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

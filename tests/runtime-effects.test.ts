// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountShader, type ShaderDefinition } from '../src/renderer/core/runtime';
import type { EffectsConfig, EffectLayer } from '../src/shared/effects';

const state = vi.hoisted(() => ({
  tick: (_delta: number) => {}, resize: () => {},
  programs: [] as any[], draws: [] as any[], targets: [] as any[],
  shaderDeletes: vi.fn(), programDeletes: vi.fn(), textureDeletes: vi.fn(), framebufferDeletes: vi.fn(), geometryDeletes: vi.fn(),
  complete: true, renderer: undefined as any,
}));
vi.mock('../src/renderer/core/loop', () => ({ startLoop: (tick: typeof state.tick) => { state.tick = tick; return vi.fn(); } }));
vi.mock('../src/renderer/effects', () => ({ effectRegistry: {
  tape: { id: 'tape', title: 'Tape', source: 'tape', uniforms: [{ name: 'intensity', type: 'float', default: 0.5, min: 0, max: 1 }] },
  other: { id: 'other', title: 'Other', source: 'other', uniforms: [] },
  broken: { id: 'broken', title: 'Broken', source: 'broken', uniforms: [] },
  unlinked: { id: 'unlinked', title: 'Unlinked', source: 'unlinked', uniforms: [] },
} }));
vi.mock('ogl', () => {
  let id = 0;
  return {
    Renderer: class {
      width = 100; height = 50;
      state = { uniformLocations: new Map(), textureUnits: [] as number[], currentProgram: null as number | null };
      gl = { drawingBufferWidth: 100, drawingBufferHeight: 50, FRAMEBUFFER: 1, FRAMEBUFFER_COMPLETE: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, NO_ERROR: 0,
        getShaderParameter: (shader: any) => !shader.broken,
        getProgramParameter: (program: any) => !program.unlinked,
        getShaderInfoLog: () => 'compile error', getProgramInfoLog: () => 'link error',
        checkFramebufferStatus: () => state.complete ? 2 : 9, getError: () => 0,
        deleteShader: state.shaderDeletes, deleteTexture: state.textureDeletes, deleteFramebuffer: state.framebufferDeletes,
        framebufferTexture2D() {},
      };
      constructor() { state.renderer = this; }
      setSize(width: number, height: number) { this.width = width; this.height = height; }
      bindFramebuffer() {}
      render({ scene, target }: any) {
        this.state.currentProgram = scene.program.id;
        for (const location of scene.program.uniformLocations.values()) this.state.uniformLocations.set(location, 0);
        state.draws.push({ program: scene.program, target, time: scene.program.uniforms.uTime.value, intensity: scene.program.uniforms.intensity?.value });
      }
    },
    Program: class {
      id = ++id; uniformLocations = new Map([['location', {}]]);
      vertexShader = {}; fragmentShader: any; program: any; uniforms: any;
      constructor(_gl: any, { uniforms, fragment }: any) {
        this.uniforms = uniforms; this.fragmentShader = { broken: fragment === 'broken' }; this.program = { unlinked: fragment === 'unlinked' };
        state.programs.push(this);
      }
      remove() { state.programDeletes(this); }
    },
    RenderTarget: class {
      width: number; height: number; buffer = {}; texture: any; textures: any[] = []; sizes = vi.fn();
      constructor(_gl: any, options: any) { this.width = options.width; this.height = options.height; state.targets.push(this); }
      setSize(width: number, height: number) { this.width = width; this.height = height; this.sizes(width, height); }
    },
    Texture: class { id = ++id; texture = {}; state = {}; wrapR = 0; update() {} },
    Mesh: class { program: any; constructor(_gl: any, options: any) { this.program = options.program; } },
    Triangle: class { remove() { state.geometryDeletes(); } }, Color: class {},
  };
});

const definition: ShaderDefinition = { manifest: { id: 'base', title: 'Base', fragment: '', uniforms: [{ name: 'speed', type: 'float', default: 1 }] }, source: 'base', animationTime: 'integrated' };
const layer = (id: string, effectId = 'tape', intensity = 0.5): EffectLayer => ({ id, effectId, enabled: true, values: { intensity } });
function mount(effects: EffectsConfig, paused = false) {
  const playback = { paused };
  const values = { speed: 0 };
  const statuses = vi.fn();
  const stop = mountShader(document.createElement('canvas'), definition, values, 60, playback, { effects, onEffectStatus: statuses });
  return { playback, values, statuses, stop };
}
beforeEach(() => {
  state.programs = []; state.draws = []; state.targets = []; state.complete = true;
  vi.clearAllMocks();
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { state.resize = callback; } observe() {} disconnect() {} });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('runtime effect stack', () => {
  it.each([
    { enabled: true, layers: [] },
    { enabled: false, layers: [layer('a')] },
    { enabled: true, layers: [{ ...layer('a'), enabled: false }] },
    { enabled: true, layers: [layer('a', 'tape', 0)] },
  ])('renders directly with no target for a bypassed stack: %j', effects => {
    const { stop } = mount(effects);
    state.tick(100);
    expect(state.targets).toHaveLength(0);
    expect(state.programs).toHaveLength(1);
    expect(state.draws.every(draw => !draw.target)).toBe(true);
    stop();
  });

  it('orders repeated instances and keeps programs on edits/reorder/toggle, using at most two targets', () => {
    const effects = { enabled: true, layers: [layer('a'), layer('b'), layer('c')] };
    const { stop } = mount(effects);
    const [base, a, b, c] = state.programs;
    expect(state.targets).toHaveLength(2);
    expect(state.draws.map(draw => draw.program)).toEqual([base, a, b, c]);
    expect(state.draws.map(draw => draw.target)).toEqual([state.targets[0], state.targets[1], state.targets[0], undefined]);
    effects.layers.reverse(); effects.layers[1].values.intensity = 0.8;
    state.draws = []; state.tick(100);
    expect(state.draws.map(draw => draw.program)).toEqual([base, c, b, a]);
    expect(state.draws[2].intensity).toBe(0.8);
    expect(state.programs).toHaveLength(4);
    effects.layers[1].enabled = false; state.tick(100);
    expect(state.programDeletes).not.toHaveBeenCalled();
    effects.enabled = false; state.tick(100);
    expect(state.textureDeletes).toHaveBeenCalledTimes(2);
    effects.enabled = true; state.tick(100);
    expect(state.programs).toHaveLength(4);
    effects.layers = effects.layers.filter(item => item.id !== 'b'); state.tick(100);
    expect(state.programDeletes).toHaveBeenCalledWith(b);
    stop();
    expect(state.programDeletes).toHaveBeenCalledTimes(4);
    expect(state.shaderDeletes).toHaveBeenCalledTimes(8);
    expect(state.renderer.state.uniformLocations.size).toBe(0);
    expect(state.renderer.state.currentProgram).toBeNull();
  });

  it('advances effects at speed zero and redraws paused edits without advancing time or remounting base', () => {
    const effects = { enabled: true, layers: [layer('a')] };
    const { playback, stop } = mount(effects);
    state.tick(100);
    expect(state.draws.at(-1).time).toBe(0.1);
    expect(state.programs[0].uniforms.uTime.value).toBe(0);
    playback.paused = true; state.tick(100);
    const drawCount = state.draws.length;
    state.tick(100);
    expect(state.draws).toHaveLength(drawCount);
    effects.layers[0].values.intensity = 0.9; state.tick(100);
    expect(state.draws.at(-1).time).toBe(0.1);
    expect(state.draws.at(-1).intensity).toBe(0.9);
    effects.layers.push(layer('b')); state.tick(100);
    expect(state.draws.at(-1).time).toBe(0.1);
    state.resize();
    expect(state.draws.at(-1).time).toBe(0.1);
    playback.paused = false; state.tick(500); state.tick(100);
    expect(state.draws.at(-1).time).toBe(0.2);
    expect(state.programs).toHaveLength(3);
    stop();
  });

  it('skips broken/unlinked/unavailable layers, reports each only once, and preserves config', () => {
    const effects = { enabled: true, layers: [layer('a', 'broken'), layer('b', 'unlinked'), layer('c', 'missing'), layer('d')] };
    const before = JSON.stringify(effects);
    const { statuses, stop } = mount(effects);
    state.tick(100); state.tick(100);
    expect(statuses).toHaveBeenCalledTimes(3);
    expect(state.draws.at(-1).program).toBe(state.programs.at(-1));
    expect(JSON.stringify(effects)).toBe(before);
    expect(state.programDeletes).toHaveBeenCalledTimes(2);
    expect(state.targets).toHaveLength(1);
    stop();
  });

  it('bypasses failed framebuffers without blanking, retries after edits, and resizes only on dimensions changes', () => {
    state.complete = false;
    const effects = { enabled: true, layers: [layer('a')] };
    const { statuses, stop } = mount(effects);
    expect(state.draws.at(-1).program).toBe(state.programs[0]);
    expect(state.framebufferDeletes).toHaveBeenCalledTimes(1);
    state.tick(100); state.resize();
    expect(state.targets).toHaveLength(1);
    expect(statuses).toHaveBeenCalledTimes(1);
    state.complete = true; effects.layers[0].values.intensity = 0.7; state.tick(100);
    expect(statuses).toHaveBeenCalledTimes(2);
    expect(statuses).toHaveBeenLastCalledWith({ message: '' });
    const target = state.targets.at(-1);
    state.tick(100); state.resize();
    expect(target.sizes).not.toHaveBeenCalled();
    state.renderer.gl.drawingBufferWidth = 257; state.renderer.gl.drawingBufferHeight = 129;
    state.resize(); state.resize();
    expect(target.sizes).toHaveBeenCalledExactlyOnceWith(257, 129);
    // A fresh failure after recovery must report again, not remain suppressed.
    state.complete = false; state.renderer.gl.drawingBufferWidth = 258; state.resize();
    expect(statuses).toHaveBeenCalledTimes(3);
    expect(statuses.mock.lastCall?.[0].message).toContain('Effect stack bypassed');
    expect(state.draws.at(-1).program).toBe(state.programs[0]);
    // An intentional bypass also clears a failure that no longer applies.
    effects.enabled = false; state.tick(100);
    expect(statuses).toHaveBeenCalledTimes(4);
    expect(statuses).toHaveBeenLastCalledWith({ message: '' });
    stop();
  });

  it('replaces effect IDs in place and caps runtime layers even without normalization', () => {
    const effects = { enabled: true, layers: Array.from({ length: 10 }, (_, index) => layer(String(index))) };
    const { stop } = mount(effects);
    expect(state.programs).toHaveLength(9);
    effects.layers[0].effectId = 'other'; state.tick(100);
    expect(state.programDeletes).toHaveBeenCalledTimes(1);
    expect(state.programs).toHaveLength(10);
    stop();
  });
});

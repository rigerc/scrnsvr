// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../src/shared/config';

const state = vi.hoisted(() => ({
  mount: vi.fn(() => vi.fn()),
  clock: vi.fn(() => ({ destroy: vi.fn() })),
}));
vi.mock('../src/renderer/core/runtime', () => ({ mountShader: state.mount }));
vi.mock('../src/renderer/shaders', () => ({ shaderRegistry: {
  'flow-field': { manifest: { id: 'flow-field', title: 'Flow', fragment: 'flow', uniforms: [] }, source: '' },
  plasma: { manifest: { id: 'plasma', title: 'Plasma', fragment: 'plasma', uniforms: [] }, source: '' },
  'silk-ribbons': { manifest: { id: 'silk-ribbons', title: 'Silk', fragment: 'silk', uniforms: [] }, source: '' },
} }));
vi.mock('../src/renderer/core/clock', () => ({ mountClock: state.clock }));
let now: number, sequence: number, frames: Map<number, FrameRequestCallback>;
const advance = (milliseconds: number) => {
  now += milliseconds;
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach(callback => callback(now));
};
const opacity = () => Number(document.querySelector<HTMLElement>('.fade-overlay')!.style.opacity);
beforeEach(() => {
  now = 0; sequence = 0; frames = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  window.history.replaceState({}, '', '/');
});

describe('preview renderer and effects integration', () => {
  it('passes the global stack on launch, keeps the clock, and releases everything on pagehide', async () => {
    document.body.innerHTML = '<canvas></canvas>';
    const config = ConfigSchema.parse({
      shader: 'flow-field', clock: { enabled: true }, global: { fadeSeconds: 0 },
      effects: { layers: [{ id: 'tape', effectId: 'vhs-distortion', values: { intensity: 0.7 } }] },
    });
    const stop = vi.fn();
    state.mount.mockReturnValueOnce(stop);
    window.scrnsvr = { getConfig: vi.fn(async () => config), setConfig: vi.fn(), close: vi.fn(), importNoctaliaColors: vi.fn() };
    await import('../src/renderer/index');
    await vi.waitFor(() => expect(state.mount).toHaveBeenCalledOnce());
    const first = state.mount.mock.calls[0] as unknown as unknown[];
    expect((first[5] as { effects: unknown }).effects).toBe(config.effects);
    expect(state.clock).toHaveBeenCalledWith(document.body, config.clock);
    window.dispatchEvent(new Event('pagehide'));
    expect(stop).toHaveBeenCalledOnce();
  });
  it.each([false, true])('closes the window once after the fade on any input (nofade: %s)', async nofade => {
    document.body.innerHTML = '<canvas></canvas>';
    if (nofade) window.history.replaceState({}, '', '/?nofade=1');
    const config = ConfigSchema.parse({ shader: 'plasma', global: { fadeSeconds: 1 } });
    window.scrnsvr = { getConfig: vi.fn(async () => config), setConfig: vi.fn(), close: vi.fn(), importNoctaliaColors: vi.fn() };
    await import('../src/renderer/index');
    await vi.waitFor(() => expect(state.mount).toHaveBeenCalledOnce());
    expect((state.mount.mock.calls[0] as unknown as [unknown, { manifest: { id: string } }])[1].manifest.id).toBe('plasma');
    advance(1000);
    window.dispatchEvent(new KeyboardEvent('keydown'));
    window.dispatchEvent(new PointerEvent('pointerdown'));
    if (!nofade) {
      expect(window.scrnsvr.close).not.toHaveBeenCalled();
      advance(500);
      expect(opacity()).toBeCloseTo(0.5);
      advance(500);
    }
    expect(window.scrnsvr.close).toHaveBeenCalledOnce();
  });
});

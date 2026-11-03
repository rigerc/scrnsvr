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

describe('screensaver cycling and effects integration', () => {
  async function start(seconds = 1) {
    document.body.innerHTML = '<canvas></canvas>';
    const config = ConfigSchema.parse({ shader: 'flow-field', global: { fadeSeconds: seconds } });
    let cycle!: (pick: { shader: string }) => unknown;
    window.scrnsvr = {
      getConfig: vi.fn(async () => config), setConfig: vi.fn(), close: vi.fn(), importNoctaliaColors: vi.fn(),
      onCycle: listener => { cycle = listener; return vi.fn(); },
    };
    await import('../src/renderer/index');
    await vi.waitFor(() => expect(state.mount).toHaveBeenCalledOnce());
    advance(1000);
    return { cycle };
  }
  it.each([0, 1])('keeps the previous scene alive if a replacement fails, and allows retry (fade seconds: %s)', async seconds => {
    const outgoing = vi.fn();
    state.mount.mockReturnValueOnce(outgoing);
    const { cycle } = await start(seconds);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.mount.mockImplementationOnce(() => { throw new Error('mount failed'); });
    await cycle({ shader: 'plasma' });
    advance(500);
    expect(outgoing).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();
    advance(500);
    expect(opacity()).toBe(0);
    const incoming = vi.fn();
    state.mount.mockImplementationOnce(() => {
      expect(outgoing).not.toHaveBeenCalled();
      return incoming;
    });
    await cycle({ shader: 'plasma' });
    advance(500);
    expect(state.mount).toHaveBeenCalledTimes(3);
    expect(outgoing).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('pagehide'));
    expect(incoming).toHaveBeenCalledOnce();
  });
  it('mounts only the latest overlapping pick after a continuous fade-out', async () => {
    const { cycle } = await start();
    await cycle({ shader: 'plasma' });
    advance(400);
    await cycle({ shader: 'silk-ribbons' });
    advance(16);
    expect(opacity()).toBeCloseTo(0.832);
    advance(84);
    expect(state.mount).toHaveBeenCalledTimes(2);
    expect((state.mount.mock.calls[1] as unknown as [unknown, { manifest: { id: string } }])[1].manifest.id).toBe('silk-ribbons');
    advance(500);
    expect(opacity()).toBe(0);
  });
  it('cancels a pending replacement if the latest pick returns to the running scene', async () => {
    const { cycle } = await start();
    await cycle({ shader: 'plasma' });
    advance(250);
    await cycle({ shader: 'flow-field' });
    advance(250);
    advance(500);
    expect(state.mount).toHaveBeenCalledOnce();
    expect(opacity()).toBe(0);
  });
  it('ignores older cycle requests whose config reads complete after a newer request', async () => {
    const { cycle } = await start(0);
    let resolveConfig!: (value: unknown) => void;
    const getConfig = vi.mocked(window.scrnsvr.getConfig);
    const config = await getConfig();
    getConfig.mockImplementationOnce(() => new Promise(resolve => { resolveConfig = resolve as typeof resolveConfig; }));
    const older = cycle({ shader: 'plasma' });
    await cycle({ shader: 'silk-ribbons' });
    resolveConfig(config);
    await older;
    expect(state.mount).toHaveBeenCalledTimes(2);
    expect((state.mount.mock.calls[1] as unknown as [unknown, { manifest: { id: string } }])[1].manifest.id).toBe('silk-ribbons');
  });
  it.each([false, true])('ignores queued and subsequent cycle requests after dismissal (nofade: %s)', async nofade => {
    document.body.innerHTML = '<canvas></canvas>';
    if (nofade) window.history.replaceState({}, '', '/?nofade=1');
    const config = ConfigSchema.parse({ shader: 'flow-field', global: { fadeSeconds: 0 } });
    let cycle!: (pick: { shader: string }) => unknown;
    let dismiss!: () => void;
    const getConfig = vi.fn(async () => config);
    window.scrnsvr = {
      getConfig, setConfig: vi.fn(), close: vi.fn(), importNoctaliaColors: vi.fn(),
      onCycle: listener => { cycle = listener; return vi.fn(); },
      onDismiss: listener => { dismiss = listener; return vi.fn(); },
    };
    await import('../src/renderer/index');
    await vi.waitFor(() => expect(state.mount).toHaveBeenCalledOnce());
    let resolveConfig!: (value: typeof config) => void;
    getConfig.mockImplementationOnce(() => new Promise(resolve => { resolveConfig = resolve; }));
    const cycling = cycle({ shader: 'plasma' });
    dismiss();
    resolveConfig(config);
    await cycling;
    await cycle({ shader: 'plasma' });
    expect(getConfig).toHaveBeenCalledTimes(2);
    expect(state.mount).toHaveBeenCalledOnce();
    expect(window.scrnsvr.close).toHaveBeenCalledOnce();
  });
  it('passes the global stack on launch and refreshed stack on shuffle without altering the clock', async () => {
    document.body.innerHTML = '<canvas></canvas>';
    let config = ConfigSchema.parse({
      shader: 'flow-field', clock: { enabled: true }, global: { fadeSeconds: 0 },
      effects: { layers: [{ id: 'tape', effectId: 'vhs-distortion', values: { intensity: 0.7 } }] },
    });
    let cycle: ((pick: { shader: string; preset?: string }) => unknown) | undefined;
    const unsubscribe = vi.fn();
    window.scrnsvr = {
      getConfig: vi.fn(async () => config), setConfig: vi.fn(), close: vi.fn(), importNoctaliaColors: vi.fn(),
      onCycle: listener => { cycle = listener; return unsubscribe; },
    };
    await import('../src/renderer/index');
    await vi.waitFor(() => expect(state.mount).toHaveBeenCalledTimes(1));
    const first = state.mount.mock.calls[0] as unknown as unknown[];
    expect(first[5]).toMatchObject({ effects: config.effects });
    expect((first[5] as { effects: unknown }).effects).toBe(config.effects);
    expect(state.clock).toHaveBeenCalledWith(document.body, config.clock);

    config = ConfigSchema.parse({ ...config, effects: { enabled: false, layers: [{ id: 'new-tape', effectId: 'vhs-distortion', values: {} }] } });
    await cycle?.({ shader: 'plasma' });
    expect(state.mount).toHaveBeenCalledTimes(2);
    const second = state.mount.mock.calls[1] as unknown as unknown[];
    expect((second[5] as { effects: unknown }).effects).toBe(config.effects);
    expect(state.clock).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

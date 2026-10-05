// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../src/shared/config';

const state = vi.hoisted(() => ({
  mount: vi.fn(() => vi.fn()),
  clock: vi.fn(() => ({ destroy: vi.fn() })),
}));
vi.mock('../src/renderer/core/runtime', () => ({ mountShader: state.mount }));
vi.mock('../src/renderer/shaders', () => ({ shaderRegistry: {
  'flow-field': { manifest: { id: 'flow-field', title: 'Flow', fragment: 'flow', uniforms: [] }, source: '' },
  plasma: { manifest: { id: 'plasma', title: 'Plasma', fragment: 'plasma', uniforms: [] }, source: '' },
} }));
vi.mock('../src/renderer/core/clock', () => ({ mountClock: state.clock }));
vi.mock('../src/renderer/core/fade', () => ({ mountFadeOverlay: () => ({
  transition: (swap: () => void) => swap(), fadeOut: (close: () => void) => close(), destroy: vi.fn(),
}) }));

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.clearAllMocks();
  vi.resetModules();
});

describe('screensaver effects integration', () => {
  it('passes the global stack on launch and refreshed stack on shuffle without altering the clock', async () => {
    document.body.innerHTML = '<canvas></canvas>';
    let config = ConfigSchema.parse({
      shader: 'flow-field', clock: { enabled: true },
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

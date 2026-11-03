import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { rendererQuery, rendererWindowOptions, resolveRendererTarget, startWindowGroupCycling } from '../src/main/windows';
import type { Config } from '../src/shared/config';
import { IPC } from '../src/shared/ipc';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    shader: 'flow-field', kiosk: true,
    rotation: { enabled: true, entries: [{ shader: 'silk-ribbons' }], intervalMinutes: 10 },
    shaders: {}, presets: {},
    ...overrides,
  } as Config;
}

const available = { plasma: {}, 'silk-ribbons': {}, 'flow-field': {} };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('main window helpers', () => {
  it.each([undefined, 'Bright'])('excludes the initial shader and saved look from the first cycle (preset: %s)', async preset => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const config = makeConfig({
      rotation: { enabled: true, intervalMinutes: 1, entries: [{ shader: 'plasma', preset }, { shader: 'silk-ribbons' }] },
      presets: { plasma: { Bright: {} } },
    });
    const windows = [0, 1].map(() => Object.assign(new EventEmitter(), {
      destroyed: false, isDestroyed() { return this.destroyed; }, webContents: { send: vi.fn() },
    }));
    startWindowGroupCycling(windows as unknown as BrowserWindow[], {
      initial: { shaderId: 'plasma', preset }, config,
      loadConfig: async () => config, shaderIds: () => Object.keys(available),
    });
    await vi.advanceTimersByTimeAsync(60000);
    for (const window of windows) expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(IPC.cycle, { shader: 'silk-ribbons', preset: undefined });
    windows[0].destroyed = true; windows[0].emit('closed');
    expect(vi.getTimerCount()).toBe(1);
    windows[1].destroyed = true; windows[1].emit('closed');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('prefers an available --shader override', () => {
    expect(resolveRendererTarget(makeConfig(), 'plasma', false, available)).toEqual({ shaderId: 'plasma', preset: undefined });
  });

  it('falls back to a rotation pick when no override is given', () => {
    const target = resolveRendererTarget(makeConfig(), undefined, false, available);
    expect(target.shaderId).toBe('silk-ribbons');
  });

  it('keeps the saved shader for preview windows and disabled rotation', () => {
    expect(resolveRendererTarget(makeConfig(), undefined, true, available)).toEqual({ shaderId: 'flow-field', preset: undefined });
    const disabled = makeConfig({ rotation: { enabled: false, entries: [{ shader: 'silk-ribbons' }], intervalMinutes: 0 } });
    expect(resolveRendererTarget(disabled, undefined, false, available).shaderId).toBe('flow-field');
  });

  it('ignores an unavailable override and unusable rotation entries', () => {
    const missing = makeConfig({ rotation: { enabled: true, entries: [{ shader: 'ghost' }], intervalMinutes: 10 } });
    expect(resolveRendererTarget(missing, 'ghost', false, available).shaderId).toBe('flow-field');
  });

  it('builds preview and fullscreen window options', () => {
    const bounds = { x: 1, y: 2, width: 1920, height: 1080 };
    expect(rendererWindowOptions(makeConfig(), bounds, true)).toMatchObject({ width: 960, height: 540, fullscreen: false, kiosk: false, frame: true, x: 1, y: 2 });
    expect(rendererWindowOptions(makeConfig(), bounds, false)).toMatchObject({ width: 1920, height: 1080, fullscreen: true, kiosk: true, frame: false });
    expect(rendererWindowOptions(makeConfig({ kiosk: false }), bounds, false).kiosk).toBe(false);
  });

  it('builds the renderer query string', () => {
    expect(rendererQuery('plasma')).toEqual({ shader: 'plasma' });
    expect(rendererQuery('plasma', 'Bright')).toEqual({ shader: 'plasma', preset: 'Bright' });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewWindowOptions, rendererQuery, resolveRendererTarget } from '../src/main/windows';
import type { Config } from '../src/shared/config';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    shader: 'flow-field',
    rotation: { enabled: true, entries: [{ shader: 'silk-ribbons' }], intervalMinutes: 10 },
    shaders: {}, presets: {},
    ...overrides,
  } as Config;
}

const available = { plasma: {}, 'silk-ribbons': {}, 'flow-field': {} };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('main window helpers', () => {
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

  it('opens the preview as a window on the given display', () => {
    const options = previewWindowOptions({ x: 1, y: 2, width: 1920, height: 1080 });
    expect(options).toMatchObject({ width: 960, height: 540, x: 1, y: 2, show: false });
    expect(options).not.toHaveProperty('fullscreen');
    expect(options).not.toHaveProperty('kiosk');
  });

  it('builds the renderer query string', () => {
    expect(rendererQuery('plasma')).toEqual({ shader: 'plasma' });
    expect(rendererQuery('plasma', 'Bright')).toEqual({ shader: 'plasma', preset: 'Bright' });
  });
});

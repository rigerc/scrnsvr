import { describe, expect, it } from 'vitest';
import { rendererQuery, rendererWindowOptions, resolveRendererTarget } from '../src/main/windows';
import type { Config } from '../src/shared/config';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    shader: 'flow-field', kiosk: true,
    rotation: { enabled: true, entries: [{ shader: 'silk-ribbons' }], intervalMinutes: 10 },
    shaders: {}, presets: {},
    ...overrides,
  } as Config;
}

const available = { plasma: {}, 'silk-ribbons': {}, 'flow-field': {} };

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

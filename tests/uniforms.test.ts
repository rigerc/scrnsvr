import { describe, expect, it } from 'vitest';
import { bindUniforms, randomizeUniforms, snapUniformValue, uniformVisible } from '../src/renderer/core/uniforms';
import type { UniformManifest } from '../src/shared/manifest';

describe('bindUniforms', () => {
  it('uses defaults, clamps numbers, rounds integers, and validates selects', () => {
    const values = bindUniforms([
      { name: 'speed', type: 'float', default: 1, min: 0, max: 2 },
      { name: 'count', type: 'int', default: 3, min: 1, max: 8 },
      { name: 'palette', type: 'select', default: 'ice', options: ['ice', 'fire'] },
    ], { speed: 9, count: 4.7, palette: 'unknown' });
    expect(values).toEqual({ speed: 2, count: 5, palette: 'ice' });
  });

  it('falls back for malformed values without changing valid legacy precision', () => {
    const defs: UniformManifest[] = [
      { name: 'speed', type: 'float', default: 0.3, min: 0, max: 2, step: 0.05 },
      { name: 'enabled', type: 'bool', default: true },
      { name: 'color', type: 'color', default: '#123456' },
    ];
    for (const speed of [NaN, Infinity, -Infinity, '', ' ', 'bad', {}, true]) {
      expect(bindUniforms(defs, { speed, enabled: 'false', color: 'red' }))
        .toEqual({ speed: 0.3, enabled: true, color: '#123456' });
    }
    expect(bindUniforms(defs, { speed: 0.317, enabled: false, color: '#ABCDEF' }))
      .toEqual({ speed: 0.317, enabled: false, color: '#ABCDEF' });
  });

  it('snaps direct entry to the declared step relative to the minimum', () => {
    const def: UniformManifest = { name: 'width', type: 'float', default: 0.025, min: 0.005, max: 0.15, step: 0.005 };
    expect(snapUniformValue(def, 0.027)).toBe(0.025);
    expect(snapUniformValue(def, 0.028)).toBe(0.03);
    expect(snapUniformValue(def, 9)).toBe(0.15);
    expect(snapUniformValue(def, '')).toBe(0.025);
  });

  it('randomizes on the step grid within curated ranges and preserves hidden values', () => {
    const defs: UniformManifest[] = [
      { name: 'detail', type: 'float', default: 0.1, min: 0.005, max: 1, step: 0.005, random: { min: 0.023, max: 0.043 } },
      { name: 'custom', type: 'color', default: '#123456', visibleWhen: { name: 'palette', value: 'custom' } },
      { name: 'palette', type: 'select', default: 'ice', options: ['ice', 'custom'] },
      { name: 'background', type: 'color', default: '#000000', random: false },
    ];
    for (const random of [0, 0.3, 0.999999, 1]) {
      const values = randomizeUniforms(defs, { background: '#112233', custom: '#abcdef' }, () => random);
      expect(values.detail).toBeGreaterThanOrEqual(0.025);
      expect(values.detail).toBeLessThanOrEqual(0.04);
      expect(snapUniformValue(defs[0], values.detail)).toBe(values.detail);
      expect(values.background).toBe('#112233');
      expect(uniformVisible(defs[1], values)).toBe(values.palette === 'custom');
      if (values.palette === 'ice') expect(values.custom).toBe('#abcdef');
      else expect(values.custom).not.toBe('#abcdef');
    }
  });
});

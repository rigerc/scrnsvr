import { describe, expect, it } from 'vitest';
import { randomizeColorPalette } from '../src/shared/color-palettes';
import type { UniformManifest } from '../src/shared/manifest';

const defs: UniformManifest[] = [
  { name: 'ink', type: 'color', default: '#192546', colorRole: 'primary' },
  { name: 'accent', type: 'color', default: '#9a526f', colorRole: 'secondary' },
  { name: 'paper', type: 'color', default: '#e9e1d0', colorRole: 'onSurface', random: false },
  { name: 'hidden', type: 'color', default: '#ffffff', visibleWhen: { name: 'palette', value: 'custom' } },
];

describe('cohesive color exploration', () => {
  it('keeps protected and inherited colors out of returned edits', () => {
    expect(randomizeColorPalette(defs, {}, () => 0, new Set(['accent']))).toEqual({ ink: expect.stringMatching(/^#[\da-f]{6}$/) });
    expect(randomizeColorPalette(defs, {}, () => 0, new Set(['ink', 'accent']))).toEqual({});
  });

  it('keeps pigments dark, respects modes, and produces recoverable families', () => {
    const first = randomizeColorPalette(defs, { palette: 'custom' }, () => 0.5);
    expect(first).toEqual(randomizeColorPalette(defs, { palette: 'custom' }, () => 0.5));
    expect(first.hidden).toBeDefined();
    const components = String(first.ink).slice(1).match(/../g)!.map(hex => parseInt(hex, 16));
    expect(Math.max(...components)).toBeLessThan(100);
    expect(first).not.toEqual(randomizeColorPalette(defs, { palette: 'custom' }, () => 1));
  });
});

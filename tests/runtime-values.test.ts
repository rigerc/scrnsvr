// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { oglValue } from '../src/renderer/core/runtime';

describe('oglValue', () => {
  it('converts hex colors into OGL colors and falls back to the default', () => {
    const color = oglValue({ name: 'color1', type: 'color', default: '#ff0000' }, '#00ff00') as { r: number; g: number; b: number };
    expect(color.r).toBeCloseTo(0);
    expect(color.g).toBeCloseTo(1);
    const fallback = oglValue({ name: 'color1', type: 'color', default: '#ff0000' }, 'not-a-color') as { r: number; g: number; b: number };
    expect(fallback.r).toBeCloseTo(1);
    expect(fallback.g).toBeCloseTo(0);
  });

  it('maps select values to option indexes and passes through numbers', () => {
    const definition = { name: 'mode', type: 'select' as const, default: 'a', options: ['a', 'b', 'c'] };
    expect(oglValue(definition, 'b')).toBe(1);
    expect(oglValue(definition, 'missing')).toBe(0);
    expect(oglValue({ name: 'speed', type: 'float', default: 1 }, 2.5)).toBe(2.5);
  });
});

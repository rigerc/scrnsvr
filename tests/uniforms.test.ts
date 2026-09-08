import { describe, expect, it } from 'vitest';
import { bindUniforms } from '../src/renderer/core/uniforms';

describe('bindUniforms', () => {
  it('uses defaults, clamps numbers, rounds integers, and validates selects', () => {
    const values = bindUniforms([
      { name: 'speed', type: 'float', default: 1, min: 0, max: 2 },
      { name: 'count', type: 'int', default: 3, min: 1, max: 8 },
      { name: 'palette', type: 'select', default: 'ice', options: ['ice', 'fire'] },
    ], { speed: 9, count: 4.7, palette: 'unknown' });
    expect(values).toEqual({ speed: 2, count: 5, palette: 'ice' });
  });
});

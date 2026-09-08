import { describe, expect, it } from 'vitest';
import { fadeInOpacity, fadeOutOpacity } from '../src/renderer/core/fade';

describe('fade', () => {
  it('fades overlay opacity in and out linearly', () => {
    expect(fadeInOpacity(0, 1000)).toBe(1);
    expect(fadeInOpacity(500, 1000)).toBeCloseTo(0.5);
    expect(fadeInOpacity(1000, 1000)).toBe(0);
    expect(fadeOutOpacity(0, 1000)).toBe(0);
    expect(fadeOutOpacity(500, 1000)).toBeCloseTo(0.5);
    expect(fadeOutOpacity(1000, 1000)).toBe(1);
  });

  it('treats zero fade as instant', () => {
    expect(fadeInOpacity(0, 0)).toBe(0);
    expect(fadeOutOpacity(0, 0)).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { AnimationClock } from '../src/renderer/core/animation-clock';

describe('integrated animation time', () => {
  it('holds phase on pause and changes velocity without changing existing phase', () => {
    const clock = new AnimationClock();
    clock.advance(1000, 2);
    expect(clock.phase).toBe(2);
    clock.advance(1000, 0);
    expect(clock.phase).toBe(2);
    clock.advance(500, 3);
    expect(clock.phase).toBe(3.5);
    expect(clock.elapsed).toBe(2.5);
  });

  it('produces equivalent phase across frame rates including 1 fps', () => {
    for (const fps of [1, 15, 30, 60, 144]) {
      const clock = new AnimationClock();
      for (let i = 0; i < fps * 10; i++) clock.advance(1000 / fps, 1.7);
      expect(clock.phase).toBeCloseTo(17, 10);
    }
  });

  it('discards suspension gaps for motion and audio while retaining custom elapsed time', () => {
    const clock = new AnimationClock();
    clock.advance(100, 1);
    expect(clock.advance(60000, 1)).toBe(0);
    expect(clock.phase).toBe(0.1);
    expect(clock.elapsed).toBe(60.1);
    expect(clock.advance(100, 0)).toBe(0.1);
    expect(clock.phase).toBe(0.1);
    expect(clock.advance(Number.NaN, 1)).toBe(0);
  });
});

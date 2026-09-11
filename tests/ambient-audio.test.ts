import { describe, expect, it } from 'vitest';
import { AmbientAudio } from '../src/renderer/core/ambient-audio';
import { silentAudio } from '../src/shared/audio';

const loud = { ...silentAudio, level: 1, bass: 0.8, mid: 0.6, treble: 0.4 };

describe('ambient audio response', () => {
  it('follows an accent within 300ms and fades back smoothly', () => {
    const audio = new AmbientAudio();
    expect(audio.update(loud, 1 / 30)[0]).toBeLessThan(0.2);
    const sustained = [...audio.update(loud, 0.3 - 1 / 30)];
    expect(sustained[0]).toBeGreaterThan(0.8);
    expect(sustained[1]).toBeGreaterThan(sustained[2]);
    expect(sustained[2]).toBeGreaterThan(sustained[3]);
    const release = [...audio.update(silentAudio, 0.2)];
    expect(release[0]).toBeGreaterThan(sustained[0] * 0.7);
    expect(release[0]).toBeLessThan(sustained[0]);
    expect(audio.update(silentAudio, 2.3)[0]).toBeLessThan(0.02);
  });

  it('retains audible phrasing instead of averaging repeated accents into a constant level', () => {
    const audio = new AmbientAudio();
    for (let i = 0; i < 8; i++) {
      const peak = audio.update(loud, 0.15)[0];
      const trough = audio.update(silentAudio, 0.35)[0];
      expect(peak - trough).toBeGreaterThan(0.2);
    }
  });

  it('has the same response at 1, 30, 60 and 144 fps', () => {
    const render = (fps: number) => {
      const audio = new AmbientAudio();
      for (let i = 0; i < fps * 3; i++) audio.update(loud, 1 / fps);
      for (let i = 0; i < fps * 2; i++) audio.update(silentAudio, 1 / fps);
      return audio.value;
    };
    const reference = render(60);
    for (const fps of [1, 30, 144]) render(fps).forEach((value, i) => expect(value).toBeCloseTo(reference[i], 10));
  });

  it('does not advance on a redraw at the same time and starts a new scene quietly', () => {
    const audio = new AmbientAudio();
    expect(audio.update(loud, 0)).toEqual([0, 0, 0, 0]);
    const previous = [...audio.update(loud, 1)];
    expect(audio.update(silentAudio, 0)).toEqual(previous);
    expect(new AmbientAudio().value).toEqual([0, 0, 0, 0]);
  });
});

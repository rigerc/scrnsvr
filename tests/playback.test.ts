import { describe, expect, it } from 'vitest';
import { PlaybackGate } from '../src/renderer/core/playback';

describe('preview playback', () => {
  it('holds time while paused, redraws edits, and resumes without catching up', () => {
    const state = { paused: false };
    const gate = new PlaybackGate(state);
    const values = { speed: 1 };
    expect(gate.frame(33, values)).toBe(33);
    state.paused = true;
    expect(gate.frame(33, values)).toBe(0);
    expect(gate.frame(33, values)).toBeUndefined();
    values.speed = 2;
    expect(gate.frame(33, values)).toBe(0);
    expect(gate.frame(33, values, true)).toBe(0);
    state.paused = false;
    expect(gate.frame(1000, values)).toBe(0);
    expect(gate.frame(33, values)).toBe(33);
  });
});

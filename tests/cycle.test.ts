import { describe, expect, it, vi } from 'vitest';
import { cycleCrossfade } from '../src/renderer/core/cycle';

describe('cycleCrossfade', () => {
  it('halves the fade duration for out and in phases', () => {
    const plan = cycleCrossfade(1);
    expect(plan.halfMs).toBe(500);
    expect(plan.outOpacity(0)).toBe(0);
    expect(plan.outOpacity(500)).toBe(1);
    expect(plan.inOpacity(0)).toBe(1);
    expect(plan.inOpacity(500)).toBe(0);
  });

  it('clamps each half to at least one frame', () => {
    expect(cycleCrossfade(0).halfMs).toBeCloseTo(1000 / 60);
  });
});

describe('daemon inhibit hook', () => {
  it('skips launch while inhibited', async () => {
    vi.useFakeTimers();
    const { IdleDaemon } = await import('../src/main/daemon');
    const launch = vi.fn(() => ({ once: vi.fn() }));
    const daemon = new IdleDaemon({
      thresholdSeconds: 1, pollIntervalMs: 5000,
      idleSeconds: () => 3, launchRenderer: launch,
      inhibited: () => true,
    });
    daemon.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(launch).not.toHaveBeenCalled();
    daemon.stop();
    vi.useRealTimers();
  });
});

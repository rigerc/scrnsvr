import { describe, expect, it, vi } from 'vitest';

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

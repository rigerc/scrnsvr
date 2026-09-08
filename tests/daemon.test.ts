import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ powerMonitor: { getSystemIdleTime: vi.fn(() => 0), on: vi.fn(), removeListener: vi.fn() } }));
import { IdleDaemon } from '../src/main/daemon';

describe('IdleDaemon', () => {
  it('launches once and waits for child exit', async () => {
    vi.useFakeTimers();
    const listeners: Record<string, () => void> = {};
    const child = { once: (event: 'exit' | 'closed', fn: () => void) => { listeners[event] = fn; } };
    const launch = vi.fn(async () => child);
    const daemon = new IdleDaemon({ thresholdSeconds: 1, pollIntervalMs: 5000, idleSeconds: () => 3, launchRenderer: launch });
    daemon.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(launch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(launch).toHaveBeenCalledTimes(1);
    listeners.exit();
    await vi.advanceTimersByTimeAsync(5000);
    expect(launch).toHaveBeenCalledTimes(2);
    daemon.stop(); vi.useRealTimers();
  });
  it('suppresses launch after resume for one poll', async () => {
    vi.useFakeTimers(); const launch = vi.fn(() => ({ once: vi.fn() }));
    const daemon = new IdleDaemon({ thresholdSeconds: 1, pollIntervalMs: 5000, idleSeconds: () => 3, launchRenderer: launch });
    daemon.start(); daemon.onResume(); await vi.advanceTimersByTimeAsync(5000);
    expect(launch).not.toHaveBeenCalled(); daemon.stop(); vi.useRealTimers();
  });
});

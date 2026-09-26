import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: execFileMock }));
vi.mock('electron', () => ({ powerMonitor: { getSystemIdleTime: vi.fn(() => 0), on: vi.fn(), removeListener: vi.fn() } }));

import { readLogindIdleSeconds } from '../src/main/daemon';

let results: Array<{ error?: unknown; stdout?: string }> = [];

beforeEach(() => {
  results = [];
  execFileMock.mockReset();
  execFileMock.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (error: unknown, result: { stdout: string }) => void;
    const next = results.shift() ?? { stdout: '' };
    if (next.error) callback(next.error, { stdout: '' });
    else callback(null, { stdout: next.stdout ?? '' });
  });
  delete process.env.XDG_SESSION_ID;
});
afterEach(() => { delete process.env.XDG_SESSION_ID; });

describe('readLogindIdleSeconds', () => {
  it('returns zero without a session id', async () => {
    expect(await readLogindIdleSeconds()).toBe(0);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('computes idle seconds from logind monotonic timestamps', async () => {
    process.env.XDG_SESSION_ID = '1';
    const micro = Number(process.hrtime.bigint() / 1000n) - 5_000_000;
    results = [
      { stdout: 's "/org/freedesktop/login1/session/_1"\n' },
      { stdout: `t ${micro}\n` },
    ];
    const idle = await readLogindIdleSeconds();
    expect(idle).toBeGreaterThan(4.9);
    expect(idle).toBeLessThan(6);
  });

  it('returns zero for an unusable session path or timestamp', async () => {
    process.env.XDG_SESSION_ID = '1';
    results = [{ stdout: 's "not-a-path"' }];
    expect(await readLogindIdleSeconds()).toBe(0);
    results = [{ stdout: 's "/org/freedesktop/login1/session/_1"' }, { stdout: 't 0' }];
    expect(await readLogindIdleSeconds()).toBe(0);
  });

  it('logs and returns zero when busctl is unavailable', async () => {
    process.env.XDG_SESSION_ID = '1';
    const log = vi.fn();
    results = [{ error: new Error('busctl missing') }];
    expect(await readLogindIdleSeconds(log)).toBe(0);
    expect(log).toHaveBeenCalledWith('logind idle capability unavailable', expect.any(Error));
  });
});

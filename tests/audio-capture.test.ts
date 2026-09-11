import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { PlaybackAudio } from '../src/main/audio';
import type { AudioFrame } from '../src/shared/audio';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
describe.skipIf(process.platform !== 'linux')('shared monitor capture lifecycle', () => {
  function setup() {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const audio = new PlaybackAudio();
    const frames: AudioFrame[] = [];
    audio.setEnabled(true);
    expect(spawn).not.toHaveBeenCalled();
    const stop = audio.subscribe(frame => frames.push(frame));
    return { child, audio, frames, stop };
  }
  it('shares one monitor process and kills it after the final subscriber', () => {
    const { audio, child, stop } = setup();
    const stop2 = audio.subscribe(() => {});
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawn).mock.calls[0][1]).toContain('--device=@DEFAULT_MONITOR@');
    stop();
    expect(child.kill).not.toHaveBeenCalled();
    stop2();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
  it('clears levels on disable and ignores stale process events', () => {
    const { audio, child, frames, stop } = setup();
    child.stdout.write(Buffer.alloc(1600, 40));
    expect(frames.at(-1)!.level).toBeGreaterThan(0);
    audio.setEnabled(false);
    expect(child.kill).toHaveBeenCalledOnce();
    expect(frames.at(-1)!.level).toBe(0);
    child.emit('exit', 0);
    child.stdout.write(Buffer.alloc(1600, 40));
    expect(frames.at(-1)!.status).toContain('off');
    stop();
  });
  it('reports missing dependencies and allows explicit retry', () => {
    const { audio, child, frames, stop } = setup();
    child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
    expect(frames.at(-1)!.status).toContain('pulseaudio-utils');
    expect(frames.at(-1)!.level).toBe(0);
    audio.setEnabled(false);
    audio.setEnabled(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    stop();
  });
});

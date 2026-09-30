import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { PlaybackAudio } from '../src/main/audio';
import type { AudioFrame } from '../src/shared/audio';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const captures: PlaybackAudio[] = [];
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => {
  for (const audio of captures.splice(0)) audio.stop();
  vi.useRealTimers();
});
describe.skipIf(process.platform !== 'linux')('shared monitor capture lifecycle', () => {
  function createChild() {
    return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  }
  function setup() {
    const child = createChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const audio = new PlaybackAudio();
    captures.push(audio);
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
    expect(child.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(249);
    expect(child.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reuses capture and retains audio levels across repeated scene handoffs', () => {
    const { audio, child, stop } = setup();
    child.stdout.write(Buffer.alloc(1600, 40));
    let unsubscribe = stop;
    for (let rotation = 0; rotation < 5; rotation++) {
      unsubscribe();
      vi.advanceTimersByTime(100);
      const frames: AudioFrame[] = [];
      unsubscribe = audio.subscribe(frame => frames.push(frame));
      expect(frames[0].level).toBeGreaterThan(0);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(250);
    }
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(child.kill).not.toHaveBeenCalled();
    unsubscribe();
    vi.advanceTimersByTime(250);
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it('keeps one shutdown deadline when unsubscribe is called repeatedly', () => {
    const { child, stop } = setup();
    stop();
    vi.advanceTimersByTime(100);
    stop();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(150);
    expect(child.kill).toHaveBeenCalledOnce();
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels pending shutdown when another window subscribes', () => {
    const { audio, child, stop } = setup();
    stop();
    vi.advanceTimersByTime(100);
    const stop2 = audio.subscribe(() => {});
    const stop3 = audio.subscribe(() => {});
    expect(vi.getTimerCount()).toBe(0);
    stop2();
    vi.advanceTimersByTime(500);
    expect(child.kill).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledOnce();
    stop3();
    vi.advanceTimersByTime(250);
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it.each(['disable', 'stop'] as const)('stops immediately on %s and cancels pending shutdown', action => {
    const { audio, child, stop } = setup();
    stop();
    expect(vi.getTimerCount()).toBe(1);
    if (action === 'disable') audio.setEnabled(false);
    else audio.stop();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(500);
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it('restarts after a non-audio scene and ignores events from the old child', () => {
    const { audio, child, stop } = setup();
    stop();
    vi.advanceTimersByTime(250);
    const nextChild = createChild();
    vi.mocked(spawn).mockReturnValue(nextChild as unknown as ReturnType<typeof spawn>);
    const frames: AudioFrame[] = [];
    audio.subscribe(frame => frames.push(frame));
    expect(spawn).toHaveBeenCalledTimes(2);
    nextChild.stdout.write(Buffer.alloc(1600, 40));
    const latest = frames.at(-1);
    child.emit('exit', 0);
    child.stdout.write(Buffer.alloc(1600, 80));
    expect(frames.at(-1)).toBe(latest);
    expect(latest!.level).toBeGreaterThan(0);
    vi.advanceTimersByTime(500);
    expect(nextChild.kill).not.toHaveBeenCalled();
  });
  it('cancels the idle deadline when capture fails during a handoff', () => {
    const { audio, child, stop } = setup();
    stop();
    child.emit('error', new Error('capture failed'));
    expect(vi.getTimerCount()).toBe(0);
    const nextChild = createChild();
    vi.mocked(spawn).mockReturnValue(nextChild as unknown as ReturnType<typeof spawn>);
    const frames: AudioFrame[] = [];
    audio.subscribe(frame => frames.push(frame));
    expect(frames[0].status).toContain('Audio unavailable');
    expect(spawn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(nextChild.kill).not.toHaveBeenCalled();
  });
  it('does not schedule shutdown without an active capture', () => {
    const audio = new PlaybackAudio();
    captures.push(audio);
    const stop = audio.subscribe(() => {});
    stop();
    expect(spawn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
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

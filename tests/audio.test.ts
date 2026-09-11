import { describe, it, expect } from 'vitest';
import { AudioEnvelope, PlaybackAudio } from '../src/main/audio';
import { ConfigSchema } from '../src/shared/config';
import type { AudioFrame } from '../src/shared/audio';

function tone(hz: number, seconds = 0.3) {
  const pcm = Buffer.alloc(Math.round(24000 * seconds) * 2);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i * hz * Math.PI * 2 / 24000) * 12000), i * 2);
  return pcm;
}
function analyze(pcm: Buffer, chunk = pcm.length) {
  const frames: AudioFrame[] = [];
  const envelope = new AudioEnvelope();
  for (let i = 0; i < pcm.length; i += chunk) envelope.push(pcm.subarray(i, i + chunk), frame => frames.push(frame));
  return frames;
}
describe('playback audio', () => {
  it('is opt-in and persists its enabled setting', () => {
    expect(ConfigSchema.parse({}).audio.enabled).toBe(false);
    expect(ConfigSchema.parse({ audio: { enabled: true } }).audio.enabled).toBe(true);
  });
  it('handles split samples and produces 30 frames per second', () => {
    const pcm = tone(100, 1);
    const frames = analyze(pcm);
    expect(frames).toHaveLength(30);
    expect(analyze(pcm, 137)).toEqual(frames);
    expect(frames.at(-1)!.level).toBeGreaterThan(0.5);
  });
  it('separates bass, midrange and treble and decays to silence', () => {
    const bass = analyze(tone(60)).at(-1)!;
    const mid = analyze(tone(900)).at(-1)!;
    const treble = analyze(tone(7000)).at(-1)!;
    expect(bass.bass).toBeGreaterThan(bass.mid);
    expect(mid.mid).toBeGreaterThan(mid.bass);
    expect(treble.treble).toBeGreaterThan(treble.mid);
    const frames = analyze(Buffer.concat([tone(100), Buffer.alloc(48000)]));
    expect(frames.at(-1)!.level).toBeLessThan(0.001);
    expect(analyze(Buffer.alloc(1600))[0].level).toBe(0);
  });
  it('does not start capture while disabled and unsubscribes cleanly', () => {
    const audio = new PlaybackAudio();
    const frames: AudioFrame[] = [];
    const stop = audio.subscribe(frame => frames.push(frame));
    expect(frames[0].status).toContain('off');
    stop();
    audio.stop();
    expect(frames).toHaveLength(1);
  });
});

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { silentAudio, type AudioFrame } from '../shared/audio';

/** Streaming 24 kHz mono signed PCM; tolerate arbitrary pipe chunk boundaries. */
export class AudioEnvelope {
  private pending: number | undefined;
  private low = 0;
  private high = 0;
  private count = 0;
  private sums = [0, 0, 0, 0];
  private previous = [0, 0, 0, 0];
  push(bytes: Uint8Array, emit: (frame: AudioFrame) => void) {
    for (const byte of bytes) {
      if (this.pending === undefined) { this.pending = byte; continue; }
      const word = this.pending | (byte << 8);
      this.pending = undefined;
      const sample = (word >= 32768 ? word - 65536 : word) / 32768;
      this.low += 0.05 * (sample - this.low);
      this.high += 0.4 * (sample - this.high);
      const values = [sample, this.low, this.high - this.low, sample - this.high];
      values.forEach((value, i) => { this.sums[i] += value * value; });
      if (++this.count < 800) continue;
      this.previous = this.sums.map((sum, i) => {
        const target = Math.min(1, Math.sqrt(sum / this.count) * 3);
        return target > this.previous[i] ? target : this.previous[i] * 0.75 + target * 0.25;
      });
      const [level, bass, mid, treble] = this.previous;
      emit({ level, bass, mid, treble, status: 'Listening to default output (no recording).' });
      this.count = 0;
      this.sums.fill(0);
    }
  }
}

/** One capture process shared by all windows; never captures the default mic. */
export class PlaybackAudio {
  private child?: ChildProcessByStdio<null, Readable, Readable>;
  private enabled = false;
  private listeners = new Set<(frame: AudioFrame) => void>();
  private frame = { ...silentAudio };
  private publish(frame: AudioFrame) {
    this.frame = frame;
    for (const listener of this.listeners) listener(frame);
  }
  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.stop();
    this.sync();
  }
  subscribe(listener: (frame: AudioFrame) => void) {
    this.listeners.add(listener);
    listener(this.frame);
    this.sync();
    return () => { this.listeners.delete(listener); if (!this.listeners.size) this.stop(); };
  }
  private sync() {
    if (!this.enabled || !this.listeners.size || this.child) return;
    if (process.platform !== 'linux') {
      this.publish({ ...silentAudio, status: 'Playback capture currently requires Linux with PulseAudio or PipeWire-Pulse.' });
      return;
    }
    this.publish({ ...silentAudio, status: 'Connecting to default output…' });
    const child = this.child = spawn('parec', ['--device=@DEFAULT_MONITOR@', '--raw', '--format=s16le', '--rate=24000', '--channels=1', '--latency-msec=40', '--client-name=scrnsvr', '--stream-name=Reactive shaders'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const envelope = new AudioEnvelope();
    child.stdout.on('data', (data: Buffer) => { if (this.child === child) envelope.push(data, frame => this.publish(frame)); });
    let detail = '';
    child.stderr.on('data', (data: Buffer) => { detail = (detail + data.toString()).slice(-500); });
    const fail = () => {
      if (this.child !== child) return;
      this.child = undefined;
      this.publish({ ...silentAudio, status: `Audio unavailable. Install pulseaudio-utils and run PulseAudio or pipewire-pulse. Toggle audio off/on to retry. ${detail.trim()}` });
    };
    child.on('error', fail);
    child.on('exit', fail);
  }
  stop() {
    const child = this.child;
    this.child = undefined;
    child?.kill();
    this.publish({ ...silentAudio, status: this.enabled ? 'Audio idle.' : silentAudio.status });
  }
}

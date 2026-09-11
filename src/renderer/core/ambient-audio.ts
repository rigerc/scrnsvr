import type { AudioFrame } from '../../shared/audio';

/** Follow musical accents promptly, then let the material relax without flashing. */
export class AmbientAudio {
  readonly value = [0, 0, 0, 0];

  update(frame: AudioFrame, seconds: number): number[] {
    const targets = [frame.level, frame.bass, frame.mid, frame.treble];
    for (let i = 0; i < this.value.length; i++) {
      const target = Math.max(0, Math.min(1, targets[i]));
      const duration = target > this.value[i] ? 0.16 : 0.65;
      this.value[i] += (target - this.value[i]) * -Math.expm1(-Math.max(0, seconds) / duration);
    }
    return this.value;
  }
}

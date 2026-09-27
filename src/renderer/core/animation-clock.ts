/** Artistic phase and audio smoothing use bounded active time; custom uTime keeps elapsed time. */
export class AnimationClock {
  elapsed = 0;
  phase = 0;

  advance(milliseconds: number, speed: number): number {
    const seconds = Number.isFinite(milliseconds) ? Math.max(0, milliseconds / 1000) : 0;
    this.elapsed += seconds;
    // One second supports the slowest configured frame rate. Discard suspension
    // gaps rather than leaping through the composition after system resume.
    const activeSeconds = seconds > 1.05 ? 0 : seconds;
    this.phase += activeSeconds * (Number.isFinite(speed) ? speed : 1);
    return activeSeconds;
  }
}

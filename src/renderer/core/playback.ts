export interface PlaybackState { paused: boolean; }

/** Hold artistic time while paused, but still render edits and resizes. */
export class PlaybackGate {
  private previousValues = '';
  private wasPaused = false;

  constructor(private readonly state?: PlaybackState) {}

  frame(delta: number, values: Record<string, unknown>, force = false): number | undefined {
    if (!this.state?.paused) {
      const resumed = this.wasPaused;
      this.wasPaused = false;
      this.previousValues = '';
      return resumed ? 0 : delta;
    }
    const serialized = JSON.stringify(values);
    const changed = !this.wasPaused || serialized !== this.previousValues;
    this.wasPaused = true;
    this.previousValues = serialized;
    return changed || force ? 0 : undefined;
  }
}

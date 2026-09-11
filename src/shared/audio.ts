export interface AudioFrame {
  level: number;
  bass: number;
  mid: number;
  treble: number;
  status: string;
}
export const silentAudio: AudioFrame = { level: 0, bass: 0, mid: 0, treble: 0, status: 'Audio response is off.' };

export interface CliOptions {
  settings: boolean;
  daemon: boolean;
  shader?: string;
  preview: boolean;
  thumbnail: boolean;
  output?: string;
  frames: number;
}

export function parseArgs(args: string[]): CliOptions {
  const out: CliOptions = { settings: false, daemon: false, preview: false, thumbnail: false, frames: 3 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--settings' || argument === '-s') out.settings = true;
    else if (argument === '--daemon') out.daemon = true;
    else if (argument === '--preview') out.preview = true;
    else if (argument === '--thumbnail') out.thumbnail = true;
    else if (argument === '--shader' && args[index + 1]) out.shader = args[++index];
    else if (argument === '--output' && args[index + 1]) out.output = args[++index];
    else if (argument === '--frames' && args[index + 1]) {
      const frames = Number(args[++index]);
      if (Number.isInteger(frames) && frames > 0) out.frames = frames;
    }
  }
  return out;
}

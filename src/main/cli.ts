export interface CliOptions {
  settings: boolean;
  daemon: boolean;
  open: boolean;
  shader?: string;
  preview: boolean;
  thumbnail: boolean;
  output?: string;
  frames: number;
}

export type LaunchMode = 'thumbnail' | 'daemon' | 'screensaver' | 'settings';

const flagHandlers: Record<string, (out: CliOptions) => void> = {
  '--settings': (out) => { out.settings = true; },
  '-s': (out) => { out.settings = true; },
  '--daemon': (out) => { out.daemon = true; },
  '--open': (out) => { out.open = true; },
  '--preview': (out) => { out.preview = true; },
  '--thumbnail': (out) => { out.thumbnail = true; },
};

const valueHandlers: Record<string, (out: CliOptions, value: string) => void> = {
  '--shader': (out, value) => { out.shader = value; },
  '--output': (out, value) => { out.output = value; },
  '--frames': (out, value) => {
    const frames = Number(value);
    if (Number.isInteger(frames) && frames > 0) out.frames = frames;
  },
};

export function parseArgs(args: string[]): CliOptions {
  const out: CliOptions = { settings: false, daemon: false, open: false, preview: false, thumbnail: false, frames: 3 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const flag = flagHandlers[argument];
    if (flag) { flag(out); continue; }
    const takeValue = valueHandlers[argument];
    const value = args[index + 1];
    if (takeValue && value) { takeValue(out, value); index += 1; }
  }
  return out;
}

/** Argless runs default to settings; --open/--preview launch the screensaver. */
export function resolveMode(options: CliOptions): LaunchMode {
  if (options.thumbnail) return 'thumbnail';
  if (options.settings) return 'settings';
  if (options.daemon) return 'daemon';
  if (options.open || options.preview) return 'screensaver';
  return 'settings';
}

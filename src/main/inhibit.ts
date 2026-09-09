import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ExecResult { stdout: string; }
export type ExecFn = (command: string, args: string[], options?: { timeout?: number }) => Promise<ExecResult>;

const defaultExec: ExecFn = (command, args, options) =>
  execFileAsync(command, args, { timeout: options?.timeout ?? 1500 }).then(({ stdout }) => ({ stdout: String(stdout) }));

/** True when any PulseAudio/PipeWire sink input is active. Missing tools mean "no". */
export async function isAudioPlaying(exec: ExecFn = defaultExec): Promise<boolean> {
  try {
    const { stdout } = await exec('pactl', ['list', 'short', 'sink-inputs'], { timeout: 1500 });
    return stdout.split('\n').some((line) => line.trim().length > 0);
  } catch {
    return false;
  }
}

/** True when the active X11 window is fullscreen. Wayland and missing tools mean "no". */
export async function isFullscreenActive(
  exec: ExecFn = defaultExec,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!env.DISPLAY) return false;
  try {
    const { stdout: root } = await exec('xprop', ['-root', '_NET_ACTIVE_WINDOW'], { timeout: 1500 });
    const id = root.trim().split(/\s+/).pop();
    if (!id || id === '0x0') return false;
    const { stdout: state } = await exec('xprop', ['-id', id, '_NET_WM_STATE'], { timeout: 1500 });
    return state.includes('_NET_WM_STATE_FULLSCREEN');
  } catch {
    return false;
  }
}

export interface InhibitFlags { inhibitOnAudio: boolean; inhibitOnFullscreen: boolean; }
export interface InhibitResult { inhibited: boolean; reasons: string[]; }

/** Capability checks only; never throws, never requires a compositor. */
export async function shouldInhibitScreensaver(
  flags: InhibitFlags,
  deps: { exec?: ExecFn; env?: NodeJS.ProcessEnv } = {},
): Promise<InhibitResult> {
  const reasons: string[] = [];
  const { exec = defaultExec, env = process.env } = deps;
  const [audio, fullscreen] = await Promise.all([
    flags.inhibitOnAudio ? isAudioPlaying(exec) : Promise.resolve(false),
    flags.inhibitOnFullscreen ? isFullscreenActive(exec, env) : Promise.resolve(false),
  ]);
  if (audio) reasons.push('audio playing');
  if (fullscreen) reasons.push('fullscreen window active');
  return { inhibited: reasons.length > 0, reasons };
}

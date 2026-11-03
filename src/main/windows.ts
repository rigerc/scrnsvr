import type { Config } from '../shared/config';
import type { BrowserWindow } from 'electron';
import { pickRotationEntry, rotationEntryKey } from '../shared/rotation';
import { IPC } from '../shared/ipc';

export interface RendererTarget { shaderId: string; preset?: string; }
export interface RendererBounds { x: number; y: number; width: number; height: number; }

/** `--shader` wins; otherwise a random enabled rotation entry wins; else the saved shader. */
export function resolveRendererTarget(config: Config, override: string | undefined, preview: boolean, available: Record<string, unknown>): RendererTarget {
  let shaderId = override && available[override] ? override : config.shader;
  let preset: string | undefined;
  if (!override && !preview) {
    const pick = pickRotationEntry(config.rotation, config.shaders, config.presets, Object.keys(available));
    if (pick) { shaderId = pick.shaderId; preset = pick.preset; }
  }
  return { shaderId, preset };
}

export function rendererWindowOptions(config: Config, bounds: RendererBounds, preview: boolean) {
  return {
    x: bounds.x, y: bounds.y,
    width: preview ? 960 : bounds.width,
    height: preview ? 540 : bounds.height,
    fullscreen: !preview,
    kiosk: !preview && config.kiosk,
    frame: preview,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#000000',
  };
}

export function rendererQuery(shaderId: string, preset?: string): Record<string, string> {
  const query: Record<string, string> = { shader: shaderId };
  if (preset) query.preset = preset;
  return query;
}

/** Broadcast one choice to the group, excluding its actual initial selection. */
export function startWindowGroupCycling(windows: BrowserWindow[], options: {
  initial: RendererTarget;
  config: Config;
  loadConfig: () => Promise<Config>;
  shaderIds: (config: Config) => string[];
}): void {
  const intervalMs = options.config.rotation.intervalMinutes * 60_000;
  if (!options.config.rotation.enabled || !(intervalMs > 0)) return;
  let currentKey = rotationEntryKey(options.initial.shaderId, options.initial.preset);
  const timer = setInterval(async () => {
    const latest = await options.loadConfig();
    const pick = pickRotationEntry(latest.rotation, latest.shaders, latest.presets, options.shaderIds(latest), Math.random, currentKey);
    if (!pick) return;
    currentKey = rotationEntryKey(pick.shaderId, pick.preset);
    for (const window of windows) {
      if (!window.isDestroyed()) window.webContents.send(IPC.cycle, { shader: pick.shaderId, preset: pick.preset });
    }
  }, intervalMs);
  timer.unref?.();
  for (const window of windows) window.once('closed', () => {
    if (windows.every(window => window.isDestroyed())) clearInterval(timer);
  });
}

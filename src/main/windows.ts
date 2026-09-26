import type { Config } from '../shared/config';
import { pickRotationEntry } from '../shared/rotation';

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

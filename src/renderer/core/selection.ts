import type { Config } from '../../shared/config';
import { effectiveShaderValues } from '../../shared/palettes';
import { resolveRotationValues } from '../../shared/rotation';
import type { ShaderDefinition } from './runtime';

/** Pick the requested shader, falling back to the default then the first registered shader. */
export function resolveShaderSelection<T>(registry: Record<string, T>, requested: string | undefined, fallbackId = 'flow-field'): T | undefined {
  return registry[requested ?? ''] ?? registry[fallbackId] ?? Object.values(registry)[0];
}

/** Values for a shader: a saved preset wins, otherwise stored edits, merged under the active scheme. */
export function resolveShaderValues(config: Config, registry: Record<string, ShaderDefinition>, shaderId: string, preset?: string): Record<string, unknown> {
  const stored = preset
    ? resolveRotationValues(config.shaders, config.presets, shaderId, preset)
    : config.shaders[shaderId] ?? {};
  const manifest = registry[shaderId]?.manifest;
  return manifest ? effectiveShaderValues(manifest, stored, config.colors) : stored;
}

/** Dismiss once the pointer has travelled past `threshold` from its first position. */
export function createPointerDismiss(dismiss: () => void, threshold = 12): (event: { screenX: number; screenY: number }) => void {
  let origin: { x: number; y: number } | undefined;
  return (event) => {
    origin ??= { x: event.screenX, y: event.screenY };
    if (Math.hypot(event.screenX - origin.x, event.screenY - origin.y) > threshold) dismiss();
  };
}

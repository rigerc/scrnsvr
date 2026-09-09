import { z } from 'zod';

export const RotationEntrySchema = z.object({
  shader: z.string().min(1),
  preset: z.string().min(1).optional(),
});
export type RotationEntry = z.infer<typeof RotationEntrySchema>;

export const RotationSchema = z.object({
  enabled: z.boolean().default(false),
  entries: z.array(RotationEntrySchema).default([]),
  /** Auto-cycle while the screensaver runs. 0 = pick once on open only. */
  intervalMinutes: z.number().min(0).max(180).default(0),
}).default({});

export type RotationConfig = z.infer<typeof RotationSchema>;

export type ShaderValues = Record<string, number | boolean | string>;
export interface RotationPick { shaderId: string; preset?: string; values: ShaderValues; }

/** Stable identity for an entry; shader + preset both matter. */
export function rotationEntryKey(shaderId: string, preset?: string): string {
  return preset ? `${shaderId}/${preset}` : shaderId;
}

/**
 * Pick a random rotation entry. Returns undefined when rotation is disabled,
 * empty, or has no entries pointing at a known shader. Pass `excludeKey` to
 * avoid repeating the currently displayed shader+preset when cycling.
 */
export function pickRotationEntry(
  rotation: RotationConfig | undefined,
  shaders: Record<string, ShaderValues>,
  presets: Record<string, Record<string, ShaderValues>>,
  validIds: string[],
  random: () => number = Math.random,
  excludeKey?: string,
): RotationPick | undefined {
  if (!rotation?.enabled || rotation.entries.length === 0) return undefined;
  const valid = new Set(validIds);
  const candidates = rotation.entries.filter((entry) => valid.has(entry.shader));
  if (candidates.length === 0) return undefined;
  const rest = excludeKey ? candidates.filter((e) => rotationEntryKey(e.shader, e.preset) !== excludeKey) : candidates;
  const pool = rest.length > 0 ? rest : candidates;
  const entry = pool[Math.floor(random() * pool.length) % pool.length]!;
  const presetValues = entry.preset ? presets[entry.shader]?.[entry.preset] : undefined;
  return {
    shaderId: entry.shader,
    preset: entry.preset,
    values: { ...(shaders[entry.shader] ?? {}), ...(presetValues ?? {}) },
  };
}

/** Resolve display values for a picked entry (preset overlaid on current values). */
export function resolveRotationValues(
  shaders: Record<string, ShaderValues>,
  presets: Record<string, Record<string, ShaderValues>>,
  shaderId: string,
  preset?: string,
): ShaderValues {
  return { ...(shaders[shaderId] ?? {}), ...(preset ? presets[shaderId]?.[preset] ?? {} : {}) };
}

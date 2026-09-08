import { z } from 'zod';

export const RotationEntrySchema = z.object({
  shader: z.string().min(1),
  preset: z.string().min(1).optional(),
});
export type RotationEntry = z.infer<typeof RotationEntrySchema>;

export const RotationSchema = z.object({
  enabled: z.boolean().default(false),
  entries: z.array(RotationEntrySchema).default([]),
}).default({});

export type RotationConfig = z.infer<typeof RotationSchema>;

export type ShaderValues = Record<string, number | boolean | string>;
export interface RotationPick { shaderId: string; preset?: string; values: ShaderValues; }

/**
 * Pick a random rotation entry. Returns undefined when rotation is disabled,
 * empty, or has no entries pointing at a known shader.
 */
export function pickRotationEntry(
  rotation: RotationConfig | undefined,
  shaders: Record<string, ShaderValues>,
  presets: Record<string, Record<string, ShaderValues>>,
  validIds: string[],
  random: () => number = Math.random,
): RotationPick | undefined {
  if (!rotation?.enabled || rotation.entries.length === 0) return undefined;
  const valid = new Set(validIds);
  const candidates = rotation.entries.filter((entry) => valid.has(entry.shader));
  if (candidates.length === 0) return undefined;
  const entry = candidates[Math.floor(random() * candidates.length) % candidates.length]!;
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

import { z } from 'zod';
import type { UniformManifest, UniformValue } from './manifest';
import { effectManifests } from './effect-catalog';
export { effectManifests } from './effect-catalog';

export const MAX_EFFECT_LAYERS = 8;
export interface EffectManifest {
  id: string;
  title: string;
  description: string;
  uniforms: UniformManifest[];
}
export interface EffectDefinition extends EffectManifest {
  /** Final fragment pass; uOriginal is the input image at this layer's boundary. */
  source: string;
  /** Optional intermediate fragment passes, run in order before the final source. */
  passes?: string[];
  /** Supply uHistory/uHistoryValid and retain this instance's previous output. */
  history?: boolean;
}
export interface EffectLayer {
  id: string;
  effectId: string;
  enabled: boolean;
  values: Record<string, UniformValue>;
}
export interface EffectsConfig { enabled: boolean; layers: EffectLayer[]; }
export interface EffectStatus {
  /** Omitted for a stack-wide failure, such as framebuffer allocation. */
  layerId?: string;
  message: string;
}
export interface EffectRuntimeOptions {
  /** Mutate this object to update a mounted scene without resetting animation. */
  effects?: EffectsConfig;
  onEffectStatus?: (status: EffectStatus) => void;
}

export function resolveEffectValues(manifest: EffectManifest, values: Record<string, unknown> = {}): Record<string, UniformValue> {
  return Object.fromEntries(manifest.uniforms.map(def => {
    const value = values[def.name];
    let resolved: UniformValue = def.default;
    if (def.type === 'float' || def.type === 'int') {
      const number = typeof value === 'number' ? value : NaN;
      const finite = Number.isFinite(number) ? number : Number(def.default);
      resolved = Math.max(def.min ?? -Infinity, Math.min(def.max ?? Infinity, def.type === 'int' ? Math.round(finite) : finite));
    } else if (def.type === 'bool' && typeof value === 'boolean') resolved = value;
    else if (def.type === 'color' && typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) resolved = value;
    else if (def.type === 'select' && typeof value === 'string' && def.options?.includes(value)) resolved = value;
    return [def.name, resolved];
  }));
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100;

/** Repair this optional section independently: damaged effects must not reset the user's visuals. */
export function normalizeEffects(candidate: unknown): EffectsConfig {
  const config = object(candidate);
  const layers: EffectLayer[] = [];
  const used = new Set<string>();
  for (const [index, entry] of (Array.isArray(config?.layers) ? config.layers : []).entries()) {
    const layer = object(entry);
    if (!layer || !identifier(layer.effectId)) continue;
    let id = identifier(layer.id) ? layer.id : `effect-${index + 1}`;
    if (used.has(id)) {
      const base = `effect-${index + 1}`;
      id = base;
      for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
    }
    used.add(id);
    const values = Object.fromEntries(Object.entries(object(layer.values) ?? {}).filter(([, value]) =>
      typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))));
    const manifest = Object.hasOwn(effectManifests, layer.effectId) ? effectManifests[layer.effectId] : undefined;
    layers.push({ id, effectId: layer.effectId, enabled: typeof layer.enabled === 'boolean' ? layer.enabled : true,
      values: { ...values, ...(manifest ? resolveEffectValues(manifest, values) : {}) } as Record<string, UniformValue> });
    if (layers.length === MAX_EFFECT_LAYERS) break;
  }
  return { enabled: typeof config?.enabled === 'boolean' ? config.enabled : true, layers };
}

export const EffectsSchema = z.preprocess(normalizeEffects, z.object({
  enabled: z.boolean(),
  layers: z.array(z.object({
    id: z.string().min(1).max(100), effectId: z.string().min(1).max(100), enabled: z.boolean(),
    values: z.record(z.string(), z.union([z.number().finite(), z.boolean(), z.string()])),
  })).max(MAX_EFFECT_LAYERS),
}));

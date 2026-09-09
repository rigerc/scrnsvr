import type { UniformManifest, UniformValue } from '../../shared/manifest';

/** Normalize persisted values without snapping legacy presets to new UI steps. */
export function uniformValue(def: UniformManifest, value: unknown): UniformValue {
  if (value === undefined || value === null) return def.default;
  if (def.type === 'float' || def.type === 'int') {
    let number = typeof value === 'number' || (typeof value === 'string' && value.trim())
      ? Number(value) : NaN;
    if (!Number.isFinite(number)) number = Number(def.default);
    if (def.type === 'int') number = Math.round(number);
    return Math.max(def.min ?? -Infinity, Math.min(def.max ?? Infinity, number));
  }
  if (def.type === 'bool') return typeof value === 'boolean' ? value : def.default;
  if (def.type === 'color') return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : def.default;
  if (def.type === 'select') return def.options?.includes(String(value)) ? String(value) : def.default;
  return def.default;
}

export function bindUniforms(defs: UniformManifest[], values: Record<string, unknown>): Record<string, UniformValue> {
  return Object.fromEntries(defs.map(def => [def.name, uniformValue(def, values[def.name])]));
}

export function snapUniformValue(def: UniformManifest, value: unknown): UniformValue {
  const normalized = uniformValue(def, value);
  if (typeof normalized !== 'number') return normalized;
  const step = def.step ?? (def.type === 'int' ? 1 : 0.01);
  const origin = def.min ?? 0;
  return uniformValue(def, Number((origin + Math.round((normalized - origin) / step) * step).toFixed(6)));
}

export function uniformVisible(def: UniformManifest, values: Record<string, UniformValue>): boolean {
  return !def.visibleWhen || values[def.visibleWhen.name] === def.visibleWhen.value;
}

export function randomizeUniforms(defs: UniformManifest[], current: Record<string, unknown>, random = Math.random): Record<string, UniformValue> {
  const values = bindUniforms(defs, current);
  // Choose modes before dependent controls, regardless of manifest ordering.
  for (const def of [...defs].sort((a, b) => Number(Boolean(a.visibleWhen)) - Number(Boolean(b.visibleWhen)))) {
    if (def.random === false || !uniformVisible(def, values)) continue;
    if (def.type === 'float' || def.type === 'int') {
      const step = def.step ?? (def.type === 'int' ? 1 : 0.01);
      const origin = def.min ?? 0;
      const min = Math.max(origin, def.random?.min ?? origin);
      const max = Math.min(def.max ?? 1, def.random?.max ?? def.max ?? 1);
      const first = Math.ceil((min - origin) / step - 1e-8);
      const last = Math.floor((max - origin) / step + 1e-8);
      const index = first + Math.min(last - first, Math.floor(random() * (last - first + 1)));
      values[def.name] = snapUniformValue(def, origin + index * step);
    } else if (def.type === 'bool') values[def.name] = random() >= 0.5;
    else if (def.type === 'select') {
      const options = def.options ?? [];
      values[def.name] = options[Math.min(options.length - 1, Math.floor(random() * options.length))] ?? def.default;
    } else values[def.name] = `#${Math.min(0xffffff, Math.floor(random() * 0x1000000)).toString(16).padStart(6, '0')}`;
  }
  return values;
}

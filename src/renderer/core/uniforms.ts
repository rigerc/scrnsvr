import { randomizeColorPalette } from '../../shared/color-palettes';
import type { UniformManifest, UniformValue } from '../../shared/manifest';

/** Clamp numeric controls, rounding integers and falling back to the default for junk input. */
function normalizeNumber(def: UniformManifest, value: unknown, integer: boolean): UniformValue {
  let number = typeof value === 'number' || (typeof value === 'string' && value.trim())
    ? Number(value) : NaN;
  if (!Number.isFinite(number)) number = Number(def.default);
  if (integer) number = Math.round(number);
  return Math.max(def.min ?? -Infinity, Math.min(def.max ?? Infinity, number));
}

const normalizers: Record<UniformManifest['type'], (def: UniformManifest, value: unknown) => UniformValue> = {
  float: (def, value) => normalizeNumber(def, value, false),
  int: (def, value) => normalizeNumber(def, value, true),
  bool: (def, value) => (typeof value === 'boolean' ? value : def.default),
  color: (def, value) => (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : def.default),
  select: (def, value) => (def.options?.includes(String(value)) ? String(value) : def.default),
};

/** Normalize persisted values without snapping legacy presets to new UI steps. */
function uniformValue(def: UniformManifest, value: unknown): UniformValue {
  if (value === undefined || value === null) return def.default;
  return (normalizers[def.type] ?? ((definition: UniformManifest) => definition.default))(def, value);
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

function randomNumber(def: UniformManifest, random: () => number): UniformValue {
  const step = def.step ?? (def.type === 'int' ? 1 : 0.01);
  const origin = def.min ?? 0;
  const spec = def.random === false ? undefined : def.random;
  const min = Math.max(origin, spec?.min ?? origin);
  const max = Math.min(def.max ?? 1, spec?.max ?? def.max ?? 1);
  const first = Math.ceil((min - origin) / step - 1e-8);
  const last = Math.floor((max - origin) / step + 1e-8);
  const index = first + Math.min(last - first, Math.floor(random() * (last - first + 1)));
  return snapUniformValue(def, origin + index * step);
}

function randomSelect(def: UniformManifest, random: () => number): UniformValue {
  const options = def.options ?? [];
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))] ?? def.default;
}

const randomizers: Record<string, (def: UniformManifest, random: () => number) => UniformValue> = {
  float: randomNumber,
  int: randomNumber,
  bool: (_def, random) => random() >= 0.5,
  select: randomSelect,
};

/** Choose modes before dependent controls, regardless of manifest ordering. */
function byVisibleWhenLast(a: UniformManifest, b: UniformManifest): number {
  return Number(Boolean(a.visibleWhen)) - Number(Boolean(b.visibleWhen));
}

export function randomizeUniforms(defs: UniformManifest[], current: Record<string, unknown>, random = Math.random, protectedNames?: ReadonlySet<string>, resolvedValues: Record<string, unknown> = current): Record<string, UniformValue> {
  // Stored overrides and effective values are deliberately separate: skipped inherited
  // controls must remain absent so future scheme changes can still flow through.
  const values = { ...current } as Record<string, UniformValue>;
  const resolved = bindUniforms(defs, resolvedValues);
  for (const def of [...defs].sort(byVisibleWhenLast)) {
    const randomizer = randomizers[def.type];
    if (def.random === false || protectedNames?.has(def.name) || !uniformVisible(def, resolved) || !randomizer) continue;
    values[def.name] = randomizer(def, random);
    resolved[def.name] = values[def.name];
  }
  Object.assign(values, randomizeColorPalette(defs, resolved, random, protectedNames));
  return values;
}

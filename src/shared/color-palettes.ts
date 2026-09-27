import type { UniformManifest, UniformValue } from './manifest';

// Related pigment/light colors, deliberately separated from terminal UI schemes.
export const colorFamilies = [
  { name: 'Tide', colors: ['#58b8b5', '#8ca9da', '#d8dfc4'] },
  { name: 'Ember', colors: ['#d99255', '#c26b64', '#efd4a1'] },
  { name: 'Moss', colors: ['#90ad78', '#c2b675', '#d7dfb1'] },
  { name: 'Dusk', colors: ['#a58aba', '#c98998', '#e4c4ac'] },
  { name: 'Mineral', colors: ['#9aaec4', '#81a9a4', '#d8d7cb'] },
] as const;

function rgb(hex: string): number[] {
  return [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function lightness(hex: string): number {
  const c = rgb(hex);
  return (Math.max(...c) + Math.min(...c)) / 2;
}

// Preserve the authored light/dark role while using the selected family's hues.
// A paper shader's dark pigments should not become bright emissive lights.
function matchLightness(hex: string, target: number): string {
  const c = rgb(hex);
  const original = lightness(hex);
  const adjusted = c.map(channel => target < original
    ? channel * target / Math.max(original, 0.001)
    : 1 - (1 - channel) * (1 - target) / Math.max(1 - original, 0.001));
  return '#' + adjusted.map(channel => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, '0')).join('');
}

/** Return color edits only; never materialize inherited or locked values. */
export function randomizeColorPalette(
  defs: UniformManifest[],
  current: Record<string, UniformValue>,
  random: () => number = Math.random,
  protectedNames?: ReadonlySet<string>,
): Record<string, UniformValue> {
  const eligible = defs.filter(def => def.type === 'color' && def.random !== false
    && !protectedNames?.has(def.name)
    && (!def.visibleWhen || current[def.visibleWhen.name] === def.visibleWhen.value));
  if (!eligible.length) return {};
  const family = colorFamilies[Math.min(colorFamilies.length - 1, Math.max(0, Math.floor(random() * colorFamilies.length)))];
  const offsets = { primary: 0, secondary: 1, tertiary: 2, surface: 0, onSurface: 2 };
  return Object.fromEntries(eligible.map((def, index) => {
    const authored = String(def.default);
    const target = Math.max(0.06, Math.min(0.94, lightness(authored)));
    const color = family.colors[def.colorRole ? offsets[def.colorRole] : index % 3];
    return [def.name, matchLightness(color, target)];
  }));
}

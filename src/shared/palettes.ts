import type { ShaderManifest, UniformValue } from './manifest';
import { palettes, type ColorRoles, type Palette } from './palettes.generated';

export { palettes };
export type { ColorRoles, Palette, PaletteVariant } from './palettes.generated';

/** Sentinel meaning "keep the shader's built-in palette". */
export const SCHEME_NONE = 'none';

export interface ColorSchemeConfig {
  /** Global scheme id, or SCHEME_NONE. */
  scheme: string;
  /** Per-shader overrides. '' inherits the global scheme; SCHEME_NONE disables it. */
  overrides: Record<string, string>;
}

export const paletteById: Map<string, Palette> = new Map(palettes.map(palette => [palette.id, palette]));

/** Colour uniforms each scheme rewrites, with the roles they receive. */
const namedRoles: Record<string, keyof ColorRoles> = {
  color: 'primary',
  color1: 'primary',
  color2: 'secondary',
  color3: 'tertiary',
  color4: 'onSurface',
  background: 'surface',
  backgroundTop: 'surface',
  shadow: 'surface',
  midtone: 'primary',
  highlight: 'onSurface',
};

const accentOrder: Array<keyof ColorRoles> = ['primary', 'secondary', 'tertiary'];

/**
 * Values a set of roles writes onto a shader's colour uniforms. Shared by color
 * schemes and the Noctalia desktop import so both stay consistent.
 */
export function applyColorRoles(shader: ShaderManifest, roles: ColorRoles): Record<string, UniformValue> {
  const accents = accentOrder.map(role => roles[role]);
  const values = Object.fromEntries(
    shader.uniforms
      .filter(uniform => uniform.type === 'color')
      .map((uniform, index) => [uniform.name, roles[namedRoles[uniform.name] ?? accentOrder[index % accentOrder.length]!]]),
  );
  // Flow Field's Aurora mode reads `color`; Plasma's Custom mode reads its three colors.
  if (shader.id === 'flow-field' && values.color) values.palette = 'aurora';
  if (shader.id === 'plasma' && values.color1) values.palette = 'custom';
  return values;
}

export function hasColorUniforms(shader: ShaderManifest): boolean {
  return shader.uniforms.some(uniform => uniform.type === 'color');
}

/** Resolve the scheme id that applies to a shader, or undefined for built-in colors. */
export function schemeIdForShader(shaderId: string, colors: ColorSchemeConfig | undefined): string | undefined {
  const override = colors?.overrides?.[shaderId];
  const id = override !== undefined && override !== '' ? override : colors?.scheme;
  if (!id || id === SCHEME_NONE) return undefined;
  return paletteById.has(id) ? id : undefined;
}

/** Colour and dependent-select values a shader receives from its active scheme. */
export function shaderSchemeValues(shader: ShaderManifest, colors: ColorSchemeConfig | undefined): Record<string, UniformValue> {
  const id = schemeIdForShader(shader.id, colors);
  const palette = id ? paletteById.get(id) : undefined;
  return palette ? applyColorRoles(shader, palette.roles) : {};
}

/** Merge scheme colors under stored user values; explicit overrides always win. */
export function effectiveShaderValues(
  shader: ShaderManifest,
  stored: Record<string, unknown> | undefined,
  colors: ColorSchemeConfig | undefined,
): Record<string, UniformValue> {
  return { ...shaderSchemeValues(shader, colors), ...(stored ?? {}) } as Record<string, UniformValue>;
}

/** Drop stored color choices (and the dependent palette select) so a scheme shows through. */
export function clearShaderColorOverrides(shader: ShaderManifest, stored: Record<string, unknown> | undefined): void {
  if (!stored || !hasColorUniforms(shader)) return;
  for (const uniform of shader.uniforms) {
    if (uniform.type === 'color' || (uniform.type === 'select' && uniform.name === 'palette')) delete stored[uniform.name];
  }
}

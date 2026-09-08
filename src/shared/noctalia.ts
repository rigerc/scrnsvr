import type { ShaderManifest } from './manifest';

const roles = ['mPrimary', 'mSecondary', 'mTertiary', 'mSurface', 'mOnSurface'] as const;
export type NoctaliaPalette = Record<typeof roles[number], string>;
export type NoctaliaImportResult =
  | { ok: true; palette: NoctaliaPalette; path: string }
  | { ok: false; error: string };

export function parseNoctaliaPalette(value: unknown): NoctaliaPalette {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a Noctalia colors object.');
  }
  const palette = {} as NoctaliaPalette;
  for (const role of roles) {
    const color = (value as Record<string, unknown>)[role];
    if (typeof color !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) {
      throw new Error(`Noctalia color ${role} must be a hex color such as #aabbcc.`);
    }
    palette[role] = (color.length === 4
      ? `#${[...color.slice(1)].map(digit => digit + digit).join('')}`
      : color).toLowerCase();
  }
  return palette;
}

export function noctaliaShaderValues(shader: ShaderManifest, palette: NoctaliaPalette): Record<string, string> {
  const named: Record<string, string> = {
    color: palette.mPrimary,
    color1: palette.mPrimary,
    color2: palette.mSecondary,
    color3: palette.mTertiary,
    color4: palette.mOnSurface,
    background: palette.mSurface,
    shadow: palette.mSurface,
    midtone: palette.mPrimary,
    highlight: palette.mOnSurface,
  };
  const accents = [palette.mPrimary, palette.mSecondary, palette.mTertiary];
  const values = Object.fromEntries(shader.uniforms.filter(u => u.type === 'color')
    .map((u, index) => [u.name, named[u.name] ?? accents[index % accents.length]]));
  // Flow Field's monochrome mode ignores its color control.
  if (shader.id === 'flow-field' && values.color) values.palette = 'aurora';
  return values;
}

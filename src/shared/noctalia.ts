import type { ShaderManifest } from './manifest';
import { applyColorRoles } from './palettes';

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
  const values = applyColorRoles(shader, {
    primary: palette.mPrimary,
    secondary: palette.mSecondary,
    tertiary: palette.mTertiary,
    surface: palette.mSurface,
    onSurface: palette.mOnSurface,
  });
  // Noctalia always imports explicit colors; schemes do not run on top of them.
  return values as Record<string, string>;
}

import { describe, expect, it } from 'vitest';
import {
  SCHEME_NONE,
  applyColorRoles,
  clearShaderColorOverrides,
  effectiveShaderValues,
  hasColorUniforms,
  paletteById,
  palettes,
  schemeIdForShader,
  shaderSchemeValues,
  type ColorRoles,
} from '../src/shared/palettes';
import { flowFieldManifest } from '../src/renderer/shaders/flow-field/manifest';
import { plasmaManifest } from '../src/renderer/shaders/plasma/manifest';
import { gradientBlobsManifest } from '../src/renderer/shaders/gradient-blobs/manifest';
import { meshGradientManifest } from '../src/renderer/shaders/mesh-gradient/manifest';

const expectedIds = [
  'dracula', 'nord', 'gruvbox-dark', 'gruvbox-light', 'solarized-dark', 'solarized-light',
  'monokai', 'one-dark', 'tokyo-night', 'tokyo-night-storm', 'night-owl', 'palenight', 'zenburn',
  'ayu-dark', 'ayu-mirage', 'ayu-light', 'rose-pine', 'rose-pine-moon', 'rose-pine-dawn',
  'kanagawa-wave', 'kanagawa-dragon', 'kanagawa-lotus', 'github-dark', 'github-light',
  'material-dark', 'material-palenight', 'everforest-dark', 'everforest-light', 'iceberg-dark', 'iceberg-light',
];

const hex = /^#[0-9a-f]{6}$/;
const roles: ColorRoles = {
  surface: '#191724', onSurface: '#e0def4', primary: '#ebbcba', secondary: '#9ccfd8', tertiary: '#31748f',
};

describe('palette catalog', () => {
  it('contains the 30 curated palettes with unique ids', () => {
    expect(palettes).toHaveLength(30);
    expect(palettes.map(palette => palette.id)).toEqual(expectedIds);
    expect(new Set(palettes.map(palette => palette.id)).size).toBe(30);
  });

  it('stores complete, normalized colors and derived roles', () => {
    for (const palette of palettes) {
      expect(palette.variant === 'dark' || palette.variant === 'light').toBe(true);
      expect(palette.background).toMatch(hex);
      expect(palette.foreground).toMatch(hex);
      expect(palette.ansi).toHaveLength(16);
      for (const color of palette.ansi) expect(color).toMatch(hex);
      expect(palette.roles).toEqual({
        surface: palette.background,
        onSurface: palette.foreground,
        primary: palette.ansi[4],
        secondary: palette.ansi[5],
        tertiary: palette.ansi[6],
      });
    }
    expect(paletteById.get('dracula')?.background).toBe('#282a36');
  });
});

describe('scheme resolution', () => {
  it('prefers a per-shader override and falls back to the global scheme', () => {
    expect(schemeIdForShader('plasma', { scheme: 'nord', overrides: {} })).toBe('nord');
    expect(schemeIdForShader('plasma', { scheme: 'nord', overrides: { plasma: 'dracula' } })).toBe('dracula');
    expect(schemeIdForShader('plasma', { scheme: 'nord', overrides: { plasma: '' } })).toBe('nord');
    expect(schemeIdForShader('plasma', { scheme: 'nord', overrides: { plasma: SCHEME_NONE } })).toBeUndefined();
  });

  it('treats none and unknown ids as built-in colors', () => {
    expect(schemeIdForShader('plasma', { scheme: SCHEME_NONE, overrides: {} })).toBeUndefined();
    expect(schemeIdForShader('plasma', { scheme: 'does-not-exist', overrides: {} })).toBeUndefined();
    expect(shaderSchemeValues(plasmaManifest, { scheme: 'does-not-exist', overrides: {} })).toEqual({});
  });

  it('lets stored user colors win over the scheme', () => {
    const colors = { scheme: 'dracula', overrides: {} };
    const effective = effectiveShaderValues(
      gradientBlobsManifest,
      { color1: '#123456', background: '#000000' },
      colors,
    );
    expect(effective.color1).toBe('#123456');
    expect(effective.background).toBe('#000000');
    expect(effective.color2).toBe(paletteById.get('dracula')!.roles.secondary);
  });
});

describe('role mapping', () => {
  it('maps named roles and cycles accents by uniform order', () => {
    expect(applyColorRoles(gradientBlobsManifest, roles)).toEqual({
      color1: roles.primary, color2: roles.secondary, color3: roles.tertiary, background: roles.surface,
    });
    expect(applyColorRoles(meshGradientManifest, roles)).toEqual({
      color1: roles.primary, color2: roles.secondary, color3: roles.tertiary, color4: roles.onSurface,
    });
  });

  it('selects a color-aware palette for Flow Field and Plasma', () => {
    expect(applyColorRoles(flowFieldManifest, roles)).toEqual({
      color: roles.primary, color2: roles.secondary, background: roles.surface, palette: 'aurora',
    });
    expect(applyColorRoles(plasmaManifest, roles)).toEqual({
      color1: roles.primary, color2: roles.secondary, color3: roles.tertiary, palette: 'custom',
    });
  });
});

describe('clearing color overrides', () => {
  it('removes color uniforms and the dependent palette select only', () => {
    const stored: Record<string, unknown> = {
      color1: '#111111', color2: '#222222', color3: '#333333', palette: 'custom',
      speed: 1.7, scale: 4, contrast: 0.9, brightness: 1.1,
    };
    expect(hasColorUniforms(plasmaManifest)).toBe(true);
    clearShaderColorOverrides(plasmaManifest, stored);
    expect(stored).toEqual({ speed: 1.7, scale: 4, contrast: 0.9, brightness: 1.1 });
  });

  it('leaves shaders without color uniforms untouched', () => {
    const stored = { speed: 1, palette: 'whatever' };
    clearShaderColorOverrides({ ...plasmaManifest, id: 'no-colors', uniforms: plasmaManifest.uniforms.filter(u => u.type !== 'color') }, stored);
    expect(stored).toEqual({ speed: 1, palette: 'whatever' });
  });
});

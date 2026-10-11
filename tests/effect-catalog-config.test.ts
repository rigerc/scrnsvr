import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../src/shared/config';
import { effectManifests, normalizeEffects, resolveEffectValues, MAX_EFFECT_LAYERS } from '../src/shared/effects';
import { effectRegistry } from '../src/renderer/effects';

const ids = [
  'vhs-distortion', 'crt-monitor', 'analog-film', 'pixelate', 'ordered-dither', 'chromatic-aberration',
  'kaleidoscope', 'dream-blur', 'digital-glitch', 'lens-distortion', 'color-grade', 'vignette',
  'bloom', 'liquid-glass', 'halftone-print', 'datamosh-trails', 'palette-mapping',
];

describe('complete effect catalog metadata', () => {
  it('contains every requested effect while keeping VHS first and the eight-layer stack limit', () => {
    expect(Object.keys(effectManifests)).toEqual(ids);
    expect(Object.keys(effectManifests)).toHaveLength(17);
    expect(MAX_EFFECT_LAYERS).toBe(8);
  });

  it('registers a real source for every metadata entry, with no hidden or missing effects', () => {
    expect(Object.keys(effectRegistry).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(effectRegistry[id].id).toBe(id);
      expect(effectRegistry[id].uniforms).toBe(effectManifests[id].uniforms);
      expect(effectRegistry[id].source).toContain('void main');
      for (const pass of effectRegistry[id].passes ?? []) expect(pass).toContain('void main');
    }
    expect(effectRegistry.bloom.passes).toHaveLength(3);
    expect(effectRegistry['datamosh-trails'].history).toBe(true);
  });

  it.each(ids)('%s has usable controls, legal shader uniform names, and bounded defaults', id => {
    const manifest = effectManifests[id];
    expect(manifest.id).toBe(id);
    expect(manifest.title).toBeTruthy();
    expect(manifest.description).toBeTruthy();
    expect(manifest.uniforms[0].name).toBe('intensity');
    expect(new Set(manifest.uniforms.map(def => def.name)).size).toBe(manifest.uniforms.length);
    const defaults = resolveEffectValues(manifest);
    for (const def of manifest.uniforms) {
      expect(def.name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
      expect(def.label).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(defaults[def.name]).toEqual(def.default);
      if (def.type === 'float' || def.type === 'int') {
        expect(Number.isFinite(def.default)).toBe(true);
        expect(def.default).toBeGreaterThanOrEqual(def.min!);
        expect(def.default).toBeLessThanOrEqual(def.max!);
        expect(def.step).toBeGreaterThan(0);
        if (def.type === 'int') expect(Number.isInteger(def.default)).toBe(true);
      } else if (def.type === 'select') expect(def.options).toContain(def.default);
      else if (def.type === 'color') expect(def.default).toMatch(/^#[0-9a-f]{6}$/i);
      else if (def.type === 'bool') expect(typeof def.default).toBe('boolean');
    }
  });

  it.each(ids)('%s round-trips independently through config and defaults malformed values', id => {
    const manifest = effectManifests[id];
    const values = resolveEffectValues(manifest);
    const parsed = ConfigSchema.parse({ effects: { enabled: true, layers: [{ id: 'one', effectId: id, enabled: true, values }] } });
    expect(ConfigSchema.parse(JSON.parse(JSON.stringify(parsed))).effects).toEqual(parsed.effects);
    expect(parsed.effects.layers[0].values).toEqual(values);
    const damaged = Object.fromEntries(manifest.uniforms.map(def => [def.name, { invalid: true }]));
    expect(normalizeEffects({ layers: [{ id: 'damaged', effectId: id, values: damaged }] }).layers[0].values).toEqual(values);
  });

  it('persists typed parameters without changing visual or legacy VHS settings', () => {
    const config = ConfigSchema.parse({ shader: 'plasma', shaders: { plasma: { speed: 0.7 } }, effects: { layers: [
      { id: 'vhs', effectId: 'vhs-distortion', values: { grain: 0.37 } },
      { id: 'dots', effectId: 'halftone-print', values: { invert: true, dotSize: 7.7 } },
      { id: 'edge', effectId: 'vignette', values: { edgeColor: '#AbCdEf' } },
      { id: 'map', effectId: 'palette-mapping', values: { palette: 'Ocean' } },
      { id: 'trail', effectId: 'datamosh-trails', values: { mode: 'Datamosh' } },
    ] } });
    expect(config.shader).toBe('plasma');
    expect(config.shaders.plasma.speed).toBe(0.7);
    expect(config.effects.layers[0].values).toEqual({ intensity: 0.5, grain: 0.37, scanlines: 0.25, colorBleed: 0.2, tracking: 0.15 });
    expect(config.effects.layers[1].values).toMatchObject({ invert: true, dotSize: 8 });
    expect(config.effects.layers[2].values.edgeColor).toBe('#AbCdEf');
    expect(config.effects.layers[3].values.palette).toBe('Ocean');
    expect(config.effects.layers[4].values.mode).toBe('Datamosh');
  });

  it('normalizes out-of-range, invalid boolean, color, and palette values independently', () => {
    expect(resolveEffectValues(effectManifests['pixelate'], { pixelSize: -30, gridAspect: 99 })).toMatchObject({ pixelSize: 1, gridAspect: 4 });
    expect(resolveEffectValues(effectManifests['lens-distortion'], { distortion: -20, zoom: Infinity })).toMatchObject({ distortion: -1, zoom: 1 });
    expect(resolveEffectValues(effectManifests['vignette'], { edgeColor: 'red' }).edgeColor).toBe('#000000');
    expect(resolveEffectValues(effectManifests['halftone-print'], { invert: 'true' }).invert).toBe(false);
    expect(resolveEffectValues(effectManifests['palette-mapping'], { palette: 'invalid' }).palette).toBe('Neon');
  });
});

import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../src/shared/config';
import { EffectsSchema, effectManifests, MAX_EFFECT_LAYERS, normalizeEffects, resolveEffectValues } from '../src/shared/effects';

const vhs = (id = 'tape', values: Record<string, unknown> = {}) => ({ id, effectId: 'vhs-distortion', enabled: true, values });

describe('global effects configuration', () => {
  it('keeps old installations visually unchanged and gives each parse an independent stack', () => {
    const first = ConfigSchema.parse({ shader: 'plasma' });
    expect(first.effects).toEqual({ enabled: true, layers: [] });
    first.effects.layers.push(vhs() as never);
    expect(ConfigSchema.parse({}).effects.layers).toEqual([]);
  });

  it('round-trips ordered repeated instances, toggles and independent parameters', () => {
    const config = ConfigSchema.parse({ effects: { enabled: false, layers: [vhs('second', { intensity: 0.8 }), { ...vhs('first', { grain: 0 }), enabled: false }] } });
    const copy = ConfigSchema.parse(JSON.parse(JSON.stringify(config)));
    expect(copy.effects).toEqual(config.effects);
    expect(copy.effects.enabled).toBe(false);
    expect(copy.effects.layers.map(layer => layer.id)).toEqual(['second', 'first']);
    expect(copy.effects.layers[0].values.intensity).toBe(0.8);
    expect(copy.effects.layers[1].values.grain).toBe(0);
    expect(copy.effects.layers[1].enabled).toBe(false);
  });

  it.each([undefined, null, [], 'broken', 1, { layers: 'broken' }])('repairs a malformed effect section %j without resetting unrelated preferences', effects => {
    const config = ConfigSchema.parse({ shader: 'plasma', global: { fps: 30 }, shaders: { plasma: { speed: 0.7 } }, effects });
    expect(config.effects).toEqual({ enabled: true, layers: [] });
    expect(config.shader).toBe('plasma');
    expect(config.global.fps).toBe(30);
    expect(config.shaders.plasma.speed).toBe(0.7);
  });

  it('repairs damaged layers independently and preserves available good layers', () => {
    const result = EffectsSchema.parse({ enabled: 'bad', layers: [null, 1, [], {}, { effectId: '' }, { effectId: 'x'.repeat(101) }, vhs('ok'), { ...vhs('damaged'), enabled: 'bad', values: [] }] });
    expect(result.layers.map(layer => layer.id)).toEqual(['ok', 'damaged']);
    expect(result.enabled).toBe(true);
    expect(result.layers.every(layer => layer.enabled)).toBe(true);
    expect(result.layers[1].values).toEqual(resolveEffectValues(effectManifests['vhs-distortion']));
  });

  it('repairs missing and duplicate instance IDs deterministically and idempotently', () => {
    const result = normalizeEffects({ layers: [vhs('effect-2'), vhs('effect-2'), { effectId: 'vhs-distortion' }, vhs('effect-3')] });
    expect(new Set(result.layers.map(layer => layer.id)).size).toBe(4);
    expect(normalizeEffects(result)).toEqual(result);
    expect(normalizeEffects({ layers: [vhs('effect-2'), vhs('effect-2'), { effectId: 'vhs-distortion' }, vhs('effect-3')] })).toEqual(result);
  });

  it('caps valid layers at eight without letting invalid entries consume capacity', () => {
    const result = EffectsSchema.parse({ layers: [null, {}, ...Array.from({ length: 12 }, (_, i) => vhs(`tape-${i}`))] });
    expect(result.layers).toHaveLength(MAX_EFFECT_LAYERS);
    expect(result.layers.at(-1)?.id).toBe('tape-7');
  });

  it('defaults malformed known parameters and clamps finite numeric values', () => {
    const result = EffectsSchema.parse({ layers: [vhs('tape', { intensity: 4, grain: -1, scanlines: '0.6', colorBleed: NaN, tracking: Infinity })] });
    expect(result.layers[0].values).toEqual({ intensity: 1, grain: 0, scanlines: 0.25, colorBleed: 0.2, tracking: 0.15 });
    expect(resolveEffectValues(effectManifests['vhs-distortion'], { intensity: null, grain: false })).toMatchObject({ intensity: 0.5, grain: 0.2 });
  });

  it('preserves unknown effects and forward-compatible safe values', () => {
    const config = ConfigSchema.parse({ effects: { layers: [{ id: 'future', effectId: 'future-effect', enabled: false, values: { amount: 0.9, label: 'custom', flip: true, nested: {}, invalid: NaN } }, vhs('tape', { futureOption: 12 })] } });
    expect(config.effects.layers[0]).toEqual({ id: 'future', effectId: 'future-effect', enabled: false, values: { amount: 0.9, label: 'custom', flip: true } });
    expect(config.effects.layers[1].values.futureOption).toBe(12);
  });

  it('does not interpret inherited object names as built-in effect IDs', () => {
    for (const effectId of ['__proto__', 'constructor', 'toString']) {
      expect(EffectsSchema.parse({ layers: [{ id: effectId, effectId, values: { amount: 0.2 } }] }).layers[0].values).toEqual({ amount: 0.2 });
    }
  });

  it('normalizes all supported uniform metadata types', () => {
    const manifest = { id: 'fixture', title: 'Fixture', description: '', uniforms: [
      { name: 'count', type: 'int' as const, default: 2, min: 1, max: 5 },
      { name: 'on', type: 'bool' as const, default: true },
      { name: 'color', type: 'color' as const, default: '#123456' },
      { name: 'mode', type: 'select' as const, default: 'soft', options: ['soft', 'hard'] },
    ] };
    expect(resolveEffectValues(manifest, { count: 2.8, on: false, color: '#AbCdEf', mode: 'hard' })).toEqual({ count: 3, on: false, color: '#AbCdEf', mode: 'hard' });
    expect(resolveEffectValues(manifest, { count: 'invalid', on: 1, color: 'red', mode: 'nope' })).toEqual({ count: 2, on: true, color: '#123456', mode: 'soft' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createPointerDismiss, resolveShaderSelection, resolveShaderValues } from '../src/renderer/core/selection';
import type { Config } from '../src/shared/config';
import type { ShaderDefinition } from '../src/renderer/core/runtime';

const config = {
  shaders: { plasma: { speed: 2, color1: '#123456' }, drift: {} },
  presets: { plasma: { Bright: { speed: 3, color1: '#654321' } } },
  colors: { scheme: 'none', overrides: {} },
} as unknown as Config;

const manifest = {
  id: 'plasma', title: 'Plasma', fragment: 'shader.glsl',
  uniforms: [{ name: 'color1', type: 'color', default: '#000000' }, { name: 'speed', type: 'float', default: 1, min: 0, max: 3 }],
};
const registry = { plasma: { manifest, source: '' }, drift: { manifest: { ...manifest, id: 'drift', uniforms: [] }, source: '' } } as unknown as Record<string, ShaderDefinition>;

describe('renderer selection helpers', () => {
  it('prefers the requested shader, then the default, then the first registered', () => {
    expect(resolveShaderSelection(registry, 'drift')).toBe(registry.drift);
    expect(resolveShaderSelection(registry, 'missing')).toBe(registry.plasma);
    expect(resolveShaderSelection(registry, undefined)).toBe(registry.plasma);
    expect(resolveShaderSelection({ only: {} as never }, 'anything')).toEqual({});
  });

  it('resolves stored, preset and scheme-merged values', () => {
    expect(resolveShaderValues(config, registry, 'plasma')).toEqual({ speed: 2, color1: '#123456' });
    expect(resolveShaderValues(config, registry, 'plasma', 'Bright')).toEqual({ speed: 3, color1: '#654321' });
    expect(resolveShaderValues(config, registry, 'drift')).toEqual({});
    const unpaletted = resolveShaderValues(config, { ghost: undefined } as unknown as Record<string, ShaderDefinition>, 'plasma');
    expect(unpaletted).toEqual({ speed: 2, color1: '#123456' });
    const schemeConfig = { ...config, shaders: { plasma: { speed: 2 }, drift: {} }, colors: { scheme: 'dracula', overrides: {} } } as unknown as Config;
    expect(resolveShaderValues(schemeConfig, registry, 'plasma').color1).toBe('#bd93f9');
    expect(resolveShaderValues(schemeConfig, registry, 'plasma').speed).toBe(2);
  });

  it('dismisses once the pointer passes the threshold', () => {
    const dismiss = vi.fn();
    const handler = createPointerDismiss(dismiss);
    handler({ screenX: 10, screenY: 10 });
    expect(dismiss).not.toHaveBeenCalled();
    handler({ screenX: 14, screenY: 18 });
    expect(dismiss).not.toHaveBeenCalled();
    handler({ screenX: 40, screenY: 10 });
    expect(dismiss).toHaveBeenCalledTimes(1);
    const sensitive = createPointerDismiss(dismiss, 1);
    sensitive({ screenX: 0, screenY: 0 });
    sensitive({ screenX: 5, screenY: 0 });
    expect(dismiss).toHaveBeenCalledTimes(2);
  });
});

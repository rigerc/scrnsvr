// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mountSettings } from '../src/settings/index';
import { mountShader, mountShaderThumbnail } from '../src/renderer/core/runtime';
import { shaderRegistry } from '../src/renderer/shaders';
import type { Config } from '../src/shared/config';
import type { EffectRuntimeOptions } from '../src/shared/effects';

vi.mock('../src/settings/index', () => ({ mountSettings: vi.fn() }));
vi.mock('../src/renderer/core/runtime', () => ({ mountShader: vi.fn(() => vi.fn()), mountShaderThumbnail: vi.fn(() => vi.fn()) }));
vi.mock('../src/renderer/shaders', () => ({ shaderRegistry: { plasma: { manifest: { id: 'plasma', title: 'Plasma', uniforms: [] }, source: 'shader' } } }));
vi.mock('../src/settings/preview-controls', () => ({ mountPreviewControls: vi.fn(() => vi.fn()) }));
vi.mock('../src/settings/discovery', () => ({ mountDiscovery: vi.fn(() => vi.fn()) }));

afterEach(() => { vi.unstubAllGlobals(); });

it('forwards mutable effects options to mountShader argument six, but not thumbnail mounts', async () => {
  document.body.innerHTML = '<div id="settings"></div>';
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  const initial = { customShaders: [], effects: { enabled: true, layers: [] } } as unknown as Config;
  vi.stubGlobal('scrnsvr', { getConfig: vi.fn(async () => initial) });
  await import('../src/settings/bootstrap');
  await vi.waitFor(() => expect(mountSettings).toHaveBeenCalledTimes(1));
  const preview = vi.mocked(mountSettings).mock.calls[0][0].preview!;
  const canvas = document.createElement('canvas');
  const definition = shaderRegistry.plasma;
  const values = { speed: 1 };
  const options: EffectRuntimeOptions = { effects: initial.effects, onEffectStatus: vi.fn() };
  preview.mount(canvas, definition.manifest, values, options);
  expect(mountShader).toHaveBeenCalledWith(canvas, definition, values, 30, expect.objectContaining({ paused: false }), options);
  expect(vi.mocked(mountShader).mock.calls[0][5]).toBe(options);
  preview.mountThumbnail!(canvas, definition.manifest, values);
  expect(mountShaderThumbnail).toHaveBeenCalledWith(canvas, definition, values, expect.objectContaining({ paused: false }));
  expect(vi.mocked(mountShaderThumbnail).mock.calls[0]).toHaveLength(4);
});

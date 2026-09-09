import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadNoctaliaColors, noctaliaColorsPath } from '../src/main/noctalia';
import { noctaliaShaderValues, parseNoctaliaPalette } from '../src/shared/noctalia';
import { gradientBlobsManifest } from '../src/renderer/shaders/gradient-blobs/manifest';
import { gradientDriftManifest } from '../src/renderer/shaders/gradient-drift/manifest';
import { meshGradientManifest } from '../src/renderer/shaders/mesh-gradient/manifest';
import { flowFieldManifest } from '../src/renderer/shaders/flow-field/manifest';
import { plasmaManifest } from '../src/renderer/shaders/plasma/manifest';

const palette = {
  mPrimary: '#ebbcba', mSecondary: '#9ccfd8', mTertiary: '#31748f',
  mSurface: '#191724', mOnSurface: '#e0def4',
};
let directory: string | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function fixture(source?: string) {
  directory = await mkdtemp(path.join(tmpdir(), 'scrnsvr-noctalia-'));
  vi.stubEnv('XDG_CONFIG_HOME', directory);
  await mkdir(path.join(directory, 'noctalia'));
  if (source !== undefined) await writeFile(noctaliaColorsPath(), source);
}

describe('Noctalia color import', () => {
  it('uses the normal config directory when XDG_CONFIG_HOME is unset', () => {
    vi.stubEnv('XDG_CONFIG_HOME', '');
    expect(noctaliaColorsPath()).toBe(path.join(homedir(), '.config/noctalia/colors.json'));
  });

  it('reads the current XDG palette each time without modifying Noctalia', async () => {
    await fixture(JSON.stringify(palette));
    expect(await loadNoctaliaColors()).toEqual({ ok: true, palette, path: noctaliaColorsPath() });
    const updated = JSON.stringify({ ...palette, mPrimary: '#123456' });
    await writeFile(noctaliaColorsPath(), updated);
    expect(await loadNoctaliaColors()).toMatchObject({ ok: true, palette: { mPrimary: '#123456' } });
    expect(await readFile(noctaliaColorsPath(), 'utf8')).toBe(updated);
  });

  it('reports missing files and malformed JSON without returning partial colors', async () => {
    await fixture();
    expect(await loadNoctaliaColors()).toMatchObject({ ok: false, error: expect.stringContaining('not found') });
    await writeFile(noctaliaColorsPath(), '{');
    expect(await loadNoctaliaColors()).toMatchObject({ ok: false, error: expect.stringContaining('not valid JSON') });
    await writeFile(noctaliaColorsPath(), JSON.stringify({ ...palette, mPrimary: 'red' }));
    expect(await loadNoctaliaColors()).toMatchObject({ ok: false, error: expect.stringContaining('mPrimary') });
  });

  it('normalizes shorthand and uppercase colors and ignores unrelated roles', () => {
    expect(parseNoctaliaPalette({ ...palette, mPrimary: '#AbC', mError: '#ffffff' }))
      .toEqual({ ...palette, mPrimary: '#aabbcc' });
  });

  it('rejects unsupported structures and invalid or missing color roles', () => {
    for (const value of [null, [], 'colors', { dark: palette }, { ...palette, mSurface: undefined }, { ...palette, mPrimary: '#12345g' }]) {
      expect(() => parseNoctaliaPalette(value)).toThrow();
    }
  });

  it('maps accent and background roles without changing motion controls', () => {
    expect(noctaliaShaderValues(gradientBlobsManifest, palette)).toEqual({
      color1: palette.mPrimary, color2: palette.mSecondary, color3: palette.mTertiary, background: palette.mSurface,
    });
    expect(noctaliaShaderValues(gradientDriftManifest, palette)).toEqual({
      shadow: palette.mSurface, midtone: palette.mPrimary, highlight: palette.mOnSurface,
    });
    expect(noctaliaShaderValues(meshGradientManifest, palette)).toEqual({
      color1: palette.mPrimary, color2: palette.mSecondary, color3: palette.mTertiary, color4: palette.mOnSurface,
    });
  });

  it('selects a color-aware palette for Flow Field and Plasma', () => {
    expect(noctaliaShaderValues(flowFieldManifest, palette)).toEqual({
      color: palette.mPrimary, color2: palette.mSecondary, background: palette.mSurface, palette: 'aurora',
    });
    expect(noctaliaShaderValues(plasmaManifest, palette)).toEqual({
      color1: palette.mPrimary, color2: palette.mSecondary, color3: palette.mTertiary, palette: 'custom',
    });
  });
});

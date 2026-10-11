import { build } from 'esbuild';
import { expect, it } from 'vitest';

it('bundles shared configuration and browser entrypoints without Node or Electron dependencies', async () => {
  const result = await build({
    entryPoints: ['src/shared/config.ts', 'src/renderer/index.ts', 'src/settings/bootstrap.ts'],
    outdir: 'dist',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    loader: { '.glsl': 'text' },
    write: false,
    metafile: true,
  });
  expect(result.outputFiles).toHaveLength(3);
  expect(Object.keys(result.metafile.inputs).filter(file => /^src\/(main|preload)\//.test(file))).toEqual([]);
  expect(Object.values(result.metafile.outputs).flatMap(output => output.imports)).toEqual([]);
});

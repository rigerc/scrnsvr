import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const palettes = spawnSync(process.execPath, ['scripts/generate-palettes.mjs'], { stdio: 'inherit' });
if (palettes.status !== 0) process.exit(palettes.status ?? 1);
const generated = spawnSync(process.execPath, ['scripts/generate-shader-registry.mjs'], { stdio: 'inherit' });
if (generated.status !== 0) process.exit(generated.status ?? 1);
await mkdir('dist', { recursive:true });
// `src/shared/gpu-flags.ts` is a second entry so the check scripts can require
// the shared software-GL switch list from `dist/shared/gpu-flags.js`.
await build({entryPoints:['src/main/index.ts','src/preload/index.ts','src/shared/gpu-flags.ts'],outdir:'dist',bundle:true,platform:'node',format:'cjs',sourcemap:true,external:['electron'],loader:{'.glsl':'text'},logLevel:'info'});
await build({entryPoints:['src/renderer/index.ts','src/settings/bootstrap.ts'],outdir:'dist',bundle:true,platform:'browser',format:'iife',sourcemap:true,loader:{'.glsl':'text'},logLevel:'info'});
await cp('src/renderer/index.html','dist/renderer/index.html');
await cp('src/renderer/clock.css','dist/renderer/clock.css');
await cp('src/settings/index.html','dist/settings/index.html');
await cp('src/settings/settings.css','dist/settings/settings.css');
await cp('src/settings/fonts','dist/settings/fonts',{recursive:true});
await cp('assets/plates','dist/plates',{recursive:true});

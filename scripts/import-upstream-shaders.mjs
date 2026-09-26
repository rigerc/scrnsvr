import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adapt, manifestSource } from './lib/upstream-adapt.mjs';

const root = path.resolve('src/renderer/shaders');
const argv = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));

if (!argv.avs || !argv.shaderSaver) {
  console.error('Usage: node scripts/import-upstream-shaders.mjs --avs /path/to/AVS --shaderSaver /path/to/ShaderSaver');
  process.exit(1);
}

const imports = [
  { collection: 'AVS', base: argv.avs, file: '7seg.glsl', id: 'avs-seven-segment', category: 'Clocks', title: 'Seven-Segment Clock' },
  { collection: 'AVS', base: argv.avs, file: 'alienwater.glsl', id: 'avs-alien-waterworld', category: 'Landscapes', title: 'Alien Waterworld' },
  { collection: 'AVS', base: argv.avs, file: 'cloud.glsl', id: 'avs-clouds', category: 'Landscapes', title: 'Cloudscape' },
  { collection: 'AVS', base: argv.avs, file: 'field.glsl', id: 'avs-field', category: 'Landscapes', title: 'Sunlit Field' },
  { collection: 'AVS', base: argv.avs, file: 'fractal.glsl', id: 'avs-fractal', category: 'Abstract', title: 'Fractal Fold' },
  { collection: 'AVS', base: argv.avs, file: 'galaxy.glsl', id: 'avs-galaxy', category: 'Space', title: 'Galaxy' },
  { collection: 'AVS', base: argv.avs, file: 'glowclock.glsl', id: 'avs-glow-clock', category: 'Clocks', title: 'Glow Clock' },
  { collection: 'AVS', base: argv.avs, file: 'greenclock.glsl', id: 'avs-green-clock', category: 'Clocks', title: 'Green Clock' },
  { collection: 'AVS', base: argv.avs, file: 'matrix.glsl', id: 'avs-matrix', category: 'Digital', title: 'Digital Rain' },
  { collection: 'AVS', base: argv.avs, file: 'ocean.glsl', id: 'avs-ocean', category: 'Water', title: 'Emerald Ocean' },
  { collection: 'AVS', base: argv.avs, file: 'ripple.glsl', id: 'avs-ripple', category: 'Abstract', title: 'Chromatic Ripple' },
  { collection: 'AVS', base: argv.avs, file: 'sea.glsl', id: 'avs-sea', category: 'Water', title: 'Sea' },
  { collection: 'AVS', base: argv.avs, file: 'seascape.glsl', id: 'avs-seascape', category: 'Water', title: 'Seascape' },
  { collection: 'AVS', base: argv.avs, file: 'sinus.glsl', id: 'avs-sinus', category: 'Abstract', title: 'Sinus' },
  { collection: 'AVS', base: argv.avs, file: 'stardust.glsl', id: 'avs-stardust', category: 'Space', title: 'Star Dust' },
  { collection: 'AVS', base: argv.avs, file: 'terrain.glsl', id: 'avs-terrain', category: 'Landscapes', title: 'Mountain Terrain' },
  { collection: 'AVS', base: argv.avs, file: 'tunnelwisp.glsl', id: 'avs-tunnel-wisp', category: 'Digital', title: 'Tunnel Wisp' },
  { collection: 'AVS', base: argv.avs, file: 'waves.glsl', id: 'avs-waves', category: 'Abstract', title: 'Waves' },
  { collection: 'ShaderSaver', base: argv.shaderSaver, file: 'shader.txt', id: 'shadersaver-singularity', category: 'Space', title: 'Singularity' },
  { collection: 'ShaderSaver', base: argv.shaderSaver, file: 'shader2.txt', id: 'shadersaver-sunset', category: 'Landscapes', title: 'Sunset' },
  { collection: 'ShaderSaver', base: argv.shaderSaver, file: 'shader3.txt', id: 'shadersaver-starship', category: 'Space', title: 'Starship' },
  { collection: 'ShaderSaver', base: argv.shaderSaver, file: 'shader4.txt', id: 'shadersaver-origami', category: 'Abstract', title: 'Origami' },
  { collection: 'ShaderSaver', base: argv.shaderSaver, file: 'shader5.txt', id: 'shadersaver-shield', category: 'Digital', title: 'Shield' },
  { collection: 'ShaderSaver', base: argv.shaderSaver, file: 'shader6.txt', id: 'shadersaver-ghosts', category: 'Abstract', title: 'Ghosts' },
  { collection: 'ShaderSaver', base: argv.shaderSaver, file: 'shader7.txt', id: 'shadersaver-waveform', category: 'Abstract', title: 'Waveform' },
  { collection: 'ShaderSaver', base: argv.shaderSaver, file: 'shader8.txt', id: 'shadersaver-water-ripples', category: 'Water', title: 'Water Ripples' },
  { collection: 'ShaderSaver', base: argv.shaderSaver, file: 'shader9.txt', id: 'shadersaver-simplex', category: 'Abstract', title: 'Simplex' },
  { collection: 'ShaderSaver', base: argv.shaderSaver, file: 'shader13.txt', id: 'shadersaver-rainbow-road', category: 'Digital', title: 'Rainbow Road' },
];

for (const item of imports) {
  const source = await readFile(path.join(item.base, item.file), 'utf8');
  const destination = path.join(root, item.id);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, 'shader.glsl'), adapt(source, item), 'utf8');
  await writeFile(path.join(destination, 'manifest.ts'), manifestSource(item), 'utf8');
}

console.log(`Imported ${imports.length} shaders.`);

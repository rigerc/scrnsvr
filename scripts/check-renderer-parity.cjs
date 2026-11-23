// Pixel parity between two native renderer builds (C++ and Rust), on the same GPU driver.
// Each scene plan, exactly as the main process builds it, is captured headless by both binaries
// with identical size, frame count and frame delta, then compared pixel by pixel.
//
//   node scripts/check-renderer-parity.cjs [--cpp BIN] [--rust BIN] [--size 320x180] [--frames 30] [--keep DIR]
//
// Defaults: --cpp dist/native/scrnsvr-renderer (build with `npm run build`),
//           --rust target/release/scrnsvr-renderer (build with `cargo build --release`).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { bundleModule } = require('./lib/electron-harness.cjs');

const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
};
const binaries = { cpp: path.resolve(arg('--cpp', path.join(root, 'dist/native/scrnsvr-renderer'))), rust: path.resolve(arg('--rust', path.join(root, 'target/release/scrnsvr-renderer'))) };
const size = arg('--size', '320x180');
const frames = arg('--frames', '30');
// Channel differences up to this are rounding, not behavior.
const tolerance = Number(arg('--tolerance', '2'));
const keep = arg('--keep');
for (const [name, binary] of Object.entries(binaries)) if (!fs.existsSync(binary)) throw new Error(`Missing ${name} renderer ${binary}`);
const probe = Object.fromEntries(Object.entries(binaries).map(([name, binary]) => [name, spawnSync(binary, ['--capture', '/dev/null'], { input: '' }).stderr.toString()]));
// Both report "No scene to capture"; an unknown-option error means a build without --capture.
for (const [name, stderr] of Object.entries(probe)) if (!stderr.includes('No scene to capture')) throw new Error(`${name} renderer does not support --capture: ${stderr.trim()}`);

const scenes = bundleModule('scripts/lib/native-scenes.ts');
const plan = (config, shaderId) => scenes.buildScenePlan(config, { shaderId }, scenes.shaderRegistry, scenes.effectRegistry);
const base = scenes.ConfigSchema.parse({ clock: { enabled: false } });
const cases = Object.keys(scenes.shaderRegistry).sort().map(shaderId => {
  const scene = plan(base, shaderId);
  // Reactive shaders get a fixed envelope so audio smoothing is exercised.
  return { name: shaderId, messages: [scene, ...(scene.shader.audio ? [{ type: 'audio', value: [0.6, 0.8, 0.4, 0.3] }] : [])] };
});
const effects = Object.keys(scenes.effectRegistry);
for (const effectId of effects) {
  const config = scenes.ConfigSchema.parse({ clock: { enabled: false }, effects: { enabled: true, layers: [{ id: 'layer', effectId, enabled: true, values: {} }] } });
  cases.push({ name: `effect:${effectId}`, messages: [plan(config, 'aurora-veil')] });
}
const stacked = scenes.ConfigSchema.parse({ clock: { enabled: false }, effects: { enabled: true, layers: ['bloom', 'datamosh-trails', 'chromatic-aberration', 'vignette'].map(effectId => ({ id: effectId, effectId, enabled: true, values: {} })) } });
cases.push({ name: 'effects:stacked', messages: [plan(stacked, 'plasma')] });
const clocked = scenes.ConfigSchema.parse({ clock: { enabled: true, showDate: true, position: 'bottom-right', shadow: true } });
cases.push({ name: 'clock', messages: [plan(clocked, 'gradient-drift'), scenes.clockMessage(clocked.clock, new Date('2026-11-14T09:05:00'))] });

const directory = keep ? path.resolve(keep) : fs.mkdtempSync(path.join(os.tmpdir(), 'scrnsvr-parity-'));
fs.mkdirSync(directory, { recursive: true });

function readPam(file) {
  const data = fs.readFileSync(file);
  const end = data.indexOf('ENDHDR\n');
  const header = data.subarray(0, end).toString();
  const width = Number(/WIDTH (\d+)/.exec(header)[1]);
  const height = Number(/HEIGHT (\d+)/.exec(header)[1]);
  return { width, height, pixels: data.subarray(end + 7) };
}

function capture(name, binary, messages, file) {
  const result = spawnSync(binary, ['--capture', file, '--size', size, '--frames', frames, '--delta', String(1000 / 30)], { input: messages.map(message => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${name} exited ${result.status}: ${result.stderr.trim()}`);
  return readPam(file);
}

const failures = [];
let identical = 0;
for (const test of cases) {
  const slug = test.name.replace(/[^a-z0-9-]+/gi, '_');
  const [cpp, rust] = ['cpp', 'rust'].map(name => capture(`${test.name} (${name})`, binaries[name], test.messages, path.join(directory, `${slug}.${name}.pam`)));
  assert.equal(cpp.pixels.length, rust.pixels.length, `${test.name}: frame sizes differ`);
  let max = 0, over = 0;
  for (let index = 0; index < cpp.pixels.length; index += 1) {
    const difference = Math.abs(cpp.pixels[index] - rust.pixels[index]);
    if (difference > max) max = difference;
    if (difference > tolerance) over += 1;
  }
  if (max === 0) identical += 1;
  const share = over / cpp.pixels.length;
  const line = `${test.name.padEnd(32)} max ${String(max).padStart(3)}  over ${(share * 100).toFixed(3)}%`;
  if (share > 0) { failures.push(line); console.error(line); } else if (process.argv.includes('--verbose')) console.log(line);
}
console.log(`${cases.length} scenes captured at ${size} after ${frames} frames: ${identical} identical, ${cases.length - failures.length - identical} within ±${tolerance}, ${failures.length} different`);
if (!keep) fs.rmSync(directory, { recursive: true, force: true });
else console.log(`Captures kept in ${directory}`);
if (failures.length) process.exit(1);

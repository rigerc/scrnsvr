// Exports the scene plans and clock messages the main process sends the native renderer,
// as Rust fixtures, along with the language-neutral catalog used by the native app.
// Re-run after changing shaders, effects, or the plan format: node scripts/export-rust-fixtures.cjs
const fs = require('node:fs');
const path = require('node:path');
const { bundleModule } = require('./lib/electron-harness.cjs');

// Use the same English clock text and UTC on every host.
if (Intl.DateTimeFormat().resolvedOptions().locale !== 'en-US') {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, LC_ALL: 'C.UTF-8' }, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
process.env.TZ = 'UTC';

const scenes = bundleModule('scripts/lib/native-scenes.ts');
const effects = Object.keys(scenes.effectRegistry).map(effectId => ({ id: `layer-${effectId}`, effectId, enabled: true, values: {} }));
const config = scenes.ConfigSchema.parse({ clock: { enabled: true, showDate: true }, effects: { enabled: true, layers: [] } });
const lines = Object.keys(scenes.shaderRegistry).sort().map(shaderId => scenes.buildScenePlan(config, { shaderId }, scenes.shaderRegistry, scenes.effectRegistry));
// Every effect once, in catalog order, on one scene (the layer cap applies per plan).
for (let start = 0; start < effects.length; start += 4) {
  const layered = scenes.ConfigSchema.parse({ effects: { enabled: true, layers: effects.slice(start, start + 4) } });
  lines.push(scenes.buildScenePlan(layered, { shaderId: 'plasma' }, scenes.shaderRegistry, scenes.effectRegistry));
}
lines.push(scenes.clockMessage(config.clock, new Date('2026-11-14T09:05:00Z')));
const target = path.resolve(__dirname, '../crates/scrnsvr-core/tests/fixtures/messages.jsonl');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, lines.map(line => JSON.stringify(line)).join('\n') + '\n');
console.log(`Wrote ${lines.length} messages to ${path.relative(process.cwd(), target)}`);

// Raw GLSL and full metadata, with no resolved defaults baked into the catalog.
const catalog = {
  shaders: Object.keys(scenes.shaderRegistry).sort().map(id => {
    const { manifest, source, animationTime } = scenes.shaderRegistry[id];
    return { ...manifest, source, animationTime };
  }),
  effects: Object.values(scenes.effectRegistry),
  palettes: scenes.palettes,
  colorFamilies: scenes.colorFamilies,
};
const assets = path.resolve(__dirname, '../data/catalog.json');
fs.mkdirSync(path.dirname(assets), { recursive: true });
fs.writeFileSync(assets, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Wrote ${catalog.shaders.length} shaders, ${catalog.effects.length} effects and ${catalog.palettes.length} palettes to ${path.relative(process.cwd(), assets)}`);

// Paired raw input and output. Rust validates the input through its own TOML
// loader and then resolves the plan independently of the reference message.
const cases = [];
function scene(name, settings, selection = { launch: {} }) {
  const config = scenes.ConfigSchema.parse(settings);
  const registry = scenes.withCustomShaders(scenes.shaderRegistry, config.customShaders);
  let target = selection.target;
  if (selection.launch) {
    const { override, preview = false, random = 0 } = selection.launch;
    const saved = Math.random;
    try {
      Math.random = () => random;
      target = scenes.resolveRendererTarget(config, override, preview, registry);
    } finally {
      Math.random = saved;
    }
  } else if (selection.cycle) {
    const { random, exclude } = selection.cycle;
    target = scenes.pickRotationEntry(config.rotation, config.shaders, config.presets, Object.keys(registry), () => random, exclude);
  }
  const fixture = { name, settings, ...selection };
  if (!target) {
    fixture.expected = null;
  } else {
    try {
      fixture.expected = scenes.buildScenePlan(config, target, registry, scenes.effectRegistry);
    } catch (error) {
      if (error.message !== `Unknown shader ${target.shaderId}`) throw error;
      fixture.error = error.message;
    }
  }
  cases.push(fixture);
}

function editedUniform(def, index) {
  if (def.type === 'bool') return !def.default;
  if (def.type === 'color') return '#A1b2C3';
  if (def.type === 'select') return def.options.find(value => value !== def.default) ?? def.default;
  const min = def.min ?? 0;
  const max = def.max ?? 10;
  if (index % 3 === 0) return max + 10; // clamp
  if (index % 3 === 1) return String(min + (max - min) * 0.35); // numeric string
  return min + (max - min) * 0.65; // integer rounding, no float step snapping
}

for (const { id, uniforms } of catalog.shaders) {
  scene(`default/${id}`, { shader: id });
  const values = Object.fromEntries(uniforms.map((def, index) => [def.name, editedUniform(def, index)]));
  scene(`edits/${id}`, { shader: id, shaders: { [id]: values } });
}
scene('default-settings', {});
scene('invalid-uniforms', { shader: 'plasma', shaders: { plasma: { speed: 'junk', scale: true, color1: '#xxxyyy', palette: 'bad' } } });
scene('numeric-bases', { shader: 'plasma', shaders: { plasma: { direction: '0x1A', scale: '0b11', contrast: '0o2' } } });
for (const palette of catalog.palettes) {
  scene(`scheme/${palette.id}`, { shader: 'plasma', colors: { scheme: palette.id } });
}
scene('scheme-flow-field', { colors: { scheme: 'nord' } });
for (const { id } of catalog.shaders.filter(shader => shader.schemePalette)) {
  scene(`scheme-palette-mode/${id}`, { shader: id, colors: { scheme: 'nord' } });
}
scene('scheme-override', { shader: 'plasma', colors: { scheme: 'nord', overrides: { plasma: 'dracula' } } });
scene('scheme-opt-out', { shader: 'plasma', colors: { scheme: 'nord', overrides: { plasma: 'none' } } });
scene('scheme-inherit', { shader: 'plasma', colors: { scheme: 'nord', overrides: { plasma: '' } } });
scene('scheme-unknown-override', { shader: 'plasma', colors: { scheme: 'nord', overrides: { plasma: 'missing' } } });
const presets = { plasma: { Evening: { speed: 0.25, color1: '#1122ff' }, Empty: {} } };
const looks = { shader: 'plasma', presets, shaders: { plasma: { speed: 0.1, scale: 3, color2: '#ff0000' } }, colors: { scheme: 'nord' } };
for (const preset of ['Evening', 'Empty', 'Removed']) {
  scene(`preset/${preset}`, looks, { target: { shaderId: 'plasma', preset } });
}

const customShaders = [
  { id: 'custom-image', title: '  Image  ', source: ' // #version 300 es\n precision mediump float;\nuniform highp vec3 iResolution;\n/* sampler2D test */ void mainImage (out vec4 c,in vec2 p){c=vec4(iTime, iMouse.x, iDate.w, 1.);}\n' },
  { id: 'custom-raw', title: 'Raw', source: 'uniform vec2 uResolution;\nvoid\tmain (){gl_FragColor=vec4(gl_FragCoord.xy/uResolution,uTime,1.);}' },
  { id: 'custom-broken', title: 'Broken', source: 'uniform sampler2D tex;\nvoid main(){}' },
];
for (const shader of customShaders) {
  scene(shader.id, { customShaders }, { target: { shaderId: shader.id } });
}
scene('unknown-shader', {}, { target: { shaderId: 'missing-shader' } });

for (let start = 0; start < effects.length; start += 4) {
  scene(`effect-catalog/${start / 4 + 1}`, { effects: { layers: effects.slice(start, start + 4) } });
}
const mixed = [
  { id: 'duplicate', effectId: 'bloom', values: { intensity: 2 } },
  { id: 'duplicate', effectId: 'datamosh-trails', values: { mode: 'Datamosh', intensity: 0.6 } },
  { id: 'unavailable', effectId: 'removed-effect', values: { intensity: 0.9 } },
  { id: 'disabled', effectId: 'vignette', enabled: false },
  { id: 'zero', effectId: 'pixelate', values: { intensity: 0 } },
  { effectId: 'halftone-print', values: { invert: true } },
  { effectId: 'palette-mapping', values: { palette: 'Ocean', intensity: '0.3' } },
  { effectId: 'liquid-glass', values: { edgeColor: '#c0ffee' } },
  { id: 'over-limit', effectId: 'analog-film' },
];
scene('effect-stack', { shader: 'plasma', effects: { layers: mixed } });
scene('effects-off', { shader: 'plasma', effects: { enabled: false, layers: mixed } });
scene('unavailable-effect', { effects: { layers: [mixed[2]] } });

const rotation = { enabled: true, intervalMinutes: 4, entries: [
  { shader: 'missing-shader' }, { shader: 'plasma', preset: 'Removed' }, { shader: 'plasma', preset: 'Evening' },
  { shader: 'custom-broken' }, { shader: 'custom-raw' }, { shader: 'plasma' },
] };
const shuffle = { ...looks, shader: 'flow-field', customShaders, rotation };
scene('rotation-start-preset', shuffle);
scene('rotation-start-custom', shuffle, { launch: { random: 0.5 } });
scene('rotation-start-current-edits', shuffle, { launch: { random: 0.99 } });
scene('rotation-preview', shuffle, { launch: { preview: true } });
scene('rotation-override', shuffle, { launch: { override: 'custom-image' } });
scene('rotation-unknown-override', shuffle, { launch: { override: 'missing-shader' } });
scene('rotation-cycle', shuffle, { cycle: { random: 0, exclude: 'plasma/Evening' } });
scene('rotation-only-current', { ...shuffle, rotation: { ...rotation, entries: [{ shader: 'plasma', preset: 'Evening' }] } },
  { cycle: { random: 0.5, exclude: 'plasma/Evening' } });
scene('rotation-all-stale', { ...shuffle, rotation: { ...rotation, entries: rotation.entries.slice(0, 2) } }, { cycle: { random: 0.5 } });
scene('rotation-disabled', { ...shuffle, rotation: { ...rotation, enabled: false } });

for (const [name, clock, now] of [
  ['default', {}, '2026-11-14T09:05:00Z'],
  ['midnight', { position: 'bottom-right', font: 'serif', weight: 900 }, '2026-11-14T00:03:14Z'],
  ['noon', { format: '12h', showSeconds: true, font: 'rounded', shadow: false }, '2026-11-14T12:03:14Z'],
  ['am', { format: '12h', showDate: false, font: 'monospace', color: '#09ff55' }, '2026-11-14T09:05:01Z'],
  ['disabled', { enabled: false, font: 'custom', customFont: ' ', size: 2 }, '2026-11-14T16:25:33Z'],
  ['custom-font', { font: 'custom', customFont: '  A,B; C  ', margin: 20, opacity: 0.1 }, '2026-11-14T16:25:33Z'],
]) {
  const settings = { clock };
  cases.push({ name: `clock/${name}`, settings, now, expected: scenes.clockMessage(scenes.ConfigSchema.parse(settings).clock, new Date(now)) });
}

const parity = path.join(path.dirname(target), 'scene-parity.jsonl');
fs.writeFileSync(parity, cases.map(test => JSON.stringify(test)).join('\n') + '\n');
console.log(`Wrote ${cases.length} resolution cases to ${path.relative(process.cwd(), parity)}`);

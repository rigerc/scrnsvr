// Exports the scene plans and clock messages the main process sends the native renderer,
// as fixtures for the Rust protocol tests (crates/scrnsvr-core/tests/fixtures), and the
// shader manifests with their default plans for the settings spike (crates/scrnsvr-settings/data).
// Re-run after changing shaders, effects, or the plan format: node scripts/export-rust-fixtures.cjs
const fs = require('node:fs');
const path = require('node:path');
const { bundleModule } = require('./lib/electron-harness.cjs');

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

// Settings spike data: manifest controls plus the default plan, until manifests become shared data (milestone 3).
const preview = scenes.ConfigSchema.parse({ clock: { enabled: false } });
const catalog = Object.keys(scenes.shaderRegistry).sort().map(id => {
  const { manifest } = scenes.shaderRegistry[id];
  return { id, title: manifest.title, category: manifest.category ?? 'Ambient', uniforms: manifest.uniforms, plan: scenes.buildScenePlan(preview, { shaderId: id }, scenes.shaderRegistry, scenes.effectRegistry) };
});
const settings = path.resolve(__dirname, '../crates/scrnsvr-settings/data/shaders.json');
fs.mkdirSync(path.dirname(settings), { recursive: true });
fs.writeFileSync(settings, JSON.stringify(catalog) + '\n');
console.log(`Wrote ${catalog.length} shaders to ${path.relative(process.cwd(), settings)}`);

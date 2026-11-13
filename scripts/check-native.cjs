// Native renderer checks.
//   (default)  Compile every built-in shader and effect with the native GLES compiler.
//   --live     Also map the screensaver on the primary output for a few seconds: checks the
//              first frame is transparent, the scene fades in over the desktop, transitions swap
//              scenes behind black, a broken scene is skipped, and dismissal exits cleanly.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { bundleModule } = require('./lib/electron-harness.cjs');

const root = path.resolve(__dirname, '..');
const binary = path.join(root, 'dist/native/scrnsvr-renderer');
if (!fs.existsSync(binary)) throw new Error('Missing dist/native/scrnsvr-renderer — run `npm run build` first.');
const scenes = bundleModule('scripts/lib/native-scenes.ts');

function compileAll() {
  const config = scenes.ConfigSchema.parse({});
  const items = Object.keys(scenes.shaderRegistry).map(id => ({ id: `shader:${id}`, source: scenes.buildScenePlan(config, { shaderId: id }, scenes.shaderRegistry, scenes.effectRegistry).shader.source }));
  for (const [id, effect] of Object.entries(scenes.effectRegistry)) {
    [...(effect.passes ?? []), effect.source].forEach((source, pass) => items.push({ id: `effect:${id}#${pass}`, source }));
  }
  const result = spawnSync(binary, ['--compile-check'], { input: items.map(item => JSON.stringify(item)).join('\n') + '\n', encoding: 'utf8' });
  const reports = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const failures = reports.filter(report => !report.ok);
  for (const failure of failures) console.error(`${failure.id}: ${failure.error}`);
  assert.equal(reports.length, items.length, `Compile check stopped early: ${result.stderr}`);
  assert.equal(failures.length, 0, `${failures.length} programs failed to compile natively`);
  console.log(`Compiled ${items.length} shader and effect programs natively`);
}

/** Average color of a small square at the output's center, from the composited screen. */
function sample(output) {
  const size = 8;
  const ppm = execFileSync('grim', ['-t', 'ppm', '-g', `${output.x + Math.floor(output.width / 2)},${output.y + Math.floor(output.height / 2)} ${size}x${size}`, '-']);
  let offset = 0, fields = [];
  while (fields.length < 4) {
    while (/\s/.test(String.fromCharCode(ppm[offset]))) offset++;
    let token = '';
    while (!/\s/.test(String.fromCharCode(ppm[offset]))) token += String.fromCharCode(ppm[offset++]);
    fields.push(token);
  }
  offset++;
  const pixels = ppm.subarray(offset);
  const sum = [0, 0, 0];
  for (let i = 0; i < pixels.length; i += 3) for (let c = 0; c < 3; c++) sum[c] += pixels[i + c];
  return sum.map(value => value / (pixels.length / 3));
}

async function live() {
  const monitors = JSON.parse(execFileSync('hyprctl', ['-j', 'monitors'], { encoding: 'utf8' }));
  const monitor = monitors.find(entry => entry.focused) ?? monitors[0];
  const output = { name: monitor.name, x: monitor.x, y: monitor.y, width: Math.round(monitor.width / monitor.scale), height: Math.round(monitor.height / monitor.scale) };
  const config = scenes.ConfigSchema.parse({ global: { fadeSeconds: 0.6, fps: 60, monitors: 'primary' }, clock: { enabled: false },
    customShaders: [
      { id: 'custom-red', title: 'Red', source: 'void mainImage(out vec4 c, in vec2 p){c=vec4(1.0,0.0,0.0,1.0);}' },
      { id: 'custom-blue', title: 'Blue', source: 'void mainImage(out vec4 c, in vec2 p){c=vec4(0.0,0.0,1.0,1.0);}' },
      { id: 'custom-broken', title: 'Broken', source: 'void mainImage(out vec4 c, in vec2 p){c=missing_value;}' },
    ] });
  const registry = scenes.withCustomShaders(scenes.shaderRegistry, config.customShaders);
  const plan = shaderId => scenes.buildScenePlan(config, { shaderId }, registry, scenes.effectRegistry);
  const before = sample(output);
  const child = spawn(binary, scenes.nativeArguments(config, output), { stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const send = message => child.stdin.write(JSON.stringify(message) + '\n');
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', data => { if (String(data).includes('"ready"')) resolve(); });
    child.once('exit', code => reject(new Error(`Renderer exited before ready (${code})`)));
  });
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const close = (a, b, tolerance = 24) => a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
  try {
    send(plan('custom-red'));
    send(scenes.clockMessage(config.clock));
    await ready;
    // Activation crossfades from the desktop; it must never pass through black first.
    const early = sample(output);
    await wait(900);
    const red = sample(output);
    assert.ok(red[0] > 200 && red[1] < 40 && red[2] < 40, `Scene did not fade in to red: ${red}`);
    assert.ok(!close(early, [0, 0, 0], 6) || close(before, [0, 0, 0], 6), `Activation began black instead of over the desktop: ${early}`);
    send(plan('custom-blue'));
    await wait(150);
    const middle = sample(output);
    assert.ok(middle[0] < 200, `Transition did not dim the outgoing scene: ${middle}`);
    await wait(900);
    const blue = sample(output);
    assert.ok(blue[2] > 200 && blue[0] < 40, `Transition did not present the next scene: ${blue}`);
    send(plan('custom-broken'));
    await wait(1100);
    const kept = sample(output);
    assert.ok(kept[2] > 200 && kept[0] < 40, `A broken scene replaced the running one: ${kept}`);
    send(plan('plasma'));
    await wait(1100);
    const plasma = sample(output);
    assert.ok(!close(plasma, [0, 0, 255], 40), `Renderer did not recover after a broken scene: ${plasma}`);
    send({ type: 'dismiss' });
    const code = await Promise.race([exited, wait(3000).then(() => 'timeout')]);
    assert.equal(code, 0, 'Dismissal did not exit cleanly');
    await wait(300);
    const after = sample(output);
    assert.ok(close(after, before, 40), `Desktop was not restored after dismissal: ${after} vs ${before}`);
    console.log('Live layer-shell fade-in, transitions, broken-scene recovery and dismissal passed');
  } finally {
    child.kill('SIGTERM');
  }
}

compileAll();
if (process.argv.includes('--live')) live().catch(error => { console.error(error); process.exit(1); });

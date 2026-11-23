// Builds dist/native/scrnsvr-renderer, the layer-shell screensaver renderer.
// Optional unless --required: without it settings and previews work, but the screensaver cannot run.
//
// SCRNSVR_RENDERER selects the implementation (docs/rust-rewrite-plan.md, milestone 2):
//   cpp  (default) native/renderer/, the production renderer and rollback path
//   rust crates/scrnsvr-app, the drop-in Rust rewrite with the same protocol and exit codes
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, rm } from 'node:fs/promises';

const required = process.argv.includes('--required');
const implementation = process.env.SCRNSVR_RENDERER ?? 'cpp';
if (!['cpp', 'rust'].includes(implementation)) throw new Error(`SCRNSVR_RENDERER must be "cpp" or "rust", not "${implementation}".`);
const target = 'dist/native/scrnsvr-renderer';
const generated = 'dist/native/generated';
await rm(target, { force: true });
await rm('dist/native/layer-shell.node', { force: true });
if (process.platform !== 'linux') {
  if (required) throw new Error('The native renderer requires Linux.');
  process.exit(0);
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? `${command} failed`);
  return result.stdout.trim();
}
const flags = packages => run('pkg-config', packages).split(/\s+/).filter(Boolean);

async function buildCpp() {
  await mkdir(generated, { recursive: true });
  const libraries = ['wayland-client', 'wayland-egl', 'egl', 'glesv2', 'pangocairo'];
  const objects = [];
  // xdg-shell is generated only to resolve the layer-shell popup type reference.
  for (const protocol of ['wlr-layer-shell-unstable-v1', 'xdg-shell']) {
    const source = `${generated}/${protocol}-protocol.c`;
    run('wayland-scanner', ['client-header', `native/protocols/${protocol}.xml`, `${generated}/${protocol}-client-protocol.h`]);
    run('wayland-scanner', ['private-code', `native/protocols/${protocol}.xml`, source]);
    const object = `${generated}/${protocol}.o`;
    run(process.env.CC ?? 'cc', ['-O2', '-c', source, '-o', object, ...flags(['--cflags', 'wayland-client'])]);
    objects.push(object);
  }
  run(process.env.CXX ?? 'c++', ['-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror', `-I${generated}`,
    'native/renderer/main.cc', 'native/renderer/gl.cc', 'native/renderer/clock.cc', ...objects, '-o', target,
    ...flags(['--cflags', ...libraries]), ...flags(['--libs', ...libraries])]);
}

async function buildRust() {
  await mkdir('dist/native', { recursive: true });
  // Inherit stdio so cargo's progress and errors stay visible.
  const result = spawnSync('cargo', ['build', '--release', '--locked', '-p', 'scrnsvr-app', '--bin', 'scrnsvr-renderer'], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? 'cargo build failed');
  await copyFile('target/release/scrnsvr-renderer', target);
}

const builds = {
  cpp: { build: buildCpp, label: 'Native renderer', needs: 'a C/C++ compiler, pkg-config, wayland-scanner and development headers for wayland-client, wayland-egl, EGL, GLESv2 and pangocairo' },
  rust: { build: buildRust, label: 'Rust renderer', needs: 'a Rust toolchain (see rust-version in Cargo.toml) and development files for wayland-client, EGL and pangocairo' },
};
const { build, label, needs } = builds[implementation];
try {
  await build();
  console.log(`Built ${target}${implementation === 'rust' ? ' (Rust)' : ''}`);
} catch (error) {
  await rm(target, { force: true });
  const message = `${label} build failed: ${error.message}\nInstall ${needs}.`;
  if (required) throw new Error(message);
  console.warn(`${message}\nContinuing without it: settings and previews work, but the screensaver cannot run.`);
}

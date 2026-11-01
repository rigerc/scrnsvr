import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const required = process.argv.includes('--required');
const target = 'dist/native/layer-shell.node';
const generated = 'dist/native/generated';
await rm(target, { force: true });
if (process.platform !== 'linux') {
  if (required) throw new Error('The layer-shell backend requires Linux.');
  process.exit(0);
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? `${command} failed`);
  return result.stdout.trim();
}
try {
  await mkdir(generated, { recursive: true });
  const headers = [process.env.NODE_INCLUDE_DIR, path.join(process.config.variables.node_prefix ?? '/usr', 'include/node'), '/usr/include/node']
    .find(directory => directory && existsSync(path.join(directory, 'node_api.h')));
  if (!headers) throw new Error('Node headers were not found; set NODE_INCLUDE_DIR to their directory.');
  const protocols = ['wlr-layer-shell-unstable-v1', 'linux-dmabuf-unstable-v1', 'xdg-shell'];
  const sources = [];
  for (const protocol of protocols) {
    const source = `${generated}/${protocol}-protocol.c`;
    run('wayland-scanner', ['client-header', `native/protocols/${protocol}.xml`, `${generated}/${protocol}-client-protocol.h`]);
    run('wayland-scanner', ['private-code', `native/protocols/${protocol}.xml`, source]);
    const object = `${generated}/${protocol}.o`;
    run(process.env.CC ?? 'cc', ['-fPIC', '-c', source, '-o', object, ...run('pkg-config', ['--cflags', 'wayland-client']).split(/\s+/).filter(Boolean)]);
    sources.push(object);
  }
  run(process.env.CXX ?? 'c++', ['-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror', '-fPIC', '-shared',
    `-I${headers}`, `-I${generated}`, 'native/layer-shell.cc', ...sources, '-o', target,
    ...run('pkg-config', ['--cflags', 'wayland-client', 'libuv']).split(/\s+/).filter(Boolean),
    ...run('pkg-config', ['--libs', 'wayland-client']).split(/\s+/).filter(Boolean)]);
  console.log(`Built ${target}`);
} catch (error) {
  await rm(target, { force: true });
  const message = `Layer-shell build failed: ${error.message}\nInstall a C/C++ compiler, pkg-config, Node headers, libuv development headers, libwayland-dev and wayland-scanner (libwayland-bin).`;
  if (required) throw new Error(message);
  console.warn(`${message}\nContinuing with the fullscreen window backend.`);
}

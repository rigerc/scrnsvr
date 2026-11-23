#!/usr/bin/env node
/** Run media capture against a running production preview, then VHS tape. */
import { spawnSync } from 'node:child_process';
const tasks = [
  ['node', ['scripts/media/capture.mjs']],
  ['node', ['scripts/media/video.mjs']],
  ['node', ['scripts/media/vhs.mjs', ...process.argv.slice(2)]],
];
for (const [command, args] of tasks) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

#!/usr/bin/env node
/** Render a deterministic terminal screenshot + GIF/MP4 using Charmbracelet VHS.
 * Native mode needs vhs, ttyd and ffmpeg. Docker mode uses the official VHS image.
 * Neither route needs the website preview server.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { project } from '../../src/config/project.config.ts';

const template = 'scripts/media/tapes/quickstart.tape';
const tape = 'media-output/vhs/quickstart.generated.tape';
const image = 'ghcr.io/charmbracelet/vhs:v0.12.1';
const root = process.cwd();
await mkdir(resolve(root, 'media-output/vhs'), { recursive: true });

// The tape types these values into a shell inside `echo '...'` inside a VHS
// string, so quotes, backslashes and shell metacharacters would break it.
function tapeSafe(label, value) {
  if (!value || /['"\\`$]/.test(value)) {
    throw new Error(`project.${label} must be non-empty and free of quotes, backslashes, backticks and $ to be typed into the VHS tape.`);
  }
  return value;
}
const values = {
  PROJECT_NAME: tapeSafe('name', project.name),
  PROJECT_EYEBROW: tapeSafe('hero.eyebrow', project.hero.eyebrow || 'Project quick start'),
};
let rendered = await readFile(resolve(root, template), 'utf8');
for (const [key, value] of Object.entries(values)) rendered = rendered.replaceAll(`{{${key}}}`, value);
const unfilled = rendered.match(/{{[A-Z_]+}}/);
if (unfilled) throw new Error(`Unfilled placeholder ${unfilled[0]} in ${template}`);
await writeFile(resolve(root, tape), rendered);

function exists(command) {
  return !spawnSync(command, ['--version'], { stdio: 'ignore' }).error;
}

const arg = process.argv.slice(2);
if (arg.some((a) => !['--docker', '--native'].includes(a))) {
  throw new Error('Usage: pnpm media:vhs [--docker | --native]');
}
if (arg.includes('--docker') && arg.includes('--native')) {
  throw new Error('Choose one VHS runner: --docker or --native');
}
const runner = arg.includes('--docker') ? 'docker' : arg.includes('--native') ? 'native' : exists('vhs') ? 'native' : 'docker';
let command;
let arguments_;
if (runner === 'native') {
  if (!exists('vhs')) throw new Error('VHS was not found on PATH. Install VHS + ttyd + ffmpeg, or use --docker.');
  command = 'vhs';
  arguments_ = [tape];
} else {
  if (!exists('docker')) throw new Error('No VHS CLI or Docker found. Install VHS + ttyd + ffmpeg, or install Docker and run pnpm media:vhs --docker.');
  command = 'docker';
  arguments_ = ['run', '--rm', '-v', `${root}:/vhs`, '-w', '/vhs', image, tape];
}
console.log(`Rendering VHS tape (${runner}): ${tape}`);
const result = spawnSync(command, arguments_, { cwd: root, stdio: 'inherit' });
if (result.error) throw new Error(`${command} failed: ${result.error.message}`);
if (result.status !== 0) process.exit(result.status || 1);
console.log('VHS PNG: media-output/vhs/quickstart.png');
console.log('VHS GIF: media-output/vhs/quickstart.gif');
console.log('VHS MP4: media-output/vhs/quickstart.mp4');

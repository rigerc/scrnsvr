#!/usr/bin/env node
/** Headless thumbnail utility. The Electron entry point handles --thumbnail and
 * writes one PNG per registered shader; this wrapper keeps CI independent of a compositor. */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve(process.argv[2] || 'assets/thumbnails');
await mkdir(output, { recursive: true });
const electron = process.env.ELECTRON || resolve('node_modules/electron/cli.js');
const child = spawn(electron, ['dist/main/index.js', '--thumbnail', '--output', output, '--frames', '3'], { stdio: 'inherit', env: { ...process.env, ELECTRON_IS_HEADLESS: '1' } });
child.on('error', error => { console.error(`unable to launch Electron: ${error.message}`); process.exitCode = 1; });
child.on('exit', code => process.exit(code ?? 1));

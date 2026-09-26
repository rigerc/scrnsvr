// Shared boilerplate for the Electron check scripts. Keeping the re-exec guard,
// temporary userData, software-GL switches, module bundling and shutdown tail in
// one place means the scripts only contain their own assertions.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const harnessDir = path.join(os.tmpdir(), 'scrnsvr-harness');

/** Re-run the calling script inside Electron when started with plain `node`. */
function isElectronHost() {
  return Boolean(process.versions.electron) && !process.env.ELECTRON_RUN_AS_NODE;
}

function reexecUnderElectron() {
  if (isElectronHost()) return;
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [process.argv[1], ...process.argv.slice(2)], { env, stdio: 'inherit' });
  if (result.error) console.error(result.error);
  process.exit(result.status ?? 1);
}

/** Read the software-GL switch list from the shared source through its bundle. */
function applySoftwareGl(commandLine) {
  const bundlePath = path.join(repoRoot, 'dist', 'shared', 'gpu-flags.js');
  if (!fs.existsSync(bundlePath)) {
    throw new Error('Missing dist/shared/gpu-flags.js — run `npm run build` before this check.');
  }
  require(bundlePath).applySoftwareGl(commandLine);
}

/** Create an isolated config/userData directory and apply the shared GL switches. */
function createHarness({ prefix, userData = true, xdgConfigHome = false } = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const { app } = require('electron');
  if (xdgConfigHome) process.env.XDG_CONFIG_HOME = temporary;
  app.setPath('userData', userData === true ? temporary : userData ? path.join(temporary, userData) : path.join(temporary, 'userData'));
  applySoftwareGl(app.commandLine);
  return temporary;
}

/** Bundle a TypeScript entry to a CommonJS file and require the result. */
function bundleModule(entry, { outDir = harnessDir, loader = { '.glsl': 'text' }, platform = 'node', format = 'cjs' } = {}) {
  const { buildSync } = require('esbuild');
  fs.mkdirSync(outDir, { recursive: true });
  const outfile = path.join(outDir, `${path.basename(entry)}.cjs`);
  buildSync({ entryPoints: [path.join(repoRoot, entry)], outfile, bundle: true, platform, format, loader });
  return require(outfile);
}

/** Bundle an in-memory browser entry and return its sources as text. */
function bundleSource(contents, { loader = { '.glsl': 'text' } } = {}) {
  const { buildSync } = require('esbuild');
  return buildSync({
    stdin: { contents, resolveDir: repoRoot },
    bundle: true, write: false, platform: 'browser', loader,
  }).outputFiles[0].text;
}

/** Load the settings page and wait until the shader controls have mounted. */
async function waitForControls(win, { root = repoRoot, selector = '[data-control]', attempts = 100, intervalMs = 50 } = {}) {
  await win.loadFile(path.join(root, 'dist', 'settings', 'index.html'));
  for (let i = 0; i < attempts; i += 1) {
    if (await win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

/** Destroy the harness window, remove its temporary directory and quit. */
function finish(app, { win, temporary, exitCode } = {}) {
  if (temporary) app.on('quit', () => fs.rmSync(temporary, { recursive: true, force: true }));
  win?.destroy();
  if (exitCode === undefined) app.quit();
  else app.exit(exitCode);
}

module.exports = { reexecUnderElectron, applySoftwareGl, createHarness, bundleModule, bundleSource, waitForControls, finish };

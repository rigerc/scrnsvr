// Exercise real preload IPC, runtime smoothing and GPU uploads together.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, stdio: 'inherit' });
  if (result.error) console.error(result.error);
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow, ipcMain } = require('electron');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'scrnsvr-reactive-check-'));
app.setPath('userData', temporary);
app.commandLine.appendSwitch('disable-vulkan');
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'swiftshader-webgl');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
if (process.env.DISPLAY) app.commandLine.appendSwitch('ozone-platform', 'x11');

app.whenReady().then(async () => {
  let frame = { level: 0, bass: 0, mid: 0, treble: 0, status: 'Test audio' };
  let subscriber;
  ipcMain.on('audio:subscribe', event => { subscriber = event.sender; subscriber.send('audio:frame', frame); });
  ipcMain.on('audio:unsubscribe', () => { subscriber = undefined; });
  ipcMain.handle('test:audio', (_event, value) => {
    frame = { ...frame, ...value };
    if (!subscriber) throw Error('Renderer never subscribed to audio');
    subscriber.send('audio:frame', frame);
  });
  // Extend the normal preload only with a test command; production subscriptions stay intact.
  const preload = path.join(temporary, 'preload.cjs');
  fs.writeFileSync(preload, fs.readFileSync(path.join(root, 'dist/preload/index.js'), 'utf8') +
    '\nrequire("electron").contextBridge.exposeInMainWorld("testAudio", { send: value => require("electron").ipcRenderer.invoke("test:audio", value) });');
  const source = buildSync({
    stdin: { contents: `import { mountShader } from './src/renderer/core/runtime';
      import { shaderRegistry } from './src/renderer/shaders';
      window.testShaders = { mountShader, shaderRegistry };`, resolveDir: root },
    bundle: true, write: false, platform: 'browser', loader: { '.glsl': 'text' },
  }).outputFiles[0].text;
  const win = new BrowserWindow({ show: false, width: 400, height: 260,
    webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  await win.loadURL('data:text/html,<body style="margin:0"><canvas style="width:320px;height:180px"></canvas>');
  await win.webContents.executeJavaScript(source);
  const result = await win.webContents.executeJavaScript(`(${async function checks() {
    const assert = (ok, message) => { if (!ok) throw Error(message); };
    const canvas = document.querySelector('canvas');
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 160; sampleCanvas.height = 90;
    const ctx = sampleCanvas.getContext('2d');
    const silence = { level: 0, bass: 0, mid: 0, treble: 0 };
    const music = { level: 0.55, bass: 0.65, mid: 0.3, treble: 0.15 };
    const sample = () => {
      ctx.drawImage(canvas, 0, 0, 160, 90);
      return ctx.getImageData(0, 0, 160, 90).data;
    };
    const delta = (a, b) => a.reduce((sum, value, i) => sum + (i % 4 === 3 ? 0 : Math.abs(value - b[i])), 0) / (a.length * 0.75);
    const capture = async seconds => {
      const deadline = performance.now() + seconds * 1000;
      do { await new Promise(requestAnimationFrame); } while (performance.now() < deadline);
      return sample();
    };
    const reports = [];
    for (const definition of Object.values(window.testShaders.shaderRegistry).filter(s => s.manifest.category === 'Reactive')) {
      const values = { speed: 0, sensitivity: 1 };
      const stop = window.testShaders.mountShader(canvas, definition, values, 60);
      await capture(0.1);
      await window.testAudio.send(silence);
      const idle = await capture(0.1);
      await window.testAudio.send(music);
      const active = await capture(0.3);
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      const program = gl.getParameter(gl.CURRENT_PROGRAM);
      const audio = [...gl.getUniform(program, gl.getUniformLocation(program, 'uAudio'))];
      const response = delta(idle, active);
      assert(audio[0] > 0.3, definition.manifest.title + ': audio is too slow or not reaching GPU: ' + audio);
      assert(response > 1.5, definition.manifest.title + ': response is imperceptible after 300ms: ' + response);
      assert(response < 25, definition.manifest.title + ': response is too abrupt: ' + response);
      await window.testAudio.send(silence);
      const released = await capture(2.5);
      assert(delta(idle, released) < response * 0.2, definition.manifest.title + ': does not settle after silence: ' + delta(idle, released) + ' (active: ' + response + ')');
      values.sensitivity = 0;
      const disabled = await capture(0.1);
      await window.testAudio.send(music);
      assert(delta(disabled, await capture(0.3)) === 0, definition.manifest.title + ': zero influence still responds');
      reports.push({ title: definition.manifest.title, audio, response, release: delta(idle, released) });
      await window.testAudio.send(silence);
      stop();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return reports;
  }.toString()})()`);
  console.log(JSON.stringify(result));
  console.log('Reactive IPC, runtime upload, response time, silence recovery and zero influence passed');
  win.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
app.on('quit', () => fs.rmSync(temporary, { recursive: true, force: true }));

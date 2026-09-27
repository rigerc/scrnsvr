// Deterministic timing with real OGL uploads and GPU pixels in both WebGL versions.
const { reexecUnderElectron, createHarness, bundleSource, finish } = require('./lib/electron-harness.cjs');
reexecUnderElectron();
const { app, BrowserWindow } = require('electron');
const temporary = createHarness({ prefix: 'scrnsvr-animation-check-' });

app.whenReady().then(async () => {
  const source = bundleSource(`import { mountShader } from './src/renderer/core/runtime';
    import { shaderRegistry } from './src/renderer/shaders';
    window.testShaders = { mountShader, shaderRegistry };`);
  const win = new BrowserWindow({ show: false, width: 400, height: 260,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  await win.loadURL('data:text/html,<body style="margin:0"></body>');
  await win.webContents.executeJavaScript(source);
  const result = await win.webContents.executeJavaScript(`(${function checks() {
    const assert = (ok, message) => { if (!ok) throw Error(message); };
    let now = 0;
    let serial = 0;
    const callbacks = new Map();
    performance.now = () => now;
    window.requestAnimationFrame = callback => { callbacks.set(++serial, callback); return serial; };
    window.cancelAnimationFrame = id => callbacks.delete(id);
    window.ResizeObserver = class { observe() {} disconnect() {} };
    const NativeDate = Date;
    // Exercise midnight in the imported clock, independent of the machine time.
    window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [2026, 8, 27, 23, 59, 59])); } };
    const advance = milliseconds => {
      now += milliseconds;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(now);
    };
    const reports = [];
    for (const contextType of ['webgl2', 'webgl']) {
      const canvas = document.createElement('canvas');
      canvas.style.width = '160px'; canvas.style.height = '90px';
      document.body.append(canvas);
      const nativeContext = canvas.getContext.bind(canvas);
      canvas.getContext = (name, ...args) => contextType === 'webgl' && name === 'webgl2' ? null : nativeContext(name, ...args);
      const pixels = gl => {
        const result = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, result);
        assert(gl.getError() === gl.NO_ERROR, contextType + ': GL error');
        return result;
      };
      const difference = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0);
      for (const id of ['flow-field', 'avs-matrix', 'avs-seven-segment']) {
        const values = { speed: 1 };
        const stop = window.testShaders.mountShader(canvas, window.testShaders.shaderRegistry[id], values, 60);
        const gl = nativeContext(contextType);
        const program = gl.getParameter(gl.CURRENT_PROGRAM);
        const time = () => gl.getUniform(program, gl.getUniformLocation(program, 'uTime'));
        const original = pixels(gl);
        advance(1000);
        advance(1000);
        const moving = pixels(gl);
        assert(Math.abs(time() - 2) < 0.001, id + ': expected phase 2');
        assert(difference(original, moving) > 0, id + ': motion never advanced');
        values.speed = 0;
        advance(100);
        assert(time() === 2 && difference(moving, pixels(gl)) === 0, id + ': pause changed the current composition');
        advance(1000);
        assert(time() === 2 && difference(moving, pixels(gl)) === 0, id + ': paused image drifted');
        values.speed = 2;
        advance(100);
        assert(Math.abs(time() - 2.2) < 0.001, id + ': speed edit reset phase');
        assert(difference(moving, pixels(gl)) > 0 || id === 'avs-seven-segment', id + ': resume remained frozen');
        advance(60000);
        assert(Math.abs(time() - 2.2) < 0.001, id + ': suspension jumped phase');
        if (id === 'avs-seven-segment') {
          const dateLocation = gl.getUniformLocation(program, 'uDate');
          const date = [...gl.getUniform(program, dateLocation)];
          assert(date[3] === 86399, 'Clock baseline should be 23:59:59');
          // At phase 2.2, 23:59:59 must match a 00:00:00 baseline advanced 1.2s.
          const midnight = pixels(gl);
          gl.uniform4f(dateLocation, date[0], date[1], date[2] + 1, 0);
          gl.uniform1f(gl.getUniformLocation(program, 'uTime'), 1.2);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          assert(difference(midnight, pixels(gl)) === 0, 'Clock failed to wrap at midnight');
        }
        stop();
        reports.push({ contextType, id, phase: 2.2 });
      }
      const custom = {
        manifest: { id: 'custom-clock', title: 'Custom contract', fragment: 'custom.glsl', uniforms: [{ name: 'speed', type: 'float', default: 1 }] },
        source: 'precision highp float; uniform float uTime; uniform float speed; void main(){gl_FragColor=vec4(fract(uTime*speed),0.5,0.3,1.0);}',
      };
      const values = { speed: 2 };
      const stop = window.testShaders.mountShader(canvas, custom, values);
      const gl = nativeContext(contextType);
      const program = gl.getParameter(gl.CURRENT_PROGRAM);
      advance(100);
      assert(Math.abs(gl.getUniform(program, gl.getUniformLocation(program, 'uTime')) - 0.1) < 0.001, 'Custom elapsed contract changed');
      assert(gl.getUniform(program, gl.getUniformLocation(program, 'speed')) === 2, 'Custom speed contract changed');
      stop();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    }
    return reports;
  }.toString()})()`);
  console.log(JSON.stringify(result));
  console.log('Runtime phase continuity, GPU image hold, resume, suspension, clock midnight and custom timing passed in WebGL 1 and 2');
  finish(app, { win, temporary });
}).catch(error => { console.error(error); app.exit(1); });

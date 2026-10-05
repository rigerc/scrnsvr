// Real mountShader + OGL + GPU assertions. Optional --capture-dir DIR writes a
// contact sheet and individual fixtures for human visual acceptance (no repo artifacts).
const fs = require('node:fs');
const path = require('node:path');
const { reexecUnderElectron, createHarness, bundleSource, finish } = require('./lib/electron-harness.cjs');
reexecUnderElectron();
const { app, BrowserWindow } = require('electron');
const temporary = createHarness({ prefix: 'scrnsvr-effects-check-' });
const captureArg = process.argv.indexOf('--capture-dir');
const captureDir = captureArg < 0 ? undefined : process.argv[captureArg + 1];
if (captureArg >= 0 && !captureDir) throw Error('--capture-dir requires a directory');

app.whenReady().then(async () => {
  const source = bundleSource(`import { mountShader } from './src/renderer/core/runtime';
    import { shaderRegistry } from './src/renderer/shaders';
    import { effectRegistry } from './src/renderer/effects';
    window.effectTests = { mountShader, shaderRegistry, effectRegistry };`);
  const win = new BrowserWindow({ show: false, width: 900, height: 700,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  await win.loadURL('data:text/html,<body style="margin:0"></body>');
  await win.webContents.executeJavaScript(source);
  const result = await win.webContents.executeJavaScript(`(${function checks(capture) {
    const assert = (ok, message) => { if (!ok) throw Error(message); };
    const { mountShader, shaderRegistry, effectRegistry } = window.effectTests;
    let now = 0, serial = 0;
    const callbacks = new Map(), resizes = new Map();
    performance.now = () => now;
    window.requestAnimationFrame = callback => { callbacks.set(++serial, callback); return serial; };
    window.cancelAnimationFrame = id => callbacks.delete(id);
    window.ResizeObserver = class {
      constructor(callback) { this.callback = callback; }
      observe(canvas) { this.canvas = canvas; resizes.set(canvas, this.callback); }
      disconnect() { resizes.delete(this.canvas); }
    };
    const advance = milliseconds => {
      now += milliseconds;
      const pending = [...callbacks.values()]; callbacks.clear();
      for (const callback of pending) callback(now);
    };
    const effect = (id, source, uniforms = []) => ({ id, title: id, description: '', source, uniforms });
    const header = 'precision highp float; uniform sampler2D uInput; varying vec2 vUv;';
    effectRegistry.copy = effect('copy', header + 'void main(){gl_FragColor=texture2D(uInput,vUv);}');
    effectRegistry.add = effect('add', header + 'uniform float amount; void main(){vec4 c=texture2D(uInput,vUv);gl_FragColor=vec4(c.r+amount,c.gb,1.0);}',
      [{ name: 'amount', type: 'float', default: 0.2, min: 0, max: 0.5 }]);
    effectRegistry.half = effect('half', header + 'void main(){vec4 c=texture2D(uInput,vUv);gl_FragColor=vec4(c.r*0.5,c.gb,1.0);}');
    effectRegistry.broken = effect('broken', 'precision highp float; void main(){ this is invalid; }');
    effectRegistry.unlinked = effect('unlinked', 'precision highp float; varying vec3 vUv; void main(){gl_FragColor=vec4(vUv,1.0);}');
    const base = {
      manifest: { id: 'custom-fixture', title: 'Asymmetric custom', fragment: '', uniforms: [{ name: 'speed', type: 'float', default: 1 }] },
      animationTime: 'integrated',
      source: 'precision highp float; uniform vec2 uResolution; uniform float uTime; void main(){vec2 uv=gl_FragCoord.xy/uResolution; float border=step(0.012,uv.x)*step(0.012,uv.y)*step(uv.x,0.988)*step(uv.y,0.988); gl_FragColor=vec4(mix(vec3(0.95,0.15,0.05),vec3(0.1+0.2*uv.x,uv.y,0.2+0.6*uv.x+0.01*sin(uTime)),border),1.0);}',
    };
    const layer = (id, effectId, values = {}) => ({ id, effectId, enabled: true, values });
    const difference = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0);
    const maxDifference = (a, b) => a.reduce((max, value, i) => Math.max(max, Math.abs(value - b[i])), 0);
    const reports = [], captures = [];
    for (const contextType of ['webgl2', 'webgl']) {
      const canvas = document.createElement('canvas');
      const host = document.createElement('div'); host.style.width = '161px'; host.style.height = '91px';
      canvas.style.width = '100%'; canvas.style.height = '100%'; host.append(canvas); document.body.append(host);
      const nativeContext = canvas.getContext.bind(canvas);
      const stats = { live: {}, created: {}, deleted: {}, peakTextures: 0, textureUploads: 0, mipmaps: 0 };
      let gl, forcedFramebufferFailure = false;
      canvas.getContext = (name, ...args) => {
        if (contextType === 'webgl' && name === 'webgl2') return null;
        const context = nativeContext(name, ...args);
        if (!context || gl) return context;
        gl = context;
        for (const kind of ['Shader', 'Program', 'Texture', 'Framebuffer', 'Renderbuffer', 'Buffer']) {
          const create = gl['create' + kind].bind(gl), remove = gl['delete' + kind].bind(gl);
          stats.live[kind] = new Set(); stats.created[kind] = 0; stats.deleted[kind] = 0;
          gl['create' + kind] = (...params) => {
            const value = create(...params); stats.created[kind]++; if (value) stats.live[kind].add(value);
            if (kind === 'Texture') stats.peakTextures = Math.max(stats.peakTextures, stats.live.Texture.size);
            return value;
          };
          gl['delete' + kind] = value => { if (value) { stats.deleted[kind]++; stats.live[kind].delete(value); } return remove(value); };
        }
        const texImage = gl.texImage2D.bind(gl), mipmap = gl.generateMipmap.bind(gl), status = gl.checkFramebufferStatus.bind(gl);
        gl.texImage2D = (...params) => { stats.textureUploads++; return texImage(...params); };
        gl.generateMipmap = (...params) => { stats.mipmaps++; return mipmap(...params); };
        gl.checkFramebufferStatus = target => forcedFramebufferFailure ? gl.FRAMEBUFFER_UNSUPPORTED : status(target);
        return context;
      };
      const pixels = () => {
        const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
        assert(gl.getError() === gl.NO_ERROR, contextType + ': GL error');
        return data;
      };
      const clean = () => {
        for (const [kind, live] of Object.entries(stats.live)) assert(live.size === 0, contextType + ': leaked ' + kind + ': ' + live.size);
        assert(gl.renderer.state.uniformLocations.size === 0, 'Leaked OGL uniform cache');
        assert(gl.getError() === gl.NO_ERROR, 'GL error during teardown');
      };
      const captureFrame = name => {
        if (!capture) return;
        const image = document.createElement('canvas'); image.width = canvas.width; image.height = canvas.height;
        image.getContext('2d').drawImage(canvas, 0, 0);
        captures.push({ name: contextType + '-' + name, width: image.width, height: image.height, png: image.toDataURL('image/png') });
      };
      const resize = (width, height) => { host.style.width = width + 'px'; host.style.height = height + 'px'; resizes.get(canvas)(); };
      const effects = { enabled: true, layers: [] }, playback = { paused: true }, statuses = [];
      let stop = mountShader(canvas, base, { speed: 0 }, 60, playback, { effects, onEffectStatus: status => statuses.push(status) });
      const direct = pixels();
      const baseProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      assert(stats.created.Texture === 0 && stats.created.Framebuffer === 0, 'Empty stack allocated targets');
      effects.layers = [layer('copy-a', 'copy')]; advance(100);
      assert(maxDifference(direct, pixels()) <= 1 && stats.live.Texture.size === 1 && statuses.length === 0, 'Copy inverted/altered input or failed to execute');
      const copyProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      effects.layers.push(layer('copy-b', 'copy')); advance(100);
      assert(maxDifference(direct, pixels()) <= 1, 'Two-pass copy inverted or altered input');
      effects.layers.reverse(); advance(100);
      assert(gl.getParameter(gl.CURRENT_PROGRAM) === copyProgram, 'Reorder rebuilt retained program');
      let uploads = stats.textureUploads, programs = stats.created.Program;
      resizes.get(canvas)(); resizes.get(canvas)(); advance(100);
      assert(stats.textureUploads === uploads && stats.created.Program === programs, 'Unchanged resize reallocated resources');
      effects.enabled = false; advance(100);
      assert(difference(direct, pixels()) === 0 && stats.live.Texture.size === 0, 'Global bypass is not direct: ' + JSON.stringify(statuses));
      effects.enabled = true; effects.layers.forEach(item => { item.enabled = false; }); advance(100);
      assert(difference(direct, pixels()) === 0 && stats.live.Texture.size === 0, 'Disabled stack is not direct');
      effects.layers = [layer('zero', 'vhs-distortion', { intensity: 0 })]; advance(100);
      assert(difference(direct, pixels()) === 0 && stats.live.Texture.size === 0, 'Intensity zero allocated or altered image');
      effects.layers[0].values = { intensity: 1, grain: 0, scanlines: 0, colorBleed: 0, tracking: 0 }; advance(100);
      assert(maxDifference(direct, pixels()) <= 1 && stats.live.Texture.size === 1, 'Zero controls changed input through the real VHS program');
      effects.layers[0].values.scanlines = 1; advance(100);
      const linePixels = pixels(), column = Math.floor(gl.drawingBufferWidth / 2);
      const even = linePixels[(2 * gl.drawingBufferWidth + column) * 4];
      const odd = linePixels[(3 * gl.drawingBufferWidth + column) * 4];
      assert(even - odd >= 3, 'Physical scanlines do not alternate rows');
      // Red at center is 0.2: add->half gives 0.2; half->add gives 0.3.
      effects.layers = [layer('add-a', 'add'), layer('half-a', 'half')]; advance(100);
      const center = () => pixels()[(Math.floor(gl.drawingBufferHeight / 2) * gl.drawingBufferWidth + Math.floor(gl.drawingBufferWidth / 2)) * 4];
      assert(Math.abs(center() - 51) <= 2, 'Wrong add->half ordering');
      programs = stats.created.Program; uploads = stats.textureUploads;
      effects.layers.reverse(); advance(100);
      assert(Math.abs(center() - 77) <= 2, 'Wrong half->add ordering: red=' + center());
      assert(stats.created.Program === programs && stats.textureUploads === uploads, 'Reorder reallocated programs/targets');
      effects.layers = [layer('add-a', 'add'), layer('add-b', 'add')]; advance(100);
      assert(Math.abs(center() - 153) <= 2, 'Repeated effects were not independent');
      effects.layers[1].values.amount = 0.1; advance(100);
      assert(Math.abs(center() - 128) <= 2, 'Repeated layer values leaked');
      effects.layers[1].enabled = false; advance(100);
      assert(Math.abs(center() - 102) <= 2, 'Layer disable failed');
      effects.layers[1].enabled = true; advance(100);
      // Independent effect motion over an integrated base frozen by speed zero.
      effects.layers = [layer('vhs-a', 'vhs-distortion')]; playback.paused = false; advance(100);
      const first = pixels(); advance(1000); const moving = pixels();
      const tapeProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      const tapeTime = () => gl.getUniform(tapeProgram, gl.getUniformLocation(tapeProgram, 'uTime'));
      assert(difference(first, moving) > 0 && tapeTime() > 0, 'VHS froze at base speed zero');
      assert(gl.isProgram(baseProgram) && gl.getUniform(baseProgram, gl.getUniformLocation(baseProgram, 'uTime')) === 0, 'Effects restarted or advanced the speed-zero base');
      playback.paused = true; advance(100); const paused = pixels(), heldTime = tapeTime();
      advance(1000); advance(1000);
      assert(tapeTime() === heldTime, 'Paused VHS time drifted');
      // Paused frames need no draw. Force resize to read a freshly rendered GPU
      // image, rather than reading an unpreserved buffer after browser compositing.
      resizes.get(canvas)(); assert(difference(paused, pixels()) === 0, 'Paused VHS image drifted');
      effects.layers[0].values.grain = 0.9; advance(100);
      assert(tapeTime() === heldTime && difference(paused, pixels()) > 0, 'Paused effect edit did not redraw in place');
      assert(gl.getParameter(gl.CURRENT_PROGRAM) === tapeProgram, 'Value edit rebuilt effect');
      effects.layers.push(layer('vhs-b', 'vhs-distortion', { grain: 0.8, tracking: 0.4 })); advance(100);
      assert(Math.abs(gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM), 'uTime')) - heldTime) < 0.001, 'New layer restarted time');
      effects.layers.reverse(); advance(100);
      assert(gl.getParameter(gl.CURRENT_PROGRAM) === tapeProgram, 'VHS reorder rebuilt instance');
      playback.paused = false; advance(500); advance(100);
      assert(Math.abs(tapeTime() - heldTime - 0.1) < 0.001, 'Resume jumped effect time');
      for (const [width, height] of [[257, 129], [181, 319], [161, 91]]) {
        resize(width, height);
        const resolution = gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM), gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM), 'uResolution'));
        assert(resolution[0] === gl.drawingBufferWidth && resolution[1] === gl.drawingBufferHeight, 'Wrong physical target resolution');
        pixels(); uploads = stats.textureUploads; resizes.get(canvas)();
        assert(stats.textureUploads === uploads, 'Duplicate odd-size resize reallocated texture');
      }
      playback.paused = true;
      effects.layers = [layer('missing', 'unknown'), layer('bad', 'broken'), layer('link', 'unlinked'), layer('copy-good', 'copy')]; advance(100);
      assert(maxDifference(direct, pixels()) <= 1, 'Broken layer blanked healthy output');
      const snapshot = JSON.stringify(effects); advance(100); resizes.get(canvas)();
      assert(statuses.length === 3 && JSON.stringify(effects) === snapshot, 'Failure warning repeated or config mutated');
      effects.enabled = false; advance(100); // Release targets before injecting an allocation failure.
      effects.layers = [layer('copy-good', 'copy'), layer('other-copy', 'copy')];
      effects.enabled = true; forcedFramebufferFailure = true; advance(100);
      assert(difference(direct, pixels()) === 0 && stats.live.Texture.size === 0, 'Framebuffer failure did not bypass directly');
      advance(100); assert(statuses.length === 4, 'Framebuffer warning repeated');
      forcedFramebufferFailure = false; effects.layers.reverse(); advance(100);
      assert(maxDifference(direct, pixels()) <= 1 && stats.live.Texture.size === 2, 'Framebuffer recovery failed');
      assert(statuses.length === 5 && statuses.at(-1).message === '', 'Recovery retained a stale stack warning');
      effects.enabled = false; advance(100);
      effects.enabled = true; forcedFramebufferFailure = true; advance(100);
      assert(statuses.length === 6 && statuses.at(-1).message.includes('Effect stack bypassed'), 'A later allocation failure was suppressed');
      forcedFramebufferFailure = false; effects.layers.reverse(); advance(100);
      assert(statuses.length === 7 && statuses.at(-1).message === '', 'Second recovery did not clear the warning');
      stop(); clean();
      // Same canvas/context: mount/switch/teardown cannot inherit stale OGL state.
      for (const id of ['star-drift', 'plasma', 'kinetic-tiles', 'custom-fixture']) {
        for (const [width, height] of [[257, 129], [181, 319]]) {
          host.style.width = width + 'px'; host.style.height = height + 'px';
          const fixture = id === 'custom-fixture' ? base : shaderRegistry[id];
          const stack = { enabled: true, layers: [layer('visual', 'vhs-distortion')] };
          stop = mountShader(canvas, fixture, { speed: 0 }, 60, undefined, { effects: stack });
          for (const seconds of [0, 1, 5]) {
            if (seconds === 1) advance(1000);
            if (seconds === 5) for (let tick = 0; tick < 4; tick++) advance(1000);
            pixels(); captureFrame(id + '-' + width + 'x' + height + '-t' + seconds);
          }
          stack.layers[0].values = { intensity: 1, grain: 1, scanlines: 1, colorBleed: 1, tracking: 1 };
          advance(100); pixels(); captureFrame(id + '-' + width + 'x' + height + '-max-controls');
          stack.enabled = false; advance(100); pixels(); captureFrame(id + '-' + width + 'x' + height + '-clean');
          stop(); clean();
        }
      }
      // A separate DPR-2 mount verifies drawing-buffer-sized, not CSS-sized targets.
      const hi = document.createElement('canvas'); hi.style.width = '163px'; hi.style.height = '93px'; document.body.append(hi);
      const hiNative = hi.getContext.bind(hi);
      hi.getContext = (name, ...args) => contextType === 'webgl' && name === 'webgl2' ? null : hiNative(name, ...args);
      const oldDpr = devicePixelRatio;
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
      const hiStop = mountShader(hi, base, { speed: 0 }, 60, undefined, { effects: { enabled: true, layers: [layer('hi', 'vhs-distortion')] } });
      const hiGl = hiNative(contextType), hiProgram = hiGl.getParameter(hiGl.CURRENT_PROGRAM);
      const hiResolution = hiGl.getUniform(hiProgram, hiGl.getUniformLocation(hiProgram, 'uResolution'));
      assert(hiGl.drawingBufferWidth === 326 && hiGl.drawingBufferHeight === 186 && hiResolution[0] === 326 && hiResolution[1] === 186, 'DPR2 targets use CSS dimensions');
      assert(hiGl.getError() === hiGl.NO_ERROR, 'DPR2 GL error'); hiStop();
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: oldDpr });
      hiGl.getExtension('WEBGL_lose_context')?.loseContext(); hi.remove();
      assert(stats.peakTextures <= 2 && stats.created.Renderbuffer === 0 && stats.mipmaps === 0, 'Excess targets, depth attachment or mipmaps');
      reports.push({ contextType, peakTargets: stats.peakTextures, programs: stats.created.Program, textureUploads: stats.textureUploads, warnings: statuses.filter(status => status.message).length });
      gl.getExtension('WEBGL_lose_context')?.loseContext(); host.remove();
    }
    return { reports, captures };
  }.toString()})(${Boolean(captureDir)})`);
  if (captureDir) {
    fs.mkdirSync(captureDir, { recursive: true });
    for (const image of result.captures) fs.writeFileSync(path.join(captureDir, image.name + '.png'), Buffer.from(image.png.split(',')[1], 'base64'));
    // Browser builds one compact landscape+portrait sheet per WebGL version.
    await win.webContents.executeJavaScript(`window.capturedEffects = ${JSON.stringify(result.captures)}`);
    for (const version of ['webgl2', 'webgl']) {
      const sheet = await win.webContents.executeJavaScript(`(async () => {
        const images = window.capturedEffects.filter(image => image.name.startsWith('${version}-'));
        const sheet = document.createElement('canvas'); sheet.width = 960; sheet.height = Math.ceil(images.length / 4) * 225;
        const ctx = sheet.getContext('2d'); ctx.fillStyle = '#202028'; ctx.fillRect(0, 0, sheet.width, sheet.height);
        for (const [index, entry] of images.entries()) {
          const image = new Image(); image.src = entry.png; await image.decode();
          const x = (index % 4) * 240, y = Math.floor(index / 4) * 225;
          const scale = Math.min(230 / image.width, 195 / image.height);
          ctx.drawImage(image, x, y, image.width * scale, image.height * scale);
          ctx.fillStyle = '#ffffff'; ctx.font = '10px sans-serif'; ctx.fillText(entry.name.slice('${version}-'.length), x, y + 212);
        }
        return sheet.toDataURL('image/png');
      })()`);
      fs.writeFileSync(path.join(captureDir, version + '-contact-sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));
    }
    console.log('Visual captures: ' + path.resolve(captureDir));
  }
  console.log(JSON.stringify(result.reports));
  console.log('Effect orientation, ordering, repeat/edit/toggle, bypass, time/pause, NPOT/DPR resize, failures, remount and GL resource cleanup passed in WebGL 1 and 2');
  finish(app, { win, temporary });
}).catch(error => { console.error(error); finish(app, { temporary, exitCode: 1 }); });

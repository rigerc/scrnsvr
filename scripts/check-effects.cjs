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
    effectRegistry.multipass = { ...effect('multipass', header + 'uniform sampler2D uOriginal; void main(){gl_FragColor=vec4((texture2D(uOriginal,vUv).rgb+texture2D(uInput,vUv).rgb)*0.5,1.0);}'),
      passes: [effectRegistry.add.source, effectRegistry.add.source], uniforms: effectRegistry.add.uniforms };
    effectRegistry.typed = effect('typed', header + 'uniform vec3 color; uniform int mode; uniform int count; uniform bool invert; void main(){vec3 c=color*float(count)/8.0;if(mode==1)c=c.bgr;if(invert)c=1.0-c;gl_FragColor=vec4(c,1.0);}', [
      { name: 'color', type: 'color', default: '#ffffff' },
      { name: 'mode', type: 'select', default: 'First', options: ['First', 'Second'] },
      { name: 'count', type: 'int', default: 1, min: 1, max: 8 },
      { name: 'invert', type: 'bool', default: false },
    ]);
    effectRegistry.historyAdd = { ...effect('historyAdd', header + 'uniform sampler2D uHistory; uniform bool uHistoryValid; void main(){vec3 c=uHistoryValid?texture2D(uHistory,vUv).rgb+vec3(0.1,0.0,0.0):texture2D(uInput,vUv).rgb;gl_FragColor=vec4(c,1.0);}'), history: true };
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
      const warningCount = () => statuses.filter(status => status.message).length;
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
      advance(100); assert(warningCount() === 4, 'Framebuffer warning repeated');
      forcedFramebufferFailure = false; effects.layers.reverse(); advance(100);
      assert(maxDifference(direct, pixels()) <= 1 && stats.live.Texture.size === 2, 'Framebuffer recovery failed');
      assert(warningCount() === 4 && statuses.at(-1).message === '', 'Recovery retained a stale stack warning');
      effects.enabled = false; advance(100);
      effects.enabled = true; forcedFramebufferFailure = true; advance(100);
      assert(warningCount() === 5 && statuses.at(-1).message.includes('Effect stack bypassed'), 'A later allocation failure was suppressed');
      forcedFramebufferFailure = false; effects.layers.reverse(); advance(100);
      assert(warningCount() === 5 && statuses.at(-1).message === '', 'Second recovery did not clear the warning');
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
      // Multipass original preservation, repeated instances and typed GPU uploads.
      host.style.width = '161px'; host.style.height = '91px';
      const advanced = { enabled: true, layers: [layer('multi-a', 'multipass'), layer('multi-b', 'multipass')] };
      const held = { paused: true }, advancedStatuses = [];
      stop = mountShader(canvas, base, { speed: 0 }, 60, held, { effects: advanced, onEffectStatus: status => advancedStatuses.push(status) });
      const middleRed = () => pixels()[(Math.floor(gl.drawingBufferHeight / 2) * gl.drawingBufferWidth + Math.floor(gl.drawingBufferWidth / 2)) * 4];
      assert(Math.abs(middleRed() - 153) <= 2, 'Multipass overwrote original or repeated layer boundary: ' + middleRed());
      assert(stats.live.Texture.size === 3, 'Multipass did not use exactly three color scratch targets');
      advanced.layers = [layer('typed', 'typed', { color: '#8040ff', mode: 'Second', count: 3.6, invert: true })]; advance(100);
      let gpuProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      const gpuUniform = name => gl.getUniform(gpuProgram, gl.getUniformLocation(gpuProgram, name));
      assert(gpuUniform('mode') === 1 && gpuUniform('count') === 4 && gpuUniform('invert') === true, 'Select/int/bool not uploaded as integers');
      const uploadedColor = gpuUniform('color');
      assert(Math.abs(uploadedColor[0] - 128 / 255) < 0.00001 && Math.abs(uploadedColor[1] - 64 / 255) < 0.00001 && uploadedColor[2] === 1, 'Color not uploaded as RGB');
      assert(stats.live.Texture.size <= 2, 'Simple path retained third scratch target');
      assert(Math.abs(middleRed() - 128) <= 1, 'Typed shader did not render selected/inverted color');
      stop(); clean();

      const glowBase = { ...base, source: 'precision highp float; uniform vec2 uResolution; void main(){vec2 uv=gl_FragCoord.xy/uResolution;vec2 p=(uv-vec2(0.36,0.58))*uResolution;float spot=1.0-step(7.0,length(p));float lines=step(0.88,fract(uv.x*9.0))*step(0.45,uv.y);vec3 color=vec3(0.03+0.04*uv.x,0.02+0.02*uv.y,0.07);color=mix(color,vec3(1.0,0.82,0.4),max(spot,lines));gl_FragColor=vec4(color,1.0);}' };
      const bloomStack = { enabled: true, layers: [] };
      stop = mountShader(canvas, glowBase, { speed: 0 }, 60, held, { effects: bloomStack, onEffectStatus: status => advancedStatuses.push(status) });
      const cleanGlow = pixels(); captureFrame('bloom-dark-clean');
      bloomStack.layers = [layer('bloom', 'bloom', { intensity: 1, threshold: 0.45, radius: 8, strength: 1 })]; advance(100);
      const glowing = pixels(); captureFrame('bloom-dark-glow');
      assert(difference(cleanGlow, glowing) > 10000, 'Bloom did not spread a real glow');
      for (let i = 0; i < glowing.length; i += 4) assert(glowing[i] + 1 >= cleanGlow[i] && glowing[i + 1] + 1 >= cleanGlow[i + 1] && glowing[i + 2] + 1 >= cleanGlow[i + 2], 'Bloom inverted/darkened original input');
      bloomStack.layers[0].values.intensity = 0.5; advance(100);
      const halfGlow = pixels();
      assert(difference(cleanGlow, halfGlow) > 1000 && difference(halfGlow, glowing) > 1000, 'Bloom intensity did not blend final output');
      bloomStack.layers[0].values.intensity = 0; advance(100);
      assert(difference(cleanGlow, pixels()) === 0 && stats.live.Texture.size === 0, 'Bloom zero intensity did not bypass exactly');
      bloomStack.layers[0].values.intensity = 1; bloomStack.layers[0].values.strength = 0; advance(100);
      assert(maxDifference(cleanGlow, pixels()) <= 1, 'Bloom strength zero failed original preservation');
      bloomStack.layers[0].values = { intensity: 1, threshold: 1, radius: 16, strength: 1 }; advance(100);
      assert(maxDifference(cleanGlow, pixels()) <= 1, 'Bloom threshold one leaked glow');
      bloomStack.layers[0].values.threshold = 0; advance(100); const lowThreshold = pixels();
      bloomStack.layers[0].values.threshold = 0.85; advance(100);
      assert(difference(lowThreshold, pixels()) > 1000, 'Bloom threshold had no visible effect');
      bloomStack.layers[0].values.radius = 1; advance(100);
      assert(difference(glowing, pixels()) > 1000, 'Bloom radius had no visible effect');
      for (const [width, height] of [[257, 129], [181, 319]]) {
        resize(width, height); pixels(); captureFrame('bloom-' + width + 'x' + height);
        uploads = stats.textureUploads; resizes.get(canvas)();
        assert(stats.textureUploads === uploads, 'Bloom duplicate resize reallocated textures');
      }
      bloomStack.layers = [layer('bloom-a', 'bloom'), layer('bloom-b', 'bloom'), layer('copy', 'copy')]; advance(100); pixels();
      assert(stats.live.Texture.size === 3, 'Repeated bloom exceeded scratch bound');
      stop(); clean();

      // Real moving-source persistent feedback, including exact zero-delta repeats.
      host.style.width = '161px'; host.style.height = '91px';
      const movingBase = { ...base, source: 'precision highp float;uniform vec2 uResolution;uniform float uTime;void main(){vec2 uv=gl_FragCoord.xy/uResolution;float x=0.25+0.22*sin(uTime*2.0);float bar=1.0-smoothstep(0.06,0.075,abs(uv.x-x));vec3 c=vec3(0.03+0.03*uv.y,0.03,0.08);gl_FragColor=vec4(mix(c,vec3(0.95,0.5+0.3*uv.y,0.15),bar),1.0);}' };
      const temporal = { enabled: true, layers: [layer('trails-a', 'datamosh-trails', { intensity: 1, persistence: 0.97, decay: 1, displacement: 0 })] };
      const movingPlayback = { paused: false };
      stop = mountShader(canvas, movingBase, { speed: 1 }, 60, movingPlayback, { effects: temporal, onEffectStatus: status => advancedStatuses.push(status) });
      const initialHistory = pixels(); captureFrame('trails-moving-initial');
      assert(stats.live.Texture.size === 3, 'Single temporal layer requires one scratch plus two history');
      for (let i = 0; i < 12; i++) advance(1000 / 30);
      const trailed = pixels(); captureFrame('trails-moving-persistent');
      assert(difference(initialHistory, trailed) > 10000, 'Temporal output did not respond to moving input');
      movingPlayback.paused = true; advance(100); const frozen = pixels();
      for (let i = 0; i < 4; i++) { resizes.get(canvas)(); assert(difference(frozen, pixels()) === 0, 'Paused forced redraw accumulated feedback'); }
      temporal.enabled = false; advance(100); const currentInput = pixels(); captureFrame('trails-moving-current-input');
      assert(difference(trailed, currentInput) > 10000 && stats.live.Texture.size === 0, 'History was simulated or bypass did not release feedback');
      temporal.enabled = true; advance(100);
      assert(maxDifference(currentInput, pixels()) <= 1, 'Enable transition failed to reset history');
      temporal.layers[0].values.mode = 'Datamosh'; advance(100);
      gpuProgram = gl.getParameter(gl.CURRENT_PROGRAM); // copy presentation follows temporal shader
      movingPlayback.paused = false; advance(100); advance(1000 / 60);
      temporal.layers.push(layer('trails-b', 'datamosh-trails', { intensity: 1, mode: 'Datamosh', persistence: 0.99, decay: 0.99, displacement: 1, blockSize: 8 })); advance(1000 / 60);
      assert(stats.live.Texture.size === 6, 'Two temporal instances did not own independent history pairs');
      for (let i = 0; i < 20; i++) advance(1000 / 60);
      pixels(); captureFrame('datamosh-two-instances');
      movingPlayback.paused = true; advance(100);
      resize(181, 319); const resizedHistory = pixels(); captureFrame('datamosh-portrait-reset');
      temporal.enabled = false; advance(100);
      assert(maxDifference(resizedHistory, pixels()) <= 1, 'Temporal resize retained stale history content/dimensions');
      temporal.enabled = true; advance(100);
      temporal.layers[0].values.intensity = 0; advance(100);
      assert(stats.live.Texture.size === 4, 'Intensity-zero instance retained history buffers');
      temporal.layers = [layer('bloom', 'bloom'), layer('trails', 'datamosh-trails'), layer('copy', 'copy')]; advance(100);
      assert(stats.live.Texture.size === 5, 'Bloom + temporal resource bound violated');
      pixels(); captureFrame('bloom-trails-stack');
      const temporalWarnings = advancedStatuses.filter(status => status.message).length;
      temporal.enabled = false; advance(100);
      temporal.layers = [layer('temporal-fail', 'datamosh-trails')]; temporal.enabled = true;
      // Fail the second history framebuffer, after successfully allocating scratch/first history.
      let checksLeft = 3;
      const nativeStatus = gl.checkFramebufferStatus;
      gl.checkFramebufferStatus = target => --checksLeft === 0 ? gl.FRAMEBUFFER_UNSUPPORTED : nativeStatus(target);
      advance(100); assert(stats.live.Texture.size === 0, 'Partial history allocation failure leaked buffers');
      assert(advancedStatuses.filter(status => status.message).length === temporalWarnings + 1, 'History failure lacked diagnostic');
      const failedHistoryOutput = pixels(); advance(100);
      assert(stats.live.Texture.size === 0, 'Failed history allocation retried without an edit');
      gl.checkFramebufferStatus = nativeStatus;
      temporal.layers[0].values.persistence = 0.8; advance(100);
      assert(maxDifference(failedHistoryOutput, pixels()) <= 1 && advancedStatuses.at(-1).message === '', 'History allocation recovery did not safely reinitialize/clear warning');
      stop(); clean();

      // Labeled dark/colorful/geometric advanced-effect and maximum-control captures.
      for (const [name, fixture] of [['dark', shaderRegistry['star-drift']], ['colorful', shaderRegistry.plasma], ['geometric', shaderRegistry['kinetic-tiles']]]) {
        host.style.width = '257px'; host.style.height = '129px';
        const visualStack = { enabled: true, layers: [layer('bloom', 'bloom')] };
        stop = mountShader(canvas, fixture, { speed: 1 }, 60, undefined, { effects: visualStack, onEffectStatus: status => advancedStatuses.push(status) });
        advance(100); pixels(); captureFrame('advanced-' + name + '-bloom-default');
        visualStack.layers[0].values = { intensity: 1, threshold: 0, radius: 16, strength: 1 };
        advance(100); pixels(); captureFrame('advanced-' + name + '-bloom-max');
        visualStack.layers = [layer('trails', 'datamosh-trails', { intensity: 1, mode: 'Datamosh', persistence: 1, decay: 1, displacement: 1, blockSize: 96 })];
        for (let i = 0; i < 24; i++) advance(1000 / 60);
        pixels(); captureFrame('advanced-' + name + '-datamosh-max');
        stop(); clean();
      }

      // Every temporal control is checked against the same moving-input/time
      // sequence on a fresh mount (editing intentionally resets feedback).
      host.style.width = '257px'; host.style.height = '129px';
      const temporalFixture = (values, name, definition = movingBase, frames = 60, step = 1000 / 60) => {
        const stack = { enabled: true, layers: [layer('control', 'datamosh-trails', values)] };
        const fixtureStop = mountShader(canvas, definition, { speed: 1 }, 60, undefined, { effects: stack, onEffectStatus: status => advancedStatuses.push(status) });
        for (let i = 0; i < frames; i++) advance(step);
        const output = pixels(); if (name) captureFrame(name);
        fixtureStop(); clean(); return output;
      };
      const trailValues = { intensity: 1, mode: 'Trails', persistence: 0.97, decay: 1, displacement: 0, blockSize: 24 };
      const controlTrail = temporalFixture(trailValues, 'trails-controls-default');
      const noFeedback = temporalFixture({ ...trailValues, persistence: 0 });
      const zeroFeedback = temporalFixture({ ...trailValues, intensity: 0 });
      assert(maxDifference(noFeedback, zeroFeedback) <= 1 && difference(controlTrail, noFeedback) > 10000, 'Temporal persistence/intensity did not control real feedback');
      const halfFeedback = temporalFixture({ ...trailValues, intensity: 0.5 });
      assert(difference(halfFeedback, controlTrail) > 1000 && difference(halfFeedback, noFeedback) > 1000, 'Temporal intensity did not blend feedback');
      const decayed = temporalFixture({ ...trailValues, decay: 0.7 });
      assert(difference(controlTrail, decayed) > 1000, 'Temporal decay had no visible effect');
      const displaced = temporalFixture({ ...trailValues, displacement: 1 });
      assert(difference(controlTrail, displaced) > 1000, 'Trails displacement had no visible effect');
      const blocks = temporalFixture({ ...trailValues, mode: 'Datamosh', displacement: 1, blockSize: 24 }, 'datamosh-controls-max-displacement');
      assert(difference(displaced, blocks) > 1000, 'Datamosh mode did not produce distinct local block displacement');
      const smallBlocks = temporalFixture({ ...trailValues, mode: 'Datamosh', displacement: 1, blockSize: 4 });
      const largeBlocks = temporalFixture({ ...trailValues, mode: 'Datamosh', displacement: 1, blockSize: 96 });
      assert(difference(smallBlocks, largeBlocks) > 1000, 'Datamosh block size had no visible effect');
      const stepBase = { ...base, source: 'precision highp float;uniform float uTime;void main(){gl_FragColor=vec4(vec3(uTime<0.001?1.0:0.2),1.0);}' };
      const sixty = temporalFixture(trailValues, undefined, stepBase, 60, 1000 / 60);
      const thirty = temporalFixture(trailValues, undefined, stepBase, 30, 1000 / 30);
      assert(maxDifference(sixty, thirty) <= 5, 'Temporal persistence did not adjust for frame rate (RGBA8 tolerance)');
      assert(advancedStatuses.every(status => !status.message || status.message.includes('Effect stack bypassed')), 'Advanced shaders produced an unexpected compilation diagnostic');

      // Exact numerical independence: each feedback instance increments its own
      // previous output once, not another instance's surface or this frame's input.
      host.style.width = '161px'; host.style.height = '91px';
      const independence = { enabled: true, layers: [layer('feedback-a', 'historyAdd'), layer('feedback-b', 'historyAdd')] };
      const runningPlayback = { paused: false };
      stop = mountShader(canvas, base, { speed: 0 }, 60, runningPlayback, { effects: independence });
      const startRed = middleRed(); advance(1000 / 60);
      assert(Math.abs(middleRed() - startRed - 26) <= 1, 'Temporal instances shared or repeatedly advanced history');
      advance(1000 / 60);
      assert(Math.abs(middleRed() - startRed - 52) <= 2, 'History did not persist per instance');
      runningPlayback.paused = true; advance(100); const repeatHistory = pixels();
      resizes.get(canvas)(); resizes.get(canvas)(); assert(difference(repeatHistory, pixels()) === 0, 'Synthetic paused repeat accumulated');
      independence.layers.reverse(); advance(100); assert(Math.abs(middleRed() - startRed) <= 1, 'Reorder failed to reset temporal state');
      independence.layers = Array.from({ length: 10 }, (_, i) => layer('bounded-' + i, 'datamosh-trails'));
      advance(100); pixels(); assert(stats.live.Texture.size === 18, 'Eight-layer temporal allocation bound was not enforced');
      independence.layers = []; advance(100); assert(stats.live.Texture.size === 0, 'Removal did not release all histories');
      stop(); clean();

      // A separate DPR-2 mount verifies drawing-buffer-sized, not CSS-sized targets.
      const hi = document.createElement('canvas'); hi.style.width = '163px'; hi.style.height = '93px'; document.body.append(hi);
      const hiNative = hi.getContext.bind(hi), hiSizes = [];
      let hiTracked;
      hi.getContext = (name, ...args) => {
        if (contextType === 'webgl' && name === 'webgl2') return null;
        const context = hiNative(name, ...args);
        if (context && !hiTracked) {
          hiTracked = context;
          const upload = context.texImage2D.bind(context);
          context.texImage2D = (...params) => { hiSizes.push([params[3], params[4]]); return upload(...params); };
        }
        return context;
      };
      const oldDpr = devicePixelRatio;
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
      const hiStop = mountShader(hi, base, { speed: 0 }, 60, undefined, { effects: { enabled: true, layers: [layer('hi-bloom', 'bloom'), layer('hi-history', 'datamosh-trails')] } });
      const hiGl = hiNative(contextType), hiProgram = hiGl.getParameter(hiGl.CURRENT_PROGRAM);
      // The last program is the temporal presentation copy. Inspect the physical
      // framebuffer dimensions and render at DPR2 through both advanced layers.
      assert(hiGl.drawingBufferWidth === 326 && hiGl.drawingBufferHeight === 186 && hiGl.isProgram(hiProgram) && hiSizes.length === 5 && hiSizes.every(([width, height]) => width === 326 && height === 186), 'DPR2 scratch/history targets use CSS dimensions');
      assert(hiGl.getError() === hiGl.NO_ERROR, 'DPR2 GL error'); hiStop();
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: oldDpr });
      hiGl.getExtension('WEBGL_lose_context')?.loseContext(); hi.remove();
      assert(stats.peakTextures <= 18 && stats.created.Renderbuffer === 0 && stats.mipmaps === 0, 'Excess scratch/history targets, depth attachment or mipmaps');
      reports.push({ contextType, peakTargets: stats.peakTextures, programs: stats.created.Program, textureUploads: stats.textureUploads, warnings: warningCount(), advancedExpectedWarnings: advancedStatuses.filter(status => status.message).length });
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
  console.log('Effect orientation, ordering, multipass original preservation/bloom, typed uploads, independent persistent feedback, paused repeats, bypass/reset, NPOT/DPR resize, failures, remount and GL resource cleanup passed in WebGL 1 and 2 (Electron software GL)');
  finish(app, { win, temporary });
}).catch(error => { console.error(error); finish(app, { temporary, exitCode: 1 }); });

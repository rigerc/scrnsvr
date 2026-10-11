// Standalone GPU ground truth for the 14 single-pass catalog shaders. No runtime
// registry merge is required. Capture artifacts are optional and kept outside the repo.
const fs = require('node:fs');
const path = require('node:path');
const { reexecUnderElectron, createHarness, bundleSource, finish } = require('./lib/electron-harness.cjs');
reexecUnderElectron();
const { app, BrowserWindow } = require('electron');
const temporary = createHarness({ prefix: 'scrnsvr-catalog-check-' });
const captureArg = process.argv.indexOf('--capture-dir');
const captureDir = captureArg < 0 ? undefined : process.argv[captureArg + 1];
if (captureArg >= 0 && !captureDir) throw Error('--capture-dir requires a directory');

app.whenReady().then(async () => {
  const source = bundleSource(`import { additionalEffectRegistry } from './src/renderer/effects/catalog';
    window.catalog = additionalEffectRegistry;`);
  const win = new BrowserWindow({ show: false, width: 1000, height: 700,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  await win.loadURL('data:text/html,<body></body>');
  await win.webContents.executeJavaScript(source);
  const result = await win.webContents.executeJavaScript(`(() => { try { return (${function checks(capture) {
    const assert = (ok, message) => { if (!ok) throw Error(message); };
    const diff = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
    const maxDiff = (a, b) => a.reduce((max, v, i) => Math.max(max, Math.abs(v - b[i])), 0);
    const captures = [], reports = [];
    assert(Object.keys(window.catalog).length === 14, 'Expected 14 additional effects');
    for (const contextType of ['webgl', 'webgl2']) {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext(contextType, { alpha: false, antialias: false, preserveDrawingBuffer: true });
      assert(gl, contextType + ' unavailable');
      const shader = (type, source) => {
        const object = gl.createShader(type); gl.shaderSource(object, source); gl.compileShader(object);
        assert(gl.getShaderParameter(object, gl.COMPILE_STATUS), contextType + ': ' + gl.getShaderInfoLog(object));
        return object;
      };
      const vertex = shader(gl.VERTEX_SHADER, 'attribute vec2 position; varying vec2 vUv; void main(){vUv=position*0.5+0.5;gl_Position=vec4(position,0.0,1.0);}');
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const textures = [gl.createTexture(), gl.createTexture()];
      let width, height, fixturePixels;
      const upload = (texture, unit, data) => {
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      };
      const setFixture = (w, h, kind = 'colorful') => {
        width = canvas.width = w; height = canvas.height = h;
        gl.viewport(0, 0, width, height);
        fixturePixels = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const u = (x + 0.5) / width, v = (y + 0.5) / height;
          const checker = (Math.floor(x / 7) + Math.floor(y / 11)) % 2;
          const spot = Math.exp(-((u - 0.31) ** 2 + (v - 0.72) ** 2) * 90);
          const stripe = Math.sin(u * 87 + v * 43) * 0.07;
          let rgb = [0.12 + u * 0.64 + checker * 0.12, 0.09 + v * 0.68 + spot * 0.18, 0.14 + (1 - u) * 0.48 + stripe];
          if (kind === 'dark') rgb = rgb.map(c => c * 0.12 + spot * 0.8);
          if (kind === 'geometric') rgb = [checker ? 0.92 : 0.08, u < 0.3 ? 0.8 : 0.18, v < 0.6 ? 0.2 : 0.9];
          // Distinct edge markings make wrapping, orientation and black padding visible.
          if (x < 2) rgb = [0.9, 0.14, 0.25];
          if (y < 2) rgb = [0.1, 0.8, 0.3];
          if (x >= width - 2) rgb = [0.25, 0.15, 0.95];
          if (y >= height - 2) rgb = [0.95, 0.7, 0.12];
          const offset = (y * width + x) * 4;
          rgb.forEach((c, i) => { fixturePixels[offset + i] = Math.round(Math.max(0, Math.min(1, c)) * 255); });
          fixturePixels[offset + 3] = 255;
        }
        upload(textures[0], 0, fixturePixels); upload(textures[1], 1, fixturePixels);
      };
      const record = name => {
        if (capture) captures.push({ contextType, name, width, height, png: canvas.toDataURL('image/png') });
      };
      const programs = new Map();
      for (const [id, definition] of Object.entries(window.catalog)) {
        const fragment = shader(gl.FRAGMENT_SHADER, definition.source);
        const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
        assert(gl.getProgramParameter(program, gl.LINK_STATUS), id + ': ' + gl.getProgramInfoLog(program));
        gl.deleteShader(fragment);
        const active = {};
        for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
          const uniform = gl.getActiveUniform(program, i); active[uniform.name] = uniform.type;
        }
        for (const uniform of definition.uniforms) {
          const type = { float: gl.FLOAT, int: gl.INT, bool: gl.BOOL, select: gl.INT, color: gl.FLOAT_VEC3 }[uniform.type];
          assert(active[uniform.name] === type, id + ': inactive or mistyped ' + uniform.name);
        }
        programs.set(id, program);
      }
      const defaults = definition => Object.fromEntries(definition.uniforms.map(u => [u.name, u.default]));
      const bound = (u, high) => u.type === 'color' ? (high ? '#ff4080' : '#2040ff') :
        u.type === 'bool' ? high : u.type === 'select' ? u.options[high ? u.options.length - 1 : 0] : high ? u.max : u.min;
      const render = (id, values = {}, time = 2.15) => {
        const definition = window.catalog[id], program = programs.get(id);
        gl.useProgram(program);
        const attribute = gl.getAttribLocation(program, 'position');
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1i(gl.getUniformLocation(program, 'uInput'), 0);
        gl.uniform1i(gl.getUniformLocation(program, 'uOriginal'), 1);
        gl.uniform2f(gl.getUniformLocation(program, 'uResolution'), width, height);
        gl.uniform1f(gl.getUniformLocation(program, 'uTime'), time);
        gl.uniform1f(gl.getUniformLocation(program, 'uDelta'), 1 / 60);
        const settings = { ...defaults(definition), ...values };
        for (const uniform of definition.uniforms) {
          const location = gl.getUniformLocation(program, uniform.name), value = settings[uniform.name];
          if (uniform.type === 'float') gl.uniform1f(location, value);
          else if (uniform.type === 'int' || uniform.type === 'bool') gl.uniform1i(location, Number(value));
          else if (uniform.type === 'select') gl.uniform1i(location, uniform.options.indexOf(value));
          else if (uniform.type === 'color') gl.uniform3fv(location, [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255));
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const data = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        assert(gl.getError() === gl.NO_ERROR, contextType + ': ' + id + ' GL error');
        assert(data.every((v, i) => i % 4 !== 3 || v === 255), id + ': wrong alpha');
        return data;
      };
      const controlReports = [];
      setFixture(161, 91);
      for (const [id, definition] of Object.entries(window.catalog)) {
        const zero = render(id, { intensity: 0 });
        assert(maxDiff(zero, fixturePixels) <= 1, id + ': zero intensity inverted/changed source');
        // Strong, isolated controls reveal weak adjustments even on low-detail input.
        const strong = { intensity: 1 };
        if (id === 'digital-glitch') Object.assign(strong, { frequency: 1, displacement: 0.7, colorSplit: 0.7 });
        const base = render(id, strong);
        assert(diff(base, fixturePixels) > 0.05, id + ': default has no visible effect');
        for (const uniform of definition.uniforms) {
          const low = render(id, { ...strong, [uniform.name]: bound(uniform, false) });
          const high = render(id, { ...strong, [uniform.name]: bound(uniform, true) });
          // Angular extrema can be equivalent (e.g. +/-180 degrees with six
          // mirrored wedges). Probe an off-axis interior value as well.
          const interiorValue = uniform.type === 'float' || uniform.type === 'int' ?
            uniform.min + (uniform.max - uniform.min) * 0.37 : uniform.default;
          const interior = render(id, { ...strong, [uniform.name]: uniform.type === 'int' ? Math.round(interiorValue) : interiorValue });
          const response = Math.max(diff(base, low), diff(base, high), diff(low, high), diff(base, interior));
          assert(response > 0.02, id + ': control had no measurable response: ' + uniform.name + ' (' + response + ')');
          controlReports.push({ id, control: uniform.name, meanByteDifference: Number(response.toFixed(3)) });
          if (uniform.type === 'select') {
            const options = uniform.options.map(value => render(id, { ...strong, [uniform.name]: value }));
            for (let i = 0; i < options.length; i++) for (let j = i + 1; j < options.length; j++)
              assert(diff(options[i], options[j]) > 0.1, id + ': indistinguishable select options');
          }
        }
        // Different uOriginal checks the layer-boundary blend, not merely uInput.
        const original = new Uint8Array(fixturePixels.length);
        for (let i = 0; i < original.length; i += 4) original.set([29, 53, 97, 255], i);
        upload(textures[1], 1, original);
        const bypass = render(id, { ...strong, intensity: 0 });
        assert(maxDiff(bypass, original) === 0, id + ': uOriginal ignored');
        const full = render(id, strong), half = render(id, { ...strong, intensity: 0.5 });
        const expected = full.map((v, i) => Math.round((v + original[i]) * 0.5));
        assert(maxDiff(half, expected) <= 1, id + ': intensity is not a full-image original blend');
        upload(textures[1], 1, fixturePixels);
        const animated = ['analog-film', 'digital-glitch', 'liquid-glass'].includes(id);
        const first = render(id, strong, 1.15), second = render(id, strong, 4.15);
        assert(animated ? diff(first, second) > 0.02 : maxDiff(first, second) === 0, id + ': incorrect static/animated classification');
        assert(maxDiff(first, render(id, strong, 1.15)) === 0, id + ': fixed-time nondeterminism');
        if (id === 'digital-glitch') {
          assert(maxDiff(render(id, { ...strong, frequency: 0 }, 1.15), fixturePixels) <= 1, 'Frequency zero must suppress glitches');
          assert(maxDiff(render(id, { ...strong, frequency: 0 }, 1.15), render(id, { ...strong, frequency: 0 }, 4.15)) === 0, 'Frequency zero motion');
        }
        if (id === 'liquid-glass') assert(maxDiff(render(id, { speed: 0 }, 1), render(id, { speed: 0 }, 7)) === 0, 'Speed zero motion');
      }
      // Individual extrema plus all-min/all-max at portrait, landscape, odd and
      // DPR-2-equivalent physical sizes. No CSS dimensions are used by shaders.
      for (const [w, h] of [[257, 129], [129, 257], [326, 186], [1, 1]]) {
        setFixture(w, h);
        for (const [id, definition] of Object.entries(window.catalog)) {
          for (const high of [false, true]) {
            const values = Object.fromEntries(definition.uniforms.map(u => [u.name, bound(u, high)]));
            values.intensity = 1;
            const data = render(id, values);
            // Stylization intentionally permits black ink/shadows, but geometric
            // sampling effects should never invent uninitialized black pixels.
            if (['pixelate', 'kaleidoscope', 'dream-blur', 'digital-glitch', 'lens-distortion', 'liquid-glass'].includes(id)) {
              assert(data.every((v, i) => i % 4 === 3 || v >= 15), id + ': black/clipped/wrapped sample at ' + w + 'x' + h);
            }
            for (const uniform of definition.uniforms) render(id, { intensity: 1, [uniform.name]: bound(uniform, high) });
          }
          assert(maxDiff(render(id, { intensity: 0 }), fixturePixels) <= 1, id + ': bounds orientation');
        }
      }
      // GPU-neutral controls preserve orientation and all four asymmetric edges.
      setFixture(161, 91);
      for (const [id, values] of Object.entries({
        'crt-monitor': { curvature: 0, maskStrength: 0, scanlines: 0, edgeFalloff: 0 },
        'analog-film': { grain: 0, warmth: 0, fade: 0, exposureDrift: 0 },
        pixelate: { pixelSize: 1, gridAspect: 1 },
        'chromatic-aberration': { amount: 0 }, 'dream-blur': { radius: 0 },
        'digital-glitch': { frequency: 0 }, 'lens-distortion': { distortion: 0, zoom: 1 },
        'color-grade': { warmth: 0, tint: 0, contrast: 1, saturation: 1, fade: 0 },
        vignette: { strength: 0 }, 'liquid-glass': { strength: 0 },
      })) assert(maxDiff(render(id, { intensity: 1, ...values }), fixturePixels) <= 1, id + ': neutral controls changed/inverted input');
      // Pixelate -> Dither -> CRT: distinct successive input textures, no sampling
      // from a render target. Readback/upload here deliberately avoids pipeline scope.
      for (const id of ['pixelate', 'ordered-dither', 'crt-monitor']) {
        const output = render(id); upload(textures[0], 0, output); upload(textures[1], 1, output);
      }
      record('combination-pixelate-dither-crt');
      for (const kind of ['colorful', 'dark', 'geometric']) {
        setFixture(193, 109, kind); render('pixelate', { intensity: 0 }); record(kind + '-source');
        for (const [id, definition] of Object.entries(window.catalog)) {
          render(id); record(kind + '-' + id + '-default');
          const maximum = Object.fromEntries(definition.uniforms.map(u => [u.name, bound(u, true)]));
          render(id, maximum); record(kind + '-' + id + '-max');
        }
      }
      setFixture(109, 193);
      for (const id of Object.keys(window.catalog)) { render(id); record('portrait-' + id); }
      setFixture(193, 109, 'geometric');
      for (const id of ['analog-film', 'digital-glitch', 'liquid-glass']) {
        for (const time of [0.05, 0.15, 0.25, 0.35, 1.15, 4.15]) {
          const values = id === 'digital-glitch' ? { intensity: 1, frequency: 1, displacement: 0.5, colorSplit: 0.5 } : { intensity: 1 };
          render(id, values, time); record('motion-' + id + '-t' + time);
        }
      }
      // Unbind the current program first: GL defers deleting an in-use program,
      // and its attached vertex shader, until it stops being current.
      gl.useProgram(null);
      for (const program of programs.values()) gl.deleteProgram(program);
      gl.deleteShader(vertex); gl.deleteBuffer(buffer); textures.forEach(texture => gl.deleteTexture(texture));
      assert([...programs.values()].every(program => !gl.isProgram(program)) &&
        textures.every(texture => !gl.isTexture(texture)) && !gl.isBuffer(buffer) && !gl.isShader(vertex), 'Leaked standalone GPU resources');
      assert(gl.getError() === gl.NO_ERROR, 'Teardown GL error');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      reports.push({ contextType, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), compiledEffects: programs.size,
        responsiveControls: controlReports.length, controls: controlReports });
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    return { reports, captures };
  }.toString()})(${Boolean(captureDir)}); } catch (error) { console.error(error.stack); throw error; } })()`);
  if (captureDir) {
    fs.mkdirSync(captureDir, { recursive: true });
    fs.writeFileSync(path.join(captureDir, 'gpu-report.json'), JSON.stringify(result.reports, null, 2));
    for (const entry of result.captures) fs.writeFileSync(path.join(captureDir, entry.contextType + '-' + entry.name + '.png'), Buffer.from(entry.png.split(',')[1], 'base64'));
    await win.webContents.executeJavaScript(`window.captures = ${JSON.stringify(result.captures)}`);
    for (const version of ['webgl', 'webgl2']) for (const motionOnly of [false, true]) {
      const sheet = await win.webContents.executeJavaScript(`(async () => {
        const entries = window.captures.filter(c => c.contextType === '${version}' && c.name.startsWith('motion-') === ${motionOnly});
        const columns = ${motionOnly ? 6 : 5};
        const sheet = document.createElement('canvas'); sheet.width = columns * 220; sheet.height = Math.ceil(entries.length / columns) * 225;
        const ctx = sheet.getContext('2d'); ctx.fillStyle = '#202028'; ctx.fillRect(0, 0, sheet.width, sheet.height);
        for (const [i, entry] of entries.entries()) {
          const image = new Image(); image.src = entry.png; await image.decode();
          const x = i % columns * 220, y = Math.floor(i / columns) * 225;
          const scale = Math.min(210 / entry.width, 190 / entry.height);
          ctx.drawImage(image, x, y, entry.width * scale, entry.height * scale);
          ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif';
          ctx.fillText(entry.name, x + 2, y + 206, 215);
        }
        return sheet.toDataURL('image/png');
      })()`);
      fs.writeFileSync(path.join(captureDir, version + (motionOnly ? '-motion-sheet.png' : '-contact-sheet.png')), Buffer.from(sheet.split(',')[1], 'base64'));
    }
    console.log('Visual captures: ' + path.resolve(captureDir));
  }
  console.log(JSON.stringify(result.reports.map(({ controls, ...summary }) => summary)));
  console.log('Catalog WebGL1/2 compile/link, typed controls, bounds, orientation, blend, static/motion, combination and GPU teardown checks passed');
  finish(app, { win, temporary });
}).catch(error => { console.error(error); finish(app, { temporary, exitCode: 1 }); });

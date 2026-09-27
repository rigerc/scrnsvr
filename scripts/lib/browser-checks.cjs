// Self-contained browser-side checks injected into the settings/renderer page.
//
// `check-shaders.cjs` serializes these functions into the page with
// `browserPrelude()`; they must not rely on imports or Node globals. Helpers are
// injected by name as page-scope `const` bindings, so a function may call its
// siblings freely but must never reference a module outside this file.

function compileStage(gl, type, source, label, assert) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  assert(gl.getShaderParameter(shader, gl.COMPILE_STATUS), label + ': ' + gl.getShaderInfoLog(shader));
  return shader;
}

function applyUniform(gl, location, definition, value) {
  if (definition.type === 'color') {
    const n = parseInt(value.slice(1), 16);
    gl.uniform3f(location, ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  } else if (definition.type === 'select') gl.uniform1i(location, definition.options.indexOf(value));
  else if (definition.type === 'int' || definition.type === 'bool') gl.uniform1i(location, Number(value));
  else gl.uniform1f(location, value);
}

/** Create a WebGL context plus program/render/pixel-diff helpers for one context type. */
function createGlHarness(canvas, contextType) {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const gl = canvas.getContext(contextType, { preserveDrawingBuffer: true, alpha: false });
  assert(gl, 'Missing ' + contextType);
  const vertex = compileStage(gl, gl.VERTEX_SHADER, 'attribute vec2 position; varying vec2 vUv; void main(){vUv=position*.5+.5;gl_Position=vec4(position,0.,1.);}', 'vertex', assert);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  let checks = 0;
  const createProgram = definition => {
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    const fragment = compileStage(gl, gl.FRAGMENT_SHADER, definition.source, definition.manifest.id, assert);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(fragment);
    assert(gl.getProgramParameter(program, gl.LINK_STATUS), definition.manifest.id + ': ' + gl.getProgramInfoLog(program));
    return program;
  };
  const render = (id, program, definition, time = 12, overrides = {}, width = 320, height = 180) => {
    checks++;
    canvas.width = width; canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(gl.getUniformLocation(program, 'uTime'), time);
    gl.uniform2f(gl.getUniformLocation(program, 'uResolution'), width, height);
    // 13:00:00 so the 12-hour toggle changes the rendered hour.
    gl.uniform4f(gl.getUniformLocation(program, 'uDate'), 2026, 9, 10, 46800);
    gl.uniform4fv(gl.getUniformLocation(program, 'uAudio'), overrides.audio ?? [0.25, 0.3, 0.2, 0.15]);
    for (const def of definition.manifest.uniforms) {
      const value = overrides[def.name] ?? def.default;
      const location = gl.getUniformLocation(program, def.name);
      assert(location !== null, id + ': unused uniform ' + def.name);
      applyUniform(gl, location, def, value);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    assert(gl.getError() === gl.NO_ERROR, id + ': GL error');
    return pixels;
  };
  const difference = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / (a.length * 0.75);
  const dispose = () => {
    gl.deleteShader(vertex); gl.deleteBuffer(buffer);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
  return { gl, assert, createProgram, render, difference, dispose, count: () => checks };
}

/** A scene must move across sizes and freeze exactly at zero speed. */
function assertAnimation(harness, id, definition, program) {
  const { assert, render, difference } = harness;
  for (const [width, height] of [[640, 360], [360, 640], [180, 90], [960, 270]]) {
    assert(difference(render(id, program, definition, 0, {}, width, height), render(id, program, definition, 20, {}, width, height)) > 0.001, id + ': blank or static scene');
  }
  assert(difference(render(id, program, definition, 0, { speed: 0 }), render(id, program, definition, 100, { speed: 0 })) === 0, id + ': zero speed does not freeze');
}

/** Ambient response should be visible after sustained sound, but restrained. */
function assertReactiveAudio(harness, id, definition, program) {
  const { assert, render, difference } = harness;
  const audioDelta = difference(render(id, program, definition, 12, { audio: [0, 0, 0, 0] }), render(id, program, definition, 12, { audio: [0.6, 0.8, 0.5, 0.4] }));
  assert(audioDelta > 1.5 && audioDelta < 12, id + ': audio response outside ambient range (' + audioDelta + ')');
  assert(difference(render(id, program, definition, 12, { speed: 0, audio: [0, 0, 0, 0] }), render(id, program, definition, 12, { speed: 0, audio: [1, 1, 1, 1] })) > 0.25, id + ': zero speed must retain audio response');
  assert(difference(render(id, program, definition, 12, { sensitivity: 0, audio: [0, 0, 0, 0] }), render(id, program, definition, 12, { sensitivity: 0, audio: [1, 1, 1, 1] })) === 0, id + ': sensitivity zero must disable audio response');
}

function assertGrayscale(harness, id, definition, program) {
  const { assert, render } = harness;
  const gray = render(id, program, definition, 12, { saturation: 0 });
  for (let i = 0; i < gray.length; i += 4) assert(gray[i] === gray[i + 1] && gray[i] === gray[i + 2], id + ': saturation zero is not grayscale');
}

/** A zero march distance used to produce thousands of isolated black pixels inside white highlights. */
function assertWaveformSpeckles(harness, id, program, definition) {
  const { assert, render } = harness;
  const width = 640, height = 360;
  const pixels = render(id, program, definition, 12, {}, width, height);
  const white = index => pixels[index] > 220 && pixels[index + 1] > 220 && pixels[index + 2] > 220;
  let speckles = 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const index = (y * width + x) * 4;
    if (pixels[index] < 32 && pixels[index + 1] < 32 && pixels[index + 2] < 32
      && white(index - 4) && white(index + 4)
      && white(index - width * 4) && white(index + width * 4)) speckles++;
  }
  assert(speckles === 0, id + ': ' + speckles + ' black speckles in white highlights');
}

/** Every declared control must change the rendered result, and bounds must render. */
function assertUniformEffects(harness, id, definition, program) {
  const { assert, render, difference } = harness;
  for (const def of definition.manifest.uniforms) {
    const dependencies = def.visibleWhen ? { [def.visibleWhen.name]: def.visibleWhen.value } : {};
    const interior = def.type === 'int' ? Math.round(def.min + (def.max - def.min) * 0.37) : def.min + (def.max - def.min) * 0.37;
    const variants = def.type === 'color' ? ['#000000', '#ffffff'] : def.type === 'bool' ? [false, true] : def.type === 'select' ? def.options : [def.min, interior, def.default, def.max];
    const frames = variants.map(value => render(id, program, definition, 12, { ...dependencies, [def.name]: value }, 640, 360));
    assert(frames.slice(1).some(frame => difference(frames[0], frame) > 0.001), id + ': ' + def.name + ' has no visual effect');
  }
  for (const bound of ['min', 'max']) {
    const values = Object.fromEntries(definition.manifest.uniforms.filter(d => d.type === 'float' || d.type === 'int').map(d => [d.name, d[bound]]));
    render(id, program, definition, 86400, values, 180, 320);
  }
  render(id, program, definition, 86400);
}

/** Optional regression comparison against an older registry build. */
function assertBaseline(harness, id, baseline, definition, program) {
  if (!baseline?.[id]) return undefined;
  const { gl, assert, render, difference, createProgram } = harness;
  const oldProgram = createProgram(baseline[id]);
  let defaultDifference = 0;
  const legacy = Object.fromEntries(baseline[id].manifest.uniforms.map(d => [d.name, d.type === 'color' ? '#376ba9' : d.type === 'float' ? Math.min(d.max, Number(d.default) * 1.17) : d.default]));
  for (const values of [{}, legacy]) for (const time of [0, 12, 120]) {
    const delta = difference(render(id, program, definition, time, values), render(id, oldProgram, baseline[id], time, values, 320, 180));
    defaultDifference = Math.max(defaultDifference, delta);
    assert(delta < 0.8, id + ': default/preset appearance changed (' + delta.toFixed(3) + ' channel levels)');
  }
  gl.deleteProgram(oldProgram);
  return defaultDifference;
}

/** CPU readback includes software rendering; this is a regression measurement, not hardware FPS. */
function measureRender(harness, id, definition, program) {
  const { render } = harness;
  render(id, program, definition, 12, {}, 1920, 1080);
  const start = performance.now();
  render(id, program, definition, 13, {}, 1920, 1080);
  return Math.round(performance.now() - start);
}

function renderChecks(registry, baseline, contextType) {
  const harness = createGlHarness(document.createElement('canvas'), contextType);
  const reports = [];
  for (const [id, definition] of Object.entries(registry)) {
    const program = harness.createProgram(definition);
    assertAnimation(harness, id, definition, program);
    if (definition.manifest.category === 'Reactive') assertReactiveAudio(harness, id, definition, program);
    assertGrayscale(harness, id, definition, program);
    if (id === 'shadersaver-waveform') assertWaveformSpeckles(harness, id, program, definition);
    assertUniformEffects(harness, id, definition, program);
    const defaultDifference = assertBaseline(harness, id, baseline, definition, program);
    const renderMs = measureRender(harness, id, definition, program);
    reports.push({ id, parameters: definition.manifest.uniforms.length, renderMs, ...(defaultDifference === undefined ? {} : { defaultDifference: Number(defaultDifference.toFixed(3)) }) });
    harness.gl.deleteProgram(program);
  }
  harness.dispose();
  return { contextType, checks: harness.count(), reports };
}

/** Drive the mounted settings UI, then assert persisted state through the real preload IPC. */
async function uiChecks(registry) {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const input = (name, value, event = 'input') => {
    const control = document.querySelector(`[data-name="${name}"]`);
    assert(control, `Missing ${name}`); control.value = String(value); control.dispatchEvent(new Event(event, { bubbles: true }));
    return control;
  };
  const mainCanvas = document.querySelector('.preview');
  const mainContext = mainCanvas.getContext('webgl2') ?? mainCanvas.getContext('webgl');
  const mainRenderer = mainContext.renderer;
  const sample = document.createElement('canvas');
  sample.width = 96; sample.height = 54;
  const sampleContext = sample.getContext('2d');
  const assertScene = async (canvas, label) => {
    // Some imported scenes fade in from black; sample before presentation
    // clears the non-preserved WebGL drawing buffer.
    const deadline = performance.now() + 4000;
    do {
      sampleContext.drawImage(canvas, 0, 0, 96, 54);
      const pixels = sampleContext.getImageData(0, 0, 96, 54).data;
      let min = 255, max = 0, opaque = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        min = Math.min(min, pixels[i], pixels[i + 1], pixels[i + 2]);
        max = Math.max(max, pixels[i], pixels[i + 1], pixels[i + 2]);
        opaque += pixels[i + 3];
      }
      if (opaque > 0 && max - min > 5) return;
      await new Promise(requestAnimationFrame);
    } while (performance.now() < deadline);
    throw Error(`${label}: blank, white or flat render`);
  };
  for (const [id, shader] of Object.entries(registry)) {
    document.querySelector(`.shader-select[data-id="${id}"]`).click();
    const preview = document.querySelector('.preview');
    const gl = preview.getContext('webgl2') ?? preview.getContext('webgl');
    assert(gl.renderer === mainRenderer, `${id}: replaced renderer state on the same context`);
    assert(!gl.isContextLost() && gl.getError() === gl.NO_ERROR, `${id}: preview context failed`);
    await assertScene(preview, `${id} preview`);
    assert(document.querySelectorAll('[data-control]').length === shader.manifest.uniforms.length, `${id}: missing controls`);
    assert(document.querySelectorAll('.shader-control-group:not([hidden])').length >= 3, `${id}: missing groups`);
  }
  // Exercise observer release/remount in both scroll directions. 2D targets
  // retain their last frame while offscreen and never consume a WebGL context.
  const cards = [...document.querySelectorAll('.shader-card')];
  for (const card of [...cards, ...cards.toReversed()]) {
    card.scrollIntoView({ block: 'center' });
    await new Promise(resolve => setTimeout(resolve, 100));
    const canvas = card.querySelector('canvas');
    assert(canvas.getContext('2d'), `${card.dataset.id}: thumbnail must share the gallery GPU context`);
    await assertScene(canvas, `${card.dataset.id} thumbnail`);
  }
  window.scrollTo(0, 0);
  document.querySelector('.shader-select[data-id="plasma"]').click();
  input('brightness', 0);
  const activeProgram = mainContext.getParameter(mainContext.CURRENT_PROGRAM);
  assert(activeProgram, 'Settings preview has an active WebGL program');
  const brightnessLocation = mainContext.getUniformLocation(activeProgram, 'brightness');
  assert(brightnessLocation, 'Plasma brightness uniform is active');
  const assertBrightness = async (expected, label) => {
    const deadline = performance.now() + 4000;
    do {
      if (Math.abs(mainContext.getUniform(activeProgram, brightnessLocation) - expected) < 0.001) return;
      await new Promise(requestAnimationFrame);
    } while (performance.now() < deadline);
    throw Error(`${label}: got ${mainContext.getUniform(activeProgram, brightnessLocation)}, expected ${expected}`);
  };
  await assertBrightness(0, 'Slider updates the running preview uniform');
  document.querySelector('[data-control="brightness"] .uniform-reset').click();
  await assertBrightness(1, 'Reset updates the running preview uniform');
  assert(document.querySelector('[data-control="color1"]').hidden, 'Custom colors initially hidden');
  document.querySelector('[data-action="import-noctalia"]').click();
  for (let i = 0; i < 100 && document.querySelector('[data-action="import-noctalia"]').disabled; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert(document.querySelector('[data-name="palette"]').value === 'custom', 'Noctalia selects custom palette');
  assert(document.querySelector('[data-name="color1"]').value === '#ebbcba', 'Noctalia updates custom colors');
  input('palette', 'custom');
  assert(!document.querySelector('[data-control="color1"]').hidden, 'Custom colors appear on mode change');
  input('color1', '#123456');
  input('speed', 0.5);
  document.querySelector('[data-preset]').value = 'Integration preset';
  document.querySelector('[data-action="save"]').click();
  input('speed', 1.5);
  const preset = [...document.querySelectorAll('.look-item')].find(item => item.querySelector('strong')?.textContent === 'Integration preset');
  assert(preset, 'Saved look appears in the list');
  preset.querySelector('button[aria-label="Apply Integration preset to current edits"]').click();
  assert(document.querySelector('[data-name="speed"]').value === '0.5', 'Preset restores motion');
  assert(document.querySelector('[data-name="color1"]').value === '#123456', 'Preset restores custom colors');
  preset.querySelector('button[aria-label="Add Integration preset to shuffle"]').click();
  document.querySelector('[data-preset]').value = 'Integration alternate';
  document.querySelector('[data-action="save"]').click();
  const alternate = [...document.querySelectorAll('.look-item')].find(item => item.querySelector('strong')?.textContent === 'Integration alternate');
  alternate.querySelector('button[aria-label="Add Integration alternate to shuffle"]').click();
  assert(document.querySelectorAll('.shuffle-item').length === 2, 'Two looks from one visual stay in shuffle');
  document.querySelector('[data-control="speed"] .uniform-reset').click();
  assert(Number(document.querySelector('[data-name="speed"]').value) === registry.plasma.manifest.uniforms.find(d => d.name === 'speed').default, 'Individual reset');
  assert(document.querySelector('[data-name="color1"]').value === '#123456', 'Individual reset preserves other controls');
  document.querySelector('.shader-select[data-id="contour-dunes"]').click();
  const advanced = document.querySelector('.shader-advanced'); advanced.open = true;
  const number = document.querySelector('[data-control="lineThickness"] input[type="number"]');
  number.focus(); number.value = '0.027'; number.dispatchEvent(new Event('change', { bubbles: true }));
  assert(number.value === '0.025', 'Numeric entry snaps to step');
  assert(document.activeElement === number, 'Numeric entry preserves focus');
  number.value = '0.04'; number.dispatchEvent(new Event('change', { bubbles: true }));
  assert(document.querySelector('[data-name="lineThickness"]').value === '0.04', 'Numeric entry updates slider');
  number.value = ''; number.dispatchEvent(new Event('change', { bubbles: true }));
  assert(number.value === '0.025', 'Empty numeric entry recovers default');
  document.querySelector('[data-action="random"]').click();
  assert(document.querySelector('.shader-advanced').open, 'Advanced remains open after randomize');
  document.querySelector('[data-action="reset"]').click();
  assert(document.querySelector('[data-name="lineThickness"]').value === '0.025', 'Shader reset restores new parameters');
  document.querySelector('button[aria-label="Load Chromatic Plasma, Integration preset"]').click();
  assert(document.querySelector('#shader-tab').getAttribute('aria-selected') === 'true', 'Loading a shuffle look opens Visuals');
  assert(document.querySelector('.shader-select[data-id="plasma"]').getAttribute('aria-pressed') === 'true', 'Loading a shuffle look selects its visual');
  assert(document.querySelector('[data-name="speed"]').value === '0.5', 'Loading a shuffle look applies saved motion');
  assert(document.querySelector('[data-name="color1"]').value === '#123456', 'Loading a shuffle look applies saved color');
  const globalScheme = document.querySelector('[data-global="scheme"]');
  assert(globalScheme, 'Missing global color scheme picker');
  globalScheme.value = 'dracula';
  globalScheme.dispatchEvent(new Event('input', { bubbles: true }));
  assert(document.querySelector('[data-name="palette"]').value === 'custom', 'Scheme selects Plasma custom palette');
  assert(document.querySelector('[data-name="color1"]').value === '#bd93f9', 'Global scheme applies Dracula colors');
  const shaderScheme = document.querySelector('[data-shader-scheme]');
  assert(shaderScheme, 'Missing per-shader color scheme picker');
  shaderScheme.value = 'nord';
  shaderScheme.dispatchEvent(new Event('input', { bubbles: true }));
  assert(document.querySelector('[data-name="color1"]').value === '#81a1c1', 'Per-shader override applies Nord colors');
  shaderScheme.value = '';
  shaderScheme.dispatchEvent(new Event('input', { bubbles: true }));
  assert(document.querySelector('[data-name="color1"]').value === '#bd93f9', 'Clearing the override restores the global scheme');
  await new Promise(resolve => setTimeout(resolve, 450));
  const saved = await window.scrnsvr.getConfig();
  assert(saved.presets.plasma['Integration preset'].color1 === '#123456', 'Preset saved through IPC');
  assert(saved.rotation.entries.filter(entry => entry.shader === 'plasma').length === 2, 'Multiple looks from one visual saved through IPC');
  assert(saved.shaders['contour-dunes'].lineThickness === undefined, 'Reset clears saved override');
  assert(saved.colors.scheme === 'dracula', 'Global scheme saved through IPC');
  assert(saved.colors.overrides.plasma === undefined, 'Cleared per-shader override is not persisted');
  return 'All shader previews, thumbnail scroll/remounts, renderer reuse, controls, presets and IPC passed';
}

const browserFunctions = {
  compileStage, applyUniform, createGlHarness,
  assertAnimation, assertReactiveAudio, assertGrayscale, assertWaveformSpeckles,
  assertUniformEffects, assertBaseline, measureRender, renderChecks, uiChecks,
};

/** Page-scope bindings for every browser function so injected bodies can call siblings. */
function browserPrelude() {
  return Object.entries(browserFunctions).map(([name, fn]) => `const ${name} = ${fn.toString()};`).join('\n');
}

module.exports = { browserPrelude, renderChecks };

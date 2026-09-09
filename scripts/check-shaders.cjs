// Real Chromium/WebGL checks. Run with `npm run check-shaders` on a desktop or Xvfb.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit' });
  if (result.error) console.error(result.error);
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow, ipcMain } = require('electron');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'scrnsvr-check-'));
app.setPath('userData', temporary);
app.commandLine.appendSwitch('disable-vulkan');
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', 'swiftshader-webgl');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
if (process.env.DISPLAY) app.commandLine.appendSwitch('ozone-platform', 'x11');

function bundle(entry) {
  const file = path.join(temporary, path.basename(entry) + '.cjs');
  buildSync({ entryPoints: [path.join(root, entry)], outfile: file, bundle: true, platform: 'node', format: 'cjs', loader: { '.glsl': 'text' } });
  return require(file);
}

function renderChecks(registry, baseline, contextType) {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext(contextType, { preserveDrawingBuffer: true, alpha: false });
  assert(gl, `Missing ${contextType}`);
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    assert(gl.getShaderParameter(shader, gl.COMPILE_STATUS), gl.getShaderInfoLog(shader));
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 position; varying vec2 vUv; void main(){vUv=position*.5+.5;gl_Position=vec4(position,0.,1.);}');
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  let checks = 0;
  const reports = [];
  for (const [id, definition] of Object.entries(registry)) {
    const createProgram = shader => {
      const program = gl.createProgram();
      gl.attachShader(program, vertex);
      const fragment = compile(gl.FRAGMENT_SHADER, shader.source);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(fragment);
      assert(gl.getProgramParameter(program, gl.LINK_STATUS), `${id}: ${gl.getProgramInfoLog(program)}`);
      return program;
    };
    const program = createProgram(definition);
    const render = (time = 12, overrides = {}, width = 320, height = 180, shader = definition, selectedProgram = program) => {
      checks++;
      canvas.width = width; canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.useProgram(selectedProgram);
      const position = gl.getAttribLocation(selectedProgram, 'position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(gl.getUniformLocation(selectedProgram, 'uTime'), time);
      gl.uniform2f(gl.getUniformLocation(selectedProgram, 'uResolution'), width, height);
      for (const def of shader.manifest.uniforms) {
        const value = overrides[def.name] ?? def.default;
        const location = gl.getUniformLocation(selectedProgram, def.name);
        assert(location !== null, `${id}: unused uniform ${def.name}`);
        if (def.type === 'color') {
          const n = parseInt(value.slice(1), 16);
          gl.uniform3f(location, ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
        } else if (def.type === 'select') gl.uniform1i(location, def.options.indexOf(value));
        else if (def.type === 'int' || def.type === 'bool') gl.uniform1i(location, Number(value));
        else gl.uniform1f(location, value);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      assert(gl.getError() === gl.NO_ERROR, `${id}: GL error`);
      return pixels;
    };
    const difference = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / (a.length * 0.75);
    for (const [width,height] of [[640,360],[360,640],[180,90],[960,270]]) {
      assert(difference(render(0,{},width,height), render(20,{},width,height)) > 0.001, `${id}: blank or static scene`);
    }
    assert(difference(render(0,{speed:0}), render(100,{speed:0})) === 0, `${id}: zero speed does not freeze`);
    const gray = render(12,{saturation:0});
    for(let i=0;i<gray.length;i+=4) assert(gray[i]===gray[i+1] && gray[i]===gray[i+2], `${id}: saturation zero is not grayscale`);
    for (const def of definition.manifest.uniforms) {
      const dependencies = def.visibleWhen ? {[def.visibleWhen.name]:def.visibleWhen.value} : {};
      const interior = def.type === 'int' ? Math.round(def.min + (def.max - def.min) * 0.37) : def.min + (def.max - def.min) * 0.37;
      const variants = def.type === 'color' ? ['#000000','#ffffff'] : def.type === 'bool' ? [false,true] : def.type === 'select' ? def.options : [def.min,interior,def.default,def.max];
      const frames = variants.map(value => render(12,{...dependencies,[def.name]:value},640,360));
      assert(frames.slice(1).some(frame => difference(frames[0],frame)>0.001), `${id}: ${def.name} has no visual effect`);
    }
    for (const bound of ['min','max']) {
      const values = Object.fromEntries(definition.manifest.uniforms.filter(d=>d.type==='float'||d.type==='int').map(d=>[d.name,d[bound]]));
      render(86400,values,180,320);
    }
    render(86400);
    let defaultDifference;
    if (baseline?.[id]) {
      const oldProgram = createProgram(baseline[id]);
      defaultDifference = 0;
      const legacy = Object.fromEntries(baseline[id].manifest.uniforms.map(d=>[d.name,d.type==='color'?'#376ba9':d.type==='float'?Math.min(d.max,Number(d.default)*1.17):d.default]));
      for(const values of [{},legacy]) for(const time of [0,12,120]) {
        const delta = difference(render(time,values), render(time,values,320,180,baseline[id],oldProgram));
        defaultDifference = Math.max(defaultDifference,delta);
        assert(delta < 0.8, `${id}: default/preset appearance changed (${delta.toFixed(3)} channel levels)`);
      }
      gl.deleteProgram(oldProgram);
    }
    // CPU readback includes software rendering; this is a regression measurement, not hardware FPS.
    render(12,{},1920,1080);
    const start = performance.now();
    render(13,{},1920,1080);
    const renderMs = performance.now()-start;
    reports.push({id,parameters:definition.manifest.uniforms.length,renderMs:Math.round(renderMs),...(defaultDifference===undefined?{}:{defaultDifference:Number(defaultDifference.toFixed(3))})});
    gl.deleteProgram(program);
  }
  gl.deleteShader(vertex); gl.deleteBuffer(buffer);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return {contextType,checks,reports};
}

app.whenReady().then(async () => {
  const { shaderRegistry } = bundle('src/renderer/shaders/index.ts');
  const { defaultConfig } = bundle('src/shared/config.ts');
  const baselineIndex = process.argv.indexOf('--baseline');
  const baseline = baselineIndex < 0 ? null : require(path.resolve(process.argv[baselineIndex+1])).shaderRegistry;
  const win = new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{preload:path.join(root,'dist/preload/index.js'),contextIsolation:true,sandbox:true}});
  win.webContents.on('render-process-gone', (_event, details) => {console.error(details);app.exit(1);});
  await win.loadURL('data:text/html,<html><body></body></html>');
  for(const context of ['webgl','webgl2']) {
    const result=await win.webContents.executeJavaScript(`(() => { try { return (${renderChecks.toString()})(${JSON.stringify(shaderRegistry)},${JSON.stringify(baseline)},${JSON.stringify(context)}); } catch (error) { return {error: error.stack}; } })()`);
    if (result.error) throw Error(result.error);
    console.log(JSON.stringify(result));
  }
  let saved = structuredClone(defaultConfig);
  ipcMain.handle('config:get',()=>saved);
  ipcMain.handle('config:set',(_event,value)=>{saved=value;});
  ipcMain.handle('colors:import-noctalia',()=>({ok:true,palette:{mPrimary:'#ebbcba',mSecondary:'#9ccfd8',mTertiary:'#31748f',mSurface:'#191724',mOnSurface:'#e0def4'}}));
  await win.loadFile(path.join(root,'dist/settings/index.html'));
  // Renderer bootstrap reads configuration asynchronously over IPC.
  for(let i=0;i<100;i++) {
    if(await win.webContents.executeJavaScript('Boolean(document.querySelector("[data-control]"))'))break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  const ui=await win.webContents.executeJavaScript(`(${async function uiChecks(registry) {
    const assert=(ok,message)=>{if(!ok)throw Error(message);};
    const input=(name,value,event='input')=>{
      const control=document.querySelector(`[data-name="${name}"]`);
      assert(control,`Missing ${name}`); control.value=String(value); control.dispatchEvent(new Event(event,{bubbles:true}));
      return control;
    };
    for(const [id,shader] of Object.entries(registry)) {
      document.querySelector(`[data-id="${id}"]`).click();
      assert(document.querySelectorAll('[data-control]').length===shader.manifest.uniforms.length, `${id}: missing controls`);
      assert(document.querySelectorAll('.shader-control-group:not([hidden])').length>=3, `${id}: missing groups`);
    }
    document.querySelector('[data-id="plasma"]').click();
    assert(document.querySelector('[data-control="color1"]').hidden,'Custom colors initially hidden');
    document.querySelector('[data-action="import-noctalia"]').click();
    for(let i=0;i<100 && document.querySelector('[data-action="import-noctalia"]').disabled;i++) await new Promise(resolve=>setTimeout(resolve,20));
    assert(document.querySelector('[data-name="palette"]').value==='custom','Noctalia selects custom palette');
    assert(document.querySelector('[data-name="color1"]').value==='#ebbcba','Noctalia updates custom colors');
    input('palette','custom');
    assert(!document.querySelector('[data-control="color1"]').hidden,'Custom colors appear on mode change');
    input('color1','#123456');
    input('speed',0.5);
    document.querySelector('[data-preset]').value='Integration preset';
    document.querySelector('[data-action="save"]').click();
    input('speed',1.5);
    const preset=[...document.querySelectorAll('.preset-list button')].find(b=>b.textContent==='Integration preset');
    preset.click();
    assert(document.querySelector('[data-name="speed"]').value==='0.5','Preset restores motion');
    assert(document.querySelector('[data-name="color1"]').value==='#123456','Preset restores custom colors');
    document.querySelector('[data-control="speed"] .uniform-reset').click();
    assert(Number(document.querySelector('[data-name="speed"]').value)===registry.plasma.manifest.uniforms.find(d=>d.name==='speed').default,'Individual reset');
    assert(document.querySelector('[data-name="color1"]').value==='#123456','Individual reset preserves other controls');
    document.querySelector('[data-id="contour-dunes"]').click();
    const advanced=document.querySelector('.shader-advanced'); advanced.open=true;
    const number=document.querySelector('[data-control="lineThickness"] input[type="number"]');
    number.focus(); number.value='0.027'; number.dispatchEvent(new Event('change',{bubbles:true}));
    assert(number.value==='0.025','Numeric entry snaps to step');
    assert(document.activeElement===number,'Numeric entry preserves focus');
    number.value='0.04';number.dispatchEvent(new Event('change',{bubbles:true}));
    assert(document.querySelector('[data-name="lineThickness"]').value==='0.04','Numeric entry updates slider');
    number.value='';number.dispatchEvent(new Event('change',{bubbles:true}));
    assert(number.value==='0.025','Empty numeric entry recovers default');
    document.querySelector('[data-action="random"]').click();
    assert(document.querySelector('.shader-advanced').open,'Advanced remains open after randomize');
    document.querySelector('[data-action="reset"]').click();
    assert(document.querySelector('[data-name="lineThickness"]').value==='0.025','Shader reset restores new parameters');
    await new Promise(resolve=>setTimeout(resolve,450));
    const saved=await window.scrnsvr.getConfig();
    assert(saved.presets.plasma['Integration preset'].color1==='#123456','Preset saved through IPC');
    assert(saved.shaders['contour-dunes'].lineThickness===undefined,'Reset clears saved override');
    return 'Controls, conditional visibility, numeric entry, focus, presets, randomize, reset and IPC passed';
  }.toString()})(${JSON.stringify(shaderRegistry)}).catch(error => ({error:error.stack}))`);
  if (ui.error) throw Error(ui.error);
  console.log(ui);
  await win.loadFile(path.join(root,'dist/settings/index.html'));
  for(let i=0;i<100;i++) {
    if(await win.webContents.executeJavaScript('Boolean(document.querySelector("[data-control]"))'))break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  const restored=await win.webContents.executeJavaScript('document.querySelector("[data-id=contour-dunes]").getAttribute("aria-pressed") === "true" && document.querySelector("[data-name=lineThickness]").value === "0.025"');
  if (!restored) throw Error('Settings did not restore after reload');
  console.log('Shader checks passed');
  win.destroy();
  app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
app.on('quit',()=>fs.rmSync(temporary,{recursive:true,force:true}));

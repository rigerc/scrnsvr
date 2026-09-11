import { CustomShaderSchema, customShaderDefinition, customShaderTemplate, customVertex, type CustomShader } from '../shared/custom-shaders';
import { mountShader } from '../renderer/core/runtime';

export function validateCustomShader(gl: WebGLRenderingContext | WebGL2RenderingContext, shader: CustomShader): void {
  const definition = customShaderDefinition(shader);
  const program = gl.createProgram();
  const stages: WebGLShader[] = [];
  try {
    if (!program) throw Error('WebGL is unavailable.');
    for (const [type, source] of [[gl.VERTEX_SHADER, customVertex], [gl.FRAGMENT_SHADER, definition.source]] as const) {
      const stage = gl.createShader(type);
      if (!stage) throw Error('Cannot create shader.');
      stages.push(stage);
      gl.shaderSource(stage, source);
      gl.compileShader(stage);
      if (!gl.getShaderParameter(stage, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(stage) || 'Shader compilation failed.');
      gl.attachShader(program, stage);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) || 'Shader linking failed.');
  } finally {
    stages.forEach(stage => gl.deleteShader(stage));
    if (program) gl.deleteProgram(program);
  }
}

export function openCustomShaderEditor(existing: CustomShader | undefined, save: (shader: CustomShader) => Promise<void>) {
  const dialog = document.createElement('dialog');
  dialog.className = 'custom-shader-editor';
  dialog.setAttribute('aria-labelledby', 'custom-editor-title');
  dialog.innerHTML = `<h2 id="custom-editor-title">${existing ? 'Edit shader' : 'Add shader'}</h2>
    <label>Name<input data-custom-title maxlength="100" required></label>
    <label>Import GLSL file<input data-custom-file type="file" accept=".glsl,.frag,.txt,text/plain"></label>
    <p>Paste a single-pass GLSL ES 1.00 shader with mainImage or main. Time and resolution uniforms are supplied. Textures and multiple passes are not supported.</p>
    <label>Shader source<textarea data-custom-source spellcheck="false" rows="14" maxlength="100000"></textarea></label>
    <canvas data-custom-preview width="480" height="270" aria-label="Custom shader preview"></canvas>
    <pre data-custom-status role="status" aria-live="polite">Preview your shader before saving.</pre>
    <div class="custom-editor-actions"><button data-custom-cancel>Cancel</button><button data-custom-test>Preview</button><button data-custom-save>Save shader</button></div>`;
  document.body.append(dialog);
  const title = dialog.querySelector<HTMLInputElement>('[data-custom-title]')!;
  const source = dialog.querySelector<HTMLTextAreaElement>('[data-custom-source]')!;
  const canvas = dialog.querySelector<HTMLCanvasElement>('canvas')!;
  const status = dialog.querySelector<HTMLElement>('[data-custom-status]')!;
  const saveButton = dialog.querySelector<HTMLButtonElement>('[data-custom-save]')!;
  title.value = existing?.title ?? 'My shader';
  source.value = existing?.source ?? customShaderTemplate;
  const id = existing?.id ?? `custom-${crypto.randomUUID()}`;
  let stop: (() => void) | undefined;
  const candidate = () => CustomShaderSchema.parse({ id, title: title.value, source: source.value });
  const check = () => {
    const shader = candidate();
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) throw Error('WebGL is unavailable.');
    validateCustomShader(gl, shader);
    return shader;
  };
  const report = (error: unknown) => { status.textContent = error instanceof Error ? error.message : String(error); };
  dialog.querySelector('[data-custom-test]')!.addEventListener('click', () => {
    try {
      const shader = check();
      stop?.();
      stop = mountShader(canvas, customShaderDefinition(shader), {}, 30);
      status.textContent = 'Compiled successfully. Preview is running.';
    } catch (error) { report(error); }
  });
  dialog.querySelector('[data-custom-file]')!.addEventListener('change', async event => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      if (file.size > 100_000) throw Error('Shader files must be smaller than 100 KB.');
      source.value = await file.text();
      if (!existing) title.value = file.name.replace(/\.[^.]+$/, '').slice(0, 100);
      status.textContent = 'File imported. Preview or save to compile it.';
    } catch (error) { report(error); }
  });
  saveButton.addEventListener('click', async () => {
    try {
      const shader = check();
      saveButton.disabled = true;
      status.textContent = 'Saving…';
      await save(shader);
      dialog.close();
    } catch (error) { report(error); saveButton.disabled = false; }
  });
  dialog.querySelector('[data-custom-cancel]')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    stop?.();
    (canvas.getContext('webgl2') ?? canvas.getContext('webgl'))?.getExtension('WEBGL_lose_context')?.loseContext();
    dialog.remove();
  }, { once: true });
  dialog.showModal();
}

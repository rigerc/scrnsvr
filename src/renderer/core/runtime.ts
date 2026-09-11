import { Color, Mesh, Program, Renderer, Triangle } from 'ogl';
import type { ShaderManifest, UniformManifest } from '../../shared/manifest';
import { bindUniforms } from './uniforms';
import { startLoop } from './loop';
import { silentAudio } from '../../shared/audio';
import { AmbientAudio } from './ambient-audio';

export interface ShaderDefinition { manifest: ShaderManifest; source: string; }

function oglValue(definition: UniformManifest, value: unknown): unknown {
  if (definition.type === 'color') {
    const match = String(value).match(/^#([0-9a-f]{6})$/i) ?? String(definition.default).match(/^#([0-9a-f]{6})$/i);
    const number = Number.parseInt(match?.[1] ?? 'ffffff', 16);
    return new Color(((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255);
  }
  if (definition.type === 'select') return Math.max(0, definition.options?.indexOf(String(value)) ?? 0);
  return value;
}

// A canvas owns one WebGL context. Keep OGL's state cache with that context
// across shader switches instead of resetting the cache over existing GL state.
const renderers = new WeakMap<HTMLCanvasElement, Renderer>();

function createScene(renderer: Renderer, shader: ShaderDefinition, values: Record<string, unknown>) {
  const gl = renderer.gl;
  const resolved = bindUniforms(shader.manifest.uniforms, values);
  const mountedAt = new Date();
  let audio = silentAudio;
  const ambientAudio = new AmbientAudio();
  let previousTime = 0;
  const unsubscribeAudio = /\buAudio\b/.test(shader.source)
    ? window.scrnsvrAudio?.subscribe(frame => { audio = frame; }) : undefined;
  const uniforms: Record<string, { value: unknown }> = {
    uTime: { value: 0 },
    uAudio: { value: [0, 0, 0, 0] },
    uResolution: { value: [1, 1] },
    // Imported clock shaders use Shadertoy's year/month/day/seconds format.
    // The shader adds scaled uTime so the Speed control can also freeze clocks.
    uDate: { value: [
      mountedAt.getFullYear(),
      mountedAt.getMonth() + 1,
      mountedAt.getDate(),
      mountedAt.getHours() * 3600 + mountedAt.getMinutes() * 60 + mountedAt.getSeconds(),
    ] },
  };
  for (const definition of shader.manifest.uniforms) {
    uniforms[definition.name] = { value: oglValue(definition, resolved[definition.name]) };
  }
  const program = new Program(gl, {
    vertex: 'attribute vec2 uv; attribute vec2 position; varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,0.,1.);}',
    fragment: shader.source,
    uniforms,
    depthTest: false,
    depthWrite: false,
    cullFace: false,
  });
  const geometry = new Triangle(gl);
  const mesh = new Mesh(gl, { geometry, program });
  return {
    draw(time: number) {
      uniforms.uTime.value = time;
      uniforms.uAudio.value = ambientAudio.update(audio, time - previousTime);
      previousTime = time;
      uniforms.uResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight];
      const latest = bindUniforms(shader.manifest.uniforms, values);
      for (const definition of shader.manifest.uniforms) {
        uniforms[definition.name].value = oglValue(definition, latest[definition.name]);
      }
      renderer.render({ scene: mesh });
    },
    dispose() {
      unsubscribeAudio?.();
      geometry.remove();
      // OGL retains uploaded uniform values in its renderer cache.
      for (const location of program.uniformLocations.values()) renderer.state.uniformLocations.delete(location);
      gl.deleteShader(program.vertexShader);
      gl.deleteShader(program.fragmentShader);
      program.remove();
    },
  };
}

export function mountShader(
  canvas: HTMLCanvasElement,
  shader: ShaderDefinition,
  values: Record<string, unknown>,
  fps = 60,
): () => void {
  const inlineSize = { width: canvas.style.width, height: canvas.style.height };
  let renderer = renderers.get(canvas);
  if (!renderer) {
    const initial = canvas.getBoundingClientRect();
    renderer = new Renderer({
      canvas,
      width: Math.max(1, Math.round(initial.width) || canvas.width),
      height: Math.max(1, Math.round(initial.height) || canvas.height),
      dpr: Math.min(devicePixelRatio, 2),
      alpha: false,
    });
    renderers.set(canvas, renderer);
    Object.assign(canvas.style, inlineSize);
  }
  const scene = createScene(renderer, shader, values);
  let time = 0;
  const resize = () => {
    const width = Math.max(1, canvas.clientWidth || canvas.width);
    const height = Math.max(1, canvas.clientHeight || canvas.height);
    renderer.setSize(width, height);
    Object.assign(canvas.style, inlineSize);
    scene.draw(time);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  const stopLoop = startLoop(delta => {
    time += delta / 1000;
    scene.draw(time);
  }, fps);
  return () => {
    stopLoop();
    observer.disconnect();
    scene.dispose();
  };
}

// Copy each visible thumbnail synchronously into a 2D canvas. The whole gallery
// uses just one GPU context, regardless of window size or shader count.
let thumbnailRenderer: Renderer | undefined;
export function mountShaderThumbnail(
  canvas: HTMLCanvasElement,
  shader: ShaderDefinition,
  values: Record<string, unknown>,
): () => void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create thumbnail canvas');
  const renderer = thumbnailRenderer ??= new Renderer({ width: 180, height: 90, dpr: 1, alpha: false });
  const scene = createScene(renderer, shader, values);
  let time = 0;
  const draw = () => {
    if (renderer.width !== canvas.width || renderer.height !== canvas.height) {
      renderer.setSize(canvas.width, canvas.height);
    }
    scene.draw(time);
    context.drawImage(renderer.gl.canvas, 0, 0, canvas.width, canvas.height);
  };
  draw();
  const stop = startLoop(delta => { time += delta / 1000; draw(); }, 15);
  return () => { stop(); scene.dispose(); };
}

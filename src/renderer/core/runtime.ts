import { Color, Mesh, Program, Renderer, Triangle } from 'ogl';
import type { ShaderManifest, UniformManifest } from '../../shared/manifest';
import { compiledFragmentSource } from '../../shared/shader-source';
import { bindUniforms } from './uniforms';
import { startLoop } from './loop';
import { silentAudio } from '../../shared/audio';
import { AmbientAudio } from './ambient-audio';
import { AnimationClock } from './animation-clock';

export interface ShaderDefinition {
  manifest: ShaderManifest;
  source: string;
  /** Built-ins consume integrated uTime with speed fixed to one; custom shaders retain elapsed uTime. */
  animationTime?: 'integrated';
}

export function oglValue(definition: UniformManifest, value: unknown): unknown {
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
  const clock = new AnimationClock();
  const integrated = shader.animationTime === 'integrated';
  const unsubscribeAudio = /\buAudio\b/.test(shader.source)
    ? window.scrnsvrAudio?.subscribe(frame => { audio = frame; }) : undefined;
  const uniforms: Record<string, { value: unknown }> = {
    uTime: { value: 0 },
    uAudio: { value: [0, 0, 0, 0] },
    uResolution: { value: [1, 1] },
    // Imported clock shaders use Shadertoy's year/month/day/seconds format.
    // Clock faces follow artistic time from this mount date: pause holds the
    // displayed time, and resume continues it rather than catching up to wall time.
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
    fragment: compiledFragmentSource(shader.source),
    uniforms,
    depthTest: false,
    depthWrite: false,
    cullFace: false,
  });
  const geometry = new Triangle(gl);
  const mesh = new Mesh(gl, { geometry, program });
  return {
    draw(delta = 0) {
      const latest = bindUniforms(shader.manifest.uniforms, values);
      const activeSeconds = clock.advance(delta, Number(latest.speed ?? 1));
      uniforms.uTime.value = integrated ? clock.phase : clock.elapsed;
      uniforms.uAudio.value = ambientAudio.update(audio, activeSeconds);
      const resolution = uniforms.uResolution.value as number[];
      resolution[0] = gl.drawingBufferWidth;
      resolution[1] = gl.drawingBufferHeight;
      for (const definition of shader.manifest.uniforms) {
        uniforms[definition.name].value = oglValue(definition, integrated && definition.name === 'speed' ? 1 : latest[definition.name]);
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
  const resize = () => {
    const width = Math.max(1, canvas.clientWidth || canvas.width);
    const height = Math.max(1, canvas.clientHeight || canvas.height);
    renderer.setSize(width, height);
    Object.assign(canvas.style, inlineSize);
    scene.draw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  const stopLoop = startLoop(delta => scene.draw(delta), fps);
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
  const draw = (delta = 0) => {
    if (renderer.width !== canvas.width || renderer.height !== canvas.height) {
      renderer.setSize(canvas.width, canvas.height);
    }
    scene.draw(delta);
    context.drawImage(renderer.gl.canvas, 0, 0, canvas.width, canvas.height);
  };
  draw();
  const stop = startLoop(draw, 15);
  return () => { stop(); scene.dispose(); };
}

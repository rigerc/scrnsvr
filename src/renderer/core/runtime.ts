import { Color, Mesh, Program, Renderer, Triangle } from 'ogl';
import type { ShaderManifest, UniformManifest } from '../../shared/manifest';
import { bindUniforms } from './uniforms';
import { startLoop } from './loop';

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

export function mountShader(
  canvas: HTMLCanvasElement,
  shader: ShaderDefinition,
  values: Record<string, unknown>,
  fps = 60,
): () => void {
  const initial = canvas.getBoundingClientRect();
  const initialWidth = Math.max(1, Math.round(initial.width) || canvas.width);
  const initialHeight = Math.max(1, Math.round(initial.height) || canvas.height);
  const renderer = new Renderer({ canvas, width: initialWidth, height: initialHeight, dpr: Math.min(devicePixelRatio, 2), alpha: false });
  const gl = renderer.gl;
  const resolved = bindUniforms(shader.manifest.uniforms, values);
  const uniforms: Record<string, { value: unknown }> = {
    uTime: { value: 0 },
    uResolution: { value: [initialWidth, initialHeight] },
  };
  for (const definition of shader.manifest.uniforms) {
    uniforms[definition.name] = { value: oglValue(definition, resolved[definition.name]) };
  }
  const program = new Program(gl, {
    vertex: 'attribute vec2 uv; attribute vec2 position; varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,0.,1.);}',
    fragment: shader.source,
    uniforms,
  });
  const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
  const resize = () => {
    const width = Math.max(1, canvas.clientWidth || canvas.width);
    const height = Math.max(1, canvas.clientHeight || canvas.height);
    renderer.setSize(width, height);
    uniforms.uResolution.value = [width, height];
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  const stopLoop = startLoop((delta) => {
    uniforms.uTime.value = Number(uniforms.uTime.value) + delta / 1000;
    const latest = bindUniforms(shader.manifest.uniforms, values);
    for (const definition of shader.manifest.uniforms) {
      uniforms[definition.name].value = oglValue(definition, latest[definition.name]);
    }
    renderer.render({ scene: mesh });
  }, fps);
  return () => { stopLoop(); observer.disconnect(); };
}

import { z } from 'zod';
import type { ShaderManifest } from './manifest';

export const CustomShaderSchema = z.object({
  id: z.string().regex(/^custom-[a-z0-9-]{1,80}$/),
  title: z.string().trim().min(1).max(100),
  source: z.string().trim().min(1).max(100_000),
});
export const CustomShadersSchema = z.array(CustomShaderSchema).max(100)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Duplicate shader IDs')
  .default([]);
export type CustomShader = z.infer<typeof CustomShaderSchema>;

export const customShaderTemplate = `void mainImage(out vec4 color, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  color = vec4(0.5 + 0.5 * cos(iTime + uv.xyx * 6.0 + vec3(0, 2, 4)), 1.0);
}`;

export const customVertex = 'attribute vec2 position; attribute vec2 uv; varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,0.,1.);}';

/** Single-pass GLSL ES 1.00: Shadertoy mainImage or a raw main entry point. */
export function customShaderDefinition(candidate: CustomShader): { manifest: ShaderManifest; source: string } {
  const shader = CustomShaderSchema.parse(candidate);
  let source = shader.source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  if (/^\s*#version/m.test(source)) throw Error('Use GLSL ES 1.00 without a #version directive.');
  if (/\bsampler\w*\b|\biChannel\d\b/.test(source)) throw Error('Texture and multipass shaders are not supported.');
  source = source.replace(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(float|vec2|vec3|vec4)\s+(uTime|uResolution|iTime|iResolution|iMouse|iDate)\s*;/g, '');
  if (/\buniform\b/.test(source)) throw Error('Supported uniforms: uTime, uResolution, iTime, iResolution, iMouse, iDate.');
  source = source.replace(/\bprecision\s+\w+\s+float\s*;/g, '');
  const raw = /\bvoid\s+main\s*\(/.test(source);
  if (!raw && !/\bvoid\s+mainImage\s*\(/.test(source)) throw Error('Add a mainImage(out vec4 color, in vec2 fragCoord) or main() function.');
  if (raw) source = source.replace(/\bvoid\s+main\s*\(/, 'void customMain(');
  return {
    manifest: { id: shader.id, title: shader.title, category: 'Custom', fragment: 'custom', description: 'Your saved shader.', uniforms: [] },
    source: `precision highp float;
uniform float uTime;
uniform vec2 uResolution;
uniform vec4 uDate;
#define iTime uTime
#define iResolution vec3(uResolution, 1.0)
#define iMouse vec4(0.0)
#define iDate vec4(uDate.xyz, uDate.w + uTime)
${source}
void main() {
  ${raw ? 'customMain();' : 'vec4 color = vec4(0.0); mainImage(color, gl_FragCoord.xy); gl_FragColor = color;'}
  gl_FragColor.a = 1.0;
}`,
  };
}

export function withCustomShaders<T extends { manifest: ShaderManifest; source: string }>(builtins: Record<string, T>, shaders: CustomShader[] = []) {
  const registry: Record<string, { manifest: ShaderManifest; source: string }> = { ...builtins };
  for (const shader of shaders) {
    try { registry[shader.id] = customShaderDefinition(shader); } catch { /* A broken custom shader must not hide built-ins. */ }
  }
  return registry;
}

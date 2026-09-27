/**
 * The canonical built-in shader ABI.
 *
 * Every checked-in `src/renderer/shaders/<id>/shader.glsl` is a Shadertoy /
 * shadereye `mainImage(out vec4, in vec2)` source that renders unchanged in the
 * shadereye MCP. scrnsvr only adds the WebGL1 `main()` entry point below and
 * defines `SCRNSVR` so the shader's uniform block is used instead of its
 * manifest-default constants.
 *
 * `compiledFragmentSource` detects the form, so old (`void main`) and new
 * (`void mainImage`) sources compile side by side during the migration.
 *
 * Keep `builtinFragmentSource` in sync with `wrapBuiltinSource` in
 * `scripts/lib/browser-checks.cjs`; `tests/shader-source.test.ts` enforces it.
 */
export function builtinFragmentSource(source: string): string {
  return `#define SCRNSVR 1\n${source.trimEnd()}\nvoid main() {\n  vec4 color = vec4(0.0);\n  mainImage(color, gl_FragCoord.xy);\n  gl_FragColor = vec4(color.rgb, 1.0);\n}\n`;
}

export function isCanonicalShaderSource(source: string): boolean {
  return /\bvoid\s+mainImage\s*\(/.test(source) && !/\bvoid\s+main\s*\(/.test(source);
}

export function compiledFragmentSource(source: string): string {
  return isCanonicalShaderSource(source) ? builtinFragmentSource(source) : source;
}

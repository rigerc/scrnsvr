import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { builtinFragmentSource, compiledFragmentSource, isCanonicalShaderSource } from '../src/shared/shader-source';

const require = createRequire(import.meta.url);
const { wrapBuiltinSource, browserPrelude } = require('../scripts/lib/browser-checks.cjs');

const canonical = 'precision highp float;\n\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  fragColor = vec4(fragCoord / uResolution, 0.0, 1.0);\n}\n';
const legacy = 'precision highp float;\nvoid main() { gl_FragColor = vec4(1.0); }\n';

describe('canonical shader source wrapper', () => {
  it('detects only mainImage sources without a legacy main', () => {
    expect(isCanonicalShaderSource(canonical)).toBe(true);
    expect(isCanonicalShaderSource(legacy)).toBe(false);
    expect(isCanonicalShaderSource('precision highp float;\nvoid main() {}\nvoid mainImage(out vec4 c, in vec2 f) { c = vec4(0.0); }\n')).toBe(false);
  });

  it('adds the SCRNSVR define and the WebGL1 main entry point', () => {
    const wrapped = compiledFragmentSource(canonical);
    expect(wrapped.startsWith('#define SCRNSVR 1\n')).toBe(true);
    expect(wrapped).toContain('void mainImage(out vec4 fragColor, in vec2 fragCoord)');
    expect(wrapped).toContain('mainImage(color, gl_FragCoord.xy);');
    expect(wrapped).toContain('gl_FragColor = vec4(color.rgb, 1.0);');
  });

  it('leaves legacy and custom sources untouched', () => {
    expect(compiledFragmentSource(legacy)).toBe(legacy);
    expect(compiledFragmentSource('void customMain() {}')).toBe('void customMain() {}');
  });

  it('keeps the browser-check and runtime wrappers identical', () => {
    expect(wrapBuiltinSource(canonical)).toBe(builtinFragmentSource(canonical));
    expect(wrapBuiltinSource(legacy)).toBe(legacy);
    expect(browserPrelude()).toContain('const wrapBuiltinSource = ');
  });
});

import { describe, expect, it } from 'vitest';
import { adapt, emitModule, manifestSource, replaceFirstMainImage, stripPreamble, symbolFor } from '../scripts/lib/upstream-adapt.mjs';

const item = { collection: 'AVS', file: 'sample.glsl', id: 'avs-sample', category: 'Abstract', title: 'Sample' };
/** Wrap a snippet in a mainImage so the adapter has an effect function to canonicalize. */
const wrap = (body: string) => `void mainImage(out vec4 O, vec2 C) { ${body} O = vec4(0.0); }`;

describe('upstream shader adapter', () => {
  it('derives manifest symbols from ids', () => {
    expect(symbolFor('avs-seven-segment')).toBe('avsSevenSegmentManifest');
    expect(symbolFor('7seg')).toBe('_7segManifest');
  });

  it('replaces the first mainImage body and reports malformed sources', () => {
    const source = 'float x = 1.0;\nvoid mainImage(out vec4 O, vec2 C) { O = vec4(C, 0.0, 1.0); }\nfloat y = 2.0;\n';
    expect(replaceFirstMainImage(source, 'void mainImage(out vec4 O, vec2 C) { O = vec4(0.0); }')).toBe(
      'float x = 1.0;\nvoid mainImage(out vec4 O, vec2 C) { O = vec4(0.0); }\nfloat y = 2.0;\n',
    );
    expect(() => replaceFirstMainImage('float x = 1.0;', 'x')).toThrow('Expected mainImage function');
    expect(() => replaceFirstMainImage('void mainImage(out vec4 O, vec2 C) {', 'x')).toThrow('Unclosed mainImage function');
  });

  it('normalizes upstream compatibility names instead of emitting defines', () => {
    const timed = adapt('uniform float iTime;\nvoid mainImage(out vec4 O, vec2 C) { O = vec4(iTime); }', item);
    expect(timed).toContain('uTime * speed');
    // The only remaining iTime is the `#define uTime iTime` fallback itself.
    expect(timed.match(/\biTime\b/g)?.length).toBe(1);
    expect(timed).not.toContain('uniform float iTime;');
    const dated = adapt('uniform vec4 iDate;\nvoid mainImage(out vec4 O, vec2 C) { O = iDate; }', item);
    expect(dated).toContain('uniform vec4 uDate;');
    expect(dated).toContain('const vec4 uDate = vec4(2026.0, 9.0, 10.0, 46800.0);');
    expect(dated).toContain('mod(uDate.w + uTime * speed, 86400.0)');
    const shaderSaver = adapt('void mainImage(out vec4 O, vec2 C) { O = vec4(iTime); }', { ...item, collection: 'ShaderSaver' });
    expect(shaderSaver).toContain('uTime * speed');
  });

  it('strips GLSL ES preambles and reroutes tanh', () => {
    const source = '#ifdef GL_ES\r\nprecision highp float;\r\n#endif\r\nprecision mediump float;\r\nuniform float iTime;\r\nfloat x = tanh(1.0);\r\n';
    const stripped = stripPreamble(source);
    expect(stripped).not.toContain('#ifdef GL_ES');
    expect(stripped).not.toContain('precision mediump float');
    expect(stripped).not.toContain('uniform float iTime');
    expect(stripped).toContain('scrnsvrTanh(1.0)');
  });

  it('emits a canonical Shadereye-compatible module for an image-only source', () => {
    const output = adapt('void mainImage(out vec4 O, vec2 C) { O = vec4(1.0); }', item);
    expect(output).toContain('// Ported from AVS/sample.glsl');
    expect(output).toContain('#ifdef SCRNSVR');
    expect(output).toContain('#define uTime iTime');
    expect(output).toContain('void upstreamImage(out vec4 O, vec2 C)');
    expect(output).toContain('void mainImage(out vec4 fragColor, in vec2 fragCoord)');
    expect(output).toContain('upstreamImage(fragColor, fragCoord);');
    expect(output).not.toContain('void main(');
  });

  it('folds a raw main() into upstreamImage writing the out parameter', () => {
    const output = adapt('void main() { gl_FragColor = vec4(1.0); }', item);
    expect(output).toContain('void upstreamImage(out vec4 scrnsvrResult, in vec2 scrnsvrCoord)');
    expect(output).toContain('scrnsvrResult = vec4(1.0);');
    expect(output).not.toContain('gl_FragColor');
  });

  it('keeps both the upstream mainImage and its main() wrapper', () => {
    const output = adapt('void mainImage(out vec4 O, vec2 C) { O = vec4(1.0); }\nvoid main() { vec4 c; mainImage(c, gl_FragCoord.xy); gl_FragColor = c; }', item);
    expect(output).toContain('void effectImage(out vec4 O, vec2 C)');
    expect(output).toContain('void upstreamImage(out vec4 scrnsvrResult, in vec2 scrnsvrCoord)');
    expect(output).toContain('effectImage(c, scrnsvrCoord)');
  });

  it('applies per-import rewrite rules', () => {
    expect(adapt(wrap('float speed = 1.0;'), { ...item, file: 'cloud.glsl' })).toContain('cloudSpeed');
    expect(adapt(wrap('float brightness = 1.0;'), { ...item, file: 'ocean.glsl' })).toContain('oceanBrightness');
    expect(adapt('void main() { fragColor = vec4(col*col,1); }', { ...item, id: 'shadersaver-water-ripples' }))
      .toContain('vec3(0.72, 0.9, 1.08)');
    const matrix = adapt(wrap('O = vec4(1.0);'), { ...item, id: 'avs-matrix' });
    expect(matrix).toContain('scrnsvrTanh');
  });

  it('renders the canonical module scaffold and manifest source', () => {
    const output = emitModule('void mainImage(out vec4 O, vec2 C) { O = vec4(1.0); }', item);
    expect(output).toContain('#ifdef SCRNSVR');
    expect(output).toContain('void mainImage(out vec4 fragColor, in vec2 fragCoord)');
    const manifest = manifestSource(item);
    expect(manifest).toContain('export const avsSampleManifest = manifest(');
    expect(manifest).toContain('"id": "avs-sample"');
    expect(manifest).toContain('"schemePalette": "custom"');
  });
});

describe('expressive imported controls', () => {
  it('keeps Original as the default and declares an opt-in tonal palette', () => {
    const output = adapt('void main() { gl_FragColor = vec4(1.0); }', item);
    expect(output).toContain('if (palette == 1)');
    // Bright sources are compressed so the shadow tone still shapes the image.
    expect(output).toContain('max(raw, 0.0) / (1.0 + max(raw, 0.0))');
    expect(output).toContain('mix(mapped, highlightColor, tone * tone)');
    const manifest = manifestSource(item);
    expect(manifest).toContain('"schemePalette": "custom"');
    expect(manifest).toContain('"default": "original"');
    expect(manifest).toContain('"colorRole": "surface"');
    expect(manifest).toContain('"visibleWhen": {');
  });

  it('re-imports structural controls into source expressions', () => {
    const cases = [
      ['avs-seven-segment', 'uv *= 15.0;', 'uv *= 15.0 / clockSize;'],
      ['avs-glow-clock', 'shade = 0.004 / (dist);', '0.004 * glowWidth / (dist)'],
      ['avs-green-clock', '#if SECONDS\nfloat seconds = 1.0;\n#endif', 'if (showSeconds)'],
      ['avs-matrix', 'float f = char_hash.x >= 0.1;', 'char_hash.x >= 1.0 - glyphFill'],
      ['shadersaver-water-ripples', 'float r = .4*sin(l*3.-iTime+.5);', '(.4 * waveHeight)*sin(l*(3. * waveDensity)-uTime * speed+.5)'],
      ['avs-ocean', 'float f = waveFreq;', 'float f = waveFreq * waveDensity;'],
      ['avs-sea', 'float amp = SEA_HEIGHT;', 'float amp = SEA_HEIGHT * waveHeight;'],
      ['avs-clouds', 'const float cloudcover = 0.2;', '#define cloudcover cloudCoverage'],
      ['avs-terrain', 'return t * 55.0;', 'return t * 55.0 * terrainHeight;'],
      ['avs-seascape', 'h *= 3.0;', 'h *= 3.0 * waveHeight;'],
      ['avs-field', 'float fog = dis*dis* 0.0000012;', 'dis*dis* 0.0000012 * fogDensity'],
    ];
    for (const [id, body, expected] of cases) {
      expect(adapt(wrap(body), { ...item, id })).toContain(expected);
    }
  });
});

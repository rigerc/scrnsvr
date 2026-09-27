import { describe, expect, it } from 'vitest';
import { adapt, compatibilityDefines, emitModule, manifestSource, replaceFirstMainImage, stripPreamble, symbolFor } from '../scripts/lib/upstream-adapt.mjs';

const item = { collection: 'AVS', file: 'sample.glsl', id: 'avs-sample', category: 'Abstract', title: 'Sample' };

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

  it('emits compatibility defines for declared upstream uniforms and ShaderSaver references', () => {
    const declared = compatibilityDefines('uniform float iTime;\nuniform vec2 iResolution;\nuniform vec4 iDate;', item);
    expect(declared).toContain('#define iTime (uTime * speed)');
    expect(declared).toContain('#define iDate (vec4(uDate.xyz, mod(uDate.w + uTime * speed, 86400.0)))');
    expect(declared).toContain('uniform vec4 uDate;');
    const shaderSaver = compatibilityDefines('float t = iTime;', { ...item, collection: 'ShaderSaver' });
    expect(shaderSaver).toContain('#define iTime (uTime * speed)');
    expect(compatibilityDefines('float t = 0.0;', item)).toEqual([]);
  });

  it('strips GLSL ES preambles and reroutes tanh', () => {
    const source = '#ifdef GL_ES\r\nprecision highp float;\r\n#endif\r\nprecision mediump float;\r\nuniform float iTime;\r\nfloat x = tanh(1.0);\r\n';
    const stripped = stripPreamble(source);
    expect(stripped).not.toContain('#ifdef GL_ES');
    expect(stripped).not.toContain('precision mediump float');
    expect(stripped).not.toContain('uniform float iTime');
    expect(stripped).toContain('scrnsvrTanh(1.0)');
  });

  it('adapts an image-only source into a shader that calls mainImage', () => {
    const output = adapt('void mainImage(out vec4 O, vec2 C) { O = vec4(1.0); }', item);
    expect(output).toContain('Ported from AVS/sample.glsl');
    expect(output).toContain('mainImage(importedColor, gl_FragCoord.xy);');
    expect(output).not.toContain('scrnsvrImportedMain');
  });

  it('adapts a source that already defines main', () => {
    const output = adapt('void main() { gl_FragColor = vec4(1.0); }', item);
    expect(output).toContain('void scrnsvrImportedMain()');
    expect(output).toContain('  scrnsvrImportedMain();');
  });

  it('applies per-import rewrite rules', () => {
    expect(adapt('float speed = 1.0;', { ...item, file: 'cloud.glsl' })).toContain('cloudSpeed');
    expect(adapt('float brightness = 1.0;', { ...item, file: 'ocean.glsl' })).toContain('oceanBrightness');
    expect(adapt('void main() { fragColor = vec4(col*col,1); }', { ...item, id: 'shadersaver-water-ripples' }))
      .toContain('vec3(0.72, 0.9, 1.08)');
    const matrix = adapt('void mainImage(out vec4 O, vec2 C) { O = vec4(1.0); }', { ...item, id: 'avs-matrix' });
    expect(matrix).toContain('scrnsvrTanh');
  });

  it('renders the module scaffold and manifest source', () => {
    expect(emitModule('float x = 1.0;', ['#define iTime (uTime * speed)'], item)).toContain('#define iTime (uTime * speed)');
    const manifest = manifestSource(item);
    expect(manifest).toContain("id: \"avs-sample\"");
    expect(manifest).toContain('export const avsSampleManifest = manifest({');
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
    expect(manifest).toContain("schemePalette: 'custom'");
    expect(manifest).toContain('"default":"original"');
    expect(manifest).toContain('"colorRole":"surface"');
    expect(manifest).toContain('"visibleWhen":{"name":"palette","value":"custom"}');
  });

  it('re-imports structural controls into source expressions', () => {
    const cases = [
      ['avs-seven-segment', 'uv *= 15.0;', 'uv *= 15.0 / clockSize;'],
      ['avs-glow-clock', 'shade = 0.004 / (dist);', '0.004 * glowWidth / (dist)'],
      ['avs-green-clock', '#if SECONDS\nfloat seconds = 1.0;\n#endif', 'if (showSeconds)'],
      ['avs-matrix', 'float f = char_hash.x >= 0.1;', 'char_hash.x >= 1.0 - glyphFill'],
      ['shadersaver-water-ripples', 'float r = .4*sin(l*3.-iTime+.5);', '(.4 * waveHeight)*sin(l*(3. * waveDensity)-iTime+.5)'],
      ['avs-ocean', 'float f = waveFreq;', 'float f = waveFreq * waveDensity;'],
      ['avs-sea', 'float amp = SEA_HEIGHT;', 'float amp = SEA_HEIGHT * waveHeight;'],
      ['avs-clouds', 'const float cloudcover = 0.2;', '#define cloudcover cloudCoverage'],
      ['avs-terrain', 'return t * 55.0;', 'return t * 55.0 * terrainHeight;'],
      ['avs-seascape', 'h *= 3.0;', 'h *= 3.0 * waveHeight;'],
      ['avs-field', 'float fog = dis*dis* 0.0000012;', 'dis*dis* 0.0000012 * fogDensity'],
    ];
    for (const [id, body, expected] of cases) {
      expect(adapt(body, { ...item, id })).toContain(expected);
    }
  });
});

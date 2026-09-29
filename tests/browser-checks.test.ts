// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { renderChecks, browserPrelude } = require('../scripts/lib/browser-checks.cjs');

/**
 * A deterministic stand-in for WebGL. Pixel luminance encodes the current time,
 * audio level and every non-control uniform, so the real check assertions
 * (animation, freezing, audio response, grayscale, uniform influence, baseline
 * comparison) execute exactly as they would against a real context.
 */
function createFakeGl() {
  const uniforms = new Map<string, number | number[]>();
  let currentTime = 0;
  let currentAudio = [0, 0, 0, 0];
  const hashText = (text: string) => {
    let hash = 0;
    for (let index = 0; index < text.length; index++) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
    return hash;
  };
  const hashValue = (value: unknown) => Array.isArray(value) ? value.map(item => item.toFixed(4)).join(',') : String(value);
  const readPixel = () => {
    const speed = uniforms.has('speed') ? Number(uniforms.get('speed')) : 1;
    const sensitivity = uniforms.has('sensitivity') ? Number(uniforms.get('sensitivity')) : 1;
    const timeTerm = speed === 0 ? 0 : (currentTime * 3) % 48;
    const audioTerm = currentAudio[0] * 15 * sensitivity;
    let combined = 0;
    for (const [name, value] of uniforms) {
      if (['uTime', 'uResolution', 'uDate', 'uAudio'].includes(name)) continue;
      combined = (combined * 7 + hashText(name) + hashText(hashValue(value))) >>> 0;
    }
    return Math.max(0, Math.min(250, Math.round(70 + timeTerm + audioTerm + (combined % 31))));
  };
  const gl: Record<string, unknown> = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLES: 8, RGBA: 9, UNSIGNED_BYTE: 10, NO_ERROR: 0,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    deleteShader: () => {},
    deleteProgram: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    deleteBuffer: () => {},
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    uniform1f: (location: { name: string }, value: number) => { uniforms.set(location.name, value); if (location.name === 'uTime') currentTime = value; },
    uniform2f: (location: { name: string }, a: number, b: number) => { uniforms.set(location.name, [a, b]); },
    uniform3f: (location: { name: string }, a: number, b: number, c: number) => { uniforms.set(location.name, [a, b, c]); },
    uniform4f: (location: { name: string }, a: number, b: number, c: number, d: number) => { uniforms.set(location.name, [a, b, c, d]); },
    uniform1i: (location: { name: string }, value: number) => { uniforms.set(location.name, value); },
    uniform4fv: (location: { name: string }, value: number[]) => { uniforms.set(location.name, [...value]); if (location.name === 'uAudio') currentAudio = value; },
    useProgram: () => {},
    viewport: () => {},
    drawArrays: () => {},
    readPixels: (_x: number, _y: number, _w: number, _h: number, _f: number, _t: number, pixels: Uint8Array) => {
      const value = readPixel();
      for (let index = 0; index < pixels.length; index += 4) {
        pixels[index] = value; pixels[index + 1] = value; pixels[index + 2] = value; pixels[index + 3] = 255;
      }
    },
    getError: () => 0,
    getExtension: () => null,
  };
  return gl;
}

const fakeGl = createFakeGl();
HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, type: string) {
  return type === 'webgl' || type === 'webgl2' ? fakeGl : null;
} as typeof HTMLCanvasElement.prototype.getContext;

const plainDefinition = {
  manifest: {
    id: 'test-plain', title: 'Plain', category: 'Ambient',
    uniforms: [
      { name: 'speed', type: 'float', default: 1, min: 0, max: 3, step: 0.01 },
      { name: 'saturation', type: 'float', default: 1, min: 0, max: 2, step: 0.01 },
      { name: 'loops', type: 'int', default: 2, min: 1, max: 5, step: 1 },
      { name: 'invert', type: 'bool', default: false },
      { name: 'tint', type: 'color', default: '#336699' },
      { name: 'mode', type: 'select', default: 'a', options: ['a', 'b', 'c'] },
    ],
  },
  source: 'void main(){}',
};
const reactiveDefinition = {
  manifest: {
    id: 'test-reactive', title: 'Reactive', category: 'Reactive',
    uniforms: [
      { name: 'speed', type: 'float', default: 1, min: 0, max: 3, step: 0.01 },
      { name: 'sensitivity', type: 'float', default: 1, min: 0, max: 1, step: 0.01 },
      { name: 'brightness', type: 'float', default: 1, min: 0, max: 2, step: 0.01 },
    ],
  },
  source: 'void main(){}',
};
const plasmaDefinition = {
  manifest: { id: 'plasma', title: 'Chromatic Plasma', category: 'Ambient', uniforms: [{ name: 'speed', type: 'float', default: 1, min: 0, max: 3, step: 0.01 }] },
  source: 'void main(){}',
};

const registry = {
  'test-plain': plainDefinition,
  'test-reactive': reactiveDefinition,
  plasma: plasmaDefinition,
};

describe('browser shader checks', () => {
  it('runs every scene assertion against a WebGL context', () => {
    const result = renderChecks(registry, { 'test-plain': plainDefinition }, 'webgl');
    expect(result.contextType).toBe('webgl');
    expect(result.checks).toBeGreaterThan(0);
    expect(result.reports.map((report: { id: string }) => report.id)).toEqual(['test-plain', 'test-reactive', 'plasma']);
    expect(result.reports.find((report: { id: string }) => report.id === 'test-plain').defaultDifference).toBe(0);
  });

  it('exposes serializable page-scope bindings for injection', () => {
    const prelude = browserPrelude();
    expect(() => new Function(prelude)).not.toThrow();
    for (const name of ['renderChecks', 'uiChecks', 'assertBaseline']) expect(prelude).toContain(`const ${name} = `);
  });
});

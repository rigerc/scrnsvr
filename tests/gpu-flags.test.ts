import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySoftwareGl, type CommandLineLike } from '../src/shared/gpu-flags';

function recordSwitches(calls: Array<[string, string?]>): CommandLineLike {
  return { appendSwitch: (name, value) => { calls.push(value === undefined ? [name] : [name, value]); } };
}

describe('applySoftwareGl', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('forces ANGLE over SwiftShader so headless WebGL comes up without a GPU', () => {
    vi.stubEnv('DISPLAY', '');
    const calls: Array<[string, string?]> = [];
    applySoftwareGl(recordSwitches(calls));
    expect(calls).toEqual([
      ['disable-vulkan'],
      ['use-gl', 'angle'],
      ['use-angle', 'swiftshader-webgl'],
      ['enable-unsafe-swiftshader'],
    ]);
  });

  it('adds the X11 backend only when a display is actually present', () => {
    vi.stubEnv('DISPLAY', ':0');
    const calls: Array<[string, string?]> = [];
    applySoftwareGl(recordSwitches(calls));
    expect(calls).toHaveLength(5);
    expect(calls).toContainEqual(['ozone-platform', 'x11']);
  });
});

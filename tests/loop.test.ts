// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLoop } from '../src/renderer/core/loop';

let callback: FrameRequestCallback;
let now = 0;
let stop: (() => void) | undefined;
beforeEach(() => {
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', vi.fn((next: FrameRequestCallback) => { callback = next; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});
afterEach(() => { stop?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function frame(time: number) { now = time; callback(time); }

describe('frame pacing', () => {
  it('meets 24 fps on a 60 Hz display without accumulating interval rounding', () => {
    const render = vi.fn();
    stop = startLoop(render, 24);
    for (let i = 1; i <= 600; i++) frame(i * 1000 / 60);
    expect(render).toHaveBeenCalledTimes(240);
    expect(render.mock.calls.reduce((sum, [delta]) => sum + delta, 0)).toBeCloseTo(10000);
  });

  it('keeps 60 fps despite fractional timestamp rounding', () => {
    const render = vi.fn();
    stop = startLoop(render);
    for (let i = 1; i <= 600; i++) frame(i * 1000 / 60);
    expect(render).toHaveBeenCalledTimes(600);
  });

  it('skips hidden time and resumes without a catch-up burst', () => {
    const render = vi.fn();
    stop = startLoop(render, 10);
    frame(100);
    Object.defineProperty(document, 'hidden', { value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    frame(60100);
    Object.defineProperty(document, 'hidden', { value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    frame(60200);
    expect(render.mock.calls).toEqual([[100], [100]]);
  });
});

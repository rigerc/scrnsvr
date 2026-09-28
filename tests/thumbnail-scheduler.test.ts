import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThumbnailScheduler } from '../src/renderer/core/thumbnail-scheduler';

const loop = vi.hoisted(() => ({ tick: (_delta: number) => {}, stop: vi.fn(), start: vi.fn() }));
vi.mock('../src/renderer/core/loop', () => ({
  startLoop: (tick: (delta: number) => void, fps: number) => {
    loop.tick = tick;
    loop.start(fps);
    return loop.stop;
  },
}));

let scheduler: ThumbnailScheduler;
const scene = () => ({ draw: vi.fn(), dispose: vi.fn(), resume: vi.fn(), suspend: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); scheduler = new ThumbnailScheduler(2); });
afterEach(() => { scheduler.dispose(); vi.restoreAllMocks(); });

describe('gallery thumbnail scheduling', () => {
  it('defers compilation and budgets one tile per frame, with fair service for a large gallery', () => {
    const scenes = Array.from({ length: 400 }, scene);
    const factories = scenes.map(item => vi.fn(() => item));
    factories.forEach(create => scheduler.mount({}, create));
    expect(factories.every(create => create.mock.calls.length === 0)).toBe(true);
    expect(loop.start.mock.calls).toEqual([[60]]);
    for (let frame = 0; frame < 400; frame++) {
      loop.tick(1000 / 60);
      expect(factories[frame]).toHaveBeenCalledTimes(1);
      expect(scenes[frame].draw).toHaveBeenCalledExactlyOnceWith(0);
    }
    loop.tick(1000 / 60);
    expect(scenes[0].draw).toHaveBeenCalledTimes(2);
    expect(scenes[399].draw).toHaveBeenCalledTimes(1);
  });

  it('caps a single tile at 15 fps and passes elapsed active time', () => {
    const item = scene();
    scheduler.mount({}, () => item);
    for (let frame = 0; frame < 60; frame++) loop.tick(1000 / 60);
    expect(item.draw).toHaveBeenCalledTimes(15);
    expect(item.draw.mock.calls[1][0]).toBeCloseTo(1000 / 15);
  });

  it('never compiles tiles that leave before their scheduled first frame', () => {
    const create = vi.fn(scene);
    const stop = scheduler.mount({}, create);
    stop();
    stop();
    expect(create).not.toHaveBeenCalled();
    expect(loop.stop).toHaveBeenCalledTimes(1);
  });

  it('reuses recently hidden scenes without compiling or including offscreen time', () => {
    const key = {};
    const item = scene();
    const create = vi.fn(() => item);
    const stop = scheduler.mount(key, create);
    loop.tick(1000 / 60);
    stop();
    expect(item.suspend).toHaveBeenCalledOnce();
    scheduler.mount({}, scene);
    loop.tick(10000);
    scheduler.mount(key, create);
    expect(item.resume).toHaveBeenCalledOnce();
    loop.tick(1000 / 60);
    loop.tick(1000 / 60);
    expect(create).toHaveBeenCalledOnce();
    expect(item.draw.mock.calls[1][0]).toBeCloseTo(1000 / 60);
    expect(item.dispose).not.toHaveBeenCalled();
  });

  it('evicts the least recently used hidden scene and leaves visible scenes alive', () => {
    const visible = scene();
    const stopVisible = scheduler.mount({}, () => visible);
    loop.tick(1000 / 60);
    const hidden = Array.from({ length: 3 }, scene);
    for (const item of hidden) {
      const stop = scheduler.mount({}, () => item);
      // At most two active tiles; allow each its turn.
      loop.tick(1000 / 60);
      loop.tick(1000 / 60);
      stop();
    }
    expect(hidden[0].dispose).toHaveBeenCalledOnce();
    expect(hidden[1].dispose).not.toHaveBeenCalled();
    expect(visible.dispose).not.toHaveBeenCalled();
    scheduler.dispose();
    stopVisible(); // pagehide cleanup may release a tile after scheduler disposal.
    scheduler.dispose();
    for (const item of [visible, ...hidden]) expect(item.dispose).toHaveBeenCalledOnce();
  });

  it('continues rendering other thumbnails after a shader fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = scene();
    bad.draw.mockImplementation(() => { throw new Error('broken shader'); });
    const stopBad = scheduler.mount({}, () => bad);
    const good = scene();
    scheduler.mount({}, () => good);
    loop.tick(1000 / 60);
    loop.tick(1000 / 60);
    expect(bad.dispose).toHaveBeenCalledOnce();
    expect(good.draw).toHaveBeenCalledOnce();
    stopBad();
    expect(bad.dispose).toHaveBeenCalledOnce();
  });
});

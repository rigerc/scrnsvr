// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fadeInOpacity, fadeOutOpacity, mountFadeOverlay } from '../src/renderer/core/fade';

describe('fade', () => {
  it('fades overlay opacity in and out linearly', () => {
    expect(fadeInOpacity(0, 1000)).toBe(1);
    expect(fadeInOpacity(500, 1000)).toBeCloseTo(0.5);
    expect(fadeInOpacity(1000, 1000)).toBe(0);
    expect(fadeOutOpacity(0, 1000)).toBe(0);
    expect(fadeOutOpacity(500, 1000)).toBeCloseTo(0.5);
    expect(fadeOutOpacity(1000, 1000)).toBe(1);
  });

  it('treats zero fade as instant', () => {
    expect(fadeInOpacity(0, 0)).toBe(0);
    expect(fadeOutOpacity(0, 0)).toBe(1);
  });
});

describe('fade overlay transitions and dismissal', () => {
  let now: number;
  let sequence: number;
  let frames: Map<number, FrameRequestCallback>;
  const advance = (milliseconds: number) => {
    now += milliseconds;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(callback => callback(now));
  };
  const opacity = () => Number(document.querySelector<HTMLElement>('.fade-overlay')!.style.opacity);
  beforeEach(() => {
    now = 0; sequence = 0; frames = new Map();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it('swaps exactly once at black and uses half the duration for each phase', () => {
    const fade = mountFadeOverlay(document.body, 1);
    advance(1000);
    const swap = vi.fn(() => expect(opacity()).toBe(1));
    fade.transition(swap);
    advance(250);
    expect(opacity()).toBeCloseTo(0.5);
    expect(swap).not.toHaveBeenCalled();
    advance(250);
    expect(swap).toHaveBeenCalledOnce();
    advance(250);
    expect(opacity()).toBeCloseTo(0.5);
    advance(250);
    expect(opacity()).toBe(0);
    expect(frames.size).toBe(0);
  });
  it('coalesces overlapping picks without resetting opacity or postponing the swap', () => {
    const fade = mountFadeOverlay(document.body, 1);
    advance(1000);
    const first = vi.fn(), second = vi.fn(), latest = vi.fn();
    fade.transition(first);
    advance(400);
    expect(opacity()).toBeCloseTo(0.8);
    fade.transition(second);
    advance(16);
    expect(opacity()).toBeCloseTo(0.832);
    fade.transition(latest);
    advance(84);
    expect(opacity()).toBe(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    advance(500);
    expect(opacity()).toBe(0);
  });
  it('continues from the current opacity when a transition interrupts fade-in', () => {
    const fade = mountFadeOverlay(document.body, 1);
    advance(250);
    expect(opacity()).toBeCloseTo(0.75);
    fade.transition(vi.fn());
    advance(250);
    expect(opacity()).toBeCloseTo(0.875);
    advance(250);
    advance(250);
    expect(opacity()).toBeCloseTo(0.5);
    fade.transition(vi.fn());
    advance(250);
    expect(opacity()).toBeCloseTo(0.75);
  });
  it.each([0, 1])('recovers from a throwing scene swap (fade seconds: %s)', seconds => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fade = mountFadeOverlay(document.body, seconds);
    advance(1000);
    fade.transition(() => { throw new Error('mount failed'); });
    advance(500);
    expect(warning).toHaveBeenCalledOnce();
    advance(500);
    expect(opacity()).toBe(0);
    expect(frames.size).toBe(0);
  });
  it('does not start fading in if the scene swap triggers dismissal', () => {
    const fade = mountFadeOverlay(document.body, 1);
    advance(1000);
    const close = vi.fn();
    fade.transition(() => fade.fadeOut(close));
    advance(500);
    advance(500);
    expect(opacity()).toBe(1);
    expect(close).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it('continues from the current opacity when dismissed during fade-in', () => {
    const fade = mountFadeOverlay(document.body, 1);
    advance(250);
    expect(opacity()).toBeCloseTo(0.75);
    const close = vi.fn();
    fade.fadeOut(close);
    expect(opacity()).toBeCloseTo(0.75);
    advance(500);
    expect(opacity()).toBeCloseTo(0.875);
    expect(close).not.toHaveBeenCalled();
    advance(500);
    expect(opacity()).toBe(1);
    expect(close).toHaveBeenCalledOnce();
  });
  it('keeps dismissal terminal despite repeated input, cycling, or opacity changes', () => {
    const fade = mountFadeOverlay(document.body, 1);
    advance(1000);
    const close = vi.fn();
    const duplicateClose = vi.fn();
    const swap = vi.fn();
    fade.fadeOut(close);
    advance(500);
    fade.fadeOut(duplicateClose);
    fade.transition(swap);
    fade.setOpacity(0);
    expect(opacity()).toBeCloseTo(0.5);
    advance(500);
    expect(opacity()).toBe(1);
    expect(close).toHaveBeenCalledOnce();
    expect(duplicateClose).not.toHaveBeenCalled();
    expect(swap).not.toHaveBeenCalled();
    fade.transition(swap);
    advance(1000);
    expect(opacity()).toBe(1);
    expect(close).toHaveBeenCalledOnce();
  });
  it('cancels a pending scene swap when dismissed during a transition', () => {
    const fade = mountFadeOverlay(document.body, 1);
    advance(1000);
    const swap = vi.fn();
    const close = vi.fn();
    fade.transition(swap);
    advance(250);
    fade.fadeOut(close);
    expect(opacity()).toBeCloseTo(0.5);
    advance(1000);
    expect(opacity()).toBe(1);
    expect(swap).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
  it('closes an instant fade with the overlay already black', () => {
    const fade = mountFadeOverlay(document.body, 0);
    const close = vi.fn(() => expect(opacity()).toBe(1));
    fade.fadeOut(close);
    expect(close).toHaveBeenCalledOnce();
  });
  it('cancels outstanding animation when destroyed', () => {
    const fade = mountFadeOverlay(document.body, 1);
    const close = vi.fn();
    fade.fadeOut(close);
    fade.destroy();
    advance(1000);
    fade.fadeOut(close);
    fade.transition(vi.fn());
    expect(close).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(document.querySelector('.fade-overlay')).toBeNull();
  });
});

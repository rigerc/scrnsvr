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

describe('fade overlay dismissal', () => {
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

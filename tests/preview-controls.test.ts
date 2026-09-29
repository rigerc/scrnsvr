// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountPreviewControls } from '../src/settings/preview-controls';
import { settingsMarkup } from '../src/settings/layout';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('preview controls', () => {
  it('starts paused for reduced motion but honors explicit playback', () => {
    const motion = new EventTarget() as MediaQueryList;
    Object.defineProperty(motion, 'matches', { value: true, writable: true });
    vi.stubGlobal('matchMedia', () => motion);
    document.body.innerHTML = settingsMarkup;
    const state = { paused: false };
    const cleanup = mountPreviewControls(document.body, state);
    const button = document.querySelector<HTMLButtonElement>('[data-preview-pause]')!;
    expect(state.paused).toBe(true);
    expect(button.textContent).toBe('Play animation');
    button.click();
    expect(state.paused).toBe(false);
    motion.dispatchEvent(new Event('change'));
    expect(state.paused).toBe(false);
    cleanup();
    vi.unstubAllGlobals();
  });

  it('announces fullscreen rejection and returns focus on exit', async () => {
    const motion = new EventTarget() as MediaQueryList;
    Object.defineProperty(motion, 'matches', { value: false });
    vi.stubGlobal('matchMedia', () => motion);
    document.body.innerHTML = settingsMarkup;
    const stage = document.querySelector<HTMLElement>('.clock-stage')!;
    stage.requestFullscreen = vi.fn().mockRejectedValue(new Error('Denied'));
    const cleanup = mountPreviewControls(document.body, { paused: false });
    const button = document.querySelector<HTMLButtonElement>('[data-preview-fullscreen]')!;
    button.click();
    await Promise.resolve();
    expect(document.querySelector('[data-playback-status]')?.textContent).toContain('unavailable');
    Object.defineProperty(document, 'fullscreenElement', { value: stage, configurable: true });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(document.activeElement).toBe(document.querySelector('[data-preview-exit]'));
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(document.activeElement).toBe(button);
    cleanup();
    vi.unstubAllGlobals();
  });
});

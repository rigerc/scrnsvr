import { describe, expect, it, vi } from 'vitest';
import { isAudioPlaying, isFullscreenActive, shouldInhibitScreensaver } from '../src/main/inhibit';

describe('inhibit', () => {
  it('detects active sink inputs', async () => {
    expect(await isAudioPlaying(async () => ({ stdout: '1\talsa_output\tmodule\n' }))).toBe(true);
    expect(await isAudioPlaying(async () => ({ stdout: '\n' }))).toBe(false);
    expect(await isAudioPlaying(async () => { throw new Error('no pactl'); })).toBe(false);
  });

  it('detects fullscreen X11 windows only', async () => {
    const fullscreen = vi.fn()
      .mockResolvedValueOnce({ stdout: '_NET_ACTIVE_WINDOW = 0x400001\n' })
      .mockResolvedValueOnce({ stdout: '_NET_WM_STATE = _NET_WM_STATE_FULLSCREEN\n' });
    expect(await isFullscreenActive(fullscreen, { DISPLAY: ':0' })).toBe(true);
    const windowed = vi.fn()
      .mockResolvedValueOnce({ stdout: '_NET_ACTIVE_WINDOW = 0x400001\n' })
      .mockResolvedValueOnce({ stdout: '_NET_WM_STATE = _NET_WM_STATE_MAXIMIZED_HORZ\n' });
    expect(await isFullscreenActive(windowed, { DISPLAY: ':0' })).toBe(false);
    // No DISPLAY (Wayland): never claim fullscreen.
    expect(await isFullscreenActive(async () => ({ stdout: 'x' }), {})).toBe(false);
    // Missing tools: never claim fullscreen.
    expect(await isFullscreenActive(async () => { throw new Error('no xprop'); }, { DISPLAY: ':0' })).toBe(false);
  });

  it('combines flags into reasons without throwing', async () => {
    const exec = async () => ({ stdout: '1\tsink\n' });
    const both = await shouldInhibitScreensaver(
      { inhibitOnAudio: true, inhibitOnFullscreen: true }, { exec, env: {} },
    );
    expect(both).toEqual({ inhibited: true, reasons: ['audio playing'] });
    const off = await shouldInhibitScreensaver(
      { inhibitOnAudio: false, inhibitOnFullscreen: false }, { exec, env: {} },
    );
    expect(off).toEqual({ inhibited: false, reasons: [] });
  });
});

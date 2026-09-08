import { describe, expect, it } from 'vitest';
import { parseArgs, resolveMode } from '../src/main/cli';

describe('parseArgs', () => {
  it('parses public renderer and settings modes', () => {
    expect(parseArgs(['--settings'])).toMatchObject({ settings: true, daemon: false });
    expect(parseArgs(['-s'])).toMatchObject({ settings: true });
    expect(parseArgs(['--open'])).toMatchObject({ open: true });
    expect(parseArgs(['--preview', '--shader', 'plasma'])).toMatchObject({ preview: true, shader: 'plasma' });
  });

  it('parses thumbnail options defensively', () => {
    expect(parseArgs(['--thumbnail', '--output', '/tmp/out', '--frames', '8'])).toMatchObject({ thumbnail: true, output: '/tmp/out', frames: 8 });
    expect(parseArgs(['--frames', '-1']).frames).toBe(3);
  });

  it('defaults argless runs to settings and opens the screensaver with --open', () => {
    expect(resolveMode(parseArgs([]))).toBe('settings');
    expect(resolveMode(parseArgs(['--settings']))).toBe('settings');
    expect(resolveMode(parseArgs(['-s']))).toBe('settings');
    expect(resolveMode(parseArgs(['--open']))).toBe('screensaver');
    expect(resolveMode(parseArgs(['--preview']))).toBe('screensaver');
    expect(resolveMode(parseArgs(['--daemon']))).toBe('daemon');
    expect(resolveMode(parseArgs(['--thumbnail']))).toBe('thumbnail');
  });
});

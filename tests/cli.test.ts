import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/main/cli';

describe('parseArgs', () => {
  it('parses public renderer and settings modes', () => {
    expect(parseArgs(['--settings'])).toMatchObject({ settings: true, daemon: false });
    expect(parseArgs(['-s'])).toMatchObject({ settings: true });
    expect(parseArgs(['--preview', '--shader', 'plasma'])).toMatchObject({ preview: true, shader: 'plasma' });
  });

  it('parses thumbnail options defensively', () => {
    expect(parseArgs(['--thumbnail', '--output', '/tmp/out', '--frames', '8'])).toMatchObject({ thumbnail: true, output: '/tmp/out', frames: 8 });
    expect(parseArgs(['--frames', '-1']).frames).toBe(3);
  });
});

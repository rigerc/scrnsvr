import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigSchema, configPath, defaultConfig, loadConfig, saveConfig } from '../src/shared/config';

let temporary: string | undefined;
afterEach(async () => {
  delete process.env.XDG_CONFIG_HOME;
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

describe('config', () => {
  it('migrates legacy global fields', () => {
    const parsed = ConfigSchema.parse({ fps: 24, monitor: 'all' });
    expect(parsed.global).toMatchObject({ fps: 24, monitors: 'all' });
  });

  it('defaults rotation to disabled with no entries', () => {
    expect(ConfigSchema.parse({}).rotation).toEqual({ enabled: false, entries: [], intervalMinutes: 0 });
    expect(ConfigSchema.parse({ rotation: { enabled: true, entries: [{ shader: 'plasma', preset: 'neon' }], intervalMinutes: 10 } }).rotation)
      .toEqual({ enabled: true, entries: [{ shader: 'plasma', preset: 'neon' }], intervalMinutes: 10 });
  });

  it('defaults inhibit flags', () => {
    expect(ConfigSchema.parse({}).global).toMatchObject({ inhibitOnAudio: false, inhibitOnFullscreen: true });
  });

  it('defaults color schemes to built-in colors', () => {
    expect(ConfigSchema.parse({}).colors).toEqual({ scheme: 'none', overrides: {} });
    expect(defaultConfig.colors).toEqual({ scheme: 'none', overrides: {} });
  });

  it('round-trips a global scheme and per-shader override', () => {
    const parsed = ConfigSchema.parse({ colors: { scheme: 'dracula', overrides: { plasma: 'nord', 'flow-field': 'none' } } });
    expect(parsed.colors).toEqual({ scheme: 'dracula', overrides: { plasma: 'nord', 'flow-field': 'none' } });
    expect(ConfigSchema.parse({ colors: { scheme: 'does-not-exist' } }).colors.scheme).toBe('does-not-exist');
  });

  it('keeps legacy configs without colors readable', () => {
    expect(ConfigSchema.parse({ shader: 'plasma' }).colors).toEqual({ scheme: 'none', overrides: {} });
  });

  it('defaults fade duration and accepts updates', () => {
    expect(ConfigSchema.parse({}).global.fadeSeconds).toBe(1);
    expect(ConfigSchema.parse({ global: { fadeSeconds: 2.5 } }).global.fadeSeconds).toBe(2.5);
  });

  it('falls back safely and atomically coalesces writes', async () => {
    temporary = await mkdtemp(path.join(tmpdir(), 'scrnsvr-test-'));
    process.env.XDG_CONFIG_HOME = temporary;
    expect(await loadConfig()).toEqual(defaultConfig);
    const first = ConfigSchema.parse({ shader: 'plasma' });
    const last = ConfigSchema.parse({ shader: 'interference', global: { fps: 30 } });
    await Promise.all([saveConfig(first), saveConfig(last)]);
    const stored = JSON.parse(await readFile(configPath(), 'utf8'));
    expect(stored.shader).toBe('interference');
    expect(stored.global.fps).toBe(30);
  });
});

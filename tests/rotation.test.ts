import { describe, expect, it } from 'vitest';
import { pickRotationEntry, resolveRotationValues, rotationEntryKey } from '../src/shared/rotation';

describe('pickRotationEntry', () => {
  const shaders = { plasma: { speed: 1 }, interference: { scale: 2 } };
  const presets = { plasma: { neon: { speed: 9 } } };
  const ids = ['plasma', 'interference'];

  it('returns undefined when rotation is disabled or empty', () => {
    expect(pickRotationEntry(undefined, shaders, presets, ids)).toBeUndefined();
    expect(pickRotationEntry({ enabled: false, entries: [{ shader: 'plasma' }] }, shaders, presets, ids)).toBeUndefined();
    expect(pickRotationEntry({ enabled: true, entries: [] }, shaders, presets, ids)).toBeUndefined();
  });

  it('ignores unknown shader ids', () => {
    expect(pickRotationEntry({ enabled: true, entries: [{ shader: 'nope' }] }, shaders, presets, ids)).toBeUndefined();
  });

  it('picks a deterministic entry with an injected random source', () => {
    const pick = pickRotationEntry(
      { enabled: true, entries: [{ shader: 'plasma' }, { shader: 'interference' }] },
      shaders, presets, ids, () => 0.75,
    );
    expect(pick?.shaderId).toBe('interference');
    expect(pick?.values).toEqual({ scale: 2 });
  });

  it('keeps a saved look independent of later current edits', () => {
    const pick = pickRotationEntry(
      { enabled: true, entries: [{ shader: 'plasma', preset: 'neon' }], intervalMinutes: 0 },
      shaders, presets, ids, () => 0,
    );
    expect(pick).toMatchObject({ shaderId: 'plasma', preset: 'neon', values: { speed: 9 } });
    expect(resolveRotationValues(shaders, presets, 'plasma', 'neon')).toEqual({ speed: 9 });
    expect(resolveRotationValues(shaders, presets, 'plasma')).toEqual({ speed: 1 });
    expect(resolveRotationValues({ plasma: { speed: 1, brightness: 0.3 } }, presets, 'plasma', 'neon'))
      .toEqual({ speed: 9 });
  });

  it('can choose multiple saved looks from the same shader', () => {
    const picks = { enabled: true, entries: [
      { shader: 'plasma', preset: 'neon' },
      { shader: 'plasma', preset: 'soft' },
    ], intervalMinutes: 0 };
    const saved = { plasma: { neon: { speed: 9 }, soft: { speed: 0.25 } } };
    expect(pickRotationEntry(picks, shaders, saved, ids, () => 0, rotationEntryKey('plasma', 'neon')))
      .toMatchObject({ shaderId: 'plasma', preset: 'soft', values: { speed: 0.25 } });
  });

  it('skips a deleted look instead of showing current edits in its place', () => {
    const picks = { enabled: true, entries: [{ shader: 'plasma', preset: 'deleted' }], intervalMinutes: 0 };
    expect(pickRotationEntry(picks, shaders, presets, ids)).toBeUndefined();
  });

  it('avoids repeating the current entry when cycling', () => {
    const rotation = { enabled: true, entries: [{ shader: 'plasma' }, { shader: 'interference' }], intervalMinutes: 5 };
    const pick = pickRotationEntry(rotation, shaders, presets, ids, () => 0, rotationEntryKey('plasma'));
    expect(pick?.shaderId).toBe('interference');
    // Single-entry rotation still cycles (nothing else to show).
    const solo = pickRotationEntry(
      { enabled: true, entries: [{ shader: 'plasma' }], intervalMinutes: 5 },
      shaders, presets, ids, () => 0, rotationEntryKey('plasma'),
    );
    expect(solo?.shaderId).toBe('plasma');
  });
});

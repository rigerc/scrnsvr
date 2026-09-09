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

  it('overlays preset values on current shader values', () => {
    const pick = pickRotationEntry(
      { enabled: true, entries: [{ shader: 'plasma', preset: 'neon' }], intervalMinutes: 0 },
      shaders, presets, ids, () => 0,
    );
    expect(pick).toMatchObject({ shaderId: 'plasma', preset: 'neon', values: { speed: 9 } });
    expect(resolveRotationValues(shaders, presets, 'plasma', 'neon')).toEqual({ speed: 9 });
    expect(resolveRotationValues(shaders, presets, 'plasma')).toEqual({ speed: 1 });
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

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPalette, normalizeColor, parseScalar, parseYaml } from '../scripts/lib/palettes.mjs';

const scratch = mkdtempSync(path.join(tmpdir(), 'scrnsvr-palettes-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function fixture(name: string, contents: string): string {
  writeFileSync(path.join(scratch, name), contents, 'utf8');
  return scratch;
}

const validYaml = [
  'variant: dark',
  ...Array.from({ length: 16 }, (_, index) => `color_${String(index + 1).padStart(2, '0')}: '#00${String(index + 1).padStart(2, '0')}00'`),
  "background: '#111'",
  "foreground: '#eee'",
].join('\n') + '\n';

describe('palette generator helpers', () => {
  it('parses quoted and unquoted scalars without treating quoted hashes as comments', () => {
    expect(parseScalar("  'text # not a comment'  ")).toBe('text # not a comment');
    expect(parseScalar('"double"')).toBe('double');
    expect(parseScalar('plain  # trailing')).toBe('plain');
    expect(parseScalar('   ')).toBe('');
    expect(() => parseScalar("'unterminated")).toThrow('Unterminated quoted value');
  });

  it('parses yaml fields and reports unsupported lines', () => {
    expect(parseYaml('---\n# comment\nname: Test\nvariant: light # inline\r\n', 'x.yml')).toEqual({ name: 'Test', variant: 'light' });
    expect(() => parseYaml('not a field\n', 'x.yml')).toThrow('x.yml:1: unsupported line');
  });

  it('normalizes three- and six-digit colors and rejects others', () => {
    expect(normalizeColor(' #AbC ', 'where')).toBe('#aabbcc');
    expect(normalizeColor('#AABBCC', 'where')).toBe('#aabbcc');
    expect(() => normalizeColor('nope', 'where')).toThrow('where: invalid color');
  });

  it('builds a palette from a curated entry and derives ANSI roles', () => {
    const palette = buildPalette({ id: 'dracula', name: 'Dracula', file: 'Dracula.yml' }, 'reference');
    expect(palette.variant).toBe('dark');
    expect(palette.ansi).toHaveLength(16);
    expect(palette.roles.primary).toBe(palette.ansi[4]);
    expect(palette.cursor).toBe('#f8f8f2');
  });

  it('applies role overrides and expands shorthand colors', () => {
    fixture('roles.yml', validYaml.replace('#111', '#abc'));
    const palette = buildPalette({ id: 'custom-id', name: 'Custom', file: 'roles.yml', roles: { primary: '#000000' } }, scratch);
    expect(palette.roles.primary).toBe('#000000');
    expect(palette.background).toBe('#aabbcc');
  });

  it('omits the cursor when the source has none', () => {
    fixture('no-cursor.yml', validYaml);
    expect(buildPalette({ id: 'no-cursor', name: 'No Cursor', file: 'no-cursor.yml' }, scratch)).not.toHaveProperty('cursor');
  });

  it('rejects invalid ids, unreadable files, bad variants and incomplete sources', () => {
    expect(() => buildPalette({ id: 'Bad Id', name: 'x', file: 'Dracula.yml' }, 'reference')).toThrow('Invalid palette id');
    expect(() => buildPalette({ id: 'missing', name: 'x', file: 'does-not-exist.yml' }, scratch)).toThrow('Could not read');
    fixture('bad-variant.yml', validYaml.replace('variant: dark', 'variant: neon'));
    expect(() => buildPalette({ id: 'bad-variant', name: 'x', file: 'bad-variant.yml' }, scratch)).toThrow('variant must be dark or light');
    fixture('missing-color.yml', validYaml.replace('color_16:', 'color_missing:'));
    expect(() => buildPalette({ id: 'missing-color', name: 'x', file: 'missing-color.yml' }, scratch)).toThrow('missing color_16');
    fixture('missing-background.yml', validYaml.replace("background: '#111'", "bg: '#111'"));
    expect(() => buildPalette({ id: 'missing-bg', name: 'x', file: 'missing-background.yml' }, scratch)).toThrow('missing background');
  });
});

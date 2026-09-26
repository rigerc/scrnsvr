// Pure parsing/validation helpers for scripts/generate-palettes.mjs.
// Kept importable (and testable) because the generator itself writes the
// generated file as an import side effect.
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Read `key: 'value'  # comment` lines without letting `#` inside quotes start a comment. */
export function parseScalar(raw) {
  const value = raw.trim();
  if (!value) return '';
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const close = value.indexOf(quote, 1);
    if (close === -1) throw new Error(`Unterminated quoted value: ${raw}`);
    return value.slice(1, close);
  }
  const hash = value.indexOf('#');
  return (hash === -1 ? value : value.slice(0, hash)).trim();
}

export function parseYaml(text, file) {
  const fields = {};
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '---' || trimmed.startsWith('#')) return;
    const match = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
    if (!match) throw new Error(`${file}:${index + 1}: unsupported line ${JSON.stringify(line)}`);
    fields[match[1]] = parseScalar(match[2]);
  });
  return fields;
}

export function normalizeColor(value, where) {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(String(value).trim());
  if (!match) throw new Error(`${where}: invalid color ${JSON.stringify(value)}`);
  const hex = match[1].toLowerCase();
  return hex.length === 3 ? `#${[...hex].map((digit) => digit + digit).join('')}` : `#${hex}`;
}

export function buildPalette(entry, referenceDir) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) throw new Error(`Invalid palette id: ${entry.id}`);
  const file = path.join(referenceDir, entry.file);
  const where = `reference/${entry.file}`;
  let fields;
  try {
    fields = parseYaml(readFileSync(file, 'utf8'), entry.file);
  } catch (error) {
    throw new Error(`Could not read ${where}: ${error.message}`);
  }
  const ansi = [];
  for (let index = 1; index <= 16; index += 1) {
    const key = `color_${String(index).padStart(2, '0')}`;
    if (!(key in fields)) throw new Error(`${where}: missing ${key}`);
    ansi.push(normalizeColor(fields[key], `${where}:${key}`));
  }
  for (const key of ['background', 'foreground']) {
    if (!(key in fields)) throw new Error(`${where}: missing ${key}`);
  }
  const variant = fields.variant;
  if (variant !== 'dark' && variant !== 'light') throw new Error(`${where}: variant must be dark or light`);
  const derived = {
    surface: normalizeColor(fields.background, `${where}:background`),
    onSurface: normalizeColor(fields.foreground, `${where}:foreground`),
    primary: ansi[4],
    secondary: ansi[5],
    tertiary: ansi[6],
  };
  const roles = entry.roles ? { ...derived, ...entry.roles } : derived;
  return {
    id: entry.id,
    name: entry.name,
    variant,
    background: derived.surface,
    foreground: derived.onSurface,
    ...(fields.cursor ? { cursor: normalizeColor(fields.cursor, `${where}:cursor`) } : {}),
    ansi,
    roles,
  };
}

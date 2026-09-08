import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseNoctaliaPalette, type NoctaliaImportResult } from '../shared/noctalia';

export function noctaliaColorsPath(): string {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'noctalia', 'colors.json');
}

export async function loadNoctaliaColors(): Promise<NoctaliaImportResult> {
  const file = noctaliaColorsPath();
  try {
    const source = await readFile(file, 'utf8');
    return { ok: true, palette: parseNoctaliaPalette(JSON.parse(source)), path: file };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, error: `Noctalia colors were not found at ${file}. Open Noctalia and choose a color scheme first.` };
    }
    if (error instanceof SyntaxError) {
      return { ok: false, error: `Noctalia colors at ${file} are not valid JSON.` };
    }
    return { ok: false, error: `Could not import Noctalia colors: ${error instanceof Error ? error.message : 'Unable to read the color file.'}` };
  }
}

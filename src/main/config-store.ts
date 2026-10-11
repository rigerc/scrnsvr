import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ConfigSchema, type Config } from '../shared/config';

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(base, 'scrnsvr', 'config.json');
}

export async function loadConfig(): Promise<Config> {
  try {
    return ConfigSchema.parse(JSON.parse(await readFile(configPath(), 'utf8')));
  } catch {
    // Each caller owns its mutable config, including when the file is missing.
    return ConfigSchema.parse({});
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

/** Coalesce pending saves into the latest snapshot and replace the file atomically. */
export function saveConfig(config: Config): Promise<void> {
  if (timer) clearTimeout(timer);
  return new Promise((resolve, reject) => {
    waiters.push({ resolve, reject });
    timer = setTimeout(async () => {
      const pending = waiters;
      waiters = [];
      try {
        const file = configPath();
        const validated = ConfigSchema.parse(config);
        await mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
        await rename(temporary, file);
        pending.forEach(({ resolve: done }) => done());
      } catch (error) {
        pending.forEach(({ reject: fail }) => fail(error));
      }
    }, 150);
  });
}

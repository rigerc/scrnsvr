import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { clockFonts, clockPositions, defaultClockConfig } from './clock';

const ClockSchema = z.object({
  enabled: z.boolean().default(defaultClockConfig.enabled),
  position: z.enum(clockPositions).default(defaultClockConfig.position),
  font: z.enum(clockFonts).default(defaultClockConfig.font),
  customFont: z.string().max(100).default(defaultClockConfig.customFont),
  size: z.number().min(2).max(30).default(defaultClockConfig.size),
  weight: z.number().int().min(100).max(900).default(defaultClockConfig.weight),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default(defaultClockConfig.color),
  opacity: z.number().min(0.1).max(1).default(defaultClockConfig.opacity),
  margin: z.number().min(0).max(20).default(defaultClockConfig.margin),
  format: z.enum(['24h', '12h']).default(defaultClockConfig.format),
  showSeconds: z.boolean().default(defaultClockConfig.showSeconds),
  showDate: z.boolean().default(defaultClockConfig.showDate),
  shadow: z.boolean().default(defaultClockConfig.shadow),
}).default({});

const GlobalSchema = z.object({
  idleThresholdSeconds: z.number().min(0).default(300),
  fps: z.number().int().min(1).max(240).default(60),
  monitors: z.enum(['all', 'primary']).default('primary')
}).default({});
const ConfigObjectSchema = z.object({
  // Legacy fields remain readable by older builds.
  shader: z.string().default('flow-field'), fps: z.number().int().min(1).max(240).default(60),
  monitor: z.enum(['all','primary']).default('primary'), kiosk: z.boolean().default(true),
  settings: z.boolean().default(false),
  global: GlobalSchema,
  clock: ClockSchema,
  shaders: z.record(z.string(), z.record(z.string(), z.union([z.number(), z.boolean(), z.string()]))).default({}),
  presets: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])))).default({})
});
export const ConfigSchema = z.preprocess((candidate) => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
  const value = candidate as Record<string, unknown>;
  if (value.global !== undefined) return value;
  return {
    ...value,
    global: {
      fps: value.fps,
      monitors: value.monitor,
    },
  };
}, ConfigObjectSchema).transform(value => ({ ...value, fps: value.global.fps, monitor: value.global.monitors }));
export type Config = z.infer<typeof ConfigSchema>;
export const defaultConfig: Config = ConfigSchema.parse({});
export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(base, 'scrnsvr', 'config.json');
}
export async function loadConfig(): Promise<Config> {
  try { return ConfigSchema.parse(JSON.parse(await readFile(configPath(),'utf8'))); } catch { return defaultConfig; }
}
let timer: ReturnType<typeof setTimeout> | undefined;
let waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
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

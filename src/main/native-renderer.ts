import { EventEmitter } from 'node:events';
import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '../shared/config';
import type { AudioFrame } from '../shared/audio';
import { clockPangoFamily, formatClock, type ClockConfig } from '../shared/clock';
import { MAX_EFFECT_LAYERS, resolveEffectValues, type EffectDefinition } from '../shared/effects';
import type { UniformManifest, UniformValue } from '../shared/manifest';
import { rotationEntryKey } from '../shared/rotation';
import { compiledFragmentSource } from '../shared/shader-source';
import { bindUniforms } from '../renderer/core/uniforms';
import { resolveShaderValues } from '../renderer/core/selection';
import type { ShaderDefinition } from '../renderer/core/runtime';
import { startCycling, type RendererTarget } from './windows';

export type WindowBackend = 'auto' | 'layer-shell' | 'fullscreen';
type Registry = Record<string, Pick<ShaderDefinition, 'manifest' | 'source' | 'animationTime'>>;
type NativeValue = number | number[];

/** The native renderer draws directly into layer-shell surfaces; previews keep Electron windows. */
export function useNativeRenderer(backend: WindowBackend, preview: boolean, platform = process.platform, env = process.env): boolean {
  return !preview && backend !== 'fullscreen' && platform === 'linux' && !!env.WAYLAND_DISPLAY;
}

/** Packaged builds unpack the executable from the ASAR archive. */
export function nativeRendererPath(directory = __dirname, exists = existsSync): string | undefined {
  const candidate = path.join(directory, '../native/scrnsvr-renderer').replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
  return exists(candidate) ? candidate : undefined;
}

function rgb(hex: string): number[] {
  const value = Number.parseInt(/^#[\da-f]{6}$/i.test(hex) ? hex.slice(1) : 'ffffff', 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** GL-ready value, matching how the WebGL runtime uploads each control type. */
export function nativeValue(definition: UniformManifest, value: UniformValue): NativeValue {
  if (definition.type === 'color') return rgb(String(value));
  if (definition.type === 'select') return Math.max(0, definition.options?.indexOf(String(value)) ?? 0);
  if (definition.type === 'bool') return value ? 1 : 0;
  if (definition.type === 'int') return Math.round(Number(value));
  return Number(value);
}

export interface ScenePlan {
  type: 'scene';
  key: string;
  shader: { source: string; uniforms: Record<string, NativeValue>; integrated: boolean; audio: boolean };
  effects: { id: string; passes: string[]; history: boolean; uniforms: Record<string, NativeValue> }[];
}

/** Everything the native renderer needs for one scene; all value resolution stays in TypeScript. */
export function buildScenePlan(config: Config, target: RendererTarget, registry: Registry, effects: Record<string, EffectDefinition>): ScenePlan {
  const shader = registry[target.shaderId];
  if (!shader) throw new Error(`Unknown shader ${target.shaderId}`);
  const values = bindUniforms(shader.manifest.uniforms, resolveShaderValues(config, registry as Record<string, ShaderDefinition>, target.shaderId, target.preset));
  const layers = config.effects.enabled ? config.effects.layers.slice(0, MAX_EFFECT_LAYERS) : [];
  return {
    type: 'scene',
    key: rotationEntryKey(target.shaderId, target.preset),
    shader: {
      source: compiledFragmentSource(shader.source),
      uniforms: Object.fromEntries(shader.manifest.uniforms.map(definition => [definition.name, nativeValue(definition, values[definition.name])])),
      integrated: shader.animationTime === 'integrated',
      audio: /\buAudio\b/.test(shader.source),
    },
    effects: layers.flatMap(layer => {
      const definition = Object.hasOwn(effects, layer.effectId) ? effects[layer.effectId] : undefined;
      if (!layer.enabled || !definition) return [];
      const resolved = resolveEffectValues(definition, layer.values);
      if (resolved.intensity === 0) return [];
      return [{
        id: layer.id,
        passes: [...(definition.passes ?? []), definition.source],
        history: Boolean(definition.history),
        uniforms: Object.fromEntries(definition.uniforms.map(uniform => [uniform.name, nativeValue(uniform, resolved[uniform.name])])),
      }];
    }),
  };
}

/** Clock style plus text formatted here, so locale handling matches the Electron overlay. */
export function clockMessage(config: ClockConfig, now = new Date()) {
  const text = formatClock(now, config);
  return {
    type: 'clock', enabled: config.enabled, position: config.position, family: clockPangoFamily(config),
    weight: config.weight, color: rgb(config.color), opacity: config.opacity, size: config.size,
    margin: config.margin, shadow: config.shadow, time: text.time, period: text.period, date: text.date,
  };
}

export interface NativeOutputHint { name: string; x: number; y: number; }
export interface NativeAudioSource { subscribe(listener: (frame: AudioFrame) => void): () => void; }

export interface NativeScreensaverOptions {
  binary: string;
  config: Config;
  target: RendererTarget;
  registry: (config: Config) => Registry;
  effects: Record<string, EffectDefinition>;
  /** Primary display for 'primary' monitor mode; omitted renders every output. */
  output?: NativeOutputHint;
  loadConfig: () => Promise<Config>;
  audio: NativeAudioSource;
  spawn?: typeof spawnProcess;
  timeoutMs?: number;
  log?: (message: string) => void;
}

export function nativeArguments(config: Config, output?: NativeOutputHint): string[] {
  const args = ['--fps', String(config.global.fps), '--fade', String(config.global.fadeSeconds)];
  if (config.global.monitors === 'all' || !output) args.push('--all-outputs');
  else args.push('--output', output.name, '--output-at', `${Math.round(output.x)},${Math.round(output.y)}`);
  return args;
}

/** Exit codes the renderer uses before it is ready. */
export const NativeExit = { closed: 0, failed: 1, unavailable: 2, sceneFailed: 3 } as const;

export class NativeStartupError extends Error {
  constructor(message: string, readonly code: number | null) { super(message); }
}

/**
 * One running screensaver. Emits 'closed' and 'exit' (with the exit code) once,
 * after the renderer has faded out and released its surfaces.
 */
export class NativeScreensaver extends EventEmitter {
  private exited = false;
  private stopCycling?: () => void;
  private clockTimer?: ReturnType<typeof setTimeout>;
  private clockText = '';
  private unsubscribeAudio?: () => void;
  private stderr = '';
  readonly ready: Promise<void>;

  constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly options: NativeScreensaverOptions) {
    super();
    const log = options.log ?? (message => console.warn(message));
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    let ready = false;
    this.ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // Callers that only care about 'exit' must not see an unhandled rejection.
    this.ready.catch(() => {});
    const timeout = setTimeout(() => {
      if (ready) return;
      rejectReady(new NativeStartupError('Native renderer did not present a frame in time', null));
      child.kill('SIGTERM');
    }, options.timeoutMs ?? 8000);
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      for (let index; (index = pending.indexOf('\n')) >= 0;) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        let message: { type?: string };
        try { message = JSON.parse(line); } catch { continue; }
        if (message.type === 'ready' && !ready) {
          ready = true;
          clearTimeout(timeout);
          resolveReady();
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-2000);
      for (const line of chunk.split('\n')) if (line.trim()) log(line.trim());
    });
    // Writes after exit are expected while shutting down.
    child.stdin.on('error', () => {});
    const finish = (code: number | null, error?: Error) => {
      if (this.exited) return;
      this.exited = true;
      clearTimeout(timeout);
      this.stopUpdates();
      if (!ready) rejectReady(error ?? new NativeStartupError(this.stderr.trim().split('\n').pop() || `Native renderer exited with code ${code}`, code));
      this.emit('closed');
      this.emit('exit', code);
    };
    child.once('error', error => finish(null, error));
    child.once('exit', code => finish(code));
    this.showScene(options.target, options.config);
    this.startClock(options.config.clock);
    this.stopCycling = startCycling({
      initial: options.target, config: options.config, loadConfig: options.loadConfig,
      shaderIds: config => Object.keys(options.registry(config)),
      send: (target, config) => this.showScene(target, config),
    });
  }

  private send(message: unknown) {
    if (this.exited || !this.child.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private showScene(target: RendererTarget, config: Config) {
    let plan: ScenePlan;
    try { plan = buildScenePlan(config, target, this.options.registry(config), this.options.effects); }
    catch (error) { (this.options.log ?? console.warn)(`scrnsvr could not prepare ${target.shaderId}: ${String(error)}`); return; }
    this.send(plan);
    // Capture only runs while a reactive scene is on screen.
    if (plan.shader.audio && !this.unsubscribeAudio) {
      this.unsubscribeAudio = this.options.audio.subscribe(frame => this.send({ type: 'audio', value: [frame.level, frame.bass, frame.mid, frame.treble] }));
    } else if (!plan.shader.audio && this.unsubscribeAudio) {
      this.unsubscribeAudio();
      this.unsubscribeAudio = undefined;
    }
  }

  private startClock(config: ClockConfig) {
    const tick = () => {
      const message = clockMessage(config);
      const text = JSON.stringify(message);
      if (text !== this.clockText) { this.clockText = text; this.send(message); }
      if (!config.enabled) return;
      // Re-read wall time each second so suspend/resume and time changes stay correct.
      this.clockTimer = setTimeout(tick, 1000 - Date.now() % 1000);
      this.clockTimer.unref?.();
    };
    tick();
  }

  private stopUpdates() {
    this.stopCycling?.();
    this.stopCycling = undefined;
    if (this.clockTimer) clearTimeout(this.clockTimer);
    this.clockTimer = undefined;
    this.unsubscribeAudio?.();
    this.unsubscribeAudio = undefined;
  }

  /** Fade out and close, as if the user had pressed a key. */
  dismiss() { this.send({ type: 'dismiss' }); }

  /** Stop immediately, e.g. when the daemon itself is quitting. */
  kill() {
    if (this.exited) return;
    this.stopUpdates();
    this.child.kill('SIGTERM');
  }
}

/** Resolve once every output shows the first frame; reject if the renderer cannot start. */
export async function launchNativeScreensaver(options: NativeScreensaverOptions): Promise<NativeScreensaver> {
  const spawn = options.spawn ?? spawnProcess;
  const child = spawn(options.binary, nativeArguments(options.config, options.output), { stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
  const saver = new NativeScreensaver(child, options);
  await saver.ready;
  return saver;
}

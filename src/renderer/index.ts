import { shaderRegistry as builtins } from './shaders';
import { withCustomShaders } from '../shared/custom-shaders';
import { mountShader, type ShaderDefinition } from './core/runtime';
import type { Config } from '../shared/config';
import { defaultClockConfig, type ClockConfig } from '../shared/clock';
import { rotationEntryKey } from '../shared/rotation';
import { resolveShaderSelection, resolveShaderValues, createPointerDismiss } from './core/selection';
import { mountClock } from './core/clock';
import { mountFadeOverlay, type FadeOverlay } from './core/fade';

type ShaderRegistry = Record<string, ShaderDefinition>;
interface CyclePick { shader: string; preset?: string; }

interface SceneState {
  config: Config;
  registry: ShaderRegistry;
  canvas: HTMLCanvasElement;
  currentKey: string;
  stop: () => void;
}

function resolveRequestedShader(params: URLSearchParams, config: Config): string {
  return params.get('shader') || config.shader;
}

function createSceneState(config: Config, registry: ShaderRegistry, chosen: ShaderDefinition, params: URLSearchParams): SceneState {
  const canvas = document.querySelector('canvas') as HTMLCanvasElement;
  const preset = params.get('preset') ?? undefined;
  return {
    config, registry, canvas,
    currentKey: rotationEntryKey(chosen.manifest.id, preset),
    stop: mountShader(canvas, chosen, resolveShaderValues(config, registry, chosen.manifest.id, preset), config.global.fps),
  };
}

/** Swap the mounted scene for a cycle pick, honoring the fade overlay when present. */
function applyPick(state: SceneState, pick: CyclePick, fade?: FadeOverlay): void {
  const next = state.registry[pick.shader];
  if (!next) return;
  const key = rotationEntryKey(pick.shader, pick.preset);
  if (key === state.currentKey) return;
  state.currentKey = key;
  const swap = () => {
    state.stop();
    state.stop = mountShader(state.canvas, next, resolveShaderValues(state.config, state.registry, pick.shader, pick.preset), state.config.global.fps);
  };
  if (fade) fade.transition(swap);
  else swap();
}

/** Any user input closes the screensaver; a pointer must travel a little first. */
function setupDismiss(fade?: FadeOverlay): () => void {
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    if (fade) fade.fadeOut(() => window.scrnsvr.close());
    else window.scrnsvr.close();
  };
  addEventListener('keydown', dismiss, { once: true });
  addEventListener('pointerdown', dismiss, { once: true });
  addEventListener('wheel', dismiss, { once: true });
  addEventListener('touchstart', dismiss, { once: true });
  addEventListener('pointermove', createPointerDismiss(dismiss));
  return dismiss;
}

function createFade(params: URLSearchParams, config: Config): FadeOverlay | undefined {
  if (params.has('nofade')) return undefined;
  return mountFadeOverlay(document.body, config.global.fadeSeconds ?? 1);
}

function resolveClockConfig(config: Config): ClockConfig {
  return config.clock ?? defaultClockConfig;
}

async function startRenderer(): Promise<void> {
  const config = await window.scrnsvr.getConfig() as Config;
  const params = new URLSearchParams(location.search);
  let registry = withCustomShaders(builtins, config.customShaders) as ShaderRegistry;
  const chosen = resolveShaderSelection(registry, resolveRequestedShader(params, config));
  if (!chosen) throw new Error('No shaders are registered');
  const state = createSceneState(config, registry, chosen, params);
  const clock = mountClock(document.body, resolveClockConfig(config));
  const fade = createFade(params, config);

  // Cycling is coordinated by the main process so every monitor swaps together.
  const unsubscribeCycle = window.scrnsvr.onCycle?.(async (pick) => {
    Object.assign(config, await window.scrnsvr.getConfig());
    registry = withCustomShaders(builtins, config.customShaders) as ShaderRegistry;
    state.registry = registry;
    applyPick(state, pick, fade);
  });

  setupDismiss(fade);
  addEventListener('pagehide', () => {
    unsubscribeCycle?.();
    state.stop();
    fade?.destroy();
    clock.destroy();
  }, { once: true });
}

void startRenderer();

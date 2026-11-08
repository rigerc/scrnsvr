import { shaderRegistry as builtins } from './shaders';
import { withCustomShaders } from '../shared/custom-shaders';
import { mountShader, type ShaderDefinition } from './core/runtime';
import type { Config } from '../shared/config';
import type { CyclePick } from '../shared/ipc';
import { defaultClockConfig, type ClockConfig } from '../shared/clock';
import { rotationEntryKey } from '../shared/rotation';
import { resolveShaderSelection, resolveShaderValues, createPointerDismiss } from './core/selection';
import { mountClock } from './core/clock';
import { mountFadeOverlay, type FadeOverlay } from './core/fade';

type ShaderRegistry = Record<string, ShaderDefinition>;

interface SceneState {
  config: Config;
  registry: ShaderRegistry;
  canvas: HTMLCanvasElement;
  currentKey: string;
  requestedKey?: string;
  active?: boolean;
  pendingPick?: CyclePick;
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
    stop: mountShader(canvas, chosen, resolveShaderValues(config, registry, chosen.manifest.id, preset), config.global.fps, undefined, {
      effects: config.effects,
      onEffectStatus: status => console.warn('[scrnsvr effects]', status.layerId ?? 'stack', status.message),
    }),
  };
}

/** Swap the mounted scene for a cycle pick, honoring the fade overlay when present. */
function applyPick(state: SceneState, pick: CyclePick, fade?: FadeOverlay): void {
  if (state.active === false) { state.pendingPick = pick; return; }
  const next = state.registry[pick.shader];
  if (!next) return;
  const key = rotationEntryKey(pick.shader, pick.preset);
  if (key === state.requestedKey || (key === state.currentKey && !state.requestedKey)) return;
  state.pendingPick = pick;
  state.requestedKey = key;
  const swap = () => {
    state.requestedKey = undefined;
    if (state.active === false) { state.pendingPick = pick; return; }
    state.pendingPick = undefined;
    if (key === state.currentKey) return;
    let stop: () => void;
    try {
      // Mount first so a broken replacement cannot dispose the running scene.
      stop = mountShader(state.canvas, next, resolveShaderValues(state.config, state.registry, pick.shader, pick.preset), state.config.global.fps, undefined, {
        effects: state.config.effects,
        onEffectStatus: status => console.warn('[scrnsvr effects]', status.layerId ?? 'stack', status.message),
      });
    } catch (error) {
      console.warn(`scrnsvr could not switch to ${pick.shader}; keeping the current scene`, error);
      return;
    }
    state.stop();
    state.stop = stop;
    state.currentKey = key;
  };
  if (fade) fade.transition(swap);
  else swap();
}

/** Any user input closes the screensaver; a pointer must travel a little first. */
function setupDismiss(fade: FadeOverlay | undefined, onDismiss: () => void): () => void {
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    onDismiss();
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
  const config = await window.scrnsvr.getConfig();
  const params = new URLSearchParams(location.search);
  let registry = withCustomShaders(builtins, config.customShaders) as ShaderRegistry;
  const chosen = resolveShaderSelection(registry, resolveRequestedShader(params, config));
  if (!chosen) throw new Error('No shaders are registered');
  const state = createSceneState(config, registry, chosen, params);
  const clock = mountClock(document.body, resolveClockConfig(config));
  const fade = createFade(params, config);
  let dismissing = false;
  let cycleRequest = 0;
  const unsubscribeActivity = window.scrnsvr.onRenderingActive?.(active => {
    if (dismissing) return;
    state.active = active;
    if (!active) {
      // Cancel in-flight fades without mounting a replacement on a dark output.
      fade?.setOpacity(0);
      state.requestedKey = undefined;
    } else if (state.pendingPick) {
      const pick = state.pendingPick;
      state.pendingPick = undefined;
      void cycle(pick);
    }
  });

  // Cycling is coordinated by the main process so every monitor swaps together.
  async function cycle(pick: CyclePick) {
    if (dismissing) return;
    const request = ++cycleRequest;
    if (state.active === false) { state.pendingPick = pick; return; }
    const refreshed = await window.scrnsvr.getConfig();
    if (dismissing || request !== cycleRequest) return;
    Object.assign(config, refreshed);
    registry = withCustomShaders(builtins, config.customShaders) as ShaderRegistry;
    state.registry = registry;
    applyPick(state, pick, fade);
  }
  const unsubscribeCycle = window.scrnsvr.onCycle?.(cycle);

  const dismiss = setupDismiss(fade, () => { dismissing = true; });
  const unsubscribeDismiss = window.scrnsvr.onDismiss?.(dismiss);
  addEventListener('pagehide', () => {
    unsubscribeCycle?.();
    unsubscribeDismiss?.();
    unsubscribeActivity?.();
    state.stop();
    fade?.destroy();
    clock.destroy();
  }, { once: true });
}

void startRenderer();

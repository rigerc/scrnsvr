import { shaderRegistry as builtins } from './shaders';
import { withCustomShaders } from '../shared/custom-shaders';
import { mountShader, type ShaderDefinition } from './core/runtime';
import type { Config } from '../shared/config';
import { defaultClockConfig, type ClockConfig } from '../shared/clock';
import { resolveShaderSelection, resolveShaderValues, createPointerDismiss } from './core/selection';
import { mountClock } from './core/clock';
import { mountFadeOverlay, type FadeOverlay } from './core/fade';

// The windowed preview and thumbnail captures; the screensaver itself is native.
type ShaderRegistry = Record<string, ShaderDefinition>;

function mountScene(config: Config, registry: ShaderRegistry, chosen: ShaderDefinition, params: URLSearchParams): () => void {
  const canvas = document.querySelector('canvas') as HTMLCanvasElement;
  const preset = params.get('preset') ?? undefined;
  return mountShader(canvas, chosen, resolveShaderValues(config, registry, chosen.manifest.id, preset), config.global.fps, undefined, {
    effects: config.effects,
    onEffectStatus: status => console.warn('[scrnsvr effects]', status.layerId ?? 'stack', status.message),
  });
}

/** Any user input closes the preview; a pointer must travel a little first. */
function setupDismiss(fade: FadeOverlay | undefined): void {
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
  const registry = withCustomShaders(builtins, config.customShaders) as ShaderRegistry;
  const chosen = resolveShaderSelection(registry, params.get('shader') || config.shader);
  if (!chosen) throw new Error('No shaders are registered');
  const stop = mountScene(config, registry, chosen, params);
  const clock = mountClock(document.body, resolveClockConfig(config));
  const fade = createFade(params, config);
  setupDismiss(fade);
  addEventListener('pagehide', () => {
    stop();
    fade?.destroy();
    clock.destroy();
  }, { once: true });
}

void startRenderer();

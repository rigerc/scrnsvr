import { shaderRegistry } from './shaders';
import { mountShader } from './core/runtime';
import type { Config } from '../shared/config';
import { defaultClockConfig } from '../shared/clock';
import { resolveRotationValues, rotationEntryKey } from '../shared/rotation';
import { mountClock } from './core/clock';
import { mountFadeOverlay } from './core/fade';

void (async () => {
  const config = await window.scrnsvr.getConfig() as Config;
  const params = new URLSearchParams(location.search);
  const requested = params.get('shader') || config.shader;
  const chosen = shaderRegistry[requested] ?? shaderRegistry['flow-field'] ?? Object.values(shaderRegistry)[0];
  if (!chosen) throw new Error('No shaders are registered');
  const canvas = document.querySelector('canvas') as HTMLCanvasElement;
  const initialPreset = params.get('preset') ?? undefined;
  const valuesFor = (shaderId: string, preset?: string) => preset
    ? resolveRotationValues(config.shaders, config.presets, shaderId, preset)
    : config.shaders[shaderId] ?? {};
  let currentKey = rotationEntryKey(chosen.manifest.id, initialPreset);
  let stopScene = mountShader(canvas, chosen, valuesFor(chosen.manifest.id, initialPreset), config.global.fps);
  const clock = mountClock(document.body, config.clock ?? defaultClockConfig);
  const fade = params.has('nofade') ? undefined : mountFadeOverlay(document.body, config.global.fadeSeconds ?? 1);

  // Cycling is coordinated by the main process so every monitor swaps together.
  const unsubscribeCycle = window.scrnsvr.onCycle?.((pick) => {
    const next = shaderRegistry[pick.shader];
    if (!next) return;
    const key = rotationEntryKey(pick.shader, pick.preset);
    if (key === currentKey) return;
    currentKey = key;
    const swap = () => {
      stopScene();
      stopScene = mountShader(canvas, next, valuesFor(pick.shader, pick.preset), config.global.fps);
    };
    if (fade) fade.transition(swap);
    else swap();
  });

  const teardown = () => { unsubscribeCycle?.(); fade?.destroy(); clock.destroy(); };
  addEventListener('pagehide', teardown, { once: true });

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    if (fade) fade.fadeOut(() => window.scrnsvr.close());
    else window.scrnsvr.close();
  };
  let origin: { x: number; y: number } | undefined;
  addEventListener('keydown', dismiss, { once: true });
  addEventListener('pointerdown', dismiss, { once: true });
  addEventListener('wheel', dismiss, { once: true });
  addEventListener('touchstart', dismiss, { once: true });
  addEventListener('pointermove', (event) => {
    origin ??= { x: event.screenX, y: event.screenY };
    if (Math.hypot(event.screenX - origin.x, event.screenY - origin.y) > 12) dismiss();
  });
})();

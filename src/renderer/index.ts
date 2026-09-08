import { shaderRegistry } from './shaders';
import { mountShader } from './core/runtime';
import type { Config } from '../shared/config';
import { defaultClockConfig } from '../shared/clock';
import { mountClock } from './core/clock';

void (async () => {
  const config = await window.scrnsvr.getConfig() as Config;
  const requested = new URLSearchParams(location.search).get('shader') || config.shader;
  const chosen = shaderRegistry[requested] ?? shaderRegistry['flow-field'] ?? Object.values(shaderRegistry)[0];
  if (!chosen) throw new Error('No shaders are registered');
  const canvas = document.querySelector('canvas') as HTMLCanvasElement;
  mountShader(canvas, chosen, config.shaders[chosen.manifest.id] ?? {}, config.global.fps);
  const clock = mountClock(document.body, config.clock ?? defaultClockConfig);
  addEventListener('pagehide', () => clock.destroy(), { once: true });

  let origin: { x: number; y: number } | undefined;
  const dismiss = () => window.scrnsvr.close();
  addEventListener('keydown', dismiss, { once: true });
  addEventListener('pointerdown', dismiss, { once: true });
  addEventListener('wheel', dismiss, { once: true });
  addEventListener('touchstart', dismiss, { once: true });
  addEventListener('pointermove', (event) => {
    origin ??= { x: event.screenX, y: event.screenY };
    if (Math.hypot(event.screenX - origin.x, event.screenY - origin.y) > 12) dismiss();
  });
})();

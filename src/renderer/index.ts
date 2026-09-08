import { shaderRegistry } from './shaders';
import { mountShader } from './core/runtime';
import type { Config } from '../shared/config';
import { defaultClockConfig } from '../shared/clock';
import { mountClock } from './core/clock';
import { mountFadeOverlay } from './core/fade';

void (async () => {
  const config = await window.scrnsvr.getConfig() as Config;
  const params = new URLSearchParams(location.search);
  const requested = params.get('shader') || config.shader;
  const chosen = shaderRegistry[requested] ?? shaderRegistry['flow-field'] ?? Object.values(shaderRegistry)[0];
  if (!chosen) throw new Error('No shaders are registered');
  const canvas = document.querySelector('canvas') as HTMLCanvasElement;
  mountShader(canvas, chosen, config.shaders[chosen.manifest.id] ?? {}, config.global.fps);
  const clock = mountClock(document.body, config.clock ?? defaultClockConfig);
  const fade = params.has('nofade') ? undefined : mountFadeOverlay(document.body, config.global.fadeSeconds ?? 1);
  const teardown = () => { fade?.destroy(); clock.destroy(); };
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

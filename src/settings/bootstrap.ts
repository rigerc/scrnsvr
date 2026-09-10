import { mountSettings, type PreviewRuntime } from './index';
import { shaderRegistry } from '../renderer/shaders';
import { mountShader, mountShaderThumbnail } from '../renderer/core/runtime';
import type { Config } from '../shared/config';

const preview: PreviewRuntime = {
  mountThumbnail(canvas, manifest, values) {
    return mountShaderThumbnail(canvas, shaderRegistry[manifest.id], values);
  },
  mount(canvas, manifest, values) {
    const definition = shaderRegistry[manifest.id];
    return definition ? mountShader(canvas, definition, values, 30) : () => undefined;
  },
};

void (async () => {
  const root = document.querySelector('#settings');
  if (!(root instanceof HTMLElement)) throw new Error('Settings root is missing');
  const initial = await window.scrnsvr.getConfig() as Config;
  mountSettings({ root, manifests: Object.values(shaderRegistry).map(({ manifest }) => manifest), initial, preview });
})();

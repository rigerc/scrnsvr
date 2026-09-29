import { mountSettings, type PreviewRuntime } from './index';
import { shaderRegistry } from '../renderer/shaders';
import { mountShader, mountShaderThumbnail } from '../renderer/core/runtime';
import type { Config } from '../shared/config';
import { withCustomShaders } from '../shared/custom-shaders';
import { mountPreviewControls } from './preview-controls';
import { mountDiscovery } from './discovery';
import type { PlaybackState } from '../renderer/core/playback';

let available = shaderRegistry;
const playback: PlaybackState = { paused: window.matchMedia('(prefers-reduced-motion: reduce)').matches };

const preview: PreviewRuntime = {
  mountThumbnail(canvas, manifest, values) {
    return mountShaderThumbnail(canvas, available[manifest.id], values, playback);
  },
  mount(canvas, manifest, values) {
    const definition = available[manifest.id];
    return definition ? mountShader(canvas, definition, values, 30, playback) : () => undefined;
  },
};

void (async () => {
  const root = document.querySelector('#settings');
  if (!(root instanceof HTMLElement)) throw new Error('Settings root is missing');
  const initial = await window.scrnsvr.getConfig() as Config;
  available = withCustomShaders(shaderRegistry, initial.customShaders);
  mountSettings({ root, manifests: Object.values(available).map(({ manifest }) => manifest), initial, preview });
  const stopControls = mountPreviewControls(root, playback);
  const stopDiscovery = mountDiscovery(root);
  window.addEventListener('pagehide', () => { stopControls(); stopDiscovery(); }, { once: true });
})();

import {
  effectManifests, MAX_EFFECT_LAYERS, resolveEffectValues,
  type EffectLayer, type EffectsConfig, type EffectStatus,
} from '../shared/effects';

/** Edits the same object held by the preview; never mounts or restarts the base visual. */
export function mountEffectsControls(root: HTMLElement, config: EffectsConfig, onChange: () => void, previewStatus?: HTMLElement) {
  root.innerHTML = `
    <div class="inspector-heading"><h2>Global effects</h2></div>
    <p class="effects-intro">Add texture to every visual, including custom shaders. The clock and gallery stay clean.</p>
    <label class="toggle-row"><input type="checkbox" data-effects-enabled>Enable effects</label>
    <div class="effect-add">
      <label for="effect-choice">Add effect</label>
      <div class="effect-add-row"><select id="effect-choice" data-effect-choice></select><button type="button" data-effect-add data-action="add-effect">Add effect</button></div>
      <p data-effect-limit></p>
    </div>
    <div class="effect-stack-heading"><h3>Applied top to bottom</h3><span data-effect-count></span></div>
    <p class="effects-empty" data-effects-empty>No effects yet. Add VHS Distortion to start a tape-inspired stack.</p>
    <ol class="effect-list" data-effect-list aria-label="Effect layers applied top to bottom"></ol>
    <p class="effect-status" data-effect-status role="status" aria-live="polite" aria-atomic="true"></p>
    <p class="effect-announcement" data-effect-announcement role="status" aria-live="polite" aria-atomic="true"></p>`;
  const enabled = root.querySelector<HTMLInputElement>('[data-effects-enabled]')!;
  const choice = root.querySelector<HTMLSelectElement>('[data-effect-choice]')!;
  const add = root.querySelector<HTMLButtonElement>('[data-effect-add]')!;
  const list = root.querySelector<HTMLOListElement>('[data-effect-list]')!;
  const status = root.querySelector<HTMLElement>('[data-effect-status]')!;
  const announcement = root.querySelector<HTMLElement>('[data-effect-announcement]')!;
  const openLayers = new Set<string>();
  const warnings = new Map<string, string>();
  const warningNodes = new Map<string, HTMLElement>();
  const summaries = new Map<string, HTMLElement>();
  let stackWarning = '';
  let nextId = 1;
  let nextControlId = 1;
  const syncStatus = () => {
    status.textContent = [stackWarning, ...config.layers.filter(layer => warnings.has(layer.id))
      .map(layer => `${labelFor(layer)}: ${warnings.get(layer.id)}`)].filter(Boolean).join(' ');
    if (!previewStatus) return;
    previewStatus.textContent = status.textContent;
    previewStatus.hidden = !status.textContent;
  };
  const manifestFor = (layer: EffectLayer) => Object.hasOwn(effectManifests, layer.effectId) ? effectManifests[layer.effectId] : undefined;
  const layerTitle = (layer: EffectLayer) => manifestFor(layer)?.title ?? layer.effectId;
  const labelFor = (layer: EffectLayer) => `${layerTitle(layer)}, layer ${config.layers.indexOf(layer) + 1}`;
  enabled.checked = config.enabled;
  enabled.addEventListener('change', () => { config.enabled = enabled.checked; onChange(); });
  for (const manifest of Object.values(effectManifests)) {
    const option = document.createElement('option');
    option.value = manifest.id; option.textContent = manifest.title;
    choice.append(option);
  }

  const makeButton = (text: string, action: string, layer: EffectLayer, run: () => void) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = text; button.dataset.effectAction = action;
    button.setAttribute('aria-label', `${text}: ${labelFor(layer)}`);
    button.addEventListener('click', run);
    return button;
  };
  const render = (focusLayer?: string) => {
    for (const item of Array.from(list.querySelectorAll<HTMLElement>('[data-layer-id]'))) {
      if (item.querySelector<HTMLDetailsElement>('details')?.open) openLayers.add(item.dataset.layerId!);
      else openLayers.delete(item.dataset.layerId!);
    }
    for (const id of openLayers) if (!config.layers.some(layer => layer.id === id)) openLayers.delete(id);
    list.replaceChildren(); summaries.clear(); warningNodes.clear();
    root.querySelector('[data-effects-empty]')!.toggleAttribute('hidden', config.layers.length > 0);
    root.querySelector('[data-effect-count]')!.textContent = `${config.layers.length} / ${MAX_EFFECT_LAYERS}`;
    const capped = config.layers.length >= MAX_EFFECT_LAYERS;
    add.disabled = capped; choice.disabled = capped;
    root.querySelector('[data-effect-limit]')!.textContent = capped ? 'Eight-layer limit reached. Remove a layer to add another.' : 'Up to eight layers. Repeated effects have independent controls.';
    for (const [index, layer] of config.layers.entries()) {
      const manifest = manifestFor(layer);
      const item = document.createElement('li'); item.className = 'effect-layer'; item.dataset.layerId = layer.id; item.dataset.effectLayer = layer.id;
      const details = document.createElement('details'); details.className = 'effect-details'; details.open = openLayers.has(layer.id);
      const summary = document.createElement('summary');
      summary.textContent = `${index + 1}. ${layerTitle(layer)}`;
      summaries.set(layer.id, summary);
      const toggleRow = document.createElement('label'); toggleRow.className = 'toggle-row';
      const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = layer.enabled; toggle.dataset.effectLayerEnabled = '';
      toggle.setAttribute('aria-label', `Enable ${labelFor(layer)}`);
      toggle.addEventListener('change', () => { layer.enabled = toggle.checked; onChange(); });
      toggleRow.append(toggle, 'Enable layer');
      const warning = document.createElement('p'); warning.className = 'effect-layer-status'; warning.dataset.effectLayerStatus = '';
      warning.textContent = manifest ? warnings.get(layer.id) ?? '' : 'Unavailable effect. This layer is skipped; its settings are kept. Remove it or keep it for later.';
      warningNodes.set(layer.id, warning);
      const body = document.createElement('div'); body.className = 'effect-layer-controls';
      if (manifest) {
        const description = document.createElement('p'); description.className = 'effect-description'; description.textContent = manifest.description;
        body.append(description);
        const resolved = resolveEffectValues(manifest, layer.values);
        for (const def of manifest.uniforms) {
          const row = document.createElement('div'); row.className = 'shader-control'; row.dataset.effectControl = def.name;
          const heading = document.createElement('div'); heading.className = 'shader-control-heading';
          const label = document.createElement('label'); label.textContent = def.label ?? def.name;
          const id = `effect-control-${nextControlId++}`; label.htmlFor = id;
          const hint = document.createElement('p'); hint.id = `${id}-hint`; hint.textContent = def.description ?? '';
          const range = document.createElement('input'); range.type = 'range'; range.id = id; range.dataset.effectName = def.name;
          range.setAttribute('aria-label', `${def.label ?? def.name}: ${labelFor(layer)}`);
          const number = document.createElement('input'); number.type = 'number'; number.dataset.effectNumber = def.name; number.setAttribute('aria-label', `${def.label ?? def.name} value: ${labelFor(layer)}`);
          for (const input of [range, number]) {
            input.min = String(def.min ?? 0); input.max = String(def.max ?? 1); input.step = String(def.step ?? 0.01);
            input.value = String(resolved[def.name]); input.setAttribute('aria-describedby', hint.id);
          }
          const commit = (input: HTMLInputElement) => {
            const value = Number(input.value);
            // Invalid direct entry returns to the last valid value instead of damaging config.
            if (input.value.trim() && Number.isFinite(value)) {
              const step = def.step ?? 0.01;
              layer.values[def.name] = resolveEffectValues(manifest, { [def.name]: Number((Math.round(value / step) * step).toFixed(8)) })[def.name];
              onChange();
            }
            const current = resolveEffectValues(manifest, layer.values)[def.name];
            range.value = String(current); number.value = String(current);
          };
          range.addEventListener('input', () => commit(range));
          number.addEventListener('change', () => commit(number));
          number.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); commit(number); } });
          const inputs = document.createElement('div'); inputs.className = 'shader-control-inputs'; inputs.append(range, number);
          heading.append(label); row.append(heading, inputs, hint); body.append(row);
        }
      }
      details.append(summary, body);
      const actions = document.createElement('div'); actions.className = 'effect-layer-actions';
      const move = (offset: number) => {
        const target = index + offset;
        [config.layers[index], config.layers[target]] = [config.layers[target], config.layers[index]];
        render(layer.id); onChange();
        announcement.textContent = `Moved ${layerTitle(layer)} to layer ${target + 1}.`;
      };
      const up = makeButton('Move up', 'up', layer, () => move(-1)); up.disabled = index === 0;
      const down = makeButton('Move down', 'down', layer, () => move(1)); down.disabled = index === config.layers.length - 1;
      const reset = makeButton('Reset', 'reset', layer, () => {
        if (!manifest) return;
        // Reset values only, not order or enable state.
        for (const key of Object.keys(layer.values)) delete layer.values[key];
        Object.assign(layer.values, resolveEffectValues(manifest));
        render(layer.id); onChange(); announcement.textContent = `Reset ${labelFor(layer)} controls.`;
      });
      reset.disabled = !manifest;
      const remove = makeButton('Remove', 'remove', layer, () => {
        config.layers.splice(index, 1); openLayers.delete(layer.id); warnings.delete(layer.id);
        const next = config.layers[Math.min(index, config.layers.length - 1)];
        render(next?.id); if (!next) add.focus(); onChange();
        announcement.textContent = `Removed ${layerTitle(layer)}. ${config.layers.length} layers remaining.`;
      });
      actions.append(up, down, reset, remove);
      item.append(details, toggleRow, warning, actions); list.append(item);
    }
    syncStatus();
    if (focusLayer) summaries.get(focusLayer)?.focus();
  };
  add.addEventListener('click', () => {
    if (config.layers.length >= MAX_EFFECT_LAYERS) return;
    const manifest = Object.hasOwn(effectManifests, choice.value) ? effectManifests[choice.value] : undefined;
    if (!manifest) return;
    let id: string;
    do { id = `effect-${nextId++}`; } while (config.layers.some(layer => layer.id === id));
    const layer: EffectLayer = { id, effectId: manifest.id, enabled: true, values: resolveEffectValues(manifest) };
    config.layers.push(layer); openLayers.add(id); render(id); onChange();
    announcement.textContent = `Added ${labelFor(layer)}.`;
  });
  render();
  return {
    reportStatus(update: EffectStatus) {
      if (update.layerId) {
        const layer = config.layers.find(layer => layer.id === update.layerId);
        if (!layer) return;
        warnings.set(layer.id, update.message);
        const node = warningNodes.get(layer.id); if (node) node.textContent = update.message;
      } else stackWarning = update.message;
      syncStatus();
    },
    clearStatus() {
      warnings.clear(); stackWarning = ''; syncStatus();
      for (const layer of config.layers) if (manifestFor(layer)) {
        const node = warningNodes.get(layer.id); if (node) node.textContent = '';
      }
    },
  };
}

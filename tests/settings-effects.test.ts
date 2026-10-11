// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel, type PreviewRuntime } from '../src/settings/index';
import { mountEffectsControls } from '../src/settings/effects';

// This suite owns settings behavior, not the custom editor's GPU runtime.
vi.mock('../src/settings/custom-shader-editor', () => ({ openCustomShaderEditor: vi.fn() }));
import { defaultClockConfig } from '../src/shared/clock';
import { effectManifests, MAX_EFFECT_LAYERS, resolveEffectValues, type EffectRuntimeOptions } from '../src/shared/effects';
import type { Config } from '../src/shared/config';
import type { ShaderManifest } from '../src/shared/manifest';

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observed: Element[] = [];
  constructor(public callback: IntersectionObserverCallback) { FakeIntersectionObserver.instances.push(this); }
  observe(element: Element) { this.observed.push(element); }
  disconnect() {}
  trigger() { this.callback(this.observed.map(target => ({ target, isIntersecting: true } as IntersectionObserverEntry)), this as unknown as IntersectionObserver); }
}
class FakeResizeObserver { observe() {} disconnect() {} }
const shader: ShaderManifest = {
  id: 'plasma', title: 'Plasma', category: 'Ambient', fragment: 'shader.glsl',
  uniforms: [{ name: 'speed', type: 'float', default: 1, min: 0, max: 3, step: 0.1, label: 'Speed', group: 'Motion' },
    { name: 'color1', type: 'color', default: '#123456', label: 'Color', group: 'Color' }],
};
const other = { ...shader, id: 'other', title: 'Other' };
const defaults = () => resolveEffectValues(effectManifests['vhs-distortion']);
const makeConfig = (): Config => ({
  shader: 'plasma', fps: 60, monitor: 'primary', kiosk: true, settings: true,
  global: { idleThresholdSeconds: 300, fps: 60, fadeSeconds: 1, inhibitOnAudio: false, inhibitOnFullscreen: true, monitors: 'primary' },
  clock: { ...defaultClockConfig }, rotation: { enabled: false, entries: [], intervalMinutes: 0 },
  audio: { enabled: false }, colors: { scheme: 'none', overrides: {} }, customShaders: [],
  effects: { enabled: true, layers: [] }, shaders: { plasma: { speed: 2 } }, presets: { plasma: { Saved: { speed: 0.5 } } },
});
let config: Config;
let setConfig: ReturnType<typeof vi.fn>;
let mount: ReturnType<typeof vi.fn>;
let mountThumbnail: ReturnType<typeof vi.fn>;
function makePanel(thumbnails = true) {
  const root = document.createElement('div'); document.body.append(root);
  mount = vi.fn(() => vi.fn()); mountThumbnail = vi.fn(() => vi.fn());
  const preview: PreviewRuntime = { mount, ...(thumbnails ? { mountThumbnail } : {}) };
  return new SettingsPanel({ root, manifests: [shader, other], initial: config, preview }).element;
}
function button(root: ParentNode, selector: string) { return root.querySelector<HTMLButtonElement>(selector)!; }
function add(root: ParentNode, effectId?: string) {
  if (effectId) root.querySelector<HTMLSelectElement>('[data-effect-choice]')!.value = effectId;
  button(root, '[data-action="add-effect"]').click();
}
function rows(root: ParentNode) { return [...root.querySelectorAll<HTMLElement>('[data-effect-layer]')]; }
function action(row: ParentNode, name: string) { return button(row, `[data-effect-action="${name}"]`); }
function options() { return mount.mock.calls[0][3] as EffectRuntimeOptions; }
function input(root: ParentNode, selector: string, value: string, event = 'input') {
  const input = root.querySelector<HTMLInputElement>(selector)!;
  input.value = value; input.dispatchEvent(new Event(event, { bubbles: true })); return input;
}
function toggle(root: ParentNode, selector: string, checked: boolean) {
  const input = root.querySelector<HTMLInputElement>(selector)!;
  input.checked = checked; input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = ''; FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Object.defineProperty(document, 'fonts', { configurable: true, value: { addEventListener: vi.fn(), removeEventListener: vi.fn() } });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: vi.fn(() => null) });
  config = makeConfig(); setConfig = vi.fn(async () => undefined);
  vi.stubGlobal('scrnsvr', { setConfig, close: vi.fn() });
  vi.stubGlobal('scrnsvrAudio', { subscribe: vi.fn(() => vi.fn()) });
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('global effect settings', () => {
  it('places Effects beside Visuals with tab keyboard navigation and keeps the main preview visible', () => {
    const root = makePanel();
    expect([...root.querySelectorAll('[data-tab]')].slice(0, 2).map(tab => tab.textContent)).toEqual(['Visuals', 'Effects']);
    button(root, '#shader-tab').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(root.querySelector('#effects-tab'));
    expect(root.querySelector('#effects-settings')).toHaveProperty('hidden', false);
    expect(root.querySelector('#shader-settings')).toHaveProperty('hidden', true);
    expect(root.querySelector('.preview-column')?.hasAttribute('hidden')).toBe(false);
    expect(root.querySelector('[data-effects-empty]')).toHaveProperty('hidden', false);
    expect(root.querySelector('[data-effect-choice] option')?.textContent).toBe('VHS Distortion');
  });

  it('offers the complete catalog in metadata order and explains its breadth in the empty state', () => {
    const root = makePanel();
    const choices = [...root.querySelectorAll<HTMLOptionElement>('[data-effect-choice] option')];
    expect(choices).toHaveLength(17);
    expect(choices.map(option => option.value)).toEqual(Object.keys(effectManifests));
    expect(choices[0].value).toBe('vhs-distortion');
    expect(root.querySelector('[data-effects-empty]')?.textContent).toContain('color grading, glow, and trails');
  });

  it.each(Object.values(effectManifests))('renders metadata-driven typed controls for $title', manifest => {
    const root = makePanel(); add(root, manifest.id);
    const row = rows(root)[0];
    for (const def of manifest.uniforms) {
      const control = row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-effect-name="${def.name}"]`)!;
      expect(control).toBeTruthy();
      expect(row.querySelector(`label[for="${control.id}"]`)?.textContent).toBe(def.label ?? def.name);
      expect(control.getAttribute('aria-label')).toContain(`${manifest.title}, layer 1`);
      const hint = root.querySelector(`#${control.getAttribute('aria-describedby')}`);
      expect(hint?.textContent).toBe(def.description ?? '');
      if (def.type === 'float' || def.type === 'int') {
        expect(control).toHaveProperty('type', 'range');
        const number = row.querySelector<HTMLInputElement>(`[data-effect-number="${def.name}"]`)!;
        expect(number.type).toBe('number');
        for (const numeric of [control as HTMLInputElement, number]) {
          expect(numeric.min).toBe(String(def.min));
          expect(numeric.max).toBe(String(def.max));
          expect(numeric.step).toBe(String(def.type === 'int' ? 1 : def.step ?? 0.01));
          expect(numeric.value).toBe(String(def.default));
          expect(numeric.getAttribute('aria-describedby')).toBe(hint?.id);
        }
      } else if (def.type === 'select') {
        expect(control.tagName).toBe('SELECT');
        expect([...(control as HTMLSelectElement).options].map(option => option.value)).toEqual(def.options);
        expect(control.value).toBe(def.default);
      } else {
        expect(control).toHaveProperty('type', def.type === 'bool' ? 'checkbox' : 'color');
        if (def.type === 'bool') expect(control).toHaveProperty('checked', def.default);
        else expect(control.value).toBe(def.default);
      }
    }
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('normalizes missing and damaged legacy effects without resetting visuals', () => {
    delete (config as Partial<Config>).effects;
    makePanel();
    expect(options().effects).toEqual({ enabled: true, layers: [] });
    expect(config.shaders.plasma.speed).toBe(2);
    config.effects = { enabled: true, layers: [
      { id: 'same', effectId: 'vhs-distortion', enabled: true, values: { intensity: 20, grain: NaN } },
      { id: 'same', effectId: 'future-effect', enabled: false, values: { future: 'kept' } },
    ] };
    const root = makePanel();
    expect(config.effects.layers[0].values.intensity).toBe(1);
    expect(config.effects.layers[0].values.grain).toBe(0.2);
    expect(new Set(config.effects.layers.map(layer => layer.id)).size).toBe(2);
    expect(rows(root)[1].textContent).toContain('Unavailable effect');
    expect(action(rows(root)[1], 'reset').disabled).toBe(true);
    expect(options().effects).toBe(config.effects);
  });

  it('adds repeated independent layers and changes controls/toggles/reset without remounting', async () => {
    const root = makePanel(); const effects = options().effects!;
    add(root); add(root);
    expect(options().effects).toBe(effects);
    expect(effects.layers).toHaveLength(2);
    expect(effects.layers[0].id).not.toBe(effects.layers[1].id);
    expect(rows(root)[1].querySelector('details')).toHaveProperty('open', true);
    expect(document.activeElement).toBe(rows(root)[1].querySelector('summary'));
    input(rows(root)[0], '[data-effect-name="grain"]', '0.71');
    input(rows(root)[0], '[data-effect-number="tracking"]', '0.43', 'change');
    expect(effects.layers[0].values).toMatchObject({ grain: 0.71, tracking: 0.43 });
    expect(effects.layers[1].values).toEqual(defaults());
    toggle(rows(root)[0], '[data-effect-layer-enabled]', false);
    toggle(root, '[data-effects-enabled]', false);
    expect(effects.enabled).toBe(false); expect(effects.layers[0].enabled).toBe(false);
    action(rows(root)[0], 'reset').click();
    expect(effects.layers[0].values).toEqual(defaults());
    expect(effects.layers[0].enabled).toBe(false);
    expect(document.activeElement).toBe(rows(root)[0].querySelector('summary'));
    toggle(root, '[data-effects-enabled]', true);
    expect(effects.layers[0].enabled).toBe(false);
    expect(mount).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(setConfig.mock.lastCall![0].effects).toEqual(effects);
    const ids = [...root.querySelectorAll<HTMLElement>('[id]')].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const range = rows(root)[1].querySelector<HTMLInputElement>('[data-effect-name="grain"]')!;
    expect(root.querySelector(`label[for="${range.id}"]`)).toBeTruthy();
  });

  it('clamps and snaps direct numeric values and repairs invalid entry without saving it', () => {
    const root = makePanel(); add(root);
    input(rows(root)[0], '[data-effect-number="intensity"]', '4', 'change');
    expect(config.effects.layers[0].values.intensity).toBe(1);
    input(rows(root)[0], '[data-effect-number="intensity"]', '0.346', 'change');
    expect(config.effects.layers[0].values.intensity).toBe(0.35);
    const number = input(rows(root)[0], '[data-effect-number="intensity"]', '', 'change');
    expect(number.value).toBe('0.35');
    expect(config.effects.layers[0].values.intensity).toBe(0.35);
  });

  it('snaps integers, clamps bounds, accepts Enter and restores empty/invalid entry without saving', () => {
    const root = document.createElement('div'); document.body.append(root);
    const effects = makeConfig().effects;
    const changed = vi.fn(); mountEffectsControls(root, effects, changed);
    add(root, 'pixelate'); changed.mockClear();
    const selector = '[data-effect-number="pixelSize"]';
    const number = input(rows(root)[0], selector, '11.7', 'change');
    expect(effects.layers[0].values.pixelSize).toBe(12);
    expect(number.value).toBe('12');
    expect(rows(root)[0].querySelector('[data-effect-name="pixelSize"]')).toHaveProperty('value', '12');
    input(rows(root)[0], selector, '-4', 'change');
    expect(effects.layers[0].values.pixelSize).toBe(1);
    input(rows(root)[0], selector, '12345', 'change');
    expect(effects.layers[0].values.pixelSize).toBe(96);
    number.value = '18.4';
    number.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(effects.layers[0].values.pixelSize).toBe(18);
    changed.mockClear();
    for (const invalid of ['', 'invalid', 'Infinity']) {
      input(rows(root)[0], selector, invalid, 'change');
      expect(number.value).toBe('18');
      expect(effects.layers[0].values.pixelSize).toBe(18);
    }
    expect(changed).not.toHaveBeenCalled();
    expect(document.body.contains(number)).toBe(true);
  });

  it('snaps floating-point steps relative to the declared minimum rather than zero', () => {
    // A non-zero step origin proves the generic control, beyond today's catalog values.
    effectManifests['step-origin-test'] = {
      id: 'step-origin-test', title: 'Step origin test', description: '',
      uniforms: [{ name: 'offset', type: 'float', default: 0.15, min: 0.15, max: 0.95, step: 0.2 }],
    };
    try {
      const root = makePanel(); add(root, 'step-origin-test');
      input(rows(root)[0], '[data-effect-number="offset"]', '0.38', 'change');
      expect(config.effects.layers[0].values.offset).toBe(0.35);
      input(rows(root)[0], '[data-effect-number="offset"]', '-9', 'change');
      expect(config.effects.layers[0].values.offset).toBe(0.15);
      input(rows(root)[0], '[data-effect-number="offset"]', '9', 'change');
      expect(config.effects.layers[0].values.offset).toBe(0.95);
    } finally { delete effectManifests['step-origin-test']; }
  });

  it('edits all input types live, saves and reloads repeated independent instances, and resets values only', async () => {
    const root = makePanel(); const effects = options().effects!;
    for (const id of ['pixelate', 'pixelate', 'vignette', 'halftone-print', 'datamosh-trails', 'palette-mapping', 'color-grade']) add(root, id);
    input(rows(root)[0], '[data-effect-number="pixelSize"]', '17.8', 'change');
    input(rows(root)[2], '[data-effect-name="edgeColor"]', '#aabbcc');
    toggle(rows(root)[3], '[data-effect-name="invert"]', true);
    input(rows(root)[4], '[data-effect-name="mode"]', 'Datamosh', 'change');
    input(rows(root)[5], '[data-effect-name="palette"]', 'Ocean', 'change');
    const warmth = input(rows(root)[6], '[data-effect-number="warmth"]', '-0.476', 'change');
    warmth.focus(); input(rows(root)[6], '[data-effect-number="warmth"]', '-0.42', 'change');
    expect(document.activeElement).toBe(warmth);
    expect(effects.layers.map(layer => layer.values)).toMatchObject([
      { pixelSize: 18 }, { pixelSize: 8 }, { edgeColor: '#aabbcc' }, { invert: true },
      { mode: 'Datamosh' }, { palette: 'Ocean' }, { warmth: -0.42 },
    ]);
    expect(options().effects).toBe(effects);
    expect(mount).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    const saved = structuredClone(setConfig.mock.lastCall![0] as Config);
    expect(saved.effects).toEqual(effects);
    config = saved;
    const reloaded = makePanel();
    expect(rows(reloaded)[0].querySelector('[data-effect-number="pixelSize"]')).toHaveProperty('value', '18');
    expect(rows(reloaded)[2].querySelector('[data-effect-name="edgeColor"]')).toHaveProperty('value', '#aabbcc');
    expect(rows(reloaded)[3].querySelector('[data-effect-name="invert"]')).toHaveProperty('checked', true);
    expect(rows(reloaded)[4].querySelector('[data-effect-name="mode"]')).toHaveProperty('value', 'Datamosh');
    expect(rows(reloaded)[5].querySelector('[data-effect-name="palette"]')).toHaveProperty('value', 'Ocean');
    expect(config.effects).toEqual(effects);
    const identities = config.effects.layers.map(layer => layer.id);
    toggle(rows(reloaded)[3], '[data-effect-layer-enabled]', false);
    for (const index of [0, 2, 3, 4, 5, 6]) {
      const layer = config.effects.layers[index];
      action(rows(reloaded)[index], 'reset').click();
      expect(layer.values).toEqual(resolveEffectValues(effectManifests[layer.effectId]));
      expect(document.activeElement).toBe(rows(reloaded)[index].querySelector('summary'));
    }
    expect(config.effects.layers[3].enabled).toBe(false);
    expect(config.effects.layers.map(layer => layer.id)).toEqual(identities);
    expect(config.effects.layers[1].values.pixelSize).toBe(8);
    expect(mount).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(setConfig.mock.lastCall![0].effects).toEqual(config.effects);
  });

  it('keeps repeated color, bool and select controls independent through edits and resets at the stack cap', () => {
    const root = makePanel();
    for (const id of ['vignette', 'halftone-print', 'datamosh-trails', 'palette-mapping']) { add(root, id); add(root, id); }
    expect(button(root, '[data-effect-add]').disabled).toBe(true);
    input(rows(root)[0], '[data-effect-name="edgeColor"]', '#aabbcc');
    toggle(rows(root)[2], '[data-effect-name="invert"]', true);
    input(rows(root)[4], '[data-effect-name="mode"]', 'Datamosh', 'change');
    input(rows(root)[6], '[data-effect-name="palette"]', 'Ember', 'change');
    for (const index of [0, 2, 4, 6]) {
      const first = config.effects.layers[index], second = config.effects.layers[index + 1];
      const defaults = resolveEffectValues(effectManifests[first.effectId]);
      expect(first.values).not.toEqual(defaults);
      expect(second.values).toEqual(defaults);
      action(rows(root)[index + 1], 'reset').click();
      expect(first.values).not.toEqual(defaults);
      action(rows(root)[index], 'reset').click();
      expect(first.values).toEqual(defaults);
      expect(second.values).toEqual(defaults);
    }
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('rejects out-of-manifest select values without saving and keeps typed edits on failed save/retry', async () => {
    const standalone = document.createElement('div'); const changed = vi.fn();
    const effects = makeConfig().effects;
    mountEffectsControls(standalone, effects, changed); add(standalone, 'palette-mapping');
    changed.mockClear();
    const select = input(rows(standalone)[0], '[data-effect-name="palette"]', 'Invalid', 'change');
    expect(select.value).toBe('Neon');
    expect(effects.layers[0].values.palette).toBe('Neon');
    expect(changed).not.toHaveBeenCalled();
    setConfig.mockRejectedValueOnce(new Error('disk full'));
    const root = makePanel(); add(root, 'vignette'); add(root, 'halftone-print'); add(root, 'palette-mapping');
    input(rows(root)[0], '[data-effect-name="edgeColor"]', '#123456');
    toggle(rows(root)[1], '[data-effect-name="invert"]', true);
    input(rows(root)[2], '[data-effect-name="palette"]', 'Ember', 'change');
    await vi.advanceTimersByTimeAsync(300);
    expect(root.querySelector('[data-status]')?.textContent).toContain('Could not save');
    input(rows(root)[2], '[data-effect-name="palette"]', 'Ocean', 'change');
    button(root, '[data-action="retry-save"]').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(setConfig.mock.lastCall![0].effects.layers.map((layer: Config['effects']['layers'][number]) => layer.values)).toMatchObject([
      { edgeColor: '#123456' }, { invert: true }, { palette: 'Ocean' },
    ]);
    expect(root.querySelector('[data-status]')?.textContent).toContain('All changes saved');
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('reorders and removes by instance identity, retains expanded state and places focus predictably', () => {
    const root = makePanel(); add(root); add(root); add(root);
    const effects = options().effects!; const original = [...effects.layers];
    const first = rows(root)[0]; first.querySelector<HTMLDetailsElement>('details')!.open = false;
    expect(action(first, 'up').disabled).toBe(true);
    expect(action(rows(root)[2], 'down').disabled).toBe(true);
    action(rows(root)[1], 'up').click();
    expect(effects.layers).toEqual([original[1], original[0], original[2]]);
    expect(document.activeElement).toBe(rows(root)[0].querySelector('summary'));
    expect(rows(root)[1].querySelector('details')).toHaveProperty('open', false);
    expect(root.querySelector('[data-effect-announcement]')?.textContent).toContain('to layer 1');
    action(rows(root)[0], 'down').click();
    expect(effects.layers).toEqual(original);
    action(rows(root)[1], 'remove').click();
    expect(effects.layers).toEqual([original[0], original[2]]);
    expect(document.activeElement).toBe(rows(root)[1].querySelector('summary'));
    action(rows(root)[1], 'remove').click();
    expect(document.activeElement).toBe(rows(root)[0].querySelector('summary'));
    action(rows(root)[0], 'remove').click();
    expect(document.activeElement).toBe(root.querySelector('[data-effect-add]'));
    expect(root.querySelector('[data-effects-empty]')).toHaveProperty('hidden', false);
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('enforces eight layers and unlocks add after removal', () => {
    const root = makePanel(); for (let i = 0; i < MAX_EFFECT_LAYERS + 2; i++) add(root);
    expect(config.effects.layers).toHaveLength(MAX_EFFECT_LAYERS);
    expect(button(root, '[data-effect-add]').disabled).toBe(true);
    expect(root.querySelector('[data-effect-choice]')).toHaveProperty('disabled', true);
    expect(root.querySelector('[data-effect-limit]')?.textContent).toContain('limit reached');
    action(rows(root)[0], 'remove').click(); add(root);
    expect(config.effects.layers).toHaveLength(MAX_EFFECT_LAYERS);
    expect(new Set(config.effects.layers.map(layer => layer.id)).size).toBe(MAX_EFFECT_LAYERS);
  });

  it('preserves effect edits across failed saves and retries the latest mutable stack', async () => {
    setConfig.mockRejectedValueOnce(new Error('disk full'));
    const root = makePanel(); add(root); input(rows(root)[0], '[data-effect-name="grain"]', '0.6');
    await vi.advanceTimersByTimeAsync(300);
    expect(root.querySelector('[data-status]')?.textContent).toContain('Could not save');
    expect(config.effects.layers[0].values.grain).toBe(0.6);
    input(rows(root)[0], '[data-effect-name="grain"]', '0.8');
    const retry = button(root, '[data-action="retry-save"]'); retry.focus(); retry.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(setConfig.mock.lastCall![0].effects.layers[0].values.grain).toBe(0.8);
    expect(root.querySelector('[data-status]')?.textContent).toContain('All changes saved');
    expect(retry.hidden).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('[data-status]'));
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('shows layer/stack failures by the main preview even on Visuals, separate from autosave/base errors', () => {
    const root = makePanel(); add(root);
    const callback = options().onEffectStatus!;
    callback({ layerId: config.effects.layers[0].id, message: 'Compilation failed; layer skipped.' });
    expect(rows(root)[0].querySelector('[data-effect-layer-status]')?.textContent).toContain('Compilation failed');
    expect(root.querySelector('[data-effect-status]')?.textContent).toContain('VHS Distortion, layer 1');
    expect(root.querySelector('[data-preview-effect-status]')).toHaveProperty('hidden', false);
    expect(root.querySelector('[data-preview-effect-status]')?.textContent).toContain('Compilation failed');
    expect(root.querySelector('#effects-settings')).toHaveProperty('hidden', true);
    expect(root.querySelector('[data-status]')?.textContent).toBe('Saving…');
    expect(root.querySelector('[data-preview-status]')).toHaveProperty('hidden', true);
    action(rows(root)[0], 'remove').click();
    expect(root.querySelector('[data-preview-effect-status]')).toHaveProperty('hidden', true);
    callback({ message: 'Framebuffer unavailable; showing the clean visual.' });
    expect(root.querySelector('[data-preview-effect-status]')?.textContent).toContain('Framebuffer unavailable');
    button(root, '.shader-select[data-id="other"]').click();
    expect(root.querySelector('[data-effect-status]')?.textContent).toBe('');
    expect(root.querySelector('[data-preview-effect-status]')).toHaveProperty('hidden', true);
    callback({ layerId: 'removed', message: 'Late failure' });
    expect(root.querySelector('[data-effect-status]')?.textContent).toBe('');
  });

  it('keeps all pending layer diagnostics visible and updates positions after reorder/removal', () => {
    const root = makePanel(); add(root); add(root);
    const firstId = config.effects.layers[0].id;
    const secondId = config.effects.layers[1].id;
    options().onEffectStatus!({ layerId: firstId, message: 'First failure.' });
    options().onEffectStatus!({ layerId: secondId, message: 'Second failure.' });
    expect(root.querySelector('[data-preview-effect-status]')?.textContent).toContain('First failure.');
    expect(root.querySelector('[data-preview-effect-status]')?.textContent).toContain('Second failure.');
    action(rows(root)[0], 'down').click();
    expect(root.querySelector('[data-preview-effect-status]')?.textContent).toContain('layer 2: First failure.');
    action(rows(root)[0], 'remove').click();
    expect(root.querySelector('[data-preview-effect-status]')?.textContent).toBe('VHS Distortion, layer 1: First failure.');
  });

  it('keeps effects independent of visual reset/randomize/looks/palettes and passes them through visual switches', () => {
    const root = makePanel(); add(root);
    input(rows(root)[0], '[data-effect-name="intensity"]', '0.83');
    const effects = config.effects; const expected = structuredClone(effects);
    button(root, '[data-action="reset"]').click();
    button(root, '[data-action="random"]').click();
    button(root, '.look-apply').click();
    input(root, '[data-global="scheme"]', 'dracula');
    input(root, '[data-shader-scheme]', 'none');
    expect(config.effects).toBe(effects); expect(effects).toEqual(expected);
    // Applying a look retains the existing base-select/remount semantics.
    expect(mount).toHaveBeenCalledTimes(2);
    button(root, '.shader-select[data-id="other"]').click();
    expect(mount.mock.lastCall![3].effects).toBe(effects);
    expect(effects).toEqual(expected);
  });

  it('never supplies effects to thumbnails, including the main-mount fallback', () => {
    const root = makePanel(); add(root); FakeIntersectionObserver.instances[0].trigger();
    expect(mountThumbnail).toHaveBeenCalledTimes(2);
    for (const call of mountThumbnail.mock.calls) expect(call).toHaveLength(3);
    makePanel(false); FakeIntersectionObserver.instances[1].trigger();
    expect(mount.mock.calls[0][3].effects).toBe(config.effects);
    for (const call of mount.mock.calls.slice(1)) expect(call).toHaveLength(3);
  });
});

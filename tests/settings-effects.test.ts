// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel, type PreviewRuntime } from '../src/settings/index';

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
function add(root: ParentNode) { button(root, '[data-action="add-effect"]').click(); }
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

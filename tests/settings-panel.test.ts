// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel, type PreviewRuntime } from '../src/settings/index';
import { defaultClockConfig } from '../src/shared/clock';
import type { Config } from '../src/shared/config';
import type { ShaderManifest, UniformManifest } from '../src/shared/manifest';

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observed: Element[] = [];
  constructor(public callback: IntersectionObserverCallback, public options?: IntersectionObserverInit) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(element: Element) { this.observed.push(element); }
  unobserve() {}
  disconnect() { this.observed = []; }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  trigger(isIntersecting: boolean) {
    this.callback(this.observed.map(target => ({ target, isIntersecting } as IntersectionObserverEntry)), this as unknown as IntersectionObserver);
  }
}

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }

const float = (name: string, extra: Partial<UniformManifest> = {}): UniformManifest => ({
  name, type: 'float', default: 1, min: 0, max: 3, step: 0.01, label: name, description: `${name} description`, group: 'Motion', random: { min: 0.5, max: 1.5 }, ...extra,
});

const plasma: ShaderManifest = {
  id: 'plasma', title: 'Plasma', category: 'Abstract', description: 'Plasma description', fragment: 'shader.glsl',
  uniforms: [
    float('speed'),
    { name: 'color1', type: 'color', default: '#112233', label: 'Color', description: 'color', group: 'Color' },
    { name: 'palette', type: 'select', default: 'builtin', options: ['builtin', 'custom'], label: 'Palette', description: 'palette', group: 'Color' },
    { name: 'flag', type: 'bool', default: false, label: 'Flag', description: 'flag', group: 'Shape' },
    float('knob', { default: 0.5, max: 1, advanced: true, group: 'Shape' }),
    float('dependent', { visibleWhen: { name: 'flag', value: true }, group: 'Shape' }),
  ],
};
const ribbons: ShaderManifest = {
  id: 'silk-ribbons', title: 'Silk Ribbons', category: 'Abstract', fracture: undefined, fragment: 'shader.glsl',
  uniforms: [float('speed')],
} as ShaderManifest;

function makeConfig(): Config {
  return {
    shader: 'plasma', fps: 60, monitor: 'primary', kiosk: true, settings: true,
    global: { idleThresholdSeconds: 300, fps: 60, fadeSeconds: 1, inhibitOnAudio: false, inhibitOnFullscreen: true, monitors: 'primary' },
    clock: { ...defaultClockConfig },
    rotation: { enabled: true, entries: [{ shader: 'plasma', preset: 'Look A' }, { shader: 'silk-ribbons' }], intervalMinutes: 10 },
    audio: { enabled: false },
    colors: { scheme: 'dracula', overrides: { plasma: 'nord' } },
    customShaders: [],
    shaders: { plasma: { speed: 2, color1: '#123456' }, 'silk-ribbons': {} },
    presets: { plasma: { 'Look A': { speed: 1.5, color1: '#654321' } } },
  } as Config;
}

const palette = { mPrimary: '#ebbcba', mSecondary: '#9ccfd8', mTertiary: '#31748f', mSurface: '#191724', mOnSurface: '#e0def4' };

let config: Config;
let setConfig: ReturnType<typeof vi.fn>;
let importNoctalia: ReturnType<typeof vi.fn>;
let mount: ReturnType<typeof vi.fn>;
let mountThumbnail: ReturnType<typeof vi.fn>;

function buttonByText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text);
}

function makePreview(): PreviewRuntime {
  mount = vi.fn(() => vi.fn());
  mountThumbnail = vi.fn(() => vi.fn());
  return { mount, mountThumbnail };
}

function panel(preview?: PreviewRuntime) {
  const root = document.createElement('div');
  document.body.append(root);
  return new SettingsPanel({ root, manifests: [plasma, ribbons], initial: structuredClone(config), ...(preview ? { preview } : {}) });
}

beforeEach(() => {
  document.body.innerHTML = '';
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  Object.defineProperty(document, 'fonts', { configurable: true, value: { addEventListener: vi.fn(), removeEventListener: vi.fn() } });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: vi.fn((type: string) => type === '2d' ? { fillStyle: '', fillRect: vi.fn(), textAlign: '', font: '', fillText: vi.fn() } : null) });
  config = makeConfig();
  setConfig = vi.fn(async () => undefined);
  importNoctalia = vi.fn(async () => ({ ok: true, palette }));
  vi.stubGlobal('scrnsvr', { getConfig: vi.fn(async () => structuredClone(config)), setConfig, importNoctaliaColors: importNoctalia, close: vi.fn() });
  vi.stubGlobal('scrnsvrAudio', { subscribe: vi.fn(() => vi.fn()) });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SettingsPanel', () => {
  it('mounts the shell, selects the shader and lists saved looks', () => {
    const preview = makePreview();
    const settings = panel(preview);
    expect(settings.element.querySelector('#preview-title')?.textContent).toBe('Plasma');
    expect(preview.mount).toHaveBeenCalled();
    expect(settings.element.querySelector('[data-name="speed"]')).toBeTruthy();
    expect(settings.element.querySelectorAll('.shader-card').length).toBeGreaterThanOrEqual(2);
    expect(settings.element.querySelectorAll('.look-item')).toHaveLength(1);
    expect(settings.element.querySelectorAll('.shuffle-item')).toHaveLength(2);
    expect(settings.element.querySelector('[data-shuffle-count]')?.textContent).toBe('2 looks');
    expect(settings.element.querySelector('[data-rotation="cycle"]')).toHaveProperty('disabled', false);
    expect(settings.element.querySelector('[data-scheme-hint]')?.textContent).toContain('Nord');
  });

  it('switches tabs with clicks and keyboard navigation', () => {
    const settings = panel(makePreview());
    const looks = settings.element.querySelector<HTMLButtonElement>('#looks-tab')!;
    looks.click();
    expect(settings.element.dataset.view).toBe('looks-settings');
    expect(settings.element.querySelector('.looks-workspace')?.hasAttribute('hidden')).toBe(false);
    looks.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(settings.element.querySelector('#clock-tab'));
    settings.element.querySelector<HTMLButtonElement>('#settings-tab')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(settings.element.querySelector('#shader-tab')?.getAttribute('aria-selected')).toBe('true');
    settings.element.querySelector<HTMLButtonElement>('[data-action="open-save-look"]')!.click();
    expect(document.activeElement).toBe(settings.element.querySelector('[data-preset]'));
  });

  it('selects a shader from the gallery and resets plus randomizes controls', () => {
    const preview = makePreview();
    const settings = panel(preview);
    settings.element.querySelector<HTMLButtonElement>('.shader-select[data-id="silk-ribbons"]')!.click();
    expect(settings.element.querySelector('#preview-title')?.textContent).toBe('Silk Ribbons');
    settings.element.querySelector<HTMLButtonElement>('.shader-select[data-id="plasma"]')!.click();
    const color = settings.element.querySelector<HTMLInputElement>('[data-name="color1"]')!;
    expect(color.value).toBe('#123456');
    settings.element.querySelector<HTMLButtonElement>('[data-action="random"]')!.click();
    settings.element.querySelector<HTMLButtonElement>('[data-action="reset"]')!.click();
    expect(settings.element.querySelector<HTMLInputElement>('[data-name="speed"]')!.value).toBe('1');
    expect(preview.mount).toHaveBeenCalledTimes(3);
  });

  it('reveals boolean-dependent controls and retains their edits while hidden', () => {
    const settings = panel(makePreview());
    const row = settings.element.querySelector<HTMLElement>('[data-control="dependent"]')!;
    const toggle = settings.element.querySelector<HTMLInputElement>('[data-name="flag"]')!;
    expect(row.hidden).toBe(true);
    toggle.checked = true; toggle.dispatchEvent(new Event('input'));
    expect(row.hidden).toBe(false);
    const input = row.querySelector<HTMLInputElement>('input[type="number"]')!;
    input.value = '2.4'; input.dispatchEvent(new Event('change'));
    toggle.checked = false; toggle.dispatchEvent(new Event('input'));
    expect(row.hidden).toBe(true);
    toggle.checked = true; toggle.dispatchEvent(new Event('input'));
    expect(row.hidden).toBe(false);
    expect(input.value).toBe('2.4');
  });

  it('validates exact hex entry and resets overrides even when equal to built-in defaults', () => {
    config.shaders.plasma.color1 = '#112233';
    const settings = panel(makePreview());
    const row = settings.element.querySelector<HTMLElement>('[data-control="color1"]')!;
    const reset = row.querySelector<HTMLButtonElement>('.uniform-reset')!;
    const hex = row.querySelector<HTMLInputElement>('.uniform-hex')!;
    expect(reset.disabled).toBe(false);
    expect(row.querySelector('.uniform-source')?.textContent).toBe('Custom');
    hex.value = '#bad';
    hex.dispatchEvent(new Event('change'));
    expect(hex.getAttribute('aria-invalid')).toBe('true');
    expect(row.querySelector('.uniform-error')?.hasAttribute('hidden')).toBe(false);
    expect(row.querySelector<HTMLInputElement>('[type="color"]')!.value).toBe('#112233');
    hex.value = '#ABCDEF';
    hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(row.querySelector<HTMLInputElement>('[type="color"]')!.value).toBe('#abcdef');
    expect(hex.hasAttribute('aria-invalid')).toBe(false);
    reset.click();
    expect(reset.disabled).toBe(true);
    expect(row.querySelector('.uniform-source')?.textContent).toBe('From scheme');
    expect(hex.value).not.toBe('#112233');
  });

  it('preserves scheme inheritance through randomize, undo, save and subsequent scheme changes', async () => {
    delete config.shaders.plasma.color1;
    const settings = panel(makePreview());
    const color = () => settings.element.querySelector<HTMLInputElement>('[data-name="color1"]')!.value;
    const original = color();
    settings.element.querySelector<HTMLButtonElement>('[data-action="random"]')!.click();
    expect(color()).toBe(original);
    await vi.advanceTimersByTimeAsync(400);
    expect(setConfig.mock.lastCall![0].shaders.plasma).not.toHaveProperty('color1');
    expect(setConfig.mock.lastCall![0].shaders.plasma).not.toHaveProperty('palette');
    settings.element.querySelector<HTMLButtonElement>('[data-action="undo-random"]')!.click();
    await vi.advanceTimersByTimeAsync(400);
    expect(setConfig.mock.lastCall![0].shaders.plasma).toEqual({ speed: 2 });
    const scheme = settings.element.querySelector<HTMLSelectElement>('[data-shader-scheme]')!;
    scheme.value = '';
    scheme.dispatchEvent(new Event('input'));
    expect(color()).not.toBe(original);
  });

  it('applies locks across random scopes and restores a color exploration in one step', () => {
    const settings = panel(makePreview());
    const scope = settings.element.querySelector<HTMLSelectElement>('[data-random-scope]')!;
    const random = settings.element.querySelector<HTMLButtonElement>('[data-action="random"]')!;
    settings.element.querySelector<HTMLButtonElement>('[data-control="speed"] .uniform-lock')!.click();
    for (const value of ['Motion', 'Shape', 'Color', 'all']) {
      scope.value = value;
      random.click();
      expect(settings.element.querySelector<HTMLInputElement>('[data-name="speed"]')!.value).toBe('2');
    }
    const original = settings.element.querySelector<HTMLInputElement>('[data-name="color1"]')!.value;
    settings.element.querySelector<HTMLButtonElement>('[data-control="color1"] .uniform-lock')!.click();
    scope.value = 'all'; random.click();
    expect(settings.element.querySelector<HTMLInputElement>('[data-name="color1"]')!.value).toBe(original);
    settings.element.querySelector<HTMLButtonElement>('[data-control="color1"] .uniform-lock')!.click();
    scope.value = 'Color'; random.click();
    const undo = settings.element.querySelector<HTMLButtonElement>('[data-action="undo-random"]')!;
    expect(undo.disabled).toBe(false);
    undo.click();
    expect(settings.element.querySelector<HTMLInputElement>('[data-name="color1"]')!.value).toBe(original);
    expect(undo.disabled).toBe(true);
  });

  it('saves, overwrites, renames and deletes looks', () => {
    const settings = panel(makePreview());
    const form = settings.element.querySelector<HTMLFormElement>('[data-look-save-form]')!;
    const input = settings.element.querySelector<HTMLInputElement>('[data-preset]')!;
    input.value = 'Look A';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(settings.element.querySelector('[data-look-confirm]')?.hasAttribute('hidden')).toBe(false);
    settings.element.querySelector<HTMLButtonElement>('[data-action="cancel-update"]')!.click();
    expect(settings.element.querySelector('[data-look-confirm]')?.hasAttribute('hidden')).toBe(true);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    settings.element.querySelector<HTMLButtonElement>('[data-action="update-look"]')!.click();
    input.value = 'Look B';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect([...settings.element.querySelectorAll('.look-item strong')].map(node => node.textContent)).toContain('Look B');
    const item = [...settings.element.querySelectorAll<HTMLElement>('.look-item')].find(node => node.querySelector('strong')?.textContent === 'Look B')!;
    buttonByText(item, 'Apply')!.click();
    expect(settings.element.querySelector<HTMLInputElement>('[data-name="speed"]')!.value).toBe('2');
    buttonByText(item, 'Rename look')!.click();
    const renameInput = item.querySelector<HTMLInputElement>('.look-inline-action input')!;
    renameInput.value = 'Look C';
    item.querySelector<HTMLFormElement>('.look-inline-action')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect([...settings.element.querySelectorAll('.look-item strong')].map(node => node.textContent)).toContain('Look C');
    const renamed = [...settings.element.querySelectorAll<HTMLElement>('.look-item')].find(node => node.querySelector('strong')?.textContent === 'Look C')!;
    buttonByText(renamed, 'Delete look')!.click();
    buttonByText(renamed, 'Delete')!.click();
    expect([...settings.element.querySelectorAll('.look-item strong')].map(node => node.textContent)).not.toContain('Look C');
  });

  it('edits shuffle rotation and global settings', async () => {
    const settings = panel(makePreview());
    const enabled = settings.element.querySelector<HTMLInputElement>('[data-rotation="enabled"]')!;
    const cycle = settings.element.querySelector<HTMLInputElement>('[data-rotation="cycle"]')!;
    const interval = settings.element.querySelector<HTMLInputElement>('[data-rotation="intervalMinutes"]')!;
    enabled.checked = true; enabled.dispatchEvent(new Event('change', { bubbles: true }));
    cycle.checked = true; cycle.dispatchEvent(new Event('change', { bubbles: true }));
    interval.value = '30'; interval.dispatchEvent(new Event('change', { bubbles: true }));
    expect(settings.element.querySelector('[data-shuffle-summary]')?.textContent).toContain('every 30 minutes');
    buttonByText(settings.element.querySelector('.shuffle-item')!, 'Remove')!.click();
    expect(settings.element.querySelectorAll('.shuffle-item')).toHaveLength(1);
    const fps = settings.element.querySelector<HTMLInputElement>('[data-global="fps"]')!;
    fps.value = '90'; fps.dispatchEvent(new Event('input', { bubbles: true }));
    expect(settings.element.querySelector('[data-output="fps"]')?.textContent).toBe('90 FPS');
    const fade = settings.element.querySelector<HTMLInputElement>('[data-global="fadeSeconds"]')!;
    fade.value = '2'; fade.dispatchEvent(new Event('input', { bubbles: true }));
    expect(settings.element.querySelector('[data-output="fadeSeconds"]')?.textContent).toBe('2s');
    const monitors = settings.element.querySelector<HTMLSelectElement>('[data-global="monitors"]')!;
    monitors.value = 'all'; monitors.dispatchEvent(new Event('input', { bubbles: true }));
    const audioCheck = settings.element.querySelector<HTMLInputElement>('[data-global-check="inhibitOnAudio"]')!;
    audioCheck.checked = true; audioCheck.dispatchEvent(new Event('change', { bubbles: true }));
    const audioEnabled = settings.element.querySelector<HTMLInputElement>('[data-audio-enabled]')!;
    audioEnabled.checked = true; audioEnabled.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);
    expect(setConfig).toHaveBeenCalled();
  });

  it('applies global and per-shader color schemes and imports Noctalia colors', async () => {
    const settings = panel(makePreview());
    const globalScheme = settings.element.querySelector<HTMLSelectElement>('[data-global="scheme"]')!;
    globalScheme.value = 'gruvbox-dark'; globalScheme.dispatchEvent(new Event('input', { bubbles: true }));
    expect(globalScheme.value).toBe('gruvbox-dark');
    const shaderScheme = settings.element.querySelector<HTMLSelectElement>('[data-shader-scheme]')!;
    shaderScheme.value = ''; shaderScheme.dispatchEvent(new Event('input', { bubbles: true }));
    expect(settings.element.querySelector('[data-scheme-hint]')?.textContent).toContain('Gruvbox Dark');
    shaderScheme.value = 'none'; shaderScheme.dispatchEvent(new Event('input', { bubbles: true }));
    const importButton = settings.element.querySelector<HTMLButtonElement>('[data-action="import-noctalia"]')!;
    importButton.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(importNoctalia).toHaveBeenCalled();
    expect(settings.element.querySelector('[data-import-status]')?.textContent).toContain('Imported Noctalia colors');
    await vi.advanceTimersByTimeAsync(400);
  });

  it('mounts and releases thumbnails through the intersection observer', () => {
    const preview = makePreview();
    panel(preview);
    const observer = FakeIntersectionObserver.instances[0];
    expect(observer.observed.length).toBeGreaterThan(0);
    observer.trigger(true);
    expect(preview.mountThumbnail).toHaveBeenCalled();
    observer.trigger(false);
    observer.trigger(true);
    expect(preview.mountThumbnail).toHaveBeenCalledTimes(4);
  });

  it('changes only the old and new selection in a large gallery and reuses scheme options', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const manifests = [plasma, ...Array.from({ length: 400 }, (_, i) => ({ ...ribbons, id: `shader-${i}` }))];
    new SettingsPanel({ root, manifests, initial: structuredClone(config), preview: makePreview() });
    const firstOption = root.querySelector('[data-shader-scheme] option');
    const observer = new MutationObserver(() => {});
    observer.observe(root.querySelector('.shader-categories')!, { subtree: true, attributes: true });
    root.querySelector<HTMLButtonElement>('.shader-select[data-id="shader-399"]')!.click();
    expect(observer.takeRecords()).toHaveLength(4);
    expect(root.querySelectorAll('.shader-select[aria-pressed="true"]')).toHaveLength(1);
    expect(root.querySelector('.shader-card.active')?.getAttribute('data-id')).toBe('shader-399');
    expect(root.querySelector('[data-shader-scheme] option')).toBe(firstOption);
    observer.disconnect();
  });

  it('updates colors without recompiling the preview and resolves offscreen thumbnail colors on entry', () => {
    const preview = makePreview();
    const settings = panel(preview);
    const observer = FakeIntersectionObserver.instances[0];
    observer.trigger(true);
    const values = mountThumbnail.mock.calls[0][2];
    observer.trigger(false);
    const scheme = settings.element.querySelector<HTMLSelectElement>('[data-shader-scheme]')!;
    scheme.value = 'none';
    scheme.dispatchEvent(new Event('input', { bubbles: true }));
    expect(preview.mount).toHaveBeenCalledTimes(1);
    observer.trigger(true);
    expect(mountThumbnail.mock.calls[2][2]).toBe(values);
    expect(values).not.toHaveProperty('color1');
    expect(values.speed).toBe(2);
  });

  it('loads a saved look from the shuffle list', () => {
    const preview = makePreview();
    const settings = panel(preview);
    settings.element.querySelector<HTMLButtonElement>('.shuffle-item .shuffle-load')!.click();
    expect(settings.element.querySelector('#shader-tab')?.getAttribute('aria-selected')).toBe('true');
    expect(settings.element.querySelector('#preview-title')?.textContent).toBe('Plasma');
    expect(preview.mount).toHaveBeenCalled();
  });

  it('falls back to an unavailable preview without a runtime', () => {
    expect(() => panel()).not.toThrow();
  });
});

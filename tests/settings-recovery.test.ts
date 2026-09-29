// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel, type PreviewRuntime } from '../src/settings/index';
import { defaultClockConfig } from '../src/shared/clock';
import type { Config } from '../src/shared/config';
import type { ShaderManifest } from '../src/shared/manifest';

class FakeIntersectionObserver {
  observed: Element[] = [];
  constructor(public callback: IntersectionObserverCallback) {}
  observe(element: Element) { this.observed.push(element); }
  unobserve() {}
  disconnect() { this.observed = []; }
}
class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }

const shader: ShaderManifest = {
  id: 'plasma', title: 'Plasma', category: 'Ambient', fragment: 'shader.glsl',
  uniforms: [{ name: 'speed', type: 'float', default: 1, min: 0, max: 3, step: 0.1, label: 'Speed', description: 'Speed', group: 'Motion' }],
};
const other: ShaderManifest = { ...shader, id: 'other', title: 'Other' };
const makeConfig = (): Config => ({
  shader: 'plasma', fps: 60, monitor: 'primary', kiosk: true, settings: true,
  global: { idleThresholdSeconds: 300, fps: 60, fadeSeconds: 1, inhibitOnAudio: false, inhibitOnFullscreen: true, monitors: 'primary' },
  clock: { ...defaultClockConfig }, rotation: { enabled: true, entries: [{ shader: 'plasma', preset: 'Saved' }, { shader: 'other' }], intervalMinutes: 10 },
  audio: { enabled: false }, colors: { scheme: 'none', overrides: {} }, customShaders: [],
  shaders: { plasma: { speed: 2 }, other: { speed: 3 } }, presets: { plasma: { Saved: { speed: 0.5 } } },
} as Config);

let config: Config;
let setConfig: ReturnType<typeof vi.fn>;
const preview = (): PreviewRuntime => ({ mount: vi.fn(() => vi.fn()) });
function makePanel() {
  const root = document.createElement('div'); document.body.append(root);
  return new SettingsPanel({ root, manifests: [shader, other], initial: structuredClone(config), preview: preview() });
}
function findButton(root: ParentNode, label: string) {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === label)!;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Object.defineProperty(document, 'fonts', { configurable: true, value: { addEventListener: vi.fn(), removeEventListener: vi.fn() } });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: vi.fn(() => null) });
  config = makeConfig();
  setConfig = vi.fn(async () => undefined);
  vi.stubGlobal('scrnsvr', { setConfig, importNoctaliaColors: vi.fn(), close: vi.fn() });
  vi.stubGlobal('scrnsvrAudio', { subscribe: vi.fn(() => vi.fn()) });
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('settings recovery', () => {
  it('undoes reset and saved look application with a truthful action label', () => {
    const panel = makePanel();
    panel.element.querySelector<HTMLButtonElement>('[data-action="reset"]')!.click();
    const undo = panel.element.querySelector<HTMLButtonElement>('[data-action="undo-random"]')!;
    expect(undo.textContent).toBe('Undo reset');
    expect(panel.element.querySelector<HTMLInputElement>('[data-name="speed"]')!.value).toBe('1');
    undo.click();
    expect(panel.element.querySelector<HTMLInputElement>('[data-name="speed"]')!.value).toBe('2');
    findButton(panel.element.querySelector('.look-item')!, 'Apply').click();
    expect(undo.textContent).toBe('Undo apply look');
    const previewUndo = panel.element.querySelector<HTMLButtonElement>('[data-action="undo-preview"]')!;
    expect(previewUndo.hidden).toBe(false);
    expect(previewUndo.textContent).toBe('Undo apply look');
    previewUndo.click();
    expect(panel.element.querySelector<HTMLInputElement>('[data-name="speed"]')!.value).toBe('2');
  });

  it('undoes a look loaded from shuffle and keeps undo scoped to its shader', () => {
    const panel = makePanel();
    panel.element.querySelector<HTMLButtonElement>('.shuffle-load')!.click();
    const undo = panel.element.querySelector<HTMLButtonElement>('[data-action="undo-random"]')!;
    expect(undo.textContent).toBe('Undo apply look');
    expect(panel.element.querySelector<HTMLInputElement>('[data-name="speed"]')!.value).toBe('0.5');
    panel.element.querySelector<HTMLButtonElement>('.shader-select[data-id="other"]')!.click();
    expect(undo.disabled).toBe(true);
    panel.element.querySelector<HTMLButtonElement>('.shader-select[data-id="plasma"]')!.click();
    expect(undo.disabled).toBe(false);
    undo.click();
    expect(panel.element.querySelector<HTMLInputElement>('[data-name="speed"]')!.value).toBe('2');
  });

  it('restores keyboard focus after shuffle and saved-look list changes', () => {
    const panel = makePanel();
    const removeShuffle = panel.element.querySelector<HTMLButtonElement>('.shuffle-item .shuffle-remove')!;
    removeShuffle.focus(); removeShuffle.click();
    expect(document.activeElement).toBe(panel.element.querySelector('.shuffle-item .shuffle-remove'));
    const addLook = panel.element.querySelector<HTMLButtonElement>('.look-shuffle')!;
    addLook.focus(); addLook.click();
    expect(document.activeElement).toBe(panel.element.querySelector('.look-shuffle'));
    const rename = panel.element.querySelector<HTMLButtonElement>('.look-rename')!;
    rename.click();
    expect(document.activeElement).toBe(panel.element.querySelector('.look-inline-action input'));
    findButton(panel.element.querySelector('.look-inline-action')!, 'Cancel').click();
    expect(document.activeElement).toBe(panel.element.querySelector('.look-more summary'));
    expect(panel.element.querySelector<HTMLDetailsElement>('.look-more')?.open).toBe(true);
    panel.element.querySelector<HTMLInputElement>('[data-preset]')!.value = 'Saved';
    panel.element.querySelector<HTMLFormElement>('[data-look-save-form]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const overwriteCancel = panel.element.querySelector<HTMLButtonElement>('[data-action="cancel-update"]');
    overwriteCancel?.click();
    expect(document.activeElement).toBe(panel.element.querySelector('[data-preset]'));
    const currentRename = panel.element.querySelector<HTMLButtonElement>('.look-rename')!;
    currentRename.click();
    const renameForm = currentRename.closest('.look-item')!.querySelector<HTMLFormElement>('.look-inline-action')!;
    renameForm.querySelector<HTMLInputElement>('input')!.value = 'Saved copy';
    renameForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(panel.element.querySelector('.look-more summary'));
    expect(panel.element.querySelector<HTMLDetailsElement>('.look-more')?.open).toBe(true);
    panel.element.querySelector<HTMLButtonElement>('.look-delete')!.click();
    const deletePrompt = panel.element.querySelector('.look-inline-action')!;
    findButton(deletePrompt, 'Cancel').click();
    expect(document.activeElement).toBe(panel.element.querySelector('.look-more summary'));
    expect(panel.element.querySelector<HTMLDetailsElement>('.look-more')?.open).toBe(true);
    panel.element.querySelector<HTMLButtonElement>('.look-delete')!.click();
    findButton(panel.element.querySelector('.look-inline-action')!, 'Delete').click();
    expect(document.activeElement).toBe(panel.element.querySelector('.look-item .look-apply') ?? panel.element.querySelector('[data-preset]'));
  });

  it('offers a retry after save failure and keeps newer save status over stale completions', async () => {
    let rejectFirst!: (error: Error) => void;
    setConfig.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
    const panel = makePanel();
    panel.element.querySelector<HTMLInputElement>('[data-global="fps"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    rejectFirst(new Error('disk full'));
    await Promise.resolve();
    expect(panel.element.querySelector('[data-status]')?.textContent).toBe('Could not save. Your edits are still here.');
    const retry = panel.element.querySelector<HTMLButtonElement>('[data-action="retry-save"]')!;
    expect(retry.hidden).toBe(false);
    retry.focus();
    retry.click();
    expect(panel.element.querySelector('[data-status]')?.textContent).toBe('Could not save. Your edits are still here.');
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(panel.element.querySelector('[data-status]')?.textContent).toBe('All changes saved locally');
    expect(retry.hidden).toBe(true);
    expect(document.activeElement).toBe(panel.element.querySelector('[data-status]'));
  });

  it('does not let an older save failure replace a newer saving state', async () => {
    let rejectOld!: (error: Error) => void;
    let resolveNew!: () => void;
    setConfig
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise<void>(resolve => { resolveNew = resolve; }));
    const panel = makePanel();
    panel.element.querySelector<HTMLInputElement>('[data-global="fps"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    panel.element.querySelector<HTMLInputElement>('[data-global="fps"]')!.dispatchEvent(new Event('input', { bubbles: true }));
    rejectOld(new Error('old write failed'));
    await Promise.resolve();
    expect(panel.element.querySelector('[data-status]')?.dataset.state).toBe('saving');
    await vi.advanceTimersByTimeAsync(300);
    resolveNew();
    await Promise.resolve();
    expect(panel.element.querySelector('[data-status]')?.textContent).toBe('All changes saved locally');
  });

  it('announces preview startup errors and clears them on success', () => {
    const root = document.createElement('div'); document.body.append(root);
    const runtime: PreviewRuntime = { mount: vi.fn(() => { throw new Error('GPU unavailable'); }) };
    const panel = new SettingsPanel({ root, manifests: [shader, other], initial: structuredClone(config), preview: runtime });
    expect(panel.element.querySelector('[data-preview-status]')?.textContent).toContain('Select another visual');
    expect(panel.element.querySelector<HTMLElement>('[data-preview-status]')?.hidden).toBe(false);
    runtime.mount = vi.fn(() => vi.fn());
    panel.element.querySelector<HTMLButtonElement>('.shader-select[data-id="other"]')!.click();
    expect(panel.element.querySelector('[data-preview-status]')?.textContent).toBe('');
    expect(panel.element.querySelector<HTMLElement>('[data-preview-status]')?.hidden).toBe(true);
  });
});

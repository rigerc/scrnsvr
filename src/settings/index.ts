import type { Config } from '../shared/config';
import { shaderCategories, type ShaderManifest } from '../shared/manifest';
import { noctaliaShaderValues } from '../shared/noctalia';
import { defaultClockConfig } from '../shared/clock';
import { mountClock } from '../renderer/core/clock';
import { mountClockControls } from './clock';
import { mountShaderControls } from './shader-controls';
import { randomizeUniforms } from '../renderer/core/uniforms';
import { openCustomShaderEditor } from './custom-shader-editor';
import { settingsMarkup } from './layout';
import { rotationEntryKey } from '../shared/rotation';
import { SCHEME_NONE, clearShaderColorOverrides, effectiveShaderValues, paletteById, palettes, schemeIdForShader } from '../shared/palettes';

type Value = number | boolean | string;

/** Fill a scheme <select> with Built-in colors plus Dark/Light optgroups. */
function fillSchemeOptions(select: HTMLSelectElement, options: { inherit?: boolean } = {}) {
  select.replaceChildren();
  if (options.inherit) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Use global scheme';
    select.append(option);
  }
  const none = document.createElement('option');
  none.value = SCHEME_NONE;
  none.textContent = 'Built-in colors';
  select.append(none);
  for (const variant of ['dark', 'light'] as const) {
    const group = document.createElement('optgroup');
    group.label = variant === 'dark' ? 'Dark' : 'Light';
    for (const palette of palettes.filter(item => item.variant === variant)) {
      const option = document.createElement('option');
      option.value = palette.id;
      option.textContent = palette.name;
      group.append(option);
    }
    select.append(group);
  }
}
export interface PreviewRuntime {
  mount(canvas: HTMLCanvasElement, shader: ShaderManifest, values: Record<string, Value>): () => void;
  mountThumbnail?(canvas: HTMLCanvasElement, shader: ShaderManifest, values: Record<string, Value>): () => void;
}
export interface SettingsOptions { root: HTMLElement; manifests: ShaderManifest[]; initial?: Config; preview?: PreviewRuntime; }

/** Vanilla settings UI. The host supplies manifests so this stays independent of the renderer registry. */
export class SettingsPanel {
  readonly element: HTMLElement;
  private config: Config;
  private readonly manifests: ShaderManifest[];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private shader!: ShaderManifest;
  private controls!: HTMLElement;
  private status!: HTMLElement;
  private preview?: PreviewRuntime;
  private stopPreview?: () => void;
  private previewValues?: Record<string, Value>;
  private importingColors = false;
  private refreshSchemeVisuals: () => void = () => {};
  private lastIntervalMinutes = 10;
  private pendingLookUpdate: string | undefined;
  private activateTab?: (tab: HTMLButtonElement, showPreview?: boolean) => void;

  constructor(options: SettingsOptions) {
    this.manifests = options.manifests;
    this.preview = options.preview;
this.config = options.initial ?? ({ shader: this.manifests[0]?.id ?? 'flow-field', fps: 60, monitor: 'primary', kiosk: true, settings: true, global: { idleThresholdSeconds: 300, fps: 60, fadeSeconds: 1, inhibitOnAudio: false, inhibitOnFullscreen: true, monitors: 'primary' }, clock: defaultClockConfig, rotation: { enabled: false, entries: [], intervalMinutes: 0 }, audio: { enabled: false }, colors: { scheme: 'none', overrides: {} }, customShaders: [], shaders: {}, presets: {} } as Config);
    this.config.clock = { ...defaultClockConfig, ...this.config.clock };
    this.config.rotation ??= { enabled: false, entries: [], intervalMinutes: 0 };
    this.config.audio ??= { enabled: false };
    this.config.colors ??= { scheme: SCHEME_NONE, overrides: {} };
    this.config.colors.overrides ??= {};
    this.element = options.root;
    this.element.className = 'scrnsvr-settings';
    this.render();
  }
  private render() {
    this.element.innerHTML = settingsMarkup;
    this.controls = this.element.querySelector('.controls')!; this.status = this.element.querySelector('[data-status]')!;
    const audioEnabled = this.element.querySelector<HTMLInputElement>('[data-audio-enabled]')!;
    audioEnabled.checked = this.config.audio.enabled;
    audioEnabled.addEventListener('change', () => { this.config.audio.enabled = audioEnabled.checked; this.queueSave(); });
    const audioStatus = this.element.querySelector<HTMLElement>('[data-audio-status]')!;
    const audioMeter = this.element.querySelector<HTMLMeterElement>('[data-audio-level]')!;
    const stopAudio = window.scrnsvrAudio?.subscribe(frame => {
      audioStatus.textContent = frame.status;
      audioMeter.value = frame.level;
    });
    window.addEventListener('pagehide', () => stopAudio?.(), { once: true });
    const clock = mountClock(this.element.querySelector('.clock-stage') as HTMLElement, this.config.clock);
    mountClockControls(this.element.querySelector('#clock-settings') as HTMLElement, this.config.clock, () => {
      clock.update(this.config.clock);
      this.queueSave();
    });
    window.addEventListener('pagehide', () => { clock.destroy(); this.stopPreview?.(); }, { once: true });
    const tabs = Array.from(this.element.querySelectorAll<HTMLButtonElement>('[data-tab]'));
    const activateTab = (tab: HTMLButtonElement, showPreview = false) => {
      this.element.dataset.view = tab.dataset.tab;
      tabs.forEach(button => {
        const active = button === tab;
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        (this.element.querySelector(`#${button.dataset.tab}`) as HTMLElement).hidden = !active;
      });
      (this.element.querySelector('.looks-workspace') as HTMLElement).hidden = tab.dataset.tab !== 'looks-settings';
      if (window.matchMedia('(max-width: 980px)').matches) {
        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
        this.element.querySelector(showPreview || tab.dataset.tab === 'looks-settings' ? '.preview-column' : '.inspector')
          ?.scrollIntoView({ block: 'start', behavior });
      }
    };
    this.activateTab = activateTab;
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activateTab(tab));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === 'Home' ? 0
          : event.key === 'End' ? tabs.length - 1
            : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
              : (index + 1) % tabs.length;
        const next = tabs[nextIndex];
        activateTab(next);
        next.focus();
      });
    });
    this.element.querySelector('[data-action="open-save-look"]')!.addEventListener('click', () => {
      activateTab(this.element.querySelector('#looks-tab') as HTMLButtonElement);
      (this.element.querySelector('[data-preset]') as HTMLInputElement).focus();
    });
    const gallery = this.element.querySelector('.shader-categories')!;
    const thumbnailStates = new Map<Element, { canvas: HTMLCanvasElement; manifest: ShaderManifest; values: Record<string, Value>; stop?: () => void }>();
    const releaseThumbnail = (state: { canvas: HTMLCanvasElement; stop?: () => void }) => {
      if (!state.stop) return;
      state.stop();
      state.stop = undefined;
    };
    const thumbnailObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const state = thumbnailStates.get(entry.target);
        if (!state) continue;
        if (entry.isIntersecting && !state.stop) {
          state.stop = this.preview
            ? (this.preview.mountThumbnail ?? this.preview.mount)(state.canvas, state.manifest, state.values)
            : this.animateFallback(state.canvas);
        } else if (!entry.isIntersecting) releaseThumbnail(state);
      }
    }, { root: this.element.querySelector('.shader-bank'), rootMargin: '100px 0px' });
    window.addEventListener('pagehide', () => {
      thumbnailObserver.disconnect();
      thumbnailStates.forEach(releaseThumbnail);
    }, { once: true });

    const addCard = (manifest: ShaderManifest, grid: HTMLElement) => {
      const card = document.createElement('div');
      card.className = 'shader-card';
      card.dataset.id = manifest.id;
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'shader-select';
      select.dataset.id = manifest.id;
      select.setAttribute('aria-label', 'Preview ' + manifest.title);
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 300;
      canvas.setAttribute('aria-hidden', 'true');
      const title = document.createElement('strong');
      title.textContent = manifest.title;
      select.append(canvas, title);
      select.addEventListener('click', () => { this.select(manifest.id); this.queueSave(); });

      card.append(select);
      grid.append(card);
      const stored = this.config.shaders[manifest.id] ??= {};
      thumbnailStates.set(select, {
        canvas, manifest, values: effectiveShaderValues(manifest, stored, this.config.colors),
      });
      thumbnailObserver.observe(select);
    };

    const featuredIds = [
      this.config.shader, 'aurora-veil', 'plasma', 'tidal-caustics',
      'silk-ribbons', 'mesh-gradient', 'flow-field',
    ];
    const featured = Array.from(new Set(featuredIds))
      .map(id => this.manifests.find(manifest => manifest.id === id))
      .filter((manifest): manifest is ShaderManifest => Boolean(manifest))
      .slice(0, 6);
    for (const manifest of this.manifests) {
      if (featured.length >= 6) break;
      if (!featured.some(item => item.id === manifest.id)) featured.push(manifest);
    }
    const featuredSection = document.createElement('section');
    featuredSection.className = 'shader-category featured';
    featuredSection.setAttribute('aria-label', 'Featured shaders');
    const featuredGrid = document.createElement('div');
    featuredGrid.className = 'gallery';
    featuredSection.append(featuredGrid);
    gallery.append(featuredSection);
    featured.forEach(manifest => addCard(manifest, featuredGrid));

    const featuredSet = new Set(featured.map(manifest => manifest.id));
    for (const category of shaderCategories) {
      const shaders = this.manifests
        .filter(manifest => !featuredSet.has(manifest.id) && (manifest.category ?? 'Abstract') === category)
        .sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base', numeric: true }));
      if (!shaders.length) continue;
      const section = document.createElement('section');
      section.className = 'shader-category';
      section.dataset.category = category;
      const heading = document.createElement('h3');
      heading.id = 'shader-category-' + category.toLowerCase();
      heading.textContent = category;
      const count = document.createElement('span');
      count.className = 'shader-category-count';
      count.textContent = String(shaders.length);
      count.setAttribute('aria-label', shaders.length + ' shaders');
      heading.append(count);
      section.setAttribute('aria-labelledby', heading.id);
      const grid = document.createElement('div');
      grid.className = 'gallery';
      section.append(heading, grid);
      gallery.append(section);
      shaders.forEach(manifest => addCard(manifest, grid));
    }
    this.refreshSchemeVisuals = () => {
      for (const state of thumbnailStates.values()) {
        const refreshed = effectiveShaderValues(state.manifest, this.config.shaders[state.manifest.id], this.config.colors);
        for (const key of Object.keys(state.values)) delete state.values[key];
        Object.assign(state.values, refreshed);
      }
      this.renderControls();
      this.refreshPreview();
      this.updateSchemeHint();
    };
    this.bindRotation();
    const editSource = (existing = false) => openCustomShaderEditor(
      existing ? this.config.customShaders?.find(shader => shader.id === this.shader.id) : undefined,
      async shader => {
        if (this.timer) clearTimeout(this.timer);
        const next = structuredClone(this.config);
        next.customShaders = [...(next.customShaders ?? []).filter(item => item.id !== shader.id), shader];
        next.shader = shader.id;
        try { await window.scrnsvr.setConfig(next); }
        catch (error) { this.queueSave(); throw error; }
        location.reload();
      },
    );
    this.element.querySelector('[data-action="add-shader"]')!.addEventListener('click', () => editSource());
    this.element.querySelector('[data-action="edit-source"]')!.addEventListener('click', () => editSource(true));
    this.bindGlobals();
    this.element.querySelector('[data-action="random"]')!.addEventListener('click', () => this.randomize());
    this.element.querySelector('[data-action="reset"]')!.addEventListener('click', () => { this.replaceValues({}); this.renderControls(); this.queueSave(); });
    this.element.querySelector('[data-look-save-form]')!.addEventListener('submit', event => { event.preventDefault(); this.savePreset(); });
    this.element.querySelector('[data-preset]')!.addEventListener('input', () => this.cancelLookUpdate());
    this.element.querySelector('[data-action="update-look"]')!.addEventListener('click', () => this.savePreset(true));
    this.element.querySelector('[data-action="cancel-update"]')!.addEventListener('click', () => this.cancelLookUpdate());
    this.element.querySelector('[data-action="import-noctalia"]')!.addEventListener('click', () => void this.importNoctaliaColors());
    this.element.querySelector('[data-shader-scheme]')!.addEventListener('input', event => this.applyShaderScheme((event.target as HTMLSelectElement).value));
    this.select(this.config.shader);
  }
  private select(id: string) {
    this.shader = this.manifests.find(m => m.id === id) ?? this.manifests[0];
    if (!this.shader) return;
    this.config.shader = this.shader.id;
    this.cancelLookUpdate();
    this.lookMessage('');
    this.element.dataset.shader = this.shader.id;
    (this.element.querySelector('[data-action="edit-source"]') as HTMLButtonElement).hidden = !this.config.customShaders?.some(shader => shader.id === this.shader.id);
    this.element.querySelector('#preview-title')!.textContent = this.shader.title;
    this.element.querySelector('.preview-description')!.textContent = this.shader.description ?? 'Adjust the controls to see your changes here immediately.';
    this.renderControls();
    this.updateColorImport();
    this.element.querySelector('[data-import-status]')!.textContent = this.shader.uniforms.some(u => u.type === 'color')
      ? 'Apply your desktop palette to this shader.'
      : 'This shader uses a built-in palette. Choose a shader with color controls to import colors.';
    this.element.querySelectorAll<HTMLButtonElement>('.shader-select').forEach(button => {
      const selected = button.dataset.id === this.shader.id;
      button.closest('.shader-card')?.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    this.renderPresets();
    this.refreshPreview();
  }
  private refreshPreview() {
    this.stopPreview?.();
    const canvas = this.element.querySelector('.preview') as HTMLCanvasElement;
    const stored = this.config.shaders[this.shader.id] ??= {};
    this.previewValues = effectiveShaderValues(this.shader, stored, this.config.colors);
    this.stopPreview = this.preview
      ? this.preview.mount(canvas, this.shader, this.previewValues)
      : this.animateFallback(canvas);
  }
  private refreshPreviewValues() {
    if (!this.previewValues) return;
    const next = effectiveShaderValues(this.shader, this.config.shaders[this.shader.id], this.config.colors);
    for (const key of Object.keys(this.previewValues)) delete this.previewValues[key];
    Object.assign(this.previewValues, next);
  }
  private replaceValues(next: Record<string, Value>) {
    // Keep the stored object so controls bound to it stay in sync.
    const values = this.config.shaders[this.shader.id] ??= {};
    for (const key of Object.keys(values)) delete values[key];
    Object.assign(values, next);
    this.refreshPreviewValues();
  }
  private updateColorImport() {
    const hasColors = this.shader.uniforms.some(u => u.type === 'color');
    const button = this.element.querySelector('[data-action="import-noctalia"]') as HTMLButtonElement;
    button.disabled = this.importingColors || !hasColors;
    button.textContent = this.importingColors ? 'Importing…' : 'Import Noctalia colors';
    const scheme = this.element.querySelector('[data-shader-scheme]') as HTMLSelectElement;
    scheme.disabled = !hasColors;
    fillSchemeOptions(scheme, { inherit: true });
    scheme.value = this.config.colors.overrides[this.shader.id] ?? '';
    this.updateSchemeHint();
  }
  private updateSchemeHint() {
    const hint = this.element.querySelector('[data-scheme-hint]') as HTMLElement | null;
    if (!hint) return;
    if (!this.shader.uniforms.some(u => u.type === 'color')) {
      hint.textContent = 'This shader uses a built-in palette.';
      return;
    }
    const override = this.config.colors.overrides[this.shader.id];
    const id = override !== undefined && override !== '' ? override : this.config.colors.scheme;
    const palette = id && id !== SCHEME_NONE ? paletteById.get(id) : undefined;
    hint.textContent = palette
      ? `Applying ${palette.name}${override ? ' (override)' : ''}.`
      : 'Using built-in shader colors.';
  }
  private applyGlobalScheme(id: string) {
    this.config.colors.scheme = id;
    for (const manifest of this.manifests) clearShaderColorOverrides(manifest, this.config.shaders[manifest.id]);
    this.refreshSchemeVisuals();
    this.queueSave();
  }
  private applyShaderScheme(id: string) {
    if (id) this.config.colors.overrides[this.shader.id] = id;
    else delete this.config.colors.overrides[this.shader.id];
    clearShaderColorOverrides(this.shader, this.config.shaders[this.shader.id]);
    this.refreshSchemeVisuals();
    this.queueSave();
  }
  private async importNoctaliaColors() {
    if (this.importingColors || !this.shader.uniforms.some(u => u.type === 'color')) return;
    const shader = this.shader;
    const status = this.element.querySelector('[data-import-status]')!;
    this.importingColors = true;
    this.updateColorImport();
    status.textContent = 'Reading Noctalia colors…';
    try {
      const result = await window.scrnsvr.importNoctaliaColors();
      if (!result.ok) throw new Error(result.error);
      Object.assign(this.config.shaders[shader.id] ??= {}, noctaliaShaderValues(shader, result.palette));
      if (this.shader.id === shader.id) {
        this.renderControls();
        this.refreshPreviewValues();
      }
      status.textContent = `Imported Noctalia colors into ${shader.title}.`;
      this.queueSave();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not import Noctalia colors.';
    } finally {
      this.importingColors = false;
      this.updateColorImport();
    }
  }
  private animateFallback(canvas: HTMLCanvasElement): () => void {
    // A missing renderer must not pretend to show the selected shader.
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#081321';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#aabbd3';
      ctx.textAlign = 'center';
      ctx.font = '14px system-ui';
      ctx.fillText('Preview unavailable', canvas.width / 2, canvas.height / 2);
    }
    return () => {};
  }
  private bindGlobals(){const g=this.config.global; (this.element.querySelector('[data-global="idleThresholdSeconds"]') as HTMLInputElement).value=String(g.idleThresholdSeconds); const fps=this.element.querySelector('[data-global="fps"]') as HTMLInputElement;fps.value=String(g.fps);this.element.querySelector('[data-output="fps"]')!.textContent=`${g.fps} FPS`; const fade=this.element.querySelector('[data-global="fadeSeconds"]') as HTMLInputElement;fade.value=String(g.fadeSeconds);this.element.querySelector('[data-output="fadeSeconds"]')!.textContent=`${g.fadeSeconds}s`; (this.element.querySelector('[data-global="monitors"]') as HTMLSelectElement).value=g.monitors; const scheme=this.element.querySelector('[data-global="scheme"]') as HTMLSelectElement; fillSchemeOptions(scheme); scheme.value=this.config.colors.scheme; this.element.querySelectorAll('[data-global]').forEach(x=>x.addEventListener('input',()=>{const key=(x as HTMLElement).dataset.global as string; if(key==='scheme'){this.applyGlobalScheme((x as HTMLSelectElement).value);return;} const v=key==='monitors'?(x as HTMLSelectElement).value:Number((x as HTMLInputElement).value);(this.config.global as any)[key]=v;if(key==='fps')this.element.querySelector('[data-output="fps"]')!.textContent=`${v} FPS`;if(key==='fadeSeconds')this.element.querySelector('[data-output="fadeSeconds"]')!.textContent=`${v}s`;this.queueSave();})); this.element.querySelectorAll<HTMLInputElement>('[data-global-check]').forEach(x=>{const key=x.dataset.globalCheck as 'inhibitOnAudio'|'inhibitOnFullscreen';x.checked=Boolean(g[key]);x.addEventListener('change',()=>{g[key]=x.checked;this.queueSave();});});}
  private bindRotation() {
    const toggle = this.element.querySelector('[data-rotation="enabled"]') as HTMLInputElement;
    const cycle = this.element.querySelector('[data-rotation="cycle"]') as HTMLInputElement;
    const interval = this.element.querySelector('[data-rotation="intervalMinutes"]') as HTMLInputElement;
    this.lastIntervalMinutes = this.config.rotation.intervalMinutes || 10;
    interval.value = String(this.lastIntervalMinutes);
    toggle.addEventListener('change', () => {
      this.config.rotation.enabled = toggle.checked;
      this.renderRotationList();
      this.queueSave();
    });
    cycle.addEventListener('change', () => {
      this.config.rotation.intervalMinutes = cycle.checked ? this.lastIntervalMinutes : 0;
      this.renderRotationList();
      this.queueSave();
    });
    interval.addEventListener('change', () => {
      this.lastIntervalMinutes = Math.max(1, Math.min(180, Math.round(Number(interval.value) || 10)));
      interval.value = String(this.lastIntervalMinutes);
      this.config.rotation.intervalMinutes = this.lastIntervalMinutes;
      this.renderRotationList();
      this.queueSave();
    });
    this.renderRotationList();
  }
  private setRotation(shaderId: string, include: boolean, preset?: string) {
    const entries = this.config.rotation.entries;
    const key = rotationEntryKey(shaderId, preset);
    const index = entries.findIndex(entry => rotationEntryKey(entry.shader, entry.preset) === key);
    if (include) {
      if (index === -1) entries.push(preset ? { shader: shaderId, preset } : { shader: shaderId });
    } else if (index !== -1) entries.splice(index, 1);
    if (!entries.length) this.config.rotation.enabled = false;
    this.renderRotationList();
    this.renderPresets();
  }
  private renderRotationList() {
    const list = this.element.querySelector('[data-rotation-list]') as HTMLUListElement;
    const empty = this.element.querySelector('[data-rotation-empty]') as HTMLElement;
    list.replaceChildren();
    const titles = new Map(this.manifests.map(m => [m.id, m.title]));
    empty.hidden = this.config.rotation.entries.length > 0;
    this.config.rotation.entries.forEach(entry => {
      const item = document.createElement('li');
      item.className = 'shuffle-item';
      const load = document.createElement('button');
      load.type = 'button';
      load.className = 'shuffle-load shuffle-item-label';
      const title = document.createElement('strong');
      title.textContent = titles.get(entry.shader) ?? entry.shader;
      const look = document.createElement('span');
      const missing = Boolean(entry.preset && !this.config.presets[entry.shader]?.[entry.preset]);
      look.textContent = missing ? `${entry.preset} · missing look` : entry.preset ?? 'Current edits';
      if (missing) look.className = 'look-missing';
      load.append(title, look);
      load.disabled = missing || !titles.has(entry.shader);
      load.setAttribute('aria-label', `Load ${title.textContent}, ${entry.preset ?? 'current edits'}`);
      load.addEventListener('click', () => this.loadShuffleEntry(entry.shader, entry.preset));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${title.textContent}, ${entry.preset ?? 'current edits'} from shuffle`);
      remove.addEventListener('click', () => { this.setRotation(entry.shader, false, entry.preset); this.queueSave(); });
      item.append(load, remove);
      list.append(item);
    });
    const count = this.config.rotation.entries.length;
    const toggle = this.element.querySelector('[data-rotation="enabled"]') as HTMLInputElement;
    const cycle = this.element.querySelector('[data-rotation="cycle"]') as HTMLInputElement;
    const interval = this.element.querySelector('[data-rotation="intervalMinutes"]') as HTMLInputElement;
    toggle.checked = this.config.rotation.enabled;
    cycle.checked = this.config.rotation.intervalMinutes > 0;
    cycle.disabled = !this.config.rotation.enabled;
    interval.disabled = !this.config.rotation.enabled || !cycle.checked;
    interval.value = String(this.lastIntervalMinutes);
    this.element.querySelector('[data-shuffle-count]')!.textContent = `${count} ${count === 1 ? 'look' : 'looks'}`;
    const summary = this.element.querySelector('[data-shuffle-summary]')!;
    summary.textContent = count === 0 ? 'Add a look to start shuffling.'
      : !this.config.rotation.enabled ? `${count} ${count === 1 ? 'look is' : 'looks are'} ready. Shuffle is off.`
      : this.config.rotation.intervalMinutes > 0
        ? `Shuffling ${count} ${count === 1 ? 'look' : 'looks'} on start and every ${this.config.rotation.intervalMinutes} minutes.`
        : `Shuffling ${count} ${count === 1 ? 'look' : 'looks'} when the screensaver starts.`;
  }
  private loadShuffleEntry(shaderId: string, preset?: string) {
    if (!this.manifests.some(manifest => manifest.id === shaderId)) return;
    const saved = preset ? this.config.presets[shaderId]?.[preset] : undefined;
    if (preset && !saved) return;
    if (saved) {
      const values = this.config.shaders[shaderId] ??= {};
      for (const key of Object.keys(values)) delete values[key];
      Object.assign(values, saved);
    }
    this.select(shaderId);
    const tab = this.element.querySelector('#shader-tab') as HTMLButtonElement;
    this.activateTab?.(tab, true);
    tab.focus();
    this.queueSave();
  }
  private renderControls() {
    const stored = this.config.shaders[this.shader.id] ??= {};
    mountShaderControls(this.controls, this.shader.uniforms, stored, () => { this.refreshPreviewValues(); this.queueSave(); },
      () => effectiveShaderValues(this.shader, stored, this.config.colors));
  }
  private randomize() {
    const stored = this.config.shaders[this.shader.id] ?? {};
    const protectedNames = schemeIdForShader(this.shader.id, this.config.colors)
      ? new Set(this.shader.uniforms.filter(u => u.type === 'color' || (u.type === 'select' && u.name === 'palette')).map(u => u.name))
      : undefined;
    this.replaceValues(randomizeUniforms(this.shader.uniforms, stored, Math.random, protectedNames));
    this.renderControls();
    this.queueSave();
  }
  private cancelLookUpdate() {
    this.pendingLookUpdate = undefined;
    (this.element.querySelector('[data-look-confirm]') as HTMLElement).hidden = true;
  }
  private lookMessage(message: string) {
    this.element.querySelector('[data-look-message]')!.textContent = message;
  }
  private savePreset(overwrite = false) {
    const input = this.element.querySelector('[data-preset]') as HTMLInputElement;
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const looks = this.config.presets[this.shader.id] ??= {};
    if (Object.hasOwn(looks, name) && !overwrite) {
      this.pendingLookUpdate = name;
      this.element.querySelector('[data-look-confirm-text]')!.textContent = `“${name}” already exists for ${this.shader.title}. Update it with your current edits?`;
      (this.element.querySelector('[data-look-confirm]') as HTMLElement).hidden = false;
      return;
    }
    if (overwrite && this.pendingLookUpdate !== name) return;
    looks[name] = { ...(this.config.shaders[this.shader.id] ?? {}) };
    input.value = '';
    this.cancelLookUpdate();
    this.lookMessage(overwrite ? `Updated “${name}”.` : `Saved “${name}”.`);
    this.renderPresets();
    this.renderRotationList();
    this.queueSave();
  }
  private renderPresets() {
    if (!this.shader) return;
    const shaderId = this.shader.id;
    this.element.querySelector('[data-look-shader]')!.textContent = this.shader.title;
    const currentButton = this.element.querySelector('[data-current-shuffle]') as HTMLButtonElement;
    const currentIncluded = this.config.rotation.entries.some(entry => entry.shader === shaderId && !entry.preset);
    currentButton.textContent = currentIncluded ? 'Remove from shuffle' : 'Add to shuffle';
    currentButton.setAttribute('aria-pressed', String(currentIncluded));
    currentButton.onclick = () => { this.setRotation(shaderId, !currentIncluded); this.queueSave(); };
    const list = this.element.querySelector('.preset-list')!;
    list.replaceChildren();
    const looks = this.config.presets[shaderId] ?? {};
    const names = Object.keys(looks);
    if (!names.length) {
      const empty = document.createElement('p');
      empty.className = 'look-empty';
      empty.textContent = 'No saved looks yet. Adjust this visual, then save a look to keep those settings.';
      list.append(empty);
    }
    for (const name of names) {
      const item = document.createElement('article');
      item.className = 'look-item';
      const heading = document.createElement('strong');
      heading.textContent = name;
      const actions = document.createElement('div');
      actions.className = 'look-item-actions';
      const apply = document.createElement('button');
      apply.type = 'button'; apply.textContent = 'Apply';
      apply.setAttribute('aria-label', `Apply ${name} to current edits`);
      apply.onclick = () => {
        this.replaceValues({ ...looks[name] });
        this.renderControls();
        this.refreshPreview();
        this.lookMessage(`Applied “${name}” to current edits. The saved look stays unchanged.`);
        this.queueSave();
      };
      const included = this.config.rotation.entries.some(entry => entry.shader === shaderId && entry.preset === name);
      const add = document.createElement('button');
      add.type = 'button'; add.textContent = included ? 'Remove from shuffle' : 'Add to shuffle';
      add.setAttribute('aria-pressed', String(included));
      add.setAttribute('aria-label', `${included ? 'Remove' : 'Add'} ${name} ${included ? 'from' : 'to'} shuffle`);
      add.onclick = () => { this.setRotation(shaderId, !included, name); this.queueSave(); };
      actions.append(apply, add);
      const more = document.createElement('details');
      more.className = 'look-more';
      const summary = document.createElement('summary'); summary.textContent = 'More actions';
      const menu = document.createElement('div'); menu.className = 'look-more-actions';
      const rename = document.createElement('button');
      rename.type = 'button'; rename.textContent = 'Rename look';
      rename.onclick = () => {
        more.open = false;
        this.showRenameLook(item, shaderId, name);
      };
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = 'Delete look';
      remove.onclick = () => {
        more.open = false;
        this.showDeleteLook(item, shaderId, name);
      };
      menu.append(rename, remove); more.append(summary, menu);
      item.append(heading, actions, more);
      list.append(item);
    }
  }
  private showRenameLook(item: HTMLElement, shaderId: string, oldName: string) {
    item.querySelector('.look-inline-action')?.remove();
    const form = document.createElement('form'); form.className = 'look-inline-action';
    const input = document.createElement('input'); input.type = 'text'; input.value = oldName; input.maxLength = 80;
    input.setAttribute('aria-label', `New name for ${oldName}`);
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Save name';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    cancel.onclick = () => form.remove();
    const error = document.createElement('p'); error.className = 'look-inline-error'; error.setAttribute('role', 'alert');
    form.onsubmit = event => {
      event.preventDefault();
      const nextName = input.value.trim();
      if (!nextName) { error.textContent = 'Enter a name.'; return; }
      const looks = this.config.presets[shaderId];
      if (nextName !== oldName && Object.hasOwn(looks, nextName)) { error.textContent = 'A look with that name already exists.'; return; }
      if (nextName !== oldName) {
        looks[nextName] = looks[oldName];
        delete looks[oldName];
        for (const entry of this.config.rotation.entries) if (entry.shader === shaderId && entry.preset === oldName) entry.preset = nextName;
        this.lookMessage(`Renamed “${oldName}” to “${nextName}”.`);
        this.renderPresets(); this.renderRotationList(); this.queueSave();
      } else form.remove();
    };
    form.append(input, save, cancel, error); item.append(form); input.focus(); input.select();
  }
  private showDeleteLook(item: HTMLElement, shaderId: string, name: string) {
    item.querySelector('.look-inline-action')?.remove();
    const confirm = document.createElement('div'); confirm.className = 'look-inline-action';
    const question = document.createElement('p'); question.textContent = `Delete “${name}”?`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    cancel.onclick = () => confirm.remove();
    remove.onclick = () => {
      const wasIncluded = this.config.rotation.entries.some(entry => entry.shader === shaderId && entry.preset === name);
      delete this.config.presets[shaderId][name];
      this.config.rotation.entries = this.config.rotation.entries.filter(entry => entry.shader !== shaderId || entry.preset !== name);
      if (!this.config.rotation.entries.length) this.config.rotation.enabled = false;
      this.lookMessage(`Deleted “${name}”${wasIncluded ? ' and removed it from shuffle' : ''}.`);
      this.renderPresets(); this.renderRotationList(); this.queueSave();
    };
    confirm.append(question, remove, cancel); item.append(confirm); remove.focus();
  }
  private queueSave() {
    this.status.textContent = 'Saving…';
    this.status.dataset.state = 'saving';
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try {
        await window.scrnsvr.setConfig(this.config);
        this.status.textContent = 'All changes saved locally';
        this.status.dataset.state = 'saved';
      } catch {
        this.status.textContent = 'Could not save changes';
        this.status.dataset.state = 'error';
      }
    }, 300);
  }
}

export function mountSettings(options: SettingsOptions): SettingsPanel { return new SettingsPanel(options); }

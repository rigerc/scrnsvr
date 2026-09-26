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
  private importingColors = false;
  private refreshSchemeVisuals: () => void = () => {};

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
    const activateTab = (tab: HTMLButtonElement) => {
      tabs.forEach(button => {
        const active = button === tab;
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        (this.element.querySelector(`#${button.dataset.tab}`) as HTMLElement).hidden = !active;
      });
      if (window.matchMedia('(max-width: 980px)').matches) {
        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
        this.element.querySelector('.inspector')?.scrollIntoView({ block: 'start', behavior });
      }
    };
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

      const rotate = document.createElement('label');
      rotate.className = 'rotate-toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.rotate = manifest.id;
      checkbox.setAttribute('aria-label', 'Include ' + manifest.title + ' in random rotation');
      checkbox.checked = this.config.rotation.entries.some(entry => entry.shader === manifest.id);
      card.classList.toggle('is-rotating', checkbox.checked);
      checkbox.addEventListener('change', () => {
        card.classList.toggle('is-rotating', checkbox.checked);
        this.setRotation(manifest.id, checkbox.checked);
        this.queueSave();
      });
      const caption = document.createElement('span');
      caption.textContent = 'Shuffle';
      rotate.append(checkbox, caption);
      card.append(select, rotate);
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
    this.element.querySelector('[data-action="save"]')!.addEventListener('click', () => this.savePreset());
    this.element.querySelector('[data-action="import-noctalia"]')!.addEventListener('click', () => void this.importNoctaliaColors());
    this.element.querySelector('[data-shader-scheme]')!.addEventListener('input', event => this.applyShaderScheme((event.target as HTMLSelectElement).value));
    this.select(this.config.shader);
  }
  private select(id: string) {
    this.shader = this.manifests.find(m => m.id === id) ?? this.manifests[0];
    if (!this.shader) return;
    this.config.shader = this.shader.id;
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
    this.stopPreview = this.preview
      ? this.preview.mount(canvas, this.shader, effectiveShaderValues(this.shader, stored, this.config.colors))
      : this.animateFallback(canvas);
  }
  private replaceValues(next: Record<string, Value>) {
    // Both the large preview and thumbnail keep reading this same object.
    const values = this.config.shaders[this.shader.id] ??= {};
    for (const key of Object.keys(values)) delete values[key];
    Object.assign(values, next);
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
      if (this.shader.id === shader.id) this.renderControls();
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
    toggle.checked = this.config.rotation.enabled;
    toggle.addEventListener('change', () => { this.config.rotation.enabled = toggle.checked; this.renderRotationList(); this.queueSave(); });
    const interval = this.element.querySelector('[data-rotation="intervalMinutes"]') as HTMLInputElement;
    interval.value = String(this.config.rotation.intervalMinutes);
    interval.addEventListener('input', () => {
      this.config.rotation.intervalMinutes = Math.max(0, Math.min(180, Math.round(Number(interval.value) || 0)));
      this.queueSave();
    });
    this.renderRotationList();
  }
  private setRotation(shaderId: string, include: boolean, preset?: string) {
    const entries = this.config.rotation.entries;
    const index = entries.findIndex(e => e.shader === shaderId);
    if (include) {
      if (index === -1) entries.push(preset ? { shader: shaderId, preset } : { shader: shaderId });
      else if (preset !== undefined) { if (preset) entries[index]!.preset = preset; else delete entries[index]!.preset; }
    } else if (index !== -1) entries.splice(index, 1);
    // Keep the card checkbox and the rotation list in sync.
    const card = this.element.querySelector(`[data-rotate="${shaderId}"]`) as HTMLInputElement | null;
    if (card) {
      card.checked = include;
      card.closest('.shader-card')?.classList.toggle('is-rotating', include);
    }
    this.renderRotationList();
  }
  private renderRotationList() {
    const list = this.element.querySelector('[data-rotation-list]') as HTMLUListElement;
    const empty = this.element.querySelector('[data-rotation-empty]') as HTMLElement;
    list.innerHTML = '';
    const titles = new Map(this.manifests.map(m => [m.id, m.title]));
    empty.hidden = this.config.rotation.entries.length > 0;
    this.config.rotation.entries.forEach((entry, index) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = titles.get(entry.shader) ?? entry.shader;
      const presetSelect = document.createElement('select');
      presetSelect.setAttribute('aria-label', `Preset for ${label.textContent}`);
      const blank = document.createElement('option'); blank.value = ''; blank.textContent = 'Current settings';
      presetSelect.append(blank);
      Object.keys(this.config.presets[entry.shader] ?? {}).forEach(name => {
        const option = document.createElement('option'); option.value = name; option.textContent = name;
        presetSelect.append(option);
      });
      presetSelect.value = entry.preset ?? '';
      presetSelect.addEventListener('change', () => {
        if (presetSelect.value) entry.preset = presetSelect.value;
        else delete entry.preset;
        this.queueSave();
      });
      const remove = document.createElement('button'); remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${label.textContent} from rotation`);
      remove.addEventListener('click', () => { this.setRotation(entry.shader, false); this.queueSave(); });
      item.append(label, presetSelect, remove);
      void index;
      list.append(item);
    });
  }
  private renderControls() {
    const stored = this.config.shaders[this.shader.id] ??= {};
    mountShaderControls(this.controls, this.shader.uniforms, stored, () => this.queueSave(),
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
  private savePreset() { const input=this.element.querySelector('[data-preset]') as HTMLInputElement; const name=input.value.trim(); if(!name)return; (this.config.presets[this.shader.id]??={})[name]={...(this.config.shaders[this.shader.id]??{})}; input.value=''; this.renderPresets(); this.renderRotationList(); this.queueSave(); }
  private renderPresets() { const list=this.element.querySelector('.preset-list')!; list.innerHTML=''; Object.keys(this.config.presets[this.shader.id]??{}).forEach(name=>{const wrap=document.createElement('span');const b=document.createElement('button');b.textContent=name;b.onclick=()=>{this.replaceValues({...this.config.presets[this.shader.id][name]});this.renderControls();this.queueSave();};const add=document.createElement('button');add.textContent='+ shuffle';add.setAttribute('aria-label',`Add ${name} to rotation`);add.onclick=()=>{this.setRotation(this.shader.id,true,name);this.queueSave();};const del=document.createElement('button');del.textContent='×';del.setAttribute('aria-label',`Delete ${name}`);del.onclick=()=>{delete this.config.presets[this.shader.id][name];for(const entry of this.config.rotation.entries)if(entry.shader===this.shader.id&&entry.preset===name)delete entry.preset;this.renderPresets();this.renderRotationList();this.queueSave();};wrap.append(b,add,del);list.append(wrap);}); }
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

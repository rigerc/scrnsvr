import type { Config } from '../shared/config';
import { shaderCategories, type ShaderManifest } from '../shared/manifest';
import { noctaliaShaderValues } from '../shared/noctalia';
import { defaultClockConfig } from '../shared/clock';
import { mountClock } from '../renderer/core/clock';
import { mountClockControls } from './clock';
import { mountShaderControls } from './shader-controls';
import { randomizeUniforms } from '../renderer/core/uniforms';

type Value = number | boolean | string;
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

  constructor(options: SettingsOptions) {
    this.manifests = options.manifests;
    this.preview = options.preview;
    this.config = options.initial ?? ({ shader: this.manifests[0]?.id ?? 'flow-field', fps: 60, monitor: 'primary', kiosk: true, settings: true, global: { idleThresholdSeconds: 300, fps: 60, fadeSeconds: 1, inhibitOnAudio: false, inhibitOnFullscreen: true, monitors: 'primary' }, clock: defaultClockConfig, rotation: { enabled: false, entries: [], intervalMinutes: 0 }, shaders: {}, presets: {} } as Config);
    this.config.clock = { ...defaultClockConfig, ...this.config.clock };
    this.config.rotation ??= { enabled: false, entries: [], intervalMinutes: 0 };
    this.element = options.root;
    this.element.className = 'scrnsvr-settings';
    this.render();
  }
  private render() {
    this.element.innerHTML = `
      <header><div><small>SCRNSVR / SETTINGS</small><h1>Shape your atmosphere</h1></div><button data-action="random">Randomize</button></header>
      <section class="editor" aria-label="Shader editor">
        <div class="preview-column">
          <section class="preview-panel" aria-labelledby="preview-title">
            <div class="preview-heading"><h2 id="preview-title"></h2><span class="live-badge">Live preview</span></div>
            <div class="clock-stage"><canvas class="preview" width="720" height="405" aria-label="Live shader preview"></canvas></div>
            <p class="preview-description"></p>
          </section>
          <h2 class="gallery-heading">Choose a shader</h2>
          <p class="rotation-hint">Click a shader to edit it. Tick <strong>Rotate</strong> to include it in the random shuffle when the screensaver opens.</p>
          <section class="shader-categories" aria-label="Shaders"></section>
          <section class="rotation" aria-label="Random rotation">
            <label class="clock-toggle"><input type="checkbox" data-rotation="enabled">Shuffle on open</label>
            <label class="rotation-interval">Change shader every <input type="number" data-rotation="intervalMinutes" min="0" max="180" step="1"> min <span data-rotation-interval-hint>(0 = only on open)</span></label>
            <ul class="rotation-list" data-rotation-list></ul>
            <p class="rotation-empty" data-rotation-empty hidden>No shaders selected — the saved shader plays instead.</p>
          </section>
        </div>
        <div class="editor-sidebar">
          <div class="editor-tabs" role="tablist" aria-label="Preview controls">
            <button id="shader-tab" role="tab" aria-selected="true" aria-controls="shader-settings" data-tab="shader-settings">Shader</button>
            <button id="clock-tab" role="tab" aria-selected="false" aria-controls="clock-settings" tabindex="-1" data-tab="clock-settings">Clock</button>
          </div>
          <div id="shader-settings" class="shader-settings" role="tabpanel" aria-labelledby="shader-tab">
          <section class="controls" aria-label="Shader controls"></section>
          <section class="color-import" aria-label="Import colors">
            <button data-action="import-noctalia">Import Noctalia colors</button>
            <p data-import-status role="status">Apply your desktop palette to this shader.</p>
          </section>
          <aside><h2>Presets</h2><div class="preset-row"><input data-preset aria-label="Preset name" placeholder="Preset name"/><button data-action="save">Save</button></div><div class="preset-list"></div></aside>
          </div>
          <section id="clock-settings" class="clock-settings" role="tabpanel" aria-labelledby="clock-tab" hidden></section>
        </div>
      </section>
      <section class="global" aria-label="Global settings"><label>Idle threshold (seconds)<input data-global="idleThresholdSeconds" type="number" min="0" step="1"></label><label>Frame rate <output data-output="fps"></output><input data-global="fps" type="range" min="1" max="240" step="1"></label><label>Fade in/out <output data-output="fadeSeconds"></output><input data-global="fadeSeconds" type="range" min="0" max="5" step="0.1"></label><label>Monitors<select data-global="monitors"><option value="primary">Primary monitor</option><option value="all">All monitors</option></select></label><label class="clock-toggle"><input data-global-check="inhibitOnAudio" type="checkbox">Don't start while audio is playing</label><label class="clock-toggle"><input data-global-check="inhibitOnFullscreen" type="checkbox">Don't start over fullscreen apps</label></section>
      <footer><span data-status role="status">All changes saved locally</span><button data-action="reset">Reset shader</button></footer>`;
    this.controls = this.element.querySelector('.controls')!; this.status = this.element.querySelector('[data-status]')!;
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
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activateTab(tab));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + 1) % tabs.length];
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
    }, { rootMargin: '180px 0px' });
    window.addEventListener('pagehide', () => {
      thumbnailObserver.disconnect();
      thumbnailStates.forEach(releaseThumbnail);
    }, { once: true });
    for (const category of shaderCategories) {
      const shaders = this.manifests
        .filter(shader => (shader.category ?? 'Abstract') === category)
        .sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base', numeric: true }));
      if (!shaders.length) continue;
      const section = document.createElement('section');
      section.className = 'shader-category';
      section.dataset.category = category;
      const heading = document.createElement('h3');
      heading.id = `shader-category-${category.toLowerCase()}`;
      heading.textContent = category;
      const count = document.createElement('span');
      count.className = 'shader-category-count';
      count.textContent = String(shaders.length);
      count.setAttribute('aria-label', `${shaders.length} shaders`);
      heading.append(count);
      section.setAttribute('aria-labelledby', heading.id);
      const grid = document.createElement('div');
      grid.className = 'gallery';
      section.append(heading, grid);
      gallery.append(section);
      shaders.forEach(m => {
        const b = document.createElement('button'); b.className = 'shader-card'; b.dataset.id = m.id;
        const c = document.createElement('canvas'); c.width = 180; c.height = 90; c.setAttribute('aria-label', `${m.title} live thumbnail`); b.append(c);
        const title = document.createElement('strong'); title.textContent = m.title; b.append(title);
        const rotate = document.createElement('label'); rotate.className = 'rotate-toggle';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.rotate = m.id;
        checkbox.setAttribute('aria-label', `Include ${m.title} in random rotation`);
        checkbox.checked = this.config.rotation.entries.some(e => e.shader === m.id);
        checkbox.addEventListener('change', () => { this.setRotation(m.id, checkbox.checked); this.queueSave(); });
        const caption = document.createElement('span'); caption.textContent = 'Rotate';
        rotate.append(checkbox, caption);
        rotate.addEventListener('click', (event) => event.stopPropagation());
        b.append(rotate);
        b.onclick = () => { this.select(m.id); this.queueSave(); };
        grid.append(b);
        const values = this.config.shaders[m.id] ??= {};
        thumbnailStates.set(b, { canvas: c, manifest: m, values });
        thumbnailObserver.observe(b);
      });
    }
    this.bindRotation();
    this.bindGlobals();
    this.element.querySelector('[data-action="random"]')!.addEventListener('click', () => this.randomize());
    this.element.querySelector('[data-action="reset"]')!.addEventListener('click', () => { this.replaceValues({}); this.renderControls(); this.queueSave(); });
    this.element.querySelector('[data-action="save"]')!.addEventListener('click', () => this.savePreset());
    this.element.querySelector('[data-action="import-noctalia"]')!.addEventListener('click', () => void this.importNoctaliaColors());
    this.select(this.config.shader);
  }
  private select(id: string) {
    this.shader = this.manifests.find(m => m.id === id) ?? this.manifests[0];
    if (!this.shader) return;
    this.config.shader = this.shader.id;
    this.element.querySelector('#preview-title')!.textContent = this.shader.title;
    this.element.querySelector('.preview-description')!.textContent = this.shader.description ?? 'Adjust the controls to see your changes here immediately.';
    this.renderControls();
    this.updateColorImport();
    this.element.querySelector('[data-import-status]')!.textContent = this.shader.uniforms.some(u => u.type === 'color')
      ? 'Apply your desktop palette to this shader.'
      : 'This shader uses a built-in palette. Choose a shader with color controls to import colors.';
    this.element.querySelectorAll('.shader-card').forEach(card => {
      const selected = (card as HTMLElement).dataset.id === this.shader.id;
      card.classList.toggle('active', selected);
      card.setAttribute('aria-pressed', String(selected));
    });
    this.renderPresets();
    this.refreshPreview();
  }
  private refreshPreview() {
    this.stopPreview?.();
    const canvas = this.element.querySelector('.preview') as HTMLCanvasElement;
    this.stopPreview = this.preview
      ? this.preview.mount(canvas, this.shader, this.config.shaders[this.shader.id] ??= {})
      : this.animateFallback(canvas);
  }
  private replaceValues(next: Record<string, Value>) {
    // Both the large preview and thumbnail keep reading this same object.
    const values = this.config.shaders[this.shader.id] ??= {};
    for (const key of Object.keys(values)) delete values[key];
    Object.assign(values, next);
  }
  private updateColorImport() {
    const button = this.element.querySelector('[data-action="import-noctalia"]') as HTMLButtonElement;
    button.disabled = this.importingColors || !this.shader.uniforms.some(u => u.type === 'color');
    button.textContent = this.importingColors ? 'Importing…' : 'Import Noctalia colors';
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
  private bindGlobals(){const g=this.config.global; (this.element.querySelector('[data-global="idleThresholdSeconds"]') as HTMLInputElement).value=String(g.idleThresholdSeconds); const fps=this.element.querySelector('[data-global="fps"]') as HTMLInputElement;fps.value=String(g.fps);this.element.querySelector('[data-output="fps"]')!.textContent=`${g.fps} FPS`; const fade=this.element.querySelector('[data-global="fadeSeconds"]') as HTMLInputElement;fade.value=String(g.fadeSeconds);this.element.querySelector('[data-output="fadeSeconds"]')!.textContent=`${g.fadeSeconds}s`; (this.element.querySelector('[data-global="monitors"]') as HTMLSelectElement).value=g.monitors; this.element.querySelectorAll('[data-global]').forEach(x=>x.addEventListener('input',()=>{const key=(x as HTMLElement).dataset.global as keyof typeof g; const v=key==='monitors'?(x as HTMLSelectElement).value:Number((x as HTMLInputElement).value);(this.config.global as any)[key]=v;if(key==='fps')this.element.querySelector('[data-output="fps"]')!.textContent=`${v} FPS`;if(key==='fadeSeconds')this.element.querySelector('[data-output="fadeSeconds"]')!.textContent=`${v}s`;this.queueSave();})); this.element.querySelectorAll<HTMLInputElement>('[data-global-check]').forEach(x=>{const key=x.dataset.globalCheck as 'inhibitOnAudio'|'inhibitOnFullscreen';x.checked=Boolean(g[key]);x.addEventListener('change',()=>{g[key]=x.checked;this.queueSave();});});}
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
    if (card) card.checked = include;
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
    mountShaderControls(this.controls, this.shader.uniforms, this.config.shaders[this.shader.id] ??= {}, () => this.queueSave());
  }
  private randomize() {
    this.replaceValues(randomizeUniforms(this.shader.uniforms, this.config.shaders[this.shader.id] ?? {}));
    this.renderControls();
    this.queueSave();
  }
  private savePreset() { const input=this.element.querySelector('[data-preset]') as HTMLInputElement; const name=input.value.trim(); if(!name)return; (this.config.presets[this.shader.id]??={})[name]={...(this.config.shaders[this.shader.id]??{})}; input.value=''; this.renderPresets(); this.renderRotationList(); this.queueSave(); }
  private renderPresets() { const list=this.element.querySelector('.preset-list')!; list.innerHTML=''; Object.keys(this.config.presets[this.shader.id]??{}).forEach(name=>{const wrap=document.createElement('span');const b=document.createElement('button');b.textContent=name;b.onclick=()=>{this.replaceValues({...this.config.presets[this.shader.id][name]});this.renderControls();this.queueSave();};const add=document.createElement('button');add.textContent='+ shuffle';add.setAttribute('aria-label',`Add ${name} to rotation`);add.onclick=()=>{this.setRotation(this.shader.id,true,name);this.queueSave();};const del=document.createElement('button');del.textContent='×';del.setAttribute('aria-label',`Delete ${name}`);del.onclick=()=>{delete this.config.presets[this.shader.id][name];for(const entry of this.config.rotation.entries)if(entry.shader===this.shader.id&&entry.preset===name)delete entry.preset;this.renderPresets();this.renderRotationList();this.queueSave();};wrap.append(b,add,del);list.append(wrap);}); }
  private queueSave() { this.status.textContent='Saving…'; if(this.timer)clearTimeout(this.timer); this.timer=setTimeout(async()=>{try{await window.scrnsvr.setConfig(this.config);this.status.textContent='All changes saved locally';}catch{this.status.textContent='Could not save changes';}},300); }
}

export function mountSettings(options: SettingsOptions): SettingsPanel { return new SettingsPanel(options); }

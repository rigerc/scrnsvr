import type { Config } from '../shared/config';
import type { ShaderManifest, UniformManifest } from '../shared/manifest';
import { noctaliaShaderValues } from '../shared/noctalia';
import { defaultClockConfig } from '../shared/clock';
import { mountClock } from '../renderer/core/clock';
import { mountClockControls } from './clock';

type Value = number | boolean | string;
export interface PreviewRuntime { mount(canvas: HTMLCanvasElement, shader: ShaderManifest, values: Record<string, Value>): () => void; }
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
  private readonly stopThumbnails: Array<() => void> = [];
  private importingColors = false;

  constructor(options: SettingsOptions) {
    this.manifests = options.manifests;
    this.preview = options.preview;
    this.config = options.initial ?? ({ shader: this.manifests[0]?.id ?? 'flow-field', fps: 60, monitor: 'primary', kiosk: true, settings: true, global: { idleThresholdSeconds: 300, fps: 60, fadeSeconds: 1, monitors: 'primary' }, shaders: {}, presets: {} } as Config);
    this.config.clock = { ...defaultClockConfig, ...this.config.clock };
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
          <section class="gallery" aria-label="Shaders"></section>
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
      <section class="global" aria-label="Global settings"><label>Idle threshold (seconds)<input data-global="idleThresholdSeconds" type="number" min="0" step="1"></label><label>Frame rate <output data-output="fps"></output><input data-global="fps" type="range" min="1" max="240" step="1"></label><label>Fade in/out <output data-output="fadeSeconds"></output><input data-global="fadeSeconds" type="range" min="0" max="5" step="0.1"></label><label>Monitors<select data-global="monitors"><option value="primary">Primary monitor</option><option value="all">All monitors</option></select></label></section>
      <footer><span data-status role="status">All changes saved locally</span><button data-action="reset">Reset shader</button></footer>`;
    this.controls = this.element.querySelector('.controls')!; this.status = this.element.querySelector('[data-status]')!;
    const clock = mountClock(this.element.querySelector('.clock-stage') as HTMLElement, this.config.clock);
    mountClockControls(this.element.querySelector('#clock-settings') as HTMLElement, this.config.clock, () => {
      clock.update(this.config.clock);
      this.queueSave();
    });
    window.addEventListener('pagehide', () => clock.destroy(), { once: true });
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
    const gallery = this.element.querySelector('.gallery')!;
    this.manifests.forEach(m => { const b = document.createElement('button'); b.className = 'shader-card'; b.dataset.id = m.id; const c=document.createElement('canvas'); c.width=180;c.height=90;c.setAttribute('aria-label',`${m.title} live thumbnail`); b.append(c); const title=document.createElement('strong');title.textContent=m.title;b.append(title); b.onclick = () => { this.select(m.id); this.queueSave(); }; gallery.append(b); const values=this.config.shaders[m.id]??={}; if(this.preview)this.stopThumbnails.push(this.preview.mount(c,m,values)); else this.stopThumbnails.push(this.animateFallback(c)); });
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
  private bindGlobals(){const g=this.config.global; (this.element.querySelector('[data-global="idleThresholdSeconds"]') as HTMLInputElement).value=String(g.idleThresholdSeconds); const fps=this.element.querySelector('[data-global="fps"]') as HTMLInputElement;fps.value=String(g.fps);this.element.querySelector('[data-output="fps"]')!.textContent=`${g.fps} FPS`; const fade=this.element.querySelector('[data-global="fadeSeconds"]') as HTMLInputElement;fade.value=String(g.fadeSeconds);this.element.querySelector('[data-output="fadeSeconds"]')!.textContent=`${g.fadeSeconds}s`; (this.element.querySelector('[data-global="monitors"]') as HTMLSelectElement).value=g.monitors; this.element.querySelectorAll('[data-global]').forEach(x=>x.addEventListener('input',()=>{const key=(x as HTMLElement).dataset.global as keyof typeof g; const v=key==='monitors'?(x as HTMLSelectElement).value:Number((x as HTMLInputElement).value);(this.config.global as any)[key]=v;if(key==='fps')this.element.querySelector('[data-output="fps"]')!.textContent=`${v} FPS`;if(key==='fadeSeconds')this.element.querySelector('[data-output="fadeSeconds"]')!.textContent=`${v}s`;this.queueSave();}));}
  private value(u: UniformManifest): Value { return this.config.shaders[this.shader.id]?.[u.name] ?? u.default; }
  private renderControls() { this.controls.innerHTML = '<h2>Adjust shader</h2>'; this.shader.uniforms.forEach(u => { const row=document.createElement('label'); row.className='control'; row.innerHTML=`<span>${u.name}</span>`; let input: HTMLInputElement|HTMLSelectElement; if(u.type==='select'){ input=document.createElement('select'); (u.options??[]).forEach(x=>{const o=document.createElement('option');o.value=x;o.textContent=x;input.append(o);}); } else { input=document.createElement('input'); input.type=u.type==='bool'?'checkbox':u.type==='color'?'color': 'range'; if(u.type==='int'||u.type==='float'){input.min=String(u.min??0);input.max=String(u.max??1);input.step=u.type==='int'?'1':'0.01';} } input.dataset.name=u.name; input.value=String(this.value(u)); if(input instanceof HTMLInputElement && u.type==='bool') input.checked=Boolean(this.value(u)); input.oninput=()=>{let v:Value=input instanceof HTMLInputElement&&u.type==='bool'?input.checked:(u.type==='int'||u.type==='float'?Number(input.value):input.value);(this.config.shaders[this.shader.id]??={})[u.name]=v;this.queueSave();}; row.append(input); this.controls.append(row); }); }
  private randomize() { const values: Record<string,Value> = {}; this.shader.uniforms.forEach(u => values[u.name]=u.type==='bool'?Math.random()>.5:u.type==='select'?(u.options??[])[Math.floor(Math.random()*(u.options?.length??1))]??u.default:u.type==='color'?`#${Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0')}`:Math.round(((u.min??0)+Math.random()*((u.max??1)-(u.min??0)))*(u.type==='int'?1:100))/ (u.type==='int'?1:100)); this.replaceValues(values); this.renderControls(); this.queueSave(); }
  private savePreset() { const input=this.element.querySelector('[data-preset]') as HTMLInputElement; const name=input.value.trim(); if(!name)return; (this.config.presets[this.shader.id]??={})[name]={...(this.config.shaders[this.shader.id]??{})}; input.value=''; this.renderPresets(); this.queueSave(); }
  private renderPresets() { const list=this.element.querySelector('.preset-list')!; list.innerHTML=''; Object.keys(this.config.presets[this.shader.id]??{}).forEach(name=>{const wrap=document.createElement('span');const b=document.createElement('button');b.textContent=name;b.onclick=()=>{this.replaceValues({...this.config.presets[this.shader.id][name]});this.renderControls();this.queueSave();};const del=document.createElement('button');del.textContent='×';del.setAttribute('aria-label',`Delete ${name}`);del.onclick=()=>{delete this.config.presets[this.shader.id][name];this.renderPresets();this.queueSave();};wrap.append(b,del);list.append(wrap);}); }
  private queueSave() { this.status.textContent='Saving…'; if(this.timer)clearTimeout(this.timer); this.timer=setTimeout(async()=>{try{await window.scrnsvr.setConfig(this.config);this.status.textContent='All changes saved locally';}catch{this.status.textContent='Could not save changes';}},300); }
}

export function mountSettings(options: SettingsOptions): SettingsPanel { return new SettingsPanel(options); }

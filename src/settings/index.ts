import type { Config } from '../shared/config';
import type { ShaderManifest, UniformManifest } from '../shared/manifest';

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

  constructor(options: SettingsOptions) {
    this.manifests = options.manifests;
    this.preview = options.preview;
    this.config = options.initial ?? ({ shader: this.manifests[0]?.id ?? 'flow-field', fps: 60, monitor: 'primary', kiosk: true, settings: true, global: { idleThresholdSeconds: 300, fps: 60, monitors: 'primary' }, shaders: {}, presets: {} } as Config);
    this.element = options.root;
    this.element.className = 'scrnsvr-settings';
    this.render();
  }
  private render() {
    this.element.innerHTML = `<header><div><small>SCRNSVR / SETTINGS</small><h1>Shape your atmosphere</h1></div><button data-action="random">Randomize</button></header><section class="global" aria-label="Global settings"><label>Idle threshold (seconds)<input data-global="idleThresholdSeconds" type="number" min="0" step="1"></label><label>Frame rate <output data-output="fps"></output><input data-global="fps" type="range" min="1" max="240" step="1"></label><label>Monitors<select data-global="monitors"><option value="primary">Primary monitor</option><option value="all">All monitors</option></select></label></section><section class="gallery" aria-label="Shaders"></section><section class="editor"><div><canvas class="preview" width="720" height="360" aria-label="Live shader preview"></canvas><div class="controls"></div></div><aside><h2>Presets</h2><div class="preset-row"><input data-preset aria-label="Preset name" placeholder="Preset name"/><button data-action="save">Save</button></div><div class="preset-list"></div></aside></section><footer><span data-status role="status">All changes saved locally</span><button data-action="reset">Reset shader</button></footer>`;
    this.controls = this.element.querySelector('.controls')!; this.status = this.element.querySelector('[data-status]')!;
    const gallery = this.element.querySelector('.gallery')!;
    this.manifests.forEach(m => { const b = document.createElement('button'); b.className = 'shader-card'; b.dataset.id = m.id; const c=document.createElement('canvas'); c.width=180;c.height=90;c.setAttribute('aria-label',`${m.title} live thumbnail`); b.append(c); const title=document.createElement('strong');title.textContent=m.title;b.append(title); b.onclick = () => { this.select(m.id); this.queueSave(); }; gallery.append(b); const values=this.config.shaders[m.id]??{}; if(this.preview)this.stopThumbnails.push(this.preview.mount(c,m,values)); else this.animateFallback(c,m); });
    this.bindGlobals();
    this.element.querySelector('[data-action="random"]')!.addEventListener('click', () => this.randomize());
    this.element.querySelector('[data-action="reset"]')!.addEventListener('click', () => { this.config.shaders[this.shader.id] = {}; this.renderControls(); this.refreshPreview(); this.queueSave(); });
    this.element.querySelector('[data-action="save"]')!.addEventListener('click', () => this.savePreset());
    this.select(this.config.shader);
  }
  private select(id: string) { this.shader = this.manifests.find(m => m.id === id) ?? this.manifests[0]; if (!this.shader) return; this.config.shader = this.shader.id; this.renderControls(); this.element.querySelectorAll('.shader-card').forEach(x => x.classList.toggle('active', (x as HTMLElement).dataset.id === this.shader.id)); this.renderPresets(); this.refreshPreview(); }
  private refreshPreview() { if(this.stopPreview)this.stopPreview(); const canvas=this.element.querySelector('.preview') as HTMLCanvasElement; if(this.preview)this.stopPreview=this.preview.mount(canvas,this.shader,this.config.shaders[this.shader.id]??{}); else this.animateFallback(canvas,this.shader); }
  private animateFallback(canvas: HTMLCanvasElement, shader: ShaderManifest) { const ctx=canvas.getContext('2d'); if(!ctx)return; let frame=0; const draw=()=>{frame++;ctx.fillStyle='#081321';ctx.fillRect(0,0,canvas.width,canvas.height);for(let i=0;i<12;i++){ctx.beginPath();ctx.strokeStyle=`hsl(${(frame+i*24)%360} 80% 65% / .5)`;ctx.lineWidth=2;ctx.arc(canvas.width/2,canvas.height/2,20+i*15+Math.sin(frame/25+i)*12,0,Math.PI*2);ctx.stroke();} requestAnimationFrame(draw)}; draw(); }
  private bindGlobals(){const g=this.config.global; (this.element.querySelector('[data-global="idleThresholdSeconds"]') as HTMLInputElement).value=String(g.idleThresholdSeconds); const fps=this.element.querySelector('[data-global="fps"]') as HTMLInputElement;fps.value=String(g.fps);this.element.querySelector('[data-output="fps"]')!.textContent=`${g.fps} FPS`; (this.element.querySelector('[data-global="monitors"]') as HTMLSelectElement).value=g.monitors; this.element.querySelectorAll('[data-global]').forEach(x=>x.addEventListener('input',()=>{const key=(x as HTMLElement).dataset.global as keyof typeof g; const v=key==='monitors'?(x as HTMLSelectElement).value:Number((x as HTMLInputElement).value);(this.config.global as any)[key]=v;if(key==='fps')this.element.querySelector('[data-output="fps"]')!.textContent=`${v} FPS`;this.queueSave();}));}
  private value(u: UniformManifest): Value { return this.config.shaders[this.shader.id]?.[u.name] ?? u.default; }
  private renderControls() { this.controls.innerHTML = `<h2>${this.shader.title}</h2>`; this.shader.uniforms.forEach(u => { const row=document.createElement('label'); row.className='control'; row.innerHTML=`<span>${u.name}</span>`; let input: HTMLInputElement|HTMLSelectElement; if(u.type==='select'){ input=document.createElement('select'); (u.options??[]).forEach(x=>{const o=document.createElement('option');o.value=x;o.textContent=x;input.append(o);}); } else { input=document.createElement('input'); input.type=u.type==='bool'?'checkbox':u.type==='color'?'color': 'range'; if(u.type==='int'||u.type==='float'){input.min=String(u.min??0);input.max=String(u.max??1);input.step=u.type==='int'?'1':'0.01';} } input.dataset.name=u.name; input.value=String(this.value(u)); if(input instanceof HTMLInputElement && u.type==='bool') input.checked=Boolean(this.value(u)); input.oninput=()=>{let v:Value=input instanceof HTMLInputElement&&u.type==='bool'?input.checked:(u.type==='int'||u.type==='float'?Number(input.value):input.value);(this.config.shaders[this.shader.id]??={})[u.name]=v;this.queueSave();}; row.append(input); this.controls.append(row); }); }
  private randomize() { const values: Record<string,Value> = {}; this.shader.uniforms.forEach(u => values[u.name]=u.type==='bool'?Math.random()>.5:u.type==='select'?(u.options??[])[Math.floor(Math.random()*(u.options?.length??1))]??u.default:u.type==='color'?`#${Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0')}`:Math.round(((u.min??0)+Math.random()*((u.max??1)-(u.min??0)))*(u.type==='int'?1:100))/ (u.type==='int'?1:100)); this.config.shaders[this.shader.id]=values; this.renderControls(); this.refreshPreview(); this.queueSave(); }
  private savePreset() { const input=this.element.querySelector('[data-preset]') as HTMLInputElement; const name=input.value.trim(); if(!name)return; (this.config.presets[this.shader.id]??={})[name]={...(this.config.shaders[this.shader.id]??{})}; input.value=''; this.renderPresets(); this.queueSave(); }
  private renderPresets() { const list=this.element.querySelector('.preset-list')!; list.innerHTML=''; Object.keys(this.config.presets[this.shader.id]??{}).forEach(name=>{const wrap=document.createElement('span');const b=document.createElement('button');b.textContent=name;b.onclick=()=>{this.config.shaders[this.shader.id]={...this.config.presets[this.shader.id][name]};this.renderControls();this.refreshPreview();this.queueSave();};const del=document.createElement('button');del.textContent='×';del.setAttribute('aria-label',`Delete ${name}`);del.onclick=()=>{delete this.config.presets[this.shader.id][name];this.renderPresets();this.queueSave();};wrap.append(b,del);list.append(wrap);}); }
  private queueSave() { this.status.textContent='Saving…'; if(this.timer)clearTimeout(this.timer); this.timer=setTimeout(async()=>{try{await window.scrnsvr.setConfig(this.config);this.status.textContent='All changes saved locally';}catch{this.status.textContent='Could not save changes';}},300); }
}

export function mountSettings(options: SettingsOptions): SettingsPanel { return new SettingsPanel(options); }

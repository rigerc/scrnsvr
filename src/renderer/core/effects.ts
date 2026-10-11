import { Mesh, Program, RenderTarget, Renderer, Texture, Triangle } from 'ogl';
import { MAX_EFFECT_LAYERS, resolveEffectValues, type EffectDefinition, type EffectLayer, type EffectRuntimeOptions } from '../../shared/effects';
import { effectRegistry } from '../effects';
import { AnimationClock } from './animation-clock';

const vertex = 'attribute vec2 uv; attribute vec2 position; varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,0.,1.);}';
const copySource = 'precision highp float; uniform sampler2D uInput; varying vec2 vUv; void main(){gl_FragColor=texture2D(uInput,vUv);}';
interface MountedLayer {
  effectId: string;
  definition?: EffectDefinition;
  programs: Program[];
  meshes: Mesh[];
  failed?: boolean;
  history: RenderTarget[];
  historyIndex: number;
  historyValid: boolean;
}

/** OGL does not delete shaders or evict uniform locations when removing a program. */
export function disposeProgram(renderer: Renderer, program: Program) {
  for (const location of program.uniformLocations?.values() ?? []) renderer.state.uniformLocations.delete(location);
  renderer.gl.deleteShader(program.vertexShader);
  renderer.gl.deleteShader(program.fragmentShader);
  if (renderer.state.currentProgram === program.id) renderer.state.currentProgram = null;
  program.remove();
}

/** One controller per base mount; edits reconcile instances without restarting either timeline. */
export class EffectStack {
  private readonly mounted = new Map<string, MountedLayer>();
  private readonly warned = new Set<string>();
  private readonly clock = new AnimationClock();
  private geometry?: Triangle;
  private copy?: Mesh;
  private targets: RenderTarget[] = [];
  private active: { layer: EffectLayer; mounted: MountedLayer; values: Record<string, unknown> }[] = [];
  private signature = '';
  private failedTargets = '';

  constructor(private readonly renderer: Renderer, private readonly options?: EffectRuntimeOptions) {}

  /** Called even on paused frames, before the playback gate decides whether to redraw. */
  reconcile(): boolean {
    const config = this.options?.effects;
    const signature = JSON.stringify(config) ?? '';
    const changed = signature !== this.signature;
    this.signature = signature;
    if (changed) {
      this.failedTargets = '';
      for (const entry of this.mounted.values()) {
        entry.historyValid = false;
        entry.failed = false;
      }
    }
    const layers = config?.layers.slice(0, MAX_EFFECT_LAYERS) ?? [];
    const ids = new Set(layers.map(layer => layer.id));
    for (const [id, entry] of this.mounted) {
      if (ids.has(id)) continue;
      this.disposeLayer(entry);
      this.mounted.delete(id);
      this.clearWarning(id);
    }
    this.active = [];
    for (const layer of layers) {
      let entry = this.mounted.get(layer.id);
      if (entry && entry.effectId !== layer.effectId) {
        this.disposeLayer(entry);
        this.clearWarning(layer.id);
        this.mounted.delete(layer.id);
        entry = undefined;
      }
      if (!entry) {
        entry = { effectId: layer.effectId, definition: Object.hasOwn(effectRegistry, layer.effectId) ? effectRegistry[layer.effectId] : undefined,
          programs: [], meshes: [], history: [], historyIndex: 0, historyValid: false };
        this.mounted.set(layer.id, entry);
      }
      if (!entry.definition) {
        this.warn(layer.id, `Effect unavailable: ${layer.effectId}. This layer is skipped.`);
        continue;
      }
      const values = resolveEffectValues(entry.definition, layer.values);
      if (!config?.enabled || !layer.enabled || values.intensity === 0) {
        this.releaseHistory(entry);
        continue;
      }
      if (!entry.programs.length && !entry.failed) this.compile(layer.id, entry);
      if (entry.programs.length) this.active.push({ layer, mounted: entry, values });
    }
    if (!this.active.length) {
      this.releaseTargets();
      this.clearWarning();
    }
    if (this.geometry && !this.copy && ![...this.mounted.values()].some(entry => entry.programs.length)) {
      this.geometry.remove();
      this.geometry = undefined;
      this.renderer.currentGeometry = null;
    }
    return changed;
  }

  private warn(id: string | undefined, message: string) {
    const key = id ?? '@stack';
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[effects] ${message}`);
    this.options?.onEffectStatus?.({ ...(id === undefined ? {} : { layerId: id }), message });
  }

  private clearWarning(id?: string) {
    if (this.warned.delete(id ?? '@stack')) this.options?.onEffectStatus?.({ ...(id === undefined ? {} : { layerId: id }), message: '' });
  }

  private makeProgram(source: string): Program {
    const gl = this.renderer.gl;
    const program = new Program(gl, {
      vertex, fragment: source,
      uniforms: { uInput: { value: null }, uOriginal: { value: null }, uHistory: { value: null }, uHistoryValid: { value: 0 },
        uResolution: { value: [1, 1] }, uTime: { value: 0 }, uDelta: { value: 0 } },
      depthTest: false, depthWrite: false, cullFace: false,
    });
    // OGL logs failures and returns an incomplete Program. Never draw it.
    if (!gl.getShaderParameter(program.vertexShader, gl.COMPILE_STATUS) ||
        !gl.getShaderParameter(program.fragmentShader, gl.COMPILE_STATUS) ||
        !gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program.program) || gl.getShaderInfoLog(program.fragmentShader) || 'Shader compilation failed';
      disposeProgram(this.renderer, program);
      throw new Error(message);
    }
    return program;
  }

  private makeMesh(program: Program): Mesh {
    this.geometry ??= new Triangle(this.renderer.gl);
    return new Mesh(this.renderer.gl, { geometry: this.geometry, program });
  }

  private compile(id: string, entry: MountedLayer) {
    try {
      for (const source of [...(entry.definition!.passes ?? []), entry.definition!.source]) {
        const program = this.makeProgram(source);
        entry.programs.push(program);
        entry.meshes.push(this.makeMesh(program));
      }
      this.clearWarning(id);
    } catch (error) {
      for (const program of entry.programs) disposeProgram(this.renderer, program);
      entry.programs = []; entry.meshes = [];
      entry.failed = true;
      this.warn(id, `Effect ${entry.effectId} could not compile and is skipped: ${String(error)}`);
    }
  }

  private releaseSurface(target: RenderTarget) {
    const gl = this.renderer.gl;
    this.renderer.bindFramebuffer({ target: gl.FRAMEBUFFER });
    for (const texture of target.textures) {
      for (let unit = 0; unit < this.renderer.state.textureUnits.length; unit++) {
        if (this.renderer.state.textureUnits[unit] === texture.id) this.renderer.state.textureUnits[unit] = -1;
      }
      gl.deleteTexture(texture.texture);
    }
    gl.deleteFramebuffer(target.buffer);
  }

  private releaseHistory(entry: MountedLayer) {
    for (const target of entry.history) this.releaseSurface(target);
    entry.history = []; entry.historyValid = false; entry.historyIndex = 0;
  }

  private disposeLayer(entry: MountedLayer) {
    this.releaseHistory(entry);
    for (const program of entry.programs) disposeProgram(this.renderer, program);
  }

  private releaseTargets() {
    for (const target of this.targets) this.releaseSurface(target);
    this.targets = [];
  }

  private prepareSurface(surfaces: RenderTarget[], index: number) {
    const gl = this.renderer.gl;
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    let target = surfaces[index];
    if (target && target.width === width && target.height === height) return;
    if (!target) {
      // Own the framebuffer before texture allocation, so partial failures are cleaned up.
      target = new RenderTarget(gl, { width, height, color: 0, depth: false, stencil: false });
      surfaces.push(target);
      if (!target.buffer) throw new Error('Could not allocate effect framebuffer');
      const texture = new Texture(gl, { width, height, flipY: false, generateMipmaps: false,
        type: gl.UNSIGNED_BYTE, format: gl.RGBA, internalFormat: gl.RGBA,
        minFilter: gl.LINEAR, magFilter: gl.LINEAR, wrapS: gl.CLAMP_TO_EDGE, wrapT: gl.CLAMP_TO_EDGE });
      target.textures.push(texture); target.texture = texture;
      if (!texture.texture) throw new Error('Could not allocate effect texture');
      // OGL 1.0.11 updates TEXTURE_WRAP_R unconditionally, including WebGL1.
      // Prime only that unused 2D texture cache field (also for history buffers).
      (texture.state as typeof texture.state & { wrapR: number }).wrapR = texture.wrapR;
      this.renderer.bindFramebuffer(target);
      texture.update();
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.texture, 0);
    } else target.setSize(width, height);
    this.renderer.bindFramebuffer(target);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER), error = gl.getError();
    if (status !== gl.FRAMEBUFFER_COMPLETE || error !== gl.NO_ERROR) {
      throw new Error(`Incomplete effect framebuffer (status ${status}, GL error ${error})`);
    }
  }

  private prepareTargets(): boolean {
    const gl = this.renderer.gl;
    const key = `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}:${this.signature}`;
    if (key === this.failedTargets) return false;
    try {
      const multipass = this.active.some(({ mounted }) => mounted.programs.length > 1);
      const count = multipass ? 3 : this.active.length > 1 ? 2 : 1;
      // Retain the existing second simple scratch target across nonempty edits,
      // but never retain a third target when returning to the simple path.
      if (!multipass && this.targets.length > 2) this.releaseSurface(this.targets.pop()!);
      for (let index = 0; index < count; index++) this.prepareSurface(this.targets, index);
      for (const { mounted } of this.active) {
        if (!mounted.definition!.history) continue;
        if (mounted.history.some(target => target.width !== gl.drawingBufferWidth || target.height !== gl.drawingBufferHeight)) mounted.historyValid = false;
        for (let index = 0; index < 2; index++) this.prepareSurface(mounted.history, index);
        this.copy ??= this.makeMesh(this.makeProgram(copySource));
      }
      this.renderer.bindFramebuffer({ target: gl.FRAMEBUFFER });
      this.failedTargets = '';
      this.clearWarning();
      return true;
    } catch (error) {
      this.failedTargets = key;
      this.releaseTargets();
      for (const entry of this.mounted.values()) this.releaseHistory(entry);
      this.warn(undefined, `Effect stack bypassed: ${String(error)}`);
      return false;
    }
  }

  private upload(program: Program, entry: MountedLayer, values: Record<string, unknown>, input: RenderTarget, original: RenderTarget, seconds: number) {
    const uniforms = program.uniforms;
    uniforms.uInput.value = input.texture;
    uniforms.uOriginal.value = original.texture;
    // Bind input as a safe fallback even when the shader has an active history sampler.
    uniforms.uHistory.value = entry.historyValid ? entry.history[entry.historyIndex].texture : original.texture;
    uniforms.uHistoryValid.value = entry.historyValid ? 1 : 0;
    uniforms.uResolution.value = [this.renderer.gl.drawingBufferWidth, this.renderer.gl.drawingBufferHeight];
    uniforms.uTime.value = this.clock.phase;
    uniforms.uDelta.value = seconds;
    for (const definition of entry.definition!.uniforms) {
      let value = values[definition.name];
      if (definition.type === 'color') {
        const hex = Number.parseInt(String(value).slice(1), 16);
        value = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
      } else if (definition.type === 'select') value = Math.max(0, definition.options?.indexOf(String(value)) ?? 0);
      else if (definition.type === 'bool') value = value ? 1 : 0;
      else if (definition.type === 'int') value = Math.round(Number(value));
      uniforms[definition.name] = { value };
    }
  }

  render(base: Mesh, delta: number) {
    const seconds = this.clock.advance(delta, 1);
    if (!this.active.length || !this.prepareTargets()) {
      this.renderer.render({ scene: base });
      return;
    }
    let input = this.targets[0];
    this.renderer.render({ scene: base, target: input });
    for (let index = 0; index < this.active.length; index++) {
      const { mounted, values } = this.active[index];
      const original = input;
      const temporal = mounted.definition!.history;
      const last = index === this.active.length - 1;
      // A zero-delta forced redraw presents the last displayed temporal output,
      // rather than feeding it back again. Initialization/edits render once safely.
      if (!temporal || seconds > 0 || !mounted.historyValid) {
        for (let pass = 0; pass < mounted.programs.length; pass++) {
          const final = pass === mounted.programs.length - 1;
          const target = final && temporal ? mounted.history[1 - mounted.historyIndex]
            : final && last ? undefined
            : this.targets.find(target => target !== input && (mounted.programs.length === 1 || target !== original))!;
          this.upload(mounted.programs[pass], mounted, values, input, original, seconds);
          this.renderer.render({ scene: mounted.meshes[pass], ...(target ? { target } : {}) });
          if (target) input = target;
        }
        if (temporal) {
          mounted.historyIndex = 1 - mounted.historyIndex;
          mounted.historyValid = true;
        }
      }
      if (temporal) {
        const target = last ? undefined : this.targets.find(target => target !== original)!;
        this.copy!.program.uniforms.uInput.value = mounted.history[mounted.historyIndex].texture;
        this.renderer.render({ scene: this.copy!, ...(target ? { target } : {}) });
        if (target) input = target;
      }
    }
  }

  dispose() {
    this.releaseTargets();
    for (const entry of this.mounted.values()) this.disposeLayer(entry);
    this.mounted.clear();
    if (this.copy) disposeProgram(this.renderer, this.copy.program);
    this.copy = undefined;
    this.geometry?.remove();
    this.geometry = undefined;
    this.renderer.currentGeometry = null;
    this.warned.clear();
  }
}

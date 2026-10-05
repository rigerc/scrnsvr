import { Mesh, Program, RenderTarget, Renderer, Texture, Triangle } from 'ogl';
import { MAX_EFFECT_LAYERS, resolveEffectValues, type EffectDefinition, type EffectLayer, type EffectRuntimeOptions } from '../../shared/effects';
import { effectRegistry } from '../effects';
import { AnimationClock } from './animation-clock';

const vertex = 'attribute vec2 uv; attribute vec2 position; varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,0.,1.);}';
interface MountedLayer {
  effectId: string;
  definition?: EffectDefinition;
  program?: Program;
  mesh?: Mesh;
  failed?: boolean;
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
    if (changed) this.failedTargets = '';
    const layers = config?.layers.slice(0, MAX_EFFECT_LAYERS) ?? [];
    const ids = new Set(layers.map(layer => layer.id));
    for (const [id, entry] of this.mounted) {
      if (ids.has(id)) continue;
      if (entry.program) disposeProgram(this.renderer, entry.program);
      this.mounted.delete(id);
      this.warned.delete(id);
    }
    this.active = [];
    for (const layer of layers) {
      let entry = this.mounted.get(layer.id);
      if (entry && entry.effectId !== layer.effectId) {
        if (entry.program) disposeProgram(this.renderer, entry.program);
        this.mounted.delete(layer.id);
        entry = undefined;
      }
      if (!entry) {
        entry = { effectId: layer.effectId, definition: Object.hasOwn(effectRegistry, layer.effectId) ? effectRegistry[layer.effectId] : undefined };
        this.mounted.set(layer.id, entry);
      }
      if (!entry.definition) {
        this.warn(layer.id, `Effect unavailable: ${layer.effectId}. This layer is skipped.`);
        continue;
      }
      if (!config?.enabled || !layer.enabled) continue;
      const values = resolveEffectValues(entry.definition, layer.values);
      if (values.intensity === 0) continue;
      if (!entry.program && !entry.failed) this.compile(layer.id, entry);
      if (entry.program) this.active.push({ layer, mounted: entry, values });
    }
    if (!this.active.length) {
      this.releaseTargets();
      this.clearStackWarning();
    }
    if (this.geometry && ![...this.mounted.values()].some(entry => entry.program)) {
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

  private clearStackWarning() {
    if (this.warned.delete('@stack')) this.options?.onEffectStatus?.({ message: '' });
  }

  private compile(id: string, entry: MountedLayer) {
    const gl = this.renderer.gl;
    let program: Program | undefined;
    try {
      program = new Program(gl, {
        vertex, fragment: entry.definition!.source,
        uniforms: { uInput: { value: null }, uResolution: { value: [1, 1] }, uTime: { value: 0 } },
        depthTest: false, depthWrite: false, cullFace: false,
      });
      // OGL only logs failure and returns an incomplete Program. Never draw it.
      if (!gl.getShaderParameter(program.vertexShader, gl.COMPILE_STATUS) ||
          !gl.getShaderParameter(program.fragmentShader, gl.COMPILE_STATUS) ||
          !gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program.program) || gl.getShaderInfoLog(program.fragmentShader) || 'Shader compilation failed');
      }
      this.geometry ??= new Triangle(gl);
      entry.mesh = new Mesh(gl, { geometry: this.geometry, program });
      entry.program = program;
    } catch (error) {
      if (program) disposeProgram(this.renderer, program);
      entry.failed = true;
      this.warn(id, `Effect ${entry.effectId} could not compile and is skipped: ${String(error)}`);
    }
  }

  private releaseTargets() {
    if (!this.targets.length) return;
    const gl = this.renderer.gl;
    this.renderer.bindFramebuffer({ target: gl.FRAMEBUFFER });
    for (const target of this.targets) {
      for (const texture of target.textures) {
        for (let unit = 0; unit < this.renderer.state.textureUnits.length; unit++) {
          if (this.renderer.state.textureUnits[unit] === texture.id) this.renderer.state.textureUnits[unit] = -1;
        }
        gl.deleteTexture(texture.texture);
      }
      gl.deleteFramebuffer(target.buffer);
    }
    this.targets = [];
  }

  private prepareTargets(): boolean {
    const gl = this.renderer.gl;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const key = `${width}x${height}:${this.signature}`;
    if (key === this.failedTargets) return false;
    try {
      const count = this.active.length > 1 ? 2 : 1;
      // Keep a second target across nonempty one/two/many-layer edits; targets
      // are released only on direct bypass or teardown, not on reorder/removal.
      for (let index = 0; index < count; index++) {
        let target = this.targets[index];
        if (target && target.width === width && target.height === height) continue;
        if (!target) {
          // Allocate the OGL framebuffer first so even a partial texture failure
          // is owned and cleaned up. OGL 1.0.11's Texture.update unconditionally
          // sets TEXTURE_WRAP_R (undefined in WebGL1). For these 2D-only targets
          // prime that unused cache entry before the first upload instead.
          target = new RenderTarget(gl, { width, height, color: 0, depth: false, stencil: false });
          this.targets.push(target);
          if (!target.buffer) throw new Error('Could not allocate effect framebuffer');
          const texture = new Texture(gl, { width, height, flipY: false, generateMipmaps: false,
            type: gl.UNSIGNED_BYTE, format: gl.RGBA, internalFormat: gl.RGBA,
            minFilter: gl.LINEAR, magFilter: gl.LINEAR, wrapS: gl.CLAMP_TO_EDGE, wrapT: gl.CLAMP_TO_EDGE });
          target.textures.push(texture);
          target.texture = texture;
          if (!texture.texture) throw new Error('Could not allocate effect texture');
          (texture.state as typeof texture.state & { wrapR: number }).wrapR = texture.wrapR;
          this.renderer.bindFramebuffer(target);
          texture.update();
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.texture, 0);
        } else target.setSize(width, height);
        this.renderer.bindFramebuffer(target);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        const error = gl.getError();
        if (status !== gl.FRAMEBUFFER_COMPLETE || error !== gl.NO_ERROR) {
          throw new Error(`Incomplete effect framebuffer (status ${status}, GL error ${error})`);
        }
      }
      this.renderer.bindFramebuffer({ target: gl.FRAMEBUFFER });
      this.failedTargets = '';
      this.clearStackWarning();
      return true;
    } catch (error) {
      this.failedTargets = key;
      this.releaseTargets();
      this.warn(undefined, `Effect stack bypassed: ${String(error)}`);
      return false;
    }
  }

  render(base: Mesh, delta: number) {
    this.clock.advance(delta, 1);
    if (!this.active.length || !this.prepareTargets()) {
      this.renderer.render({ scene: base });
      return;
    }
    this.renderer.render({ scene: base, target: this.targets[0] });
    for (let index = 0; index < this.active.length; index++) {
      const { mounted, values } = this.active[index];
      const uniforms = mounted.program!.uniforms;
      uniforms.uInput.value = this.targets[index % 2].texture;
      uniforms.uResolution.value = [this.renderer.gl.drawingBufferWidth, this.renderer.gl.drawingBufferHeight];
      uniforms.uTime.value = this.clock.phase;
      for (const [name, value] of Object.entries(values)) uniforms[name] = { value };
      this.renderer.render({ scene: mounted.mesh!, ...(index === this.active.length - 1 ? {} : { target: this.targets[(index + 1) % 2] }) });
    }
  }

  dispose() {
    this.releaseTargets();
    for (const entry of this.mounted.values()) if (entry.program) disposeProgram(this.renderer, entry.program);
    this.mounted.clear();
    this.geometry?.remove();
    this.geometry = undefined;
    this.renderer.currentGeometry = null;
    this.warned.clear();
  }
}

//! GLES2 scene renderer, ported from `native/renderer/gl.cc`.
//!
//! One [`Renderer`] owns the GL objects of one context: the scene program,
//! effect passes with per-layer temporal history, ping-pong targets, the clock
//! texture and the fade/transition finish pass. It draws into whatever
//! framebuffer 0 is for the current context (a layer-shell window, a preview
//! window or a headless pbuffer), so the same code serves every presentation
//! path.
//!
//! **Context ownership:** every method, including `Drop`, must run with this
//! renderer's context current. The caller owns the context.

mod clock;
mod program;

use std::sync::Arc;

use glow::HasContext;
use scrnsvr_core::{AnimationClock, AudioSmoother, SceneSpec, UniformValue};

pub use clock::{ClockImage, render_clock};
pub use program::{CompileError, compile_error};
use program::{Program, compile_program};

const FINISH_SOURCE: &str = "precision mediump float; uniform vec4 uColor; void main(){gl_FragColor=uColor;}";
const COPY_SOURCE: &str =
    "precision highp float; uniform sampler2D uInput; varying vec2 vUv; void main(){gl_FragColor=texture2D(uInput,vUv);}";
// Cairo rows start at the top; GL window coordinates start at the bottom.
const CLOCK_SOURCE: &str = "precision mediump float; uniform sampler2D uTexture; uniform vec4 uRect;\
    void main(){vec2 p=(gl_FragCoord.xy-uRect.xy)/uRect.zw;\
    if(p.x<0.0||p.y<0.0||p.x>1.0||p.y>1.0) discard;\
    gl_FragColor=texture2D(uTexture,vec2(p.x,1.0-p.y));}";

#[derive(Debug, Default)]
struct Target {
    framebuffer: Option<glow::Framebuffer>,
    texture: Option<glow::Texture>,
    width: i32,
    height: i32,
}

impl Target {
    fn matches(&self, width: i32, height: i32) -> bool {
        self.framebuffer.is_some() && self.width == width && self.height == height
    }
}

struct Layer {
    id: String,
    programs: Vec<Program>,
    history: bool,
    uniforms: Vec<(String, UniformValue)>,
    history_targets: [Target; 2],
    history_index: usize,
    history_valid: bool,
}

struct Scene {
    program: Program,
    uniforms: Vec<(String, UniformValue)>,
    integrated: bool,
    audio: bool,
    speed: f64,
    clock: AnimationClock,
    ambient: AudioSmoother,
    date: [f32; 4],
    layers: Vec<Layer>,
}

/// Which framebuffer a pass draws into.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Slot {
    Screen,
    Shared(usize),
    History(usize, usize),
}

pub struct Renderer {
    gl: glow::Context,
    geometry: glow::Buffer,
    finish: Program,
    copy: Program,
    clock_program: Program,
    clock_texture: Option<glow::Texture>,
    clock_rect: [i32; 4],
    clock_visible: bool,
    scene: Option<Scene>,
    scene_spec: Option<Arc<SceneSpec>>,
    effects_clock: AnimationClock,
    targets: [Target; 3],
    target_count: usize,
    failed_targets: Option<(i32, i32)>,
}

/// Shadertoy `iDate`: year, month, day, seconds since local midnight.
fn local_date() -> [f32; 4] {
    // SAFETY: localtime_r writes into the provided struct only.
    unsafe {
        let now = libc::time(std::ptr::null_mut());
        let mut local: libc::tm = std::mem::zeroed();
        if libc::localtime_r(&now, &mut local).is_null() {
            return [0.0; 4];
        }
        [
            (local.tm_year + 1900) as f32,
            (local.tm_mon + 1) as f32,
            local.tm_mday as f32,
            (local.tm_hour * 3600 + local.tm_min * 60 + local.tm_sec) as f32,
        ]
    }
}

impl Renderer {
    /// Compile utility programs. Requires `gl`'s context to be current.
    pub fn new(gl: glow::Context) -> Result<Self, CompileError> {
        // One oversized triangle covers the viewport; uv reaches 1 at the edges.
        let vertices: [f32; 12] = [-1.0, -1.0, 0.0, 0.0, 3.0, -1.0, 2.0, 0.0, -1.0, 3.0, 0.0, 2.0];
        let bytes: Vec<u8> = vertices.iter().flat_map(|value| value.to_ne_bytes()).collect();
        // SAFETY: the caller guarantees the context is current.
        unsafe {
            let geometry = gl.create_buffer().map_err(CompileError::Resource)?;
            gl.bind_buffer(glow::ARRAY_BUFFER, Some(geometry));
            gl.buffer_data_u8_slice(glow::ARRAY_BUFFER, &bytes, glow::STATIC_DRAW);
            let programs = (|| {
                Ok::<_, CompileError>((
                    compile_program(&gl, FINISH_SOURCE)?,
                    compile_program(&gl, COPY_SOURCE)?,
                    compile_program(&gl, CLOCK_SOURCE)?,
                ))
            })();
            let (finish, copy, clock_program) = match programs {
                Ok(programs) => programs,
                Err(error) => {
                    gl.delete_buffer(geometry);
                    return Err(error);
                }
            };
            Ok(Self {
                gl,
                geometry,
                finish,
                copy,
                clock_program,
                clock_texture: None,
                clock_rect: [0; 4],
                clock_visible: false,
                scene: None,
                scene_spec: None,
                effects_clock: AnimationClock::default(),
                targets: Default::default(),
                target_count: 0,
                failed_targets: None,
            })
        }
    }

    pub fn gl(&self) -> &glow::Context {
        &self.gl
    }

    pub fn has_scene(&self) -> bool {
        self.scene.is_some()
    }

    pub fn spec(&self) -> Option<&Arc<SceneSpec>> {
        self.scene_spec.as_ref()
    }

    /// Compile and mount a scene. On failure the running scene is untouched.
    /// Effect layers that fail to compile are skipped with a diagnostic.
    pub fn set_scene(&mut self, spec: &Arc<SceneSpec>) -> Result<(), CompileError> {
        let gl = &self.gl;
        // Compile before replacing, so a broken shader cannot disturb the running scene.
        let program = compile_program(gl, &spec.source)?;
        let mut layers = Vec::new();
        for effect in &spec.effects {
            let mut programs = Vec::new();
            let mut failure = None;
            for pass in &effect.passes {
                match compile_program(gl, pass) {
                    Ok(program) => programs.push(program),
                    Err(error) => {
                        failure = Some(error);
                        break;
                    }
                }
            }
            if let Some(error) = failure {
                programs.into_iter().for_each(|program| program.destroy(gl));
                eprintln!("scrnsvr effect {} could not compile and is skipped: {error}", effect.id);
                continue;
            }
            layers.push(Layer {
                id: effect.id.clone(),
                programs,
                history: effect.history,
                uniforms: effect.uniforms.clone(),
                history_targets: Default::default(),
                history_index: 0,
                history_valid: false,
            });
        }
        let next = Scene {
            program,
            uniforms: spec.uniforms.clone(),
            integrated: spec.integrated,
            audio: spec.audio,
            speed: spec.speed(),
            clock: AnimationClock::default(),
            ambient: AudioSmoother::default(),
            date: local_date(),
            layers,
        };
        if let Some(previous) = self.scene.replace(next) {
            self.destroy_scene(previous);
        }
        self.scene_spec = Some(spec.clone());
        self.failed_targets = None;
        self.effects_clock = AnimationClock::default();
        Ok(())
    }

    /// Change one scene uniform without recompiling, for live settings edits.
    /// `speed` also rescales integrated animation from this frame on.
    pub fn set_uniform(&mut self, name: &str, value: UniformValue) {
        let Some(scene) = self.scene.as_mut() else { return };
        if name == "speed"
            && let UniformValue::Scalar(speed) = value
        {
            scene.speed = speed;
        }
        match scene.uniforms.iter_mut().find(|(existing, _)| existing == name) {
            Some(slot) => slot.1 = value,
            None => scene.uniforms.push((name.to_owned(), value)),
        }
    }

    /// Effect layer ids that compiled for the current scene, in order.
    pub fn layer_ids(&self) -> Vec<&str> {
        self.scene.as_ref().map(|scene| scene.layers.iter().map(|layer| layer.id.as_str()).collect()).unwrap_or_default()
    }

    /// Upload the clock image, or hide the clock with `None`.
    pub fn set_clock(&mut self, image: Option<&ClockImage>) {
        let Some(image) = image.filter(|image| image.width > 0 && image.height > 0) else {
            self.clock_visible = false;
            return;
        };
        let gl = &self.gl;
        // SAFETY: context current per the type's contract; the slice covers width*height*4 bytes.
        unsafe {
            if self.clock_texture.is_none() {
                self.clock_texture = gl.create_texture().ok();
            }
            let Some(texture) = self.clock_texture else {
                self.clock_visible = false;
                return;
            };
            gl.active_texture(glow::TEXTURE0);
            gl.bind_texture(glow::TEXTURE_2D, Some(texture));
            set_texture_parameters(gl, glow::NEAREST);
            gl.pixel_store_i32(glow::UNPACK_ALIGNMENT, 1);
            gl.tex_image_2d(
                glow::TEXTURE_2D,
                0,
                glow::RGBA as i32,
                image.width,
                image.height,
                0,
                glow::RGBA,
                glow::UNSIGNED_BYTE,
                glow::PixelUnpackData::Slice(Some(&image.pixels)),
            );
        }
        self.clock_rect = [image.x, image.y, image.width, image.height];
        self.clock_visible = true;
    }

    /// Draw one frame into framebuffer 0.
    ///
    /// `overlay` is the rotation's black overlay; `alpha` the premultiplied
    /// scene opacity over the desktop.
    pub fn render(&mut self, width: i32, height: i32, delta_ms: f64, audio: &[f32; 4], overlay: f32, alpha: f32) {
        // SAFETY: context current per the type's contract.
        unsafe {
            self.gl.disable(glow::BLEND);
            self.gl.disable(glow::DEPTH_TEST);
        }
        if let Some(scene) = self.scene.as_mut() {
            let active = scene.clock.advance(delta_ms, scene.speed);
            if scene.audio {
                scene.ambient.step(audio, active);
            }
            let seconds = self.effects_clock.advance(delta_ms, 1.0);
            self.render_effects(width, height, seconds);
        } else {
            self.bind_slot(Slot::Screen, width, height);
            // SAFETY: as above.
            unsafe {
                self.gl.clear_color(0.0, 0.0, 0.0, 1.0);
                self.gl.clear(glow::COLOR_BUFFER_BIT);
            }
        }
        self.bind_slot(Slot::Screen, width, height);
        let gl = &self.gl;
        // SAFETY: as above.
        unsafe {
            if self.clock_visible {
                gl.enable(glow::BLEND);
                gl.blend_func(glow::ONE, glow::ONE_MINUS_SRC_ALPHA);
                gl.use_program(Some(self.clock_program.id));
                bind_texture(gl, 0, self.clock_texture);
                self.clock_program.set_int(gl, "uTexture", 0);
                let [x, y, w, h] = self.clock_rect;
                self.clock_program.set_floats(gl, "uRect", &[x as f32, (height - y - h) as f32, w as f32, h as f32]);
                self.draw_triangle(&self.clock_program);
                gl.disable(glow::BLEND);
            }
            // The scene is opaque regardless of what alpha its passes wrote.
            gl.color_mask(false, false, false, true);
            gl.clear_color(0.0, 0.0, 0.0, 1.0);
            gl.clear(glow::COLOR_BUFFER_BIT);
            gl.color_mask(true, true, true, true);
            gl.use_program(Some(self.finish.id));
            gl.enable(glow::BLEND);
            if overlay > 0.0 {
                // Transition black over the scene; alpha is untouched.
                gl.blend_func_separate(glow::SRC_ALPHA, glow::ONE_MINUS_SRC_ALPHA, glow::ZERO, glow::ONE);
                self.finish.set_floats(gl, "uColor", &[0.0, 0.0, 0.0, overlay.min(1.0)]);
                self.draw_triangle(&self.finish);
            }
            if alpha < 1.0 {
                // Premultiplied fade over the desktop: color and alpha both scale by alpha.
                gl.blend_func_separate(glow::ZERO, glow::SRC_ALPHA, glow::ZERO, glow::SRC_ALPHA);
                self.finish.set_floats(gl, "uColor", &[0.0, 0.0, 0.0, alpha.max(0.0)]);
                self.draw_triangle(&self.finish);
            }
            gl.disable(glow::BLEND);
        }
    }

    /// Read framebuffer 0 as top-down RGBA rows. For explicit capture
    /// (thumbnails, checks) only, never the normal presentation path.
    pub fn read_rgba(&self, width: i32, height: i32) -> Vec<u8> {
        let row = width.max(0) as usize * 4;
        let mut pixels = vec![0u8; row * height.max(0) as usize];
        // SAFETY: context current; buffer sized for width*height RGBA bytes.
        unsafe {
            self.gl.bind_framebuffer(glow::FRAMEBUFFER, None);
            self.gl.pixel_store_i32(glow::PACK_ALIGNMENT, 1);
            self.gl.read_pixels(0, 0, width, height, glow::RGBA, glow::UNSIGNED_BYTE, glow::PixelPackData::Slice(Some(&mut pixels)));
        }
        let mut flipped = Vec::with_capacity(pixels.len());
        for chunk in pixels.chunks_exact(row.max(1)).rev() {
            flipped.extend_from_slice(chunk);
        }
        flipped
    }

    fn draw_triangle(&self, program: &Program) {
        let gl = &self.gl;
        // SAFETY: context current; the geometry buffer holds 3 vertices of 4 floats.
        unsafe {
            gl.use_program(Some(program.id));
            gl.bind_buffer(glow::ARRAY_BUFFER, Some(self.geometry));
            gl.enable_vertex_attrib_array(0);
            gl.enable_vertex_attrib_array(1);
            gl.vertex_attrib_pointer_f32(0, 2, glow::FLOAT, false, 16, 0);
            gl.vertex_attrib_pointer_f32(1, 2, glow::FLOAT, false, 16, 8);
            gl.draw_arrays(glow::TRIANGLES, 0, 3);
        }
    }

    fn draw_base(&self, width: i32, height: i32) {
        let gl = &self.gl;
        let Some(scene) = self.scene.as_ref() else { return };
        let program = &scene.program;
        // SAFETY: context current.
        unsafe { gl.use_program(Some(program.id)) };
        let time = if scene.integrated { scene.clock.phase } else { scene.clock.elapsed };
        program.set_floats(gl, "uTime", &[time as f32]);
        program.set_floats(gl, "uResolution", &[width as f32, height as f32]);
        program.set_floats(gl, "uDate", &scene.date);
        program.set_floats(gl, "uAudio", &scene.ambient.value);
        for (name, value) in &scene.uniforms {
            if scene.integrated && name == "speed" {
                program.set_floats(gl, "speed", &[1.0]);
            } else {
                program.set_uniform(gl, name, value);
            }
        }
        self.draw_triangle(program);
    }

    fn target(&self, slot: Slot) -> Option<&Target> {
        match slot {
            Slot::Screen => None,
            Slot::Shared(index) => Some(&self.targets[index]),
            Slot::History(layer, index) => self.scene.as_ref().map(|scene| &scene.layers[layer].history_targets[index]),
        }
    }

    fn texture(&self, slot: Slot) -> Option<glow::Texture> {
        self.target(slot).and_then(|target| target.texture)
    }

    fn bind_slot(&self, slot: Slot, width: i32, height: i32) {
        let framebuffer = self.target(slot).and_then(|target| target.framebuffer);
        // SAFETY: context current.
        unsafe {
            self.gl.bind_framebuffer(glow::FRAMEBUFFER, framebuffer);
            self.gl.viewport(0, 0, width, height);
        }
    }

    fn prepare_targets(&mut self, width: i32, height: i32, count: usize) -> bool {
        if self.failed_targets == Some((width, height)) {
            return false;
        }
        let gl = &self.gl;
        let mut ok = true;
        for (index, target) in self.targets.iter_mut().enumerate() {
            if !ok {
                break;
            }
            if index >= count {
                destroy_target(gl, target);
            } else if !target.matches(width, height) {
                ok = create_target(gl, target, width, height);
            }
        }
        if let Some(scene) = self.scene.as_mut() {
            for layer in scene.layers.iter_mut().filter(|layer| layer.history) {
                if !ok {
                    break;
                }
                for target in &mut layer.history_targets {
                    if target.matches(width, height) {
                        continue;
                    }
                    layer.history_valid = false;
                    ok = ok && create_target(gl, target, width, height);
                }
            }
        }
        if !ok {
            self.failed_targets = Some((width, height));
            for target in &mut self.targets {
                destroy_target(gl, target);
            }
            if let Some(scene) = self.scene.as_mut() {
                for target in scene.layers.iter_mut().flat_map(|layer| layer.history_targets.iter_mut()) {
                    destroy_target(gl, target);
                }
            }
            eprintln!("scrnsvr effect stack bypassed: could not allocate {width}x{height} framebuffers");
            return false;
        }
        self.target_count = count;
        true
    }

    /// A shared target that is neither `a` nor `b`.
    fn free_slot(&self, a: Slot, b: Option<Slot>) -> Slot {
        (0..self.target_count).map(Slot::Shared).find(|slot| *slot != a && Some(*slot) != b).unwrap_or(Slot::Screen)
    }

    fn render_effects(&mut self, width: i32, height: i32, seconds: f64) {
        let Some(scene) = self.scene.as_ref() else { return };
        let layer_count = scene.layers.len();
        let multipass = scene.layers.iter().any(|layer| layer.programs.len() > 1);
        let count = if multipass {
            3
        } else if layer_count > 1 {
            2
        } else {
            1
        };
        if layer_count == 0 || !self.prepare_targets(width, height, count) {
            self.bind_slot(Slot::Screen, width, height);
            self.draw_base(width, height);
            return;
        }
        let mut input = Slot::Shared(0);
        self.bind_slot(input, width, height);
        self.draw_base(width, height);
        let effect_time = self.effects_clock.phase as f32;
        for index in 0..layer_count {
            let (history, history_valid, history_index, pass_count) = {
                let layer = &self.scene.as_ref().expect("scene").layers[index];
                (layer.history, layer.history_valid, layer.history_index, layer.programs.len())
            };
            let original = input;
            let last = index == layer_count - 1;
            // A zero-delta frame presents the last temporal output instead of feeding it back again.
            if !history || seconds > 0.0 || !history_valid {
                for pass in 0..pass_count {
                    let is_final = pass == pass_count - 1;
                    let target = if is_final && history {
                        Slot::History(index, 1 - history_index)
                    } else if is_final && last {
                        Slot::Screen
                    } else {
                        self.free_slot(input, if pass_count == 1 { None } else { Some(original) })
                    };
                    let history_texture =
                        if history_valid { self.texture(Slot::History(index, history_index)) } else { self.texture(original) };
                    let input_texture = self.texture(input);
                    let original_texture = self.texture(original);
                    let gl = &self.gl;
                    let layer = &self.scene.as_ref().expect("scene").layers[index];
                    let program = &layer.programs[pass];
                    // SAFETY: context current; textures belong to this context.
                    unsafe {
                        gl.use_program(Some(program.id));
                        bind_texture(gl, 0, input_texture);
                        bind_texture(gl, 1, original_texture);
                        bind_texture(gl, 2, history_texture);
                    }
                    program.set_int(gl, "uInput", 0);
                    program.set_int(gl, "uOriginal", 1);
                    program.set_int(gl, "uHistory", 2);
                    program.set_floats(gl, "uHistoryValid", &[if history_valid { 1.0 } else { 0.0 }]);
                    program.set_floats(gl, "uResolution", &[width as f32, height as f32]);
                    program.set_floats(gl, "uTime", &[effect_time]);
                    program.set_floats(gl, "uDelta", &[seconds as f32]);
                    for (name, value) in &layer.uniforms {
                        program.set_uniform(gl, name, value);
                    }
                    self.bind_slot(target, width, height);
                    self.draw_triangle(program);
                    if target != Slot::Screen {
                        input = target;
                    }
                }
                if history {
                    let layer = &mut self.scene.as_mut().expect("scene").layers[index];
                    layer.history_index = 1 - layer.history_index;
                    layer.history_valid = true;
                }
            }
            if history {
                let current = self.scene.as_ref().expect("scene").layers[index].history_index;
                let target = if last { Slot::Screen } else { self.free_slot(original, None) };
                let gl = &self.gl;
                // SAFETY: context current.
                unsafe {
                    gl.use_program(Some(self.copy.id));
                    bind_texture(gl, 0, self.texture(Slot::History(index, current)));
                }
                self.copy.set_int(gl, "uInput", 0);
                self.bind_slot(target, width, height);
                self.draw_triangle(&self.copy);
                if target != Slot::Screen {
                    input = target;
                }
            }
        }
        // SAFETY: context current.
        unsafe { self.gl.active_texture(glow::TEXTURE0) };
    }

    fn destroy_scene(&self, scene: Scene) {
        let gl = &self.gl;
        scene.program.destroy(gl);
        for mut layer in scene.layers {
            layer.programs.into_iter().for_each(|program| program.destroy(gl));
            layer.history_targets.iter_mut().for_each(|target| destroy_target(gl, target));
        }
    }
}

impl Drop for Renderer {
    fn drop(&mut self) {
        if let Some(scene) = self.scene.take() {
            self.destroy_scene(scene);
        }
        let gl = &self.gl;
        for target in &mut self.targets {
            destroy_target(gl, target);
        }
        for program in [&self.finish, &self.copy, &self.clock_program] {
            // SAFETY: context current per the type's contract.
            unsafe { gl.delete_program(program.id) };
        }
        // SAFETY: as above.
        unsafe {
            if let Some(texture) = self.clock_texture.take() {
                gl.delete_texture(texture);
            }
            gl.delete_buffer(self.geometry);
        }
    }
}

unsafe fn set_texture_parameters(gl: &glow::Context, filter: u32) {
    // SAFETY: caller has a texture bound with its context current.
    unsafe {
        gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MIN_FILTER, filter as i32);
        gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_MAG_FILTER, filter as i32);
        gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_WRAP_S, glow::CLAMP_TO_EDGE as i32);
        gl.tex_parameter_i32(glow::TEXTURE_2D, glow::TEXTURE_WRAP_T, glow::CLAMP_TO_EDGE as i32);
    }
}

unsafe fn bind_texture(gl: &glow::Context, unit: u32, texture: Option<glow::Texture>) {
    // SAFETY: caller has the context current.
    unsafe {
        gl.active_texture(glow::TEXTURE0 + unit);
        gl.bind_texture(glow::TEXTURE_2D, texture);
    }
}

fn destroy_target(gl: &glow::Context, target: &mut Target) {
    // SAFETY: objects were created in this context, which the caller keeps current.
    unsafe {
        if let Some(framebuffer) = target.framebuffer.take() {
            gl.delete_framebuffer(framebuffer);
        }
        if let Some(texture) = target.texture.take() {
            gl.delete_texture(texture);
        }
    }
    *target = Target::default();
}

fn create_target(gl: &glow::Context, target: &mut Target, width: i32, height: i32) -> bool {
    destroy_target(gl, target);
    // SAFETY: context current; objects are recorded in `target` for later deletion.
    let complete = unsafe {
        let (Ok(texture), Ok(framebuffer)) = (gl.create_texture(), gl.create_framebuffer()) else { return false };
        target.texture = Some(texture);
        target.framebuffer = Some(framebuffer);
        gl.bind_texture(glow::TEXTURE_2D, Some(texture));
        set_texture_parameters(gl, glow::LINEAR);
        gl.tex_image_2d(
            glow::TEXTURE_2D,
            0,
            glow::RGBA as i32,
            width,
            height,
            0,
            glow::RGBA,
            glow::UNSIGNED_BYTE,
            glow::PixelUnpackData::Slice(None),
        );
        gl.bind_framebuffer(glow::FRAMEBUFFER, Some(framebuffer));
        gl.framebuffer_texture_2d(glow::FRAMEBUFFER, glow::COLOR_ATTACHMENT0, glow::TEXTURE_2D, Some(texture), 0);
        let complete = gl.check_framebuffer_status(glow::FRAMEBUFFER) == glow::FRAMEBUFFER_COMPLETE && gl.get_error() == glow::NO_ERROR;
        gl.bind_framebuffer(glow::FRAMEBUFFER, None);
        complete
    };
    target.width = width;
    target.height = height;
    if !complete {
        destroy_target(gl, target);
    }
    complete
}

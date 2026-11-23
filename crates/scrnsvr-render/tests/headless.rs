//! Renderer checks in a headless GLES2 context. Skipped (with a note) when the
//! machine has no usable EGL, so they never block a build without a GPU.

use std::sync::{Arc, Mutex, MutexGuard};

use scrnsvr_core::catalog::Catalog;
use scrnsvr_core::config::{Config, CustomShader};
use scrnsvr_core::scene::SceneTarget;
use scrnsvr_core::{ClockSpec, EffectSpec, SceneSpec, UniformValue};
use scrnsvr_platform::{Egl, Headless};
use scrnsvr_render::{Renderer, render_clock};

const SIZE: i32 = 32;

/// EGL's default display is shared by the whole process; one test at a time owns it.
static GPU: Mutex<()> = Mutex::new(());

fn context() -> Option<(MutexGuard<'static, ()>, Headless, Renderer)> {
    let lock = GPU.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    // SAFETY: the default display needs no external lifetime.
    let headless = match unsafe { Egl::headless(std::ptr::null_mut(), SIZE, SIZE) } {
        Ok(headless) => headless,
        Err(error) => {
            eprintln!("skipping GPU test: {error}");
            return None;
        }
    };
    // SAFETY: the headless context is current on this thread.
    let gl = unsafe { glow::Context::from_loader_function(|name| headless.egl.proc_address(name)) };
    let renderer = Renderer::new(gl).expect("utility programs compile");
    Some((lock, headless, renderer))
}

fn scene(source: &str, uniforms: Vec<(&str, UniformValue)>, effects: Vec<EffectSpec>) -> Arc<SceneSpec> {
    Arc::new(SceneSpec {
        key: "test".into(),
        source: source.into(),
        uniforms: uniforms.into_iter().map(|(name, value)| (name.into(), value)).collect(),
        integrated: false,
        audio: false,
        effects,
    })
}

fn effect(id: &str, passes: &[&str], history: bool, uniforms: Vec<(&str, UniformValue)>) -> EffectSpec {
    EffectSpec {
        id: id.into(),
        passes: passes.iter().map(|pass| pass.to_string()).collect(),
        history,
        uniforms: uniforms.into_iter().map(|(name, value)| (name.into(), value)).collect(),
    }
}

/// Render one frame and return the center pixel.
fn frame(renderer: &mut Renderer, delta: f64, overlay: f32, alpha: f32) -> [u8; 4] {
    renderer.render(SIZE, SIZE, delta, &[0.0; 4], overlay, alpha);
    let pixels = renderer.read_rgba(SIZE, SIZE);
    let at = ((SIZE / 2 * SIZE + SIZE / 2) * 4) as usize;
    [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]]
}

fn near(actual: [u8; 4], expected: [u8; 4]) -> bool {
    actual.iter().zip(expected).all(|(a, e)| (i32::from(*a) - i32::from(e)).abs() <= 2)
}

const COLOR: &str = "precision mediump float; uniform vec3 color1; uniform int count; uniform bool mirror;\
    void main(){gl_FragColor=vec4(color1*(mirror?1.0:0.0)*float(count)/2.0,0.3);}";
const INVERT: &str = "precision mediump float; uniform sampler2D uInput; varying vec2 vUv;\
    void main(){gl_FragColor=vec4(1.0-texture2D(uInput,vUv).rgb,1.0);}";

#[test]
fn uploads_typed_uniforms_and_presents_opaque_premultiplied_frames() {
    let Some((_lock, _headless, mut renderer)) = context() else { return };
    assert!(near(frame(&mut renderer, 0.0, 0.0, 1.0), [0, 0, 0, 255]), "black before any scene");
    let spec = scene(
        COLOR,
        vec![
            ("color1", UniformValue::Vector(vec![1.0, 0.5, 0.0])),
            ("count", UniformValue::Scalar(2.4)),
            ("mirror", UniformValue::Scalar(1.0)),
        ],
        vec![],
    );
    renderer.set_scene(&spec).unwrap();
    assert!(near(frame(&mut renderer, 16.0, 0.0, 1.0), [255, 128, 0, 255]), "shader alpha is replaced by opaque");
    assert!(near(frame(&mut renderer, 16.0, 0.0, 0.5), [128, 64, 0, 128]), "fades are premultiplied");
    assert!(near(frame(&mut renderer, 16.0, 1.0, 1.0), [0, 0, 0, 255]), "the rotation overlay reaches black");
    assert!(near(frame(&mut renderer, 16.0, 0.5, 1.0), [128, 64, 0, 255]));
}

#[test]
fn native_custom_audio_uniform_compiles_and_stays_zero() {
    let Some((_lock, _headless, mut renderer)) = context() else { return };
    for declaration in ["", "uniform highp vec4 uAudio;"] {
        let shader = CustomShader {
            id: "custom-audio".into(),
            title: "Audio probe".into(),
            source: format!("{declaration} void main() {{ gl_FragColor = vec4(uAudio.rgb + vec3(0.0, 0.25, 0.5), 1.0); }}"),
        };
        let config = Config { custom_shaders: vec![shader], ..Config::default() };
        let spec = Catalog::builtin().build_scene(&config, &SceneTarget::shader("custom-audio")).unwrap();
        renderer.set_scene(&Arc::new(spec)).unwrap();
        renderer.render(SIZE, SIZE, 16.0, &[1.0; 4], 0.0, 1.0);
        assert!(near(renderer.read_rgba(SIZE, SIZE)[..4].try_into().unwrap(), [0, 64, 128, 255]));
    }
}

/// The editor reports driver errors on the user's own lines: the wrapper's prelude and any
/// comments that were stripped must not shift them.
#[test]
fn a_broken_custom_shader_reports_the_line_in_the_users_source() {
    use scrnsvr_core::diagnostics::{Diagnostic, map_driver_log};
    use scrnsvr_core::source::custom_fragment_source_mapped;

    let Some((_lock, headless, _renderer)) = context() else { return };
    // SAFETY: the headless context is current on this thread.
    let gl = unsafe { glow::Context::from_loader_function(|name| headless.egl.proc_address(name)) };
    let sources = [
        // Undefined variable on line 4, after a block comment that spans lines 1-2.
        ("/* header\n   notes */\nvoid mainImage(out vec4 color, in vec2 fragCoord) {\n  color = vec4(missing_value);\n}", 4),
        // A legacy main with the error on line 2 and a trailing line comment on line 1.
        ("void main() { // entry\n  gl_FragColor = vec4(vec3(1.0), nothing);\n}", 2),
        // Leading blank lines count: the error is on line 5.
        ("\n\n\nvoid mainImage(out vec4 color, in vec2 p) {\n  color = oops;\n}", 5),
    ];
    for (source, line) in sources {
        let mapped = custom_fragment_source_mapped(source).unwrap();
        let error = scrnsvr_render::compile_error(&gl, &mapped.source).expect("the shader is broken").to_string();
        let diagnostics = map_driver_log(&mapped, &error);
        assert!(diagnostics.iter().any(|diagnostic| diagnostic.line == Some(line)), "expected line {line}: {diagnostics:?}\n{error}");
        assert!(diagnostics.iter().all(|diagnostic: &Diagnostic| diagnostic.line.is_some()), "{diagnostics:?}");
    }
    // A shader that is fine compiles without a diagnostic.
    let ok = custom_fragment_source_mapped("void mainImage(out vec4 c, in vec2 p) { c = vec4(1.0); }").unwrap();
    assert!(scrnsvr_render::compile_error(&gl, &ok.source).is_none());
    drop(gl);
}

#[test]
fn keeps_the_running_scene_when_a_replacement_fails() {
    let Some((_lock, _headless, mut renderer)) = context() else { return };
    let red = scene("precision mediump float; void main(){gl_FragColor=vec4(1.0,0.0,0.0,1.0);}", vec![], vec![]);
    renderer.set_scene(&red).unwrap();
    let broken = scene("void main(){gl_FragColor=missing_value;}", vec![], vec![]);
    let error = renderer.set_scene(&broken).unwrap_err();
    assert!(error.to_string().starts_with("Shader compile failed:"), "{error}");
    assert!(Arc::ptr_eq(renderer.spec().unwrap(), &red));
    assert!(near(frame(&mut renderer, 16.0, 0.0, 1.0), [255, 0, 0, 255]));
}

#[test]
fn applies_effect_layers_in_order_and_skips_broken_ones() {
    let Some((_lock, _headless, mut renderer)) = context() else { return };
    let tint = "precision mediump float; uniform sampler2D uInput; uniform sampler2D uOriginal; uniform vec3 tint; varying vec2 vUv;\
        void main(){gl_FragColor=vec4(texture2D(uInput,vUv).rgb*tint+texture2D(uOriginal,vUv).rgb*0.0,1.0);}";
    let half = "precision mediump float; uniform sampler2D uInput; varying vec2 vUv; void main(){gl_FragColor=vec4(texture2D(uInput,vUv).rgb*0.5,1.0);}";
    let spec = scene(
        "precision mediump float; void main(){gl_FragColor=vec4(0.2,0.4,1.0,1.0);}",
        vec![],
        vec![
            effect("invert", &[INVERT], false, vec![]),
            effect("broken", &["void main(){nope}"], false, vec![]),
            effect("multipass", &[half, tint], false, vec![("tint", UniformValue::Vector(vec![1.0, 0.0, 1.0]))]),
        ],
    );
    renderer.set_scene(&spec).unwrap();
    assert_eq!(renderer.layer_ids(), ["invert", "multipass"]);
    // invert: (0.8, 0.6, 0.0); half: (0.4, 0.3, 0.0); tint: (0.4, 0, 0)
    assert!(near(frame(&mut renderer, 16.0, 0.0, 1.0), [102, 0, 0, 255]), "{:?}", frame(&mut renderer, 16.0, 0.0, 1.0));
}

#[test]
fn feeds_temporal_history_back_and_holds_it_on_zero_delta_frames() {
    let Some((_lock, _headless, mut renderer)) = context() else { return };
    // Each frame adds a quarter of white to the previous history; invalid history starts from black.
    let accumulate = "precision mediump float; uniform sampler2D uHistory; uniform bool uHistoryValid; varying vec2 vUv;\
        void main(){vec3 previous=uHistoryValid?texture2D(uHistory,vUv).rgb:vec3(0.0); gl_FragColor=vec4(previous+vec3(0.25),1.0);}";
    let spec = scene(
        "precision mediump float; void main(){gl_FragColor=vec4(0.0);}",
        vec![],
        vec![effect("trails", &[accumulate], true, vec![]), effect("invert", &[INVERT], false, vec![])],
    );
    renderer.set_scene(&spec).unwrap();
    assert!(near(frame(&mut renderer, 0.0, 0.0, 1.0), [191, 191, 191, 255]), "first frame renders with invalid history");
    assert!(near(frame(&mut renderer, 0.0, 0.0, 1.0), [191, 191, 191, 255]), "zero-delta frames present history unchanged");
    assert!(near(frame(&mut renderer, 16.0, 0.0, 1.0), [128, 128, 128, 255]), "history accumulates");
    assert!(near(frame(&mut renderer, 16.0, 0.0, 1.0), [64, 64, 64, 255]));
    renderer.set_scene(&spec).unwrap();
    assert!(near(frame(&mut renderer, 16.0, 0.0, 1.0), [191, 191, 191, 255]), "a new scene resets history");
}

#[test]
fn composites_the_clock_above_effects() {
    let Some((_lock, _headless, mut renderer)) = context() else { return };
    let spec = scene(
        "precision mediump float; void main(){gl_FragColor=vec4(0.0,0.0,0.0,1.0);}",
        vec![],
        vec![effect("invert", &[INVERT], false, vec![])],
    );
    renderer.set_scene(&spec).unwrap();
    assert!(near(frame(&mut renderer, 16.0, 0.0, 1.0), [255, 255, 255, 255]));
    let clock = ClockSpec {
        enabled: true,
        time: "88".into(),
        color: [1.0, 0.0, 0.0],
        size: 90.0,
        margin: 0.0,
        shadow: false,
        opacity: 1.0,
        ..ClockSpec::default()
    };
    let image = render_clock(&clock, SIZE, SIZE).unwrap().unwrap();
    renderer.set_clock(Some(&image));
    renderer.render(SIZE, SIZE, 16.0, &[0.0; 4], 0.0, 1.0);
    let pixels = renderer.read_rgba(SIZE, SIZE);
    assert!(
        pixels.as_chunks::<4>().0.iter().any(|p| p[0] > 200 && p[1] < 60 && p[3] == 255),
        "red clock text is drawn over the inverted scene"
    );
    renderer.set_clock(None);
    assert!(near(frame(&mut renderer, 16.0, 0.0, 1.0), [255, 255, 255, 255]), "the clock can be hidden");
}

#[test]
fn integrates_animation_time_with_the_speed_control() {
    let Some((_lock, _headless, mut renderer)) = context() else { return };
    // Encode uTime and speed in red/green so the frame shows what was uploaded.
    let source =
        "precision highp float; uniform float uTime; uniform float speed; void main(){gl_FragColor=vec4(uTime/2.0, speed/2.0, 0.0, 1.0);}";
    let mut spec = (*scene(source, vec![("speed", UniformValue::Scalar(2.0))], vec![])).clone();
    spec.integrated = true;
    renderer.set_scene(&Arc::new(spec.clone())).unwrap();
    frame(&mut renderer, 0.0, 0.0, 1.0);
    let pixel = frame(&mut renderer, 500.0, 0.0, 1.0);
    assert!(near(pixel, [128, 128, 0, 255]), "integrated phase is 1.0 and speed is fixed at one: {pixel:?}");
    spec.integrated = false;
    renderer.set_scene(&Arc::new(spec)).unwrap();
    frame(&mut renderer, 0.0, 0.0, 1.0);
    let pixel = frame(&mut renderer, 500.0, 0.0, 1.0);
    assert!(near(pixel, [64, 255, 0, 255]), "elapsed seconds and the raw speed value: {pixel:?}");
}

#[test]
fn updates_uniforms_live_without_recompiling() {
    let Some((_lock, _headless, mut renderer)) = context() else { return };
    let source = "precision highp float; uniform float uTime; uniform float speed; uniform float level; void main(){gl_FragColor=vec4(level, uTime, 0.0, 1.0);}";
    let mut spec = (*scene(source, vec![("speed", UniformValue::Scalar(1.0)), ("level", UniformValue::Scalar(0.0))], vec![])).clone();
    spec.integrated = true;
    renderer.set_scene(&Arc::new(spec)).unwrap();
    frame(&mut renderer, 0.0, 0.0, 1.0);
    renderer.set_uniform("level", UniformValue::Scalar(1.0));
    renderer.set_uniform("speed", UniformValue::Scalar(0.0));
    let pixel = frame(&mut renderer, 500.0, 0.0, 1.0);
    assert!(near(pixel, [255, 0, 0, 255]), "the new level shows and zero speed freezes integrated time: {pixel:?}");
}

#[test]
fn updates_effect_uniforms_live_on_the_mounted_layer_only() {
    let Some((_lock, _headless, mut renderer)) = context() else { return };
    let tint = "precision mediump float; uniform sampler2D uInput; uniform vec3 tint; varying vec2 vUv;\
        void main(){gl_FragColor=vec4(texture2D(uInput,vUv).rgb*tint,1.0);}";
    let spec = scene(
        "precision mediump float; void main(){gl_FragColor=vec4(1.0,1.0,1.0,1.0);}",
        vec![],
        vec![
            effect("first", &[tint], false, vec![("tint", UniformValue::Vector(vec![1.0, 0.0, 0.0]))]),
            effect("second", &[tint], false, vec![("tint", UniformValue::Vector(vec![1.0, 1.0, 1.0]))]),
        ],
    );
    renderer.set_scene(&spec).unwrap();
    assert!(near(frame(&mut renderer, 16.0, 0.0, 1.0), [255, 0, 0, 255]));
    renderer.set_effect_uniform("first", "tint", UniformValue::Vector(vec![0.0, 1.0, 0.0]));
    renderer.set_effect_uniform("missing", "tint", UniformValue::Vector(vec![0.0, 0.0, 1.0]));
    assert!(near(frame(&mut renderer, 16.0, 0.0, 1.0), [0, 255, 0, 255]), "the edit shows without remounting the scene");
    assert_eq!(renderer.layer_ids(), ["first", "second"]);
}

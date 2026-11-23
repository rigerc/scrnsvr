//! `--capture`: deterministic headless frames for parity checks and thumbnails.
//! Normal presentation never reads pixels back; this path exists only for explicit capture.

use std::io::{BufRead, Write};
use std::sync::Arc;

use scrnsvr_core::{CaptureOptions, ClockSpec, Message, ProtocolError};
use scrnsvr_platform::Egl;
use scrnsvr_render::{Renderer, render_clock};

use crate::{Exit, Fatal};

/// Binary PAM (`P7`) with top-down RGBA rows, readable without image libraries.
pub fn write_pam(path: &str, width: i32, height: i32, rgba: &[u8]) -> std::io::Result<()> {
    let mut file = std::io::BufWriter::new(std::fs::File::create(path)?);
    write!(file, "P7\nWIDTH {width}\nHEIGHT {height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n")?;
    file.write_all(rgba)?;
    file.flush()
}

pub fn capture(options: &CaptureOptions, native_display: *mut std::ffi::c_void) -> Result<Exit, Fatal> {
    let mut scene = None;
    let mut clock = ClockSpec::default();
    let mut audio = [0.0f32; 4];
    for line in std::io::stdin().lock().lines() {
        let line = line.map_err(|error| Fatal::new(Exit::Failed, format!("stdin: {error}")))?;
        if line.trim().is_empty() {
            continue;
        }
        match Message::parse(&line) {
            Ok(Message::Scene(spec)) => scene = Some(Arc::new(spec)),
            Ok(Message::Clock(spec)) => clock = spec,
            Ok(Message::Audio(values)) => audio.iter_mut().zip(values).for_each(|(slot, value)| *slot = value),
            Ok(Message::Dismiss | Message::Other) => {}
            Err(ProtocolError::MissingSource) => eprintln!("scrnsvr ignored a scene: Scene has no shader source"),
            Err(error) => eprintln!("scrnsvr ignored a malformed message: {error}"),
        }
    }
    let scene = scene.ok_or_else(|| Fatal::new(Exit::SceneFailed, "No scene to capture"))?;
    let (width, height) = (options.width, options.height);
    // SAFETY: `native_display` is null or the caller's live Wayland display.
    let headless = unsafe { Egl::headless(native_display, width, height) }?;
    // SAFETY: the headless context is current on this thread.
    let gl = unsafe { glow::Context::from_loader_function(|name| headless.egl.proc_address(name)) };
    let mut renderer = Renderer::new(gl).map_err(|error| Fatal::new(Exit::Unavailable, error.to_string()))?;
    renderer.set_scene(&scene).map_err(|error| Fatal::new(Exit::SceneFailed, format!("Scene {} failed: {error}", scene.key)))?;
    match render_clock(&clock, width, height) {
        Ok(image) => renderer.set_clock(image.as_ref()),
        Err(error) => eprintln!("scrnsvr could not draw the clock: {error}"),
    }
    for frame in 0..options.frames {
        renderer.render(width, height, if frame == 0 { 0.0 } else { options.delta_ms }, &audio, 0.0, 1.0);
    }
    let pixels = renderer.read_rgba(width, height);
    drop(renderer);
    drop(headless);
    write_pam(&options.path, width, height, &pixels).map_err(|error| Fatal::new(Exit::Failed, format!("{}: {error}", options.path)))?;
    Ok(Exit::Closed)
}

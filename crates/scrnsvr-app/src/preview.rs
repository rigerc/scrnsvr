use std::process::Command;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use glow::HasContext;
use scrnsvr_core::catalog::Catalog;
use scrnsvr_core::presentation::{OutputFade, Presentation};
use scrnsvr_platform::LayerShellSession;
use scrnsvr_render::{Renderer, render_clock};
use serde_json::Value;

use crate::controller::{ClockUpdates, STARTUP_TIMEOUT, primary};
use crate::{Result, STOP, load_config};

pub fn run(shader: Option<&str>) -> Result<()> {
    let config = load_config();
    let catalog = Catalog::builtin();
    let target = catalog.select_target(&config, shader, true, 0.0);
    let scene = Arc::new(catalog.build_scene(&config, &target)?);
    let mut session = LayerShellSession::connect_preview()?;
    let hints = session.output_hints();
    let output = primary(&hints).ok_or("No Wayland outputs are available")?;
    eprintln!("scrnsvr: using Wayland output {} for preview", output.name);
    session.init_egl()?;
    let index = session.open_preview(output.global)?;

    let start = Instant::now();
    let frame_interval = Duration::from_secs_f64(1.0 / f64::from(config.global.fps));
    let mut fade = OutputFade::default();
    let mut presentation = Presentation::<()>::new(config.global.fade_seconds * 1000.0);
    let mut updates = ClockUpdates::new(config.clock, start);
    let mut clock = None;
    let mut clock_dirty = false;
    let mut renderer = None;
    let mut last_frame = None;

    while !STOP.load(Ordering::Relaxed) && !session.closed() {
        let now = Instant::now();
        let time_ms = now.duration_since(start).as_secs_f64() * 1000.0;
        if session.take_dismiss() && presentation.dismiss(time_ms) {
            presentation.freeze_exit(&mut fade);
        }
        if presentation.exiting() && (presentation.alpha(&fade, time_ms) <= 0.0 || time_ms >= presentation.exit_deadline()) {
            break;
        }
        if last_frame.is_none() && now.duration_since(start) >= STARTUP_TIMEOUT {
            return Err("Preview did not present a frame in time".into());
        }
        if let Some(value) = updates.tick(now) {
            clock = Some(value.clone());
            clock_dirty = true;
        }
        let mut wait = Duration::from_millis(100);
        let view = session.output_mut(index);
        if view.is_open() && view.frame_ready {
            let remaining = last_frame.map_or(Duration::ZERO, |last| frame_interval.saturating_sub(now.duration_since(last)));
            if remaining.is_zero() {
                let size = view.buffer_size();
                let scale = view.scale;
                clock_dirty |= std::mem::take(&mut view.resized);
                let renderer = match &mut renderer {
                    Some(renderer) => renderer,
                    slot => {
                        session.make_current(index)?;
                        let egl = session.egl().ok_or("Preview EGL is unavailable")?;
                        // SAFETY: the preview's GLES context is current on this thread.
                        let gl = unsafe { glow::Context::from_loader_function(|name| egl.proc_address(name)) };
                        let mut initialized = Renderer::new(gl)?;
                        initialized.set_scene(&scene)?;
                        slot.insert(initialized)
                    }
                };
                if std::mem::take(&mut clock_dirty)
                    && let Some(clock) = &clock
                {
                    match render_clock(clock, size.0, size.1) {
                        Ok(image) => renderer.set_clock(image.as_ref()),
                        Err(error) => {
                            eprintln!("scrnsvr could not draw the clock: {error}");
                            renderer.set_clock(None);
                        }
                    }
                }
                fade.first_frame.get_or_insert(time_ms);
                let alpha = presentation.alpha(&fade, time_ms);
                let delta = last_frame.map_or(0.0, |last| now.duration_since(last).as_secs_f64() * 1000.0);
                renderer.render(size.0, size.1, delta, &[0.0; 4], 0.0, alpha as f32);
                draw_close_button(renderer.gl(), size, scale, alpha as f32);
                session.present(index, alpha >= 1.0)?;
                if last_frame.is_none() && std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some() {
                    session.sync_preview()?;
                    if let Err(error) = configure_hyprland(&output.name) {
                        eprintln!("scrnsvr: could not place the preview on {}: {error}", output.name);
                    }
                }
                last_frame = Some(now);
            } else {
                wait = wait.min(remaining.max(Duration::from_millis(1)));
            }
        }
        session.wait(wait)?;
    }
    Ok(())
}

/// Draw the close control inside the toplevel. Hyprland does not deliver
/// pointer input to title bars extending outside the preview's main surface.
fn draw_close_button(gl: &glow::Context, (width, height): (i32, i32), scale: i32, alpha: f32) {
    let size = 32 * scale;
    let inset = 12 * scale;
    if width < size + inset || height < size + inset {
        return;
    }
    let left = width - inset - size;
    let bottom = height - inset - size;
    // SAFETY: the renderer left the current context on framebuffer 0.
    unsafe {
        gl.enable(glow::SCISSOR_TEST);
        gl.scissor(left, bottom, size, size);
        gl.clear_color(0.10 * alpha, 0.11 * alpha, 0.13 * alpha, alpha);
        gl.clear(glow::COLOR_BUFFER_BIT);
        gl.clear_color(0.96 * alpha, 0.96 * alpha, 0.97 * alpha, alpha);
        for row in 0..12 {
            let y = bottom + (10 + row) * scale;
            for column in [9 + row, 20 - row] {
                gl.scissor(left + column * scale, y, scale * 2, scale);
                gl.clear(glow::COLOR_BUFFER_BIT);
            }
        }
        gl.disable(glow::SCISSOR_TEST);
    }
}

fn hypr_json(command: &str) -> Result<Value> {
    let output = Command::new("hyprctl").args(["-j", command]).output()?;
    if !output.status.success() {
        return Err(format!("hyprctl {command} returned {}", output.status).into());
    }
    Ok(serde_json::from_slice(&output.stdout)?)
}

fn hypr_dispatch(command: &str) -> bool {
    Command::new("hyprctl")
        .args(["dispatch", command])
        .output()
        .is_ok_and(|output| output.status.success() && output.stdout.trim_ascii() == b"ok")
}

fn configure_hyprland(output: &str) -> Result<()> {
    // xdg-shell leaves placement and tiling to the compositor. Target this process's
    // own preview through Hyprland IPC without adding or changing compositor rules.
    let monitors = hypr_json("monitors")?;
    let monitor = monitors
        .as_array()
        .and_then(|monitors| monitors.iter().find(|monitor| monitor["name"] == output))
        .ok_or("Output is absent from Hyprland")?;
    let monitor_id = monitor["id"].as_i64().ok_or("Could not identify the Hyprland monitor")?;
    let clients = hypr_json("clients")?;
    let pid = std::process::id();
    let client = clients
        .as_array()
        .and_then(|clients| clients.iter().find(|client| client["pid"] == pid && client["class"] == "scrnsvr-preview"))
        .ok_or("Preview has not mapped")?;
    let selector = format!("pid:{pid}");
    if client["floating"] != true
        && !hypr_dispatch(&format!("hl.dsp.window.float({{window='{selector}', action='set'}})"))
        && !hypr_dispatch(&format!("setfloating {selector}"))
    {
        return Err("Hyprland could not float the preview".into());
    }
    if client["monitor"] != monitor_id {
        let workspace = monitor["activeWorkspace"]["id"].as_i64().ok_or("Output has no workspace")?;
        if !hypr_dispatch(&format!("hl.dsp.window.move({{window='{selector}', monitor='{monitor_id}', follow=true}})"))
            && !hypr_dispatch(&format!("movetoworkspace {workspace},{selector}"))
        {
            return Err("Hyprland could not move the preview to the requested output".into());
        }
    }
    if !hypr_dispatch(&format!("hl.dsp.window.resize({{window='{selector}', x=960, y=540, relative=false}})"))
        && !hypr_dispatch(&format!("resizewindowpixel exact 960 540,{selector}"))
    {
        return Err("Hyprland could not set the initial preview size".into());
    }
    Ok(())
}

//! The layer-shell screensaver loop: protocol input, frame pacing, fades and readiness.

use std::os::fd::AsRawFd;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Instant;

use scrnsvr_core::protocol::READY_LINE;
use scrnsvr_core::{ClockSpec, Message, OutputFade, Presentation, RendererOptions, SceneSpec, Selection, select_outputs};
use scrnsvr_platform::LayerShellSession;
use scrnsvr_render::{Renderer, render_clock};

use crate::{Exit, Fatal, TERMINATED, emit};

/// Per-output presentation state, parallel to the session's outputs.
#[derive(Default)]
struct OutputRuntime {
    renderer: Option<Renderer>,
    fade: OutputFade,
    last_frame: Option<f64>,
    last_alpha: f64,
    clock_dirty: bool,
    scene_version: u64,
}

/// SCRNSVR_RENDERER_DEBUG=1 prints per-second frame statistics to stderr.
#[derive(Default)]
struct Stats {
    enabled: bool,
    frames: u64,
    callbacks_seen: u64,
    since: f64,
}

pub struct Saver {
    options: RendererOptions,
    session: LayerShellSession,
    presentation: Presentation<SceneSpec>,
    outputs: Vec<OutputRuntime>,
    clock: ClockSpec,
    audio: [f32; 4],
    ready_sent: bool,
    done: bool,
    input: Vec<u8>,
    stdin_open: bool,
    start: Instant,
    stats: Stats,
}

impl Saver {
    pub fn new(options: RendererOptions, mut session: LayerShellSession) -> Result<Self, Fatal> {
        if !session.has_layer_shell() {
            return Err(Fatal::new(Exit::Unavailable, "Compositor does not provide wlr-layer-shell"));
        }
        let hints = session.output_hints();
        let selection = select_outputs(&hints, &options);
        match &selection {
            Selection::None => return Err(Fatal::new(Exit::Unavailable, "No Wayland outputs are available")),
            Selection::One { global, fallback: true } => {
                let name = hints.iter().find(|hint| hint.global == *global).map(|hint| hint.name.as_str()).unwrap_or_default();
                eprintln!("scrnsvr could not identify the primary output; using {name}");
            }
            _ => {}
        }
        session.select(&selection);
        session.init_egl()?;
        // SAFETY: fd 0 is owned by this process for its lifetime.
        unsafe {
            let flags = libc::fcntl(0, libc::F_GETFL);
            libc::fcntl(0, libc::F_SETFL, flags | libc::O_NONBLOCK);
        }
        Ok(Self {
            presentation: Presentation::new(options.fade_ms),
            options,
            session,
            outputs: Vec::new(),
            clock: ClockSpec::default(),
            audio: [0.0; 4],
            ready_sent: false,
            done: false,
            input: Vec::new(),
            stdin_open: true,
            start: Instant::now(),
            stats: Stats { enabled: std::env::var_os("SCRNSVR_RENDERER_DEBUG").is_some(), ..Stats::default() },
        })
    }

    fn now(&self) -> f64 {
        self.start.elapsed().as_secs_f64() * 1000.0
    }

    pub fn run(&mut self) -> Result<Exit, Fatal> {
        while !self.done && !TERMINATED.load(Ordering::SeqCst) {
            self.dispatch()?;
            let timeout = self.frame()?;
            if self.done {
                break;
            }
            // EGL may have read events (such as our frame callbacks) into the queue while
            // swapping. Dispatching them can make a frame due, so schedule again first.
            let Some(guard) = self.session.prepare_read() else {
                self.dispatch()?;
                continue;
            };
            self.session.flush()?;
            let mut fds = [
                libc::pollfd { fd: guard.connection_fd().as_raw_fd(), events: libc::POLLIN, revents: 0 },
                libc::pollfd { fd: 0, events: if self.stdin_open { libc::POLLIN } else { 0 }, revents: 0 },
            ];
            let count = if self.stdin_open { 2 } else { 1 };
            // SAFETY: `fds` holds `count` initialized entries.
            let ready = unsafe { libc::poll(fds.as_mut_ptr(), count, timeout) };
            if ready < 0 {
                drop(guard);
                if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(Fatal::new(Exit::Failed, "poll failed"));
            }
            if fds[0].revents & libc::POLLIN != 0 {
                match guard.read() {
                    Ok(_) => {}
                    Err(wayland_error) if is_would_block(&wayland_error) => {}
                    Err(_) => return Err(Fatal::new(Exit::Failed, "Wayland compositor disconnected")),
                }
                self.dispatch()?;
            } else {
                drop(guard);
            }
            if fds[0].revents & (libc::POLLERR | libc::POLLHUP) != 0 {
                return Err(Fatal::new(Exit::Failed, "Wayland compositor disconnected"));
            }
            if self.stdin_open && fds[1].revents & (libc::POLLIN | libc::POLLHUP | libc::POLLERR) != 0 {
                self.read_input()?;
            }
        }
        Ok(Exit::Closed)
    }

    fn dispatch(&mut self) -> Result<(), Fatal> {
        self.session.dispatch_pending()?;
        self.outputs.resize_with(self.session.outputs().len(), || OutputRuntime { clock_dirty: true, ..OutputRuntime::default() });
        if self.session.take_dismiss() {
            self.dismiss();
        }
        if self.session.closed() {
            self.done = true;
        }
        Ok(())
    }

    fn dismiss(&mut self) {
        let now = self.now();
        if !self.presentation.dismiss(now) {
            return;
        }
        for output in &mut self.outputs {
            self.presentation.freeze_exit(&mut output.fade);
        }
        if self.options.fade_ms <= 0.0 {
            self.done = true;
        }
    }

    /// Render due outputs; returns the poll timeout in milliseconds (-1 waits for events).
    fn frame(&mut self) -> Result<i32, Fatal> {
        let now = self.now();
        if self.stats.enabled && now - self.stats.since >= 1000.0 {
            if self.stats.since > 0.0 {
                eprintln!(
                    "scrnsvr-renderer: {} frames, {} callbacks, overlay {:.2}",
                    self.stats.frames,
                    self.stats.callbacks_seen,
                    self.presentation.overlay(now)
                );
            }
            self.stats = Stats { enabled: true, since: now, ..Stats::default() };
        }
        self.presentation.advance(now);
        let mut next: Option<f64> = None;
        let mut wake = |at: f64| next = Some(next.map_or(at, |current: f64| current.min(at)));
        if self.presentation.scene().is_some() && self.session.surfaces_open() {
            let interval = self.options.interval_ms();
            let tolerance = (interval * 0.1).min(2.0);
            for index in 0..self.outputs.len() {
                let output = &self.session.outputs()[index];
                if !output.selected || !output.is_open() || !output.frame_ready {
                    continue;
                }
                let due = self.outputs[index].last_frame.map_or(now, |last| last + interval);
                if now + tolerance >= due {
                    self.render_output(index, now)?;
                } else {
                    wake(due);
                }
            }
        }
        if self.presentation.exiting() {
            // Finished: every output presented a transparent frame or stopped presenting altogether.
            let finished = self.session.outputs().iter().zip(&self.outputs).filter(|(output, _)| output.selected && output.is_open()).all(
                |(output, runtime)| {
                    let stalled = !output.frame_ready && runtime.last_frame.is_some_and(|last| now - last > 1000.0);
                    runtime.last_frame.is_none() || runtime.last_alpha <= 0.0 || stalled
                },
            );
            if finished || now > self.presentation.exit_deadline() {
                self.done = true;
            }
            wake(self.presentation.exit_deadline());
            wake(now + 250.0);
        }
        if !self.ready_sent && self.session.surfaces_open() {
            let ready = self
                .session
                .outputs()
                .iter()
                .zip(&self.outputs)
                .filter(|(output, _)| output.selected)
                .all(|(_, runtime)| runtime.last_frame.is_some());
            if ready {
                self.ready_sent = true;
                emit(READY_LINE);
            }
        }
        Ok(match next {
            None => -1,
            Some(at) => ((at - self.now()).max(0.0) + 0.999) as i32,
        })
    }

    fn render_output(&mut self, index: usize, now: f64) -> Result<(), Fatal> {
        self.session.make_current(index)?;
        let runtime = &mut self.outputs[index];
        if runtime.renderer.is_none() {
            let egl = self.session.egl().ok_or_else(|| Fatal::new(Exit::Unavailable, "EGL is not initialized"))?;
            // SAFETY: this output's context was made current above.
            let gl = unsafe { glow::Context::from_loader_function(|name| egl.proc_address(name)) };
            runtime.renderer = Some(Renderer::new(gl).map_err(|error| Fatal::new(Exit::Unavailable, error.to_string()))?);
        }
        let renderer = runtime.renderer.as_mut().expect("renderer created above");
        if runtime.scene_version != self.presentation.scene_version()
            && let Some(scene) = self.presentation.scene()
        {
            let initial = !renderer.has_scene();
            runtime.scene_version = self.presentation.scene_version();
            if let Err(error) = renderer.set_scene(scene) {
                if initial {
                    return Err(Fatal::new(Exit::SceneFailed, format!("Scene {} failed: {error}", scene.key)));
                }
                eprintln!("scrnsvr could not switch to {}; keeping the current scene: {error}", scene.key);
            }
        }
        let output = self.session.output_mut(index);
        let (width, height) = output.buffer_size();
        if std::mem::take(&mut output.resized) {
            runtime.clock_dirty = true;
        }
        if std::mem::take(&mut runtime.clock_dirty) {
            match render_clock(&self.clock, width, height) {
                Ok(image) => renderer.set_clock(image.as_ref()),
                Err(error) => {
                    eprintln!("scrnsvr could not draw the clock: {error}");
                    renderer.set_clock(None);
                }
            }
        }
        if runtime.fade.first_frame.is_none() {
            runtime.fade.first_frame = Some(now);
        }
        let delta = runtime.last_frame.map_or(0.0, |last| now - last);
        let alpha = self.presentation.alpha(&runtime.fade, now);
        renderer.render(width, height, delta, &self.audio, self.presentation.overlay(now) as f32, alpha as f32);
        self.session.present(index, alpha >= 1.0)?;
        let runtime = &mut self.outputs[index];
        runtime.last_frame = Some(now);
        runtime.last_alpha = alpha;
        self.stats.frames += 1;
        Ok(())
    }

    fn handle_message(&mut self, line: &str) -> Result<(), Fatal> {
        match Message::parse(line) {
            Err(scrnsvr_core::ProtocolError::MissingSource) => eprintln!("scrnsvr ignored a scene: Scene has no shader source"),
            Err(error) => eprintln!("scrnsvr ignored a malformed message: {error}"),
            Ok(Message::Scene(spec)) => {
                let now = self.now();
                self.presentation.set_scene(Arc::new(spec), now);
                if !self.session.surfaces_open() && !self.presentation.exiting() {
                    self.session.open_surfaces()?;
                }
            }
            Ok(Message::Clock(clock)) => {
                self.clock = clock;
                self.outputs.iter_mut().for_each(|output| output.clock_dirty = true);
            }
            Ok(Message::Audio(values)) => {
                for (slot, value) in self.audio.iter_mut().zip(values) {
                    *slot = value;
                }
            }
            Ok(Message::Dismiss) => self.dismiss(),
            Ok(Message::Other) => {}
        }
        Ok(())
    }

    fn read_input(&mut self) -> Result<(), Fatal> {
        let mut buffer = [0u8; 65536];
        loop {
            // SAFETY: reading into a stack buffer of the given length.
            let count = unsafe { libc::read(0, buffer.as_mut_ptr().cast(), buffer.len()) };
            if count > 0 {
                self.input.extend_from_slice(&buffer[..count as usize]);
                continue;
            }
            if count == 0 {
                self.stdin_open = false;
                break;
            }
            match std::io::Error::last_os_error().kind() {
                std::io::ErrorKind::Interrupted => continue,
                std::io::ErrorKind::WouldBlock => {}
                _ => self.stdin_open = false,
            }
            break;
        }
        let mut start = 0;
        while let Some(offset) = self.input[start..].iter().position(|byte| *byte == b'\n') {
            let end = start + offset;
            if end > start {
                let line = String::from_utf8_lossy(&self.input[start..end]).into_owned();
                self.handle_message(&line)?;
            }
            start = end + 1;
        }
        self.input.drain(..start);
        // Without its controller the screensaver has no way to be supervised; leave gracefully.
        if !self.stdin_open {
            self.dismiss();
        }
        Ok(())
    }
}

fn is_would_block(error: &wayland_client::backend::WaylandError) -> bool {
    matches!(error, wayland_client::backend::WaylandError::Io(io) if io.kind() == std::io::ErrorKind::WouldBlock)
}

impl Drop for Saver {
    fn drop(&mut self) {
        // GL objects must be deleted with their own context current.
        for index in 0..self.outputs.len() {
            if self.outputs[index].renderer.is_some() && self.session.make_current(index).is_ok() {
                self.outputs[index].renderer = None;
            } else if let Some(renderer) = self.outputs[index].renderer.take() {
                // Without its context the objects die with it; skip GL calls.
                std::mem::forget(renderer);
            }
        }
    }
}

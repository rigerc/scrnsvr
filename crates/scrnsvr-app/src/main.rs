//! scrnsvr-renderer (Rust): draws the screensaver directly into wlr-layer-shell
//! surfaces. It takes
//! the arguments and speaks the JSON-lines protocol that `scrnsvr` and the settings app use.
//!
//! The main process resolves everything a scene needs and streams it on stdin
//! (see `scrnsvr_core::protocol`). This program owns presentation: EGL
//! surfaces, frame pacing from compositor frame callbacks, fades, and input.
//!
//! exit: 0 closed, 1 runtime failure, 2 layer-shell/EGL unavailable, 3 initial scene failed.

mod capture;
mod saver;

use std::io::{BufRead, Write};
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};

use scrnsvr_core::RendererOptions;
use scrnsvr_core::protocol::{compile_report, parse_compile_item};
use scrnsvr_platform::{Egl, LayerShellSession, PlatformError};
use scrnsvr_render::compile_error;

/// Exit codes the main process interprets before readiness.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exit {
    Closed = 0,
    Failed = 1,
    Unavailable = 2,
    SceneFailed = 3,
}

#[derive(Debug)]
pub struct Fatal {
    pub code: Exit,
    pub message: String,
}

impl Fatal {
    pub fn new(code: Exit, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

impl From<PlatformError> for Fatal {
    fn from(error: PlatformError) -> Self {
        match error {
            PlatformError::Unavailable(message) => Fatal::new(Exit::Unavailable, message),
            PlatformError::Failed(message) => Fatal::new(Exit::Failed, message),
        }
    }
}

pub static TERMINATED: AtomicBool = AtomicBool::new(false);

extern "C" fn on_signal(_: libc::c_int) {
    TERMINATED.store(true, Ordering::SeqCst);
}

fn install_signal_handlers() {
    // SAFETY: the handler only stores to an atomic, which is async-signal-safe.
    unsafe {
        let mut action: libc::sigaction = std::mem::zeroed();
        action.sa_sigaction = on_signal as *const () as usize;
        libc::sigemptyset(&mut action.sa_mask);
        libc::sigaction(libc::SIGTERM, &action, std::ptr::null_mut());
        libc::sigaction(libc::SIGINT, &action, std::ptr::null_mut());
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
    }
}

/// Write one protocol line to stdout. Diagnostics go to stderr only.
pub fn emit(line: &str) {
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{line}");
    let _ = stdout.flush();
}

/// Compile each `{"id","source"}` line with a headless context and report the result.
fn compile_check(session: Option<&LayerShellSession>) -> Result<Exit, Fatal> {
    let display = session.map_or(std::ptr::null_mut(), LayerShellSession::display_ptr);
    // SAFETY: the session (and its wl_display) outlives the headless context, dropped at the end of this function.
    let headless = unsafe { Egl::headless(display, 16, 16) }?;
    // SAFETY: the headless context is current on this thread.
    let gl = unsafe { glow::Context::from_loader_function(|name| headless.egl.proc_address(name)) };
    let mut failures = 0;
    for line in std::io::stdin().lock().lines() {
        let line = line.map_err(|error| Fatal::new(Exit::Failed, format!("stdin: {error}")))?;
        if line.trim().is_empty() {
            continue;
        }
        let (id, source) = parse_compile_item(&line).map_err(|error| Fatal::new(Exit::Failed, error.to_string()))?;
        let error = compile_error(&gl, &source).map(|error| error.to_string());
        failures += usize::from(error.is_some());
        emit(&compile_report(&id, error.as_deref()));
    }
    drop(gl);
    drop(headless);
    Ok(if failures > 0 { Exit::Failed } else { Exit::Closed })
}

fn run(options: RendererOptions) -> Result<Exit, Fatal> {
    if let Some(capture) = &options.capture {
        let session = LayerShellSession::connect().ok();
        return capture::capture(capture, session.as_ref().map_or(std::ptr::null_mut(), LayerShellSession::display_ptr));
    }
    if options.compile_check {
        // A Wayland connection is preferred (it selects the compositor's GPU); headless EGL works without one.
        let session = LayerShellSession::connect().ok();
        return compile_check(session.as_ref());
    }
    let session = LayerShellSession::connect()?;
    saver::Saver::new(options, session)?.run()
}

fn main() -> ExitCode {
    install_signal_handlers();
    let result =
        RendererOptions::parse(std::env::args().skip(1)).map_err(|error| Fatal::new(Exit::Failed, error.to_string())).and_then(run);
    let code = match result {
        Ok(code) => code,
        Err(fatal) => {
            eprintln!("scrnsvr-renderer: {}", fatal.message);
            fatal.code
        }
    };
    ExitCode::from(code as u8)
}

//! Fullscreen preview: show the selected visual the way the saver does.
//!
//! The settings window does not draw fullscreen itself. It saves pending edits, then runs the
//! sibling `scrnsvr --open --shader <id>`, so the preview is the real saver (layer shell above
//! other windows, effects, clock, fades) and ends the same way: any key or pointer movement.

use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use gpui_kit::*;
use scrnsvr_core::exec::{find_executable, saver_running};

use crate::app::Settings;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Fullscreen {
    #[default]
    Idle,
    /// Waiting for pending edits to reach the config file.
    Saving,
    Showing,
    Failed(String),
}

pub const ALREADY_RUNNING: &str = "A screensaver is already showing. Press a key or move the pointer to close it, then try again.";

/// Run `scrnsvr --open --shader <shader>` and wait for it to end. Blocks, so call it off the UI thread.
pub fn show(program: &Path, shader: &str) -> Result<(), String> {
    let mut child = Command::new(program)
        .args(["--open", "--shader", shader])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start {}: {error}", program.display()))?;
    let mut stderr = String::new();
    if let Some(mut pipe) = child.stderr.take() {
        let _ = pipe.read_to_string(&mut stderr);
    }
    let status = child.wait().map_err(|error| error.to_string())?;
    if status.success() {
        return Ok(());
    }
    let detail = stderr.lines().rev().find(|line| !line.trim().is_empty()).unwrap_or_default().trim();
    let detail = detail.strip_prefix("scrnsvr: ").unwrap_or(detail);
    Err(if detail.is_empty() { format!("The fullscreen preview ended with {status}.") } else { detail.to_owned() })
}

/// Ask the running saver to fade out (`scrnsvr --dismiss`).
pub fn exit(program: &Path) -> Result<(), String> {
    let status = Command::new(program)
        .arg("--dismiss")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("Could not start {}: {error}", program.display()))?;
    if status.success() { Ok(()) } else { Err(format!("scrnsvr --dismiss ended with {status}.")) }
}

impl Settings {
    fn scrnsvr_program(&self) -> Result<PathBuf, String> {
        match &self.paths.scrnsvr {
            Some(program) => Ok(program.clone()),
            None => find_executable("scrnsvr"),
        }
    }

    pub fn start_fullscreen(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if matches!(self.fullscreen, Fullscreen::Saving | Fullscreen::Showing) {
            return;
        }
        let program = match self.scrnsvr_program() {
            Ok(program) => program,
            Err(error) => {
                self.fullscreen = Fullscreen::Failed(error);
                cx.notify();
                return;
            }
        };
        let blocked = match &self.paths.runtime {
            Some(directory) => scrnsvr_core::exec::saver_running_in(directory).unwrap_or(false),
            None => saver_running(),
        };
        if blocked {
            self.fullscreen = Fullscreen::Failed(ALREADY_RUNNING.into());
            cx.notify();
            return;
        }
        // The saver reads the saved config, so edits (and a custom source still being checked) go first.
        self.flush_editor(window, cx);
        self.fullscreen = Fullscreen::Saving;
        self.config_save.retry(cx.background_executor().now());
        self.start_saving(window, cx);
        let shader = self.model.visual().id.clone();
        cx.notify();
        cx.spawn_in(window, async move |this, cx| {
            let saved = loop {
                let state =
                    this.update_in(cx, |this, _, _| (this.config_save.pending() || this.custom.busy(), this.config_save.error.clone()));
                match state {
                    Err(_) => return,
                    Ok((true, _)) => cx.background_executor().timer(Duration::from_millis(25)).await,
                    Ok((false, error)) => break error.map_or(Ok(()), Err),
                }
            };
            if let Err(error) = saved {
                let _ = this.update(cx, |this, cx| {
                    this.fullscreen =
                        Fullscreen::Failed(format!("Your edits could not be saved, so the preview would not match them. {error}"));
                    cx.notify();
                });
                return;
            }
            let started = this.update(cx, |this, cx| {
                this.fullscreen = Fullscreen::Showing;
                if !this.paused {
                    this.fullscreen_paused = true;
                    this.set_paused(true, cx);
                }
                cx.notify();
            });
            if started.is_err() {
                return;
            }
            let result = cx.background_executor().spawn(async move { show(&program, &shader) }).await;
            let _ = this.update(cx, |this, cx| {
                this.fullscreen = match result {
                    Ok(()) => Fullscreen::Idle,
                    Err(error) => Fullscreen::Failed(error),
                };
                if std::mem::take(&mut this.fullscreen_paused) {
                    this.set_paused(false, cx);
                }
                cx.notify();
            });
        })
        .detach();
    }

    pub fn exit_fullscreen(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Ok(program) = self.scrnsvr_program() else { return };
        cx.spawn_in(window, async move |this, cx| {
            if let Err(error) = cx.background_executor().spawn(async move { exit(&program) }).await {
                let _ = this.update(cx, |this, cx| {
                    this.fullscreen = Fullscreen::Failed(error);
                    cx.notify();
                });
            }
        })
        .detach();
    }

    pub fn dismiss_fullscreen_message(&mut self, cx: &mut Context<Self>) {
        if matches!(self.fullscreen, Fullscreen::Failed(_)) {
            self.fullscreen = Fullscreen::Idle;
            cx.notify();
        }
    }
}

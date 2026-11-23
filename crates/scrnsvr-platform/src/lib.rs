//! Platform adapters for the native saver: EGL ownership and Wayland
//! layer-shell surfaces. Policy (pacing, fades, scene changes) stays in the
//! application; this crate has no GL or settings-UI dependencies.

pub mod egl;
pub mod layer_shell;

pub use egl::{Egl, Headless};
pub use khronos_egl;
pub use layer_shell::{LayerShellSession, OutputSurface};

/// Failures, by the exit code the main process expects before readiness.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum PlatformError {
    /// Layer-shell, EGL or GLES is unavailable: exit 2, fall back to windows.
    #[error("{0}")]
    Unavailable(String),
    /// A runtime failure: exit 1.
    #[error("{0}")]
    Failed(String),
}

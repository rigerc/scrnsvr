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

/// Flush outgoing requests, then read Wayland events with a bounded wait.
pub(crate) fn wait_for_events(
    connection: &wayland_client::Connection,
    guard: wayland_client::backend::ReadEventsGuard,
    timeout: std::time::Duration,
) -> Result<(), PlatformError> {
    use std::os::fd::AsRawFd;
    use wayland_client::backend::WaylandError;

    let mut fd = libc::pollfd { fd: guard.connection_fd().as_raw_fd(), events: libc::POLLIN, revents: 0 };
    match connection.flush() {
        Ok(()) => {}
        Err(WaylandError::Io(error)) if error.kind() == std::io::ErrorKind::WouldBlock => fd.events |= libc::POLLOUT,
        Err(error) => return Err(PlatformError::Failed(format!("Wayland flush: {error}"))),
    }
    // SAFETY: fd points to one initialized pollfd for the duration of the call.
    let ready = unsafe { libc::poll(&mut fd, 1, timeout.as_millis().min(i32::MAX as u128) as i32) };
    if ready < 0 {
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::Interrupted {
            return Err(PlatformError::Failed(format!("Wayland poll: {error}")));
        }
    } else if ready > 0 && fd.revents & (libc::POLLIN | libc::POLLHUP | libc::POLLERR) != 0 {
        match guard.read() {
            Ok(_) => {}
            Err(WaylandError::Io(error)) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(error) => return Err(PlatformError::Failed(format!("Wayland read: {error}"))),
        }
    } else if fd.revents & libc::POLLNVAL != 0 {
        return Err(PlatformError::Failed("Wayland connection is closed".into()));
    }
    Ok(())
}

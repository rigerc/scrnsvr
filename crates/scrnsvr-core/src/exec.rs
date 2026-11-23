//! Finding the sibling `scrnsvr` programs and checking whether the saver is running.

use std::env;
use std::ffi::CString;
use std::fs::File;
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};

fn executable(path: &Path) -> bool {
    path.is_file()
        && CString::new(path.as_os_str().as_bytes()).is_ok_and(|path| {
            // SAFETY: the CString is live and NUL-terminated.
            unsafe { libc::access(path.as_ptr(), libc::X_OK) == 0 }
        })
}

/// An executable named `name` next to the running program, else on `PATH`, as an absolute path.
pub fn find_executable(name: &str) -> Result<PathBuf, String> {
    let current = env::current_exe().map_err(|error| error.to_string())?;
    let path = env::var_os("PATH").unwrap_or_default();
    let found = std::iter::once(current.with_file_name(name))
        .chain(env::split_paths(&path).map(|dir| dir.join(name)))
        .find(|candidate| executable(candidate))
        .ok_or_else(|| format!("{name} is unavailable; checked next to {} and on PATH", current.display()))?;
    // A relative PATH entry still needs a slash when handed to `Command`.
    std::path::absolute(found).map_err(|error| error.to_string())
}

/// The saver's runtime directory, `$XDG_RUNTIME_DIR/scrnsvr`.
pub fn runtime_directory() -> Option<PathBuf> {
    env::var_os("XDG_RUNTIME_DIR").filter(|value| Path::new(value).is_absolute()).map(|value| PathBuf::from(value).join("scrnsvr"))
}

/// Whether a saver holds its single-instance lock in `directory`. A second `--open` would exit
/// without showing anything, so callers use this to say so instead.
pub fn saver_running_in(directory: &Path) -> io::Result<bool> {
    let lock = match File::open(directory.join("saver.lock")) {
        Ok(lock) => lock,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    // SAFETY: the descriptor is live for the call; a shared lock conflicts with the saver's exclusive one.
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_SH | libc::LOCK_NB) } == 0 {
        return Ok(false);
    }
    let error = io::Error::last_os_error();
    if error.kind() == io::ErrorKind::WouldBlock { Ok(true) } else { Err(error) }
}

pub fn saver_running() -> bool {
    runtime_directory().is_some_and(|directory| saver_running_in(&directory).unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    #[test]
    fn finds_executables_on_path_and_reports_missing_ones() {
        let directory = tempfile::tempdir().unwrap();
        let program = directory.path().join("scrnsvr-probe");
        std::fs::write(&program, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(executable(&program));
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!executable(&program));
        assert!(find_executable("scrnsvr-definitely-missing").unwrap_err().contains("unavailable"));
    }

    #[test]
    fn a_held_exclusive_lock_means_a_saver_is_running() {
        let directory = tempfile::tempdir().unwrap();
        assert!(!saver_running_in(directory.path()).unwrap(), "no lock file");
        let lock = File::create(directory.path().join("saver.lock")).unwrap();
        assert!(!saver_running_in(directory.path()).unwrap(), "unlocked");
        // SAFETY: the descriptor is live.
        assert_eq!(unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) }, 0);
        assert!(saver_running_in(directory.path()).unwrap());
        drop(lock);
        assert!(!saver_running_in(directory.path()).unwrap());
    }
}

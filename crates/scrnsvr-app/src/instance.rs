use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use crate::Result;

pub fn runtime_directory() -> Option<PathBuf> {
    env::var_os("XDG_RUNTIME_DIR").filter(|value| Path::new(value).is_absolute()).map(|value| PathBuf::from(value).join("scrnsvr"))
}

fn acquire(dir: &Path) -> io::Result<Option<File>> {
    let lock = OpenOptions::new().read(true).write(true).create(true).mode(0o600).truncate(false).open(dir.join("saver.lock"))?;
    loop {
        // SAFETY: this process owns the live descriptor and retains it for the saver lifetime.
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
            return Ok(Some(lock));
        }
        let error = io::Error::last_os_error();
        match error.kind() {
            io::ErrorKind::WouldBlock => return Ok(None),
            io::ErrorKind::Interrupted => continue,
            _ => return Err(error),
        }
    }
}

fn unlink_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

pub struct Instance {
    _lock: File,
    pid_file: PathBuf,
}

impl Instance {
    /// Take the saver lock and record this process's PID, or return `None` when a saver already runs.
    pub fn open(dir: &Path) -> Result<Option<Self>> {
        fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
        let Some(lock) = acquire(dir)? else { return Ok(None) };
        let pid_file = dir.join("saver.pid");
        // Publish the PID atomically so `--dismiss` never reads a partial file.
        let mut staged = tempfile::NamedTempFile::new_in(dir)?;
        writeln!(staged, "{}", std::process::id())?;
        staged.persist(&pid_file)?;
        Ok(Some(Self { _lock: lock, pid_file }))
    }
}

impl Drop for Instance {
    fn drop(&mut self) {
        // Keep the lock held through cleanup. Keep the lock file itself so all
        // callers lock the same inode, including callers waiting on old state.
        let _ = unlink_if_present(&self.pid_file);
    }
}

/// Ask the running saver to fade out. Returns `false` when no saver holds the lock.
pub fn dismiss(dir: &Path) -> io::Result<bool> {
    signal_saver(dir, libc::SIGUSR1)
}

fn signal_saver(dir: &Path, signal: libc::c_int) -> io::Result<bool> {
    let deadline = Instant::now() + Duration::from_millis(500);
    loop {
        // Holding the lock here means no saver owns the PID file, so a leftover PID is stale.
        match acquire(dir) {
            Ok(Some(_)) => return Ok(false),
            Ok(None) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        }
        let pid = fs::read_to_string(dir.join("saver.pid")).ok().and_then(|text| text.trim().parse::<libc::pid_t>().ok());
        if let Some(pid) = pid.filter(|pid| *pid > 1) {
            // SAFETY: kill only sends a signal to the process that currently owns the saver lock.
            if unsafe { libc::kill(pid, signal) } == 0 {
                return Ok(true);
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                return Err(error);
            }
        }
        if Instant::now() >= deadline {
            return Err(io::Error::new(io::ErrorKind::TimedOut, "The running saver has not published its process ID"));
        }
        thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering;

    use super::*;

    #[test]
    fn second_instance_cannot_lock_and_pid_is_removed_on_exit() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("scrnsvr");
        let instance = Instance::open(&path).unwrap().unwrap();
        assert!(Instance::open(&path).unwrap().is_none());
        assert_eq!(fs::read_to_string(path.join("saver.pid")).unwrap().trim(), std::process::id().to_string());
        drop(instance);
        assert!(!path.join("saver.pid").exists());
        assert!(Instance::open(&path).unwrap().is_some());
    }

    #[test]
    fn dismiss_signals_the_running_instance_and_is_idempotent_without_a_saver() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("scrnsvr");
        // No directory, then a stale PID file with no lock holder: nothing to dismiss, and no signal sent.
        assert!(!dismiss(&path).unwrap());
        fs::create_dir(&path).unwrap();
        fs::write(path.join("saver.pid"), format!("{}\n", std::process::id())).unwrap();
        assert!(!dismiss(&path).unwrap());
        assert!(!crate::STOP.load(Ordering::Relaxed));

        let instance = Instance::open(&path).unwrap().unwrap();
        crate::install_signals().unwrap();
        assert!(dismiss(&path).unwrap());
        // The handler may run on another test thread, so allow it a moment.
        let deadline = Instant::now() + Duration::from_secs(2);
        while !crate::STOP.load(Ordering::Relaxed) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(crate::STOP.swap(false, Ordering::Relaxed), "SIGUSR1 reaches the saver's dismissal flag");
        drop(instance);
        assert!(!dismiss(&path).unwrap());
    }
}

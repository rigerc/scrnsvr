//! A client for `scrnsvr-renderer --compile-check`.
//!
//! Custom shaders are validated with a real GLES compile by the same renderer binary and GPU
//! context choice the saver uses, in a child process: a driver that hangs or crashes cannot take
//! the settings window down, and the answer matches what the saver will do. The child is kept
//! running between checks; a check that gets no answer in time kills it and the next one starts
//! a fresh child.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{Value, json};

/// How long one compile may take before the checker gives up on the child.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheckError {
    /// The renderer could not be started, or ended without answering. Carries its last message.
    Unavailable(String),
    TimedOut,
}

impl std::fmt::Display for CheckError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CheckError::Unavailable(reason) => write!(f, "The GPU shader check is unavailable: {reason}"),
            CheckError::TimedOut => f.write_str("The GPU shader check did not finish in time."),
        }
    }
}

impl std::error::Error for CheckError {}

struct Running {
    child: Child,
    stdin: ChildStdin,
    answers: Receiver<String>,
    last_error: Arc<Mutex<String>>,
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub struct CompileChecker {
    program: PathBuf,
    timeout: Duration,
    running: Option<Running>,
    next_id: u64,
}

impl CompileChecker {
    pub fn new(program: impl Into<PathBuf>) -> Self {
        Self { program: program.into(), timeout: DEFAULT_TIMEOUT, running: None, next_id: 0 }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    fn start(&self) -> Result<Running, CheckError> {
        let unavailable = |error: std::io::Error| CheckError::Unavailable(format!("{}: {error}", self.program.display()));
        let mut child = Command::new(&self.program)
            .arg("--compile-check")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(unavailable)?;
        let stdin = child.stdin.take().expect("stdin was piped");
        let stdout = child.stdout.take().expect("stdout was piped");
        let stderr = child.stderr.take().expect("stderr was piped");
        let (sender, answers) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        let last_error = Arc::new(Mutex::new(String::new()));
        let record = Arc::clone(&last_error);
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok).filter(|line| !line.trim().is_empty()) {
                *record.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = line;
            }
        });
        Ok(Running { child, stdin, answers, last_error })
    }

    /// Compile and link `fragment`. `Ok(None)` means it works; `Ok(Some(log))` is the driver's
    /// complaint, prefixed `Shader compile failed:` or `Shader link failed:`.
    pub fn check(&mut self, fragment: &str) -> Result<Option<String>, CheckError> {
        // One restart covers a child that died while idle.
        for attempt in 0..2 {
            if self.running.is_none() {
                self.running = Some(self.start()?);
            }
            match self.exchange(fragment) {
                Err(CheckError::Unavailable(_)) if attempt == 0 => continue,
                result => return result,
            }
        }
        unreachable!("the second attempt returns")
    }

    fn exchange(&mut self, fragment: &str) -> Result<Option<String>, CheckError> {
        self.next_id += 1;
        let id = self.next_id.to_string();
        let running = self.running.as_mut().expect("started by check");
        let request = json!({ "id": id, "source": fragment }).to_string();
        let sent = writeln!(running.stdin, "{request}").and_then(|()| running.stdin.flush());
        let outcome = match sent {
            Err(_) => Err(Self::gone(running)),
            Ok(()) => loop {
                match running.answers.recv_timeout(self.timeout) {
                    Ok(line) => {
                        let Ok(answer) = serde_json::from_str::<Value>(&line) else { continue };
                        if answer["id"].as_str() != Some(id.as_str()) {
                            continue;
                        }
                        break Ok(if answer["ok"].as_bool() == Some(true) {
                            None
                        } else {
                            Some(answer["error"].as_str().unwrap_or("Shader compilation failed.").to_owned())
                        });
                    }
                    Err(RecvTimeoutError::Timeout) => break Err(CheckError::TimedOut),
                    Err(RecvTimeoutError::Disconnected) => break Err(Self::gone(running)),
                }
            },
        };
        if outcome.is_err() {
            self.running = None;
        }
        outcome
    }

    fn gone(running: &Running) -> CheckError {
        let reason = running.last_error.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone();
        CheckError::Unavailable(if reason.is_empty() { "the renderer exited".into() } else { reason })
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    /// A stand-in renderer: replies `ok` unless the source contains "BAD", and reports its PID.
    fn fake(directory: &std::path::Path, body: &str) -> PathBuf {
        let path = directory.join("fake-renderer");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    const ANSWERING: &str = r#"
while IFS= read -r line; do
  id=${line#*\"id\":\"}; id=${id%%\"*}
  case "$line" in
    *BAD*) printf '{"id":"%s","ok":false,"error":"Shader compile failed: 0(3) : error C0000: nope"}\n' "$id" ;;
    *) printf '{"id":"%s","ok":true}\n' "$id" ;;
  esac
done"#;

    #[test]
    fn reports_ok_and_driver_failures_over_one_long_lived_child() {
        let directory = tempfile::tempdir().unwrap();
        let mut checker = CompileChecker::new(fake(directory.path(), ANSWERING));
        assert_eq!(checker.check("void main(){}"), Ok(None));
        assert_eq!(checker.check("BAD").unwrap().unwrap(), "Shader compile failed: 0(3) : error C0000: nope");
        assert_eq!(checker.check("void main(){}"), Ok(None));
        assert_eq!(checker.next_id, 3);
    }

    #[test]
    fn a_silent_child_times_out_and_the_next_check_starts_a_fresh_one() {
        let directory = tempfile::tempdir().unwrap();
        let hang = fake(directory.path(), "sleep 30");
        let mut checker = CompileChecker::new(&hang).with_timeout(Duration::from_millis(200));
        assert_eq!(checker.check("x"), Err(CheckError::TimedOut));
        assert!(checker.running.is_none());
        fake(directory.path(), ANSWERING);
        assert_eq!(checker.check("x"), Ok(None));
    }

    #[test]
    fn a_child_that_exits_reports_its_last_message_and_a_missing_program_is_unavailable() {
        let directory = tempfile::tempdir().unwrap();
        let mut checker = CompileChecker::new(fake(directory.path(), "echo 'scrnsvr-renderer: no EGL' >&2; exit 2"));
        let error = checker.check("x").unwrap_err();
        assert!(matches!(&error, CheckError::Unavailable(reason) if reason.contains("no EGL")), "{error}");
        assert!(matches!(CompileChecker::new("/nonexistent/renderer").check("x"), Err(CheckError::Unavailable(_))));
    }
}

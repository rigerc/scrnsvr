use std::io::{self, Read, Write};
use std::os::fd::{AsFd, AsRawFd};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use chrono::{DateTime, Local, Timelike};
use scrnsvr_core::catalog::Catalog;
use scrnsvr_core::clock::ClockConfig;
use scrnsvr_core::config::{Config, Monitors};
use scrnsvr_core::scene::SceneTarget;
use scrnsvr_core::{ClockSpec, OutputHint, SceneSpec};
use scrnsvr_platform::LayerShellSession;
use serde_json::{Value, json};

pub use scrnsvr_core::protocol::scene_message;

use crate::instance::Instance;
use crate::{Result, STOP, executable, load_config};

pub const STARTUP_TIMEOUT: Duration = Duration::from_secs(8);
pub const POLL_INTERVAL: Duration = Duration::from_millis(25);

pub fn primary(outputs: &[OutputHint]) -> Option<&OutputHint> {
    outputs.iter().find(|output| output.location == (0, 0)).or_else(|| outputs.first())
}

fn renderer_args(config: &Config, outputs: &[OutputHint]) -> Vec<String> {
    let mut args = vec!["--fps".into(), config.global.fps.to_string(), "--fade".into(), config.global.fade_seconds.to_string()];
    if config.global.monitors == Monitors::All {
        args.push("--all-outputs".into());
    } else if let Some(output) = primary(outputs) {
        args.extend(["--output".into(), output.name.clone(), "--output-at".into(), format!("{},{}", output.location.0, output.location.1)]);
    }
    args
}

pub fn wayland_outputs() -> Result<Vec<OutputHint>> {
    let session = LayerShellSession::connect()?;
    if !session.has_layer_shell() {
        return Err("Compositor does not provide wlr-layer-shell".into());
    }
    let outputs = session.output_hints();
    if outputs.is_empty() {
        return Err("No Wayland outputs are available".into());
    }
    Ok(outputs)
}

pub fn renderer_binary() -> Result<PathBuf> {
    executable("scrnsvr-renderer")
}

fn clock_message(clock: &ClockSpec) -> Value {
    json!({
        "type": "clock", "enabled": clock.enabled, "position": clock.position, "family": clock.family,
        "weight": clock.weight, "color": clock.color, "opacity": clock.opacity, "size": clock.size,
        "margin": clock.margin, "shadow": clock.shadow, "time": clock.time, "period": clock.period, "date": clock.date,
    })
}

pub struct ClockUpdates {
    config: ClockConfig,
    last: Option<ClockSpec>,
    next: Option<Instant>,
}

impl ClockUpdates {
    pub fn new(config: ClockConfig, start: Instant) -> Self {
        Self { config, last: None, next: Some(start) }
    }

    pub fn tick(&mut self, now: Instant) -> Option<&ClockSpec> {
        if self.next.is_some_and(|next| now >= next) { self.update(now, Local::now()) } else { None }
    }

    fn update(&mut self, now: Instant, wall: DateTime<Local>) -> Option<&ClockSpec> {
        self.next = self.config.enabled.then(|| now + Duration::from_nanos(u64::from(1_000_000_000 - wall.nanosecond())));
        let clock = self.config.resolve(&wall);
        if self.last.as_ref() == Some(&clock) {
            return None;
        }
        self.last = Some(clock);
        self.last.as_ref()
    }
}

struct Rotation {
    current: String,
    interval: Duration,
    next: Instant,
}

impl Rotation {
    fn new(config: &Config, target: &SceneTarget, start: Instant) -> Option<Self> {
        let interval = Duration::from_secs_f64(config.rotation.interval_minutes * 60.0);
        (!interval.is_zero() && config.rotation.enabled).then(|| Self { current: target.key(), interval, next: start + interval })
    }

    fn tick(&mut self, now: Instant, load: impl FnOnce() -> Config) -> Option<SceneSpec> {
        if now < self.next {
            return None;
        }
        self.next = now + self.interval;
        let config = load();
        let catalog = Catalog::builtin();
        let target = catalog.pick_rotation(&config, rand::random(), Some(&self.current))?;
        match catalog.build_scene(&config, &target) {
            Ok(scene) => {
                self.current = scene.key.clone();
                Some(scene)
            }
            Err(error) => {
                eprintln!("scrnsvr could not prepare {}: {error}", target.key());
                None
            }
        }
    }
}

#[derive(Debug)]
pub struct RendererExit {
    pub ready: bool,
    pub status: ExitStatus,
    pub diagnostic: Option<String>,
}

impl std::fmt::Display for RendererExit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let reason = match self.status.code() {
            Some(0) => "closed",
            Some(1) => "runtime failure",
            Some(2) => "unavailable",
            Some(3) => "initial scene failed",
            _ => "unexpected exit",
        };
        let stage = if self.ready { "after readiness" } else { "before readiness" };
        write!(f, "Renderer {reason} {stage} ({})", self.status)?;
        if let Some(message) = &self.diagnostic {
            write!(f, ": {message}")?;
        }
        Ok(())
    }
}

#[derive(Default)]
struct Lines {
    partial: Vec<u8>,
}

impl Lines {
    fn drain(&mut self, pipe: &mut impl Read, mut line: impl FnMut(&[u8])) -> io::Result<()> {
        let mut buffer = [0; 8192];
        // Bound the work per tick even if a faulty renderer continuously writes diagnostics.
        for _ in 0..8 {
            match pipe.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    for segment in buffer[..size].split_inclusive(|byte| *byte == b'\n') {
                        self.partial.extend_from_slice(segment);
                        if self.partial.len() > 8192 {
                            self.partial.drain(..self.partial.len() - 8192);
                        }
                        if segment.ends_with(b"\n") {
                            line(&self.partial);
                            self.partial.clear();
                        }
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }
}

fn nonblocking(fd: &impl AsFd) -> io::Result<()> {
    let fd = fd.as_fd().as_raw_fd();
    // SAFETY: the owner keeps the descriptor live.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

pub struct SaverProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: ChildStdout,
    stderr: ChildStderr,
    stdout_lines: Lines,
    stderr_lines: Lines,
    diagnostic: Option<String>,
    pending: Vec<u8>,
    sent: usize,
    ready: bool,
    dismissing: bool,
    deadline: Instant,
    clock: ClockUpdates,
    rotation: Option<Rotation>,
}

impl SaverProcess {
    pub fn start(binary: &Path, config: &Config, outputs: &[OutputHint], shader: Option<&str>) -> Result<Self> {
        let catalog = Catalog::builtin();
        let target = catalog.select_target(config, shader, false, rand::random());
        if config.global.monitors == Monitors::All {
            let names: Vec<_> = outputs.iter().map(|output| output.name.as_str()).collect();
            eprintln!("scrnsvr: using Wayland outputs {}", names.join(", "));
        } else if let Some(output) = primary(outputs) {
            eprintln!("scrnsvr: using Wayland output {}", output.name);
        }
        let mut command = Command::new(binary);
        command.args(renderer_args(config, outputs));
        Self::spawn(command, config, target, STARTUP_TIMEOUT)
    }

    fn spawn(mut command: Command, config: &Config, target: SceneTarget, timeout: Duration) -> Result<Self> {
        let scene = Catalog::builtin().build_scene(config, &target)?;
        let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
        let now = Instant::now();
        let mut saver = Self {
            stdin: child.stdin.take(),
            stdout: child.stdout.take().expect("stdout was piped"),
            stderr: child.stderr.take().expect("stderr was piped"),
            child,
            stdout_lines: Lines::default(),
            stderr_lines: Lines::default(),
            diagnostic: None,
            pending: Vec::new(),
            sent: 0,
            ready: false,
            dismissing: false,
            deadline: now + timeout,
            clock: ClockUpdates::new(config.clock.clone(), now),
            rotation: Rotation::new(config, &target, now),
        };
        nonblocking(saver.stdin.as_ref().expect("stdin was piped"))?;
        nonblocking(&saver.stdout)?;
        nonblocking(&saver.stderr)?;
        saver.enqueue(&scene_message(&scene))?;
        saver.schedule(now, load_config)?;
        saver.flush()?;
        Ok(saver)
    }

    fn enqueue(&mut self, message: &Value) -> Result<()> {
        serde_json::to_writer(&mut self.pending, message)?;
        self.pending.push(b'\n');
        Ok(())
    }

    fn flush(&mut self) -> io::Result<()> {
        let Some(stdin) = &mut self.stdin else { return Ok(()) };
        while self.sent < self.pending.len() {
            match stdin.write(&self.pending[self.sent..]) {
                Ok(0) => break,
                Ok(n) => self.sent += n,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(()),
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) if error.kind() == io::ErrorKind::BrokenPipe => {
                    self.stdin = None;
                    break;
                }
                Err(error) => return Err(error),
            }
        }
        self.pending.clear();
        self.sent = 0;
        Ok(())
    }

    fn schedule(&mut self, now: Instant, load: impl FnOnce() -> Config) -> Result<()> {
        if let Some(clock) = self.clock.tick(now) {
            let message = clock_message(clock);
            self.enqueue(&message)?;
        }
        if let Some(rotation) = &mut self.rotation
            && let Some(scene) = rotation.tick(now, load)
        {
            self.enqueue(&scene_message(&scene))?;
        }
        Ok(())
    }

    fn drain_output(&mut self) -> io::Result<()> {
        self.stdout_lines.drain(&mut self.stdout, |line| {
            if serde_json::from_slice::<Value>(line).is_ok_and(|message| message["type"] == "ready") {
                self.ready = true;
            }
        })?;
        self.stderr_lines.drain(&mut self.stderr, |line| {
            let message = String::from_utf8_lossy(line);
            let message = message.trim();
            if !message.is_empty() {
                eprintln!("{message}");
                self.diagnostic = Some(message.into());
            }
        })
    }

    fn request_dismiss(&mut self) -> Result<()> {
        self.dismissing = true;
        self.enqueue(&json!({"type": "dismiss"}))?;
        Ok(())
    }

    pub fn tick(&mut self) -> Result<Option<RendererExit>> {
        self.tick_with_config(load_config)
    }

    fn tick_with_config(&mut self, load: impl FnOnce() -> Config) -> Result<Option<RendererExit>> {
        self.drain_output()?;
        if let Some(status) = self.child.try_wait()? {
            self.drain_output()?;
            let trailing = String::from_utf8_lossy(&self.stderr_lines.partial);
            let diagnostic = if trailing.trim().is_empty() { self.diagnostic.take() } else { Some(trailing.trim().into()) };
            return Ok(Some(RendererExit { ready: self.ready, status, diagnostic }));
        }
        let now = Instant::now();
        if !self.dismissing && !self.ready && now >= self.deadline {
            return Err("Native renderer did not present a frame in time".into());
        }
        if !self.dismissing && self.pending.is_empty() && self.stdin.is_some() {
            self.schedule(now, load)?;
        }
        self.flush()?;
        Ok(None)
    }
}

impl Drop for SaverProcess {
    fn drop(&mut self) {
        if matches!(self.child.try_wait(), Ok(Some(_))) {
            return;
        }
        // Request the renderer's prompt cleanup path, then bound time spent waiting for it.
        // SAFETY: the child is still ours and has not been reaped.
        unsafe { libc::kill(self.child.id() as libc::pid_t, libc::SIGTERM) };
        drop(self.stdin.take());
        let deadline = Instant::now() + Duration::from_millis(500);
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(POLL_INTERVAL);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub fn open(shader: Option<&str>, instance: &Instance) -> Result<()> {
    let binary = renderer_binary()?;
    let outputs = wayland_outputs()?;
    let config = load_config();
    let saver = SaverProcess::start(&binary, &config, &outputs, shader)?;
    supervise(saver, instance, &STOP, Duration::from_secs_f64(config.global.fade_seconds + 2.0))
}

/// Run until the renderer exits. SIGTERM, SIGINT and SIGUSR1 (from `--dismiss`) set `stop`
/// and make the renderer fade out; the `Instance` guard keeps the saver lock meanwhile.
fn supervise(mut saver: SaverProcess, _instance: &Instance, stop: &AtomicBool, shutdown_timeout: Duration) -> Result<()> {
    let mut dismiss_deadline = None;
    loop {
        if dismiss_deadline.is_none() && stop.load(Ordering::Relaxed) {
            saver.request_dismiss()?;
            dismiss_deadline = Some(Instant::now() + shutdown_timeout);
        }
        if let Some(exit) = saver.tick()? {
            if !exit.ready && dismiss_deadline.is_none() {
                return Err(exit.to_string().into());
            }
            if !exit.status.success() {
                eprintln!("scrnsvr: {exit}");
            }
            return Ok(());
        }
        if dismiss_deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            eprintln!("scrnsvr: renderer did not close after dismissal");
            return Ok(());
        }
        thread::sleep(POLL_INTERVAL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};
    use scrnsvr_core::Message;
    use scrnsvr_core::config::RotationEntry;

    fn output(global: u32, name: &str, location: (i32, i32)) -> OutputHint {
        OutputHint { global, name: name.into(), description: String::new(), location }
    }

    #[test]
    fn primary_uses_origin_then_first_output_and_all_passes_no_hint() {
        let left = output(4, "DP-1", (-1920, 0));
        let origin = output(3, "HDMI-A-2", (0, 0));
        assert_eq!(primary(&[left.clone(), origin.clone()]).unwrap().name, "HDMI-A-2");
        assert_eq!(primary(std::slice::from_ref(&left)).unwrap().name, "DP-1");
        assert!(primary(&[]).is_none());
        let mut config = Config::default();
        assert_eq!(
            renderer_args(&config, &[left.clone(), origin.clone()]),
            ["--fps", "60", "--fade", "1", "--output", "HDMI-A-2", "--output-at", "0,0"]
        );
        config.global.monitors = Monitors::All;
        config.global.fps = 30;
        config.global.fade_seconds = 0.4;
        assert_eq!(renderer_args(&config, &[left, origin]), ["--fps", "30", "--fade", "0.4", "--all-outputs"]);
    }

    fn fake(script: &str, config: &Config, timeout: Duration, args: &[&Path]) -> SaverProcess {
        let mut command = Command::new("sh");
        command.args(["-c", script, "fake-renderer"]).args(args);
        SaverProcess::spawn(command, config, SceneTarget::shader("flow-field"), timeout).unwrap()
    }

    fn until_exit(saver: &mut SaverProcess, load: impl Fn() -> Config) -> Result<RendererExit> {
        let deadline = Instant::now() + Duration::from_secs(4);
        while Instant::now() < deadline {
            if let Some(exit) = saver.tick_with_config(&load)? {
                return Ok(exit);
            }
            thread::sleep(Duration::from_millis(5));
        }
        panic!("fake renderer did not finish");
    }

    #[test]
    fn waits_for_whole_ready_line_and_normal_exit() {
        let script = r#"read -r scene; read -r clock; printf '{"type":'; sleep 0.05; printf '"ready"}\n'; exit 0"#;
        let mut saver = fake(script, &Config::default(), STARTUP_TIMEOUT, &[]);
        let exit = until_exit(&mut saver, Config::default).unwrap();
        assert!(exit.ready);
        assert!(exit.status.success());
    }

    #[test]
    fn treats_exit_without_ready_as_failure_and_reports_last_stderr_line() {
        for code in [0, 1, 2, 3] {
            let script = format!("printf 'first warning\nactual failure' >&2; exit {code}");
            let mut saver = fake(&script, &Config::default(), STARTUP_TIMEOUT, &[]);
            let exit = until_exit(&mut saver, Config::default).unwrap();
            assert!(!exit.ready);
            assert_eq!(exit.status.code(), Some(code));
            assert_eq!(exit.diagnostic.as_deref(), Some("actual failure"));
            assert!(exit.to_string().ends_with(": actual failure"));
        }
    }

    #[test]
    fn reports_crash_after_ready() {
        let script = r#"read -r scene; read -r clock; printf '{"type":"ready"}\n'; printf 'lost the compositor\n' >&2; exit 1"#;
        let mut saver = fake(script, &Config::default(), STARTUP_TIMEOUT, &[]);
        let exit = until_exit(&mut saver, Config::default).unwrap();
        assert!(exit.ready);
        assert_eq!(exit.status.code(), Some(1));
        assert!(exit.to_string().contains("runtime failure after readiness"));
        assert_eq!(exit.diagnostic.as_deref(), Some("lost the compositor"));
    }

    #[test]
    fn startup_timeout_reaps_a_renderer_that_ignores_sigterm() {
        let script = r#"trap '' TERM; read -r scene; read -r clock; exec sleep 30"#;
        let mut saver = fake(script, &Config::default(), Duration::from_millis(90), &[]);
        let pid = saver.child.id();
        assert!(until_exit(&mut saver, Config::default).unwrap_err().to_string().contains("did not present a frame in time"));
        let before_cleanup = Instant::now();
        drop(saver);
        assert!(before_cleanup.elapsed() < Duration::from_secs(2));
        // SAFETY: a signal of zero only tests whether the reaped child still exists.
        assert_eq!(unsafe { libc::kill(pid as libc::pid_t, 0) }, -1);
        assert_eq!(io::Error::last_os_error().raw_os_error(), Some(libc::ESRCH));
    }

    #[test]
    fn broadcasts_scene_clock_and_reloaded_rotation_without_audio() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("protocol.jsonl");
        let mut initial = Config::default();
        initial.clock.enabled = true;
        initial.clock.show_seconds = true;
        initial.rotation.enabled = true;
        initial.rotation.interval_minutes = 0.001;
        initial.rotation.entries.push(RotationEntry { shader: "flow-field".into(), preset: None });
        let mut latest = initial.clone();
        latest.rotation.entries.push(RotationEntry { shader: "plasma".into(), preset: None });
        latest.shaders.entry("plasma".into()).or_default().insert("speed".into(), scrnsvr_core::catalog::SettingValue::Number(0.5));
        let script = r#"
            read -r scene; read -r clock; printf '%s\n%s\n' "$scene" "$clock" > "$1"
            printf '{"type":"ready"}\n'
            seen_scene=0; seen_clock=0
            while IFS= read -r line; do
                printf '%s\n' "$line" >> "$1"
                case "$line" in
                    *'"type":"scene"'*) seen_scene=1 ;;
                    *'"type":"clock"'*) seen_clock=1 ;;
                    *'"type":"audio"'*) exit 9 ;;
                esac
                if [ "$seen_scene$seen_clock" = "11" ]; then exit 0; fi
            done"#;
        let mut saver = fake(script, &initial, STARTUP_TIMEOUT, &[&log]);
        let exit = until_exit(&mut saver, || latest.clone()).unwrap();
        assert!(exit.ready && exit.status.success(), "{exit}");
        let log = std::fs::read_to_string(log).unwrap();
        let messages: Vec<_> = log.lines().map(|line| Message::parse(line).unwrap()).collect();
        assert!(matches!(&messages[0], Message::Scene(scene) if scene.key == "flow-field" && !scene.audio));
        let first_clock = match &messages[1] {
            Message::Clock(clock) if clock.enabled => &clock.time,
            other => panic!("unexpected initial clock: {other:?}"),
        };
        let first_pick = messages[2..]
            .iter()
            .find_map(|message| match message {
                Message::Scene(scene) => Some(scene),
                _ => None,
            })
            .unwrap();
        assert_eq!(first_pick.key, "plasma");
        assert_eq!(first_pick.speed(), 0.5);
        assert!(messages[2..].iter().any(|message| matches!(message, Message::Clock(clock) if &clock.time != first_clock)));
        assert!(!messages.iter().any(|message| matches!(message, Message::Audio(_))));
    }

    #[test]
    fn stop_request_sends_the_renderers_normal_dismiss_message() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = dir.path().join("scrnsvr");
        let log = dir.path().join("dismissal");
        let instance = Instance::open(&runtime).unwrap().unwrap();
        let script = r#"
            read -r scene; read -r clock
            printf '{"type":"ready"}\n'
            IFS= read -r line
            printf '%s\n' "$line" > "$1"
        "#;
        let saver = fake(script, &Config::default(), STARTUP_TIMEOUT, &[&log]);
        let stop = AtomicBool::new(true);
        supervise(saver, &instance, &stop, Duration::from_secs(1)).unwrap();
        let message = std::fs::read_to_string(log).unwrap();
        assert_eq!(Message::parse(&message), Ok(Message::Dismiss));
    }

    #[test]
    fn clock_aligns_to_the_second_and_only_sends_a_changed_minute() {
        let clock = ClockConfig { enabled: true, show_seconds: false, ..ClockConfig::default() };
        let start = Instant::now();
        let mut updates = ClockUpdates::new(clock, start);
        let wall = Utc.with_ymd_and_hms(2026, 11, 23, 1, 50, 58).unwrap().with_nanosecond(750_000_000).unwrap().with_timezone(&Local);
        let original = updates.update(start, wall).unwrap().time.clone();
        assert_eq!(updates.next, Some(start + Duration::from_millis(250)));
        let next_second = wall + chrono::Duration::milliseconds(250);
        assert!(updates.update(start + Duration::from_millis(250), next_second).is_none());
        assert_ne!(updates.update(start + Duration::from_millis(1250), next_second + chrono::Duration::seconds(1)).unwrap().time, original);
    }
}

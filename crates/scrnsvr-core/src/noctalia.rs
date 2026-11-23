//! Noctalia desktop integration shared by the command line and the settings app.
//!
//! Covers the `noctalia msg` client, reading the idle configuration, finding the behavior that
//! launches scrnsvr, planning the `config-set` calls that make it match, and importing the
//! desktop color palette. Nothing here edits Noctalia's own files; writes go through
//! `noctalia msg config-set` only, and only when the caller applies a plan.

use std::env;
use std::ffi::OsString;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use thiserror::Error;
use toml::{Table, Value};

use crate::catalog::ColorRoles;

/// How long one `noctalia msg` call may take before it is abandoned.
const CALL_TIMEOUT: Duration = Duration::from_secs(10);
/// The timeout `--setup-noctalia` uses when the behavior has none yet.
pub const DEFAULT_TIMEOUT_SECONDS: f64 = 600.0;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum NoctaliaError {
    /// The `noctalia` program is not installed.
    #[error("Noctalia is unavailable: install the noctalia CLI and start Noctalia in your Wayland session")]
    Unavailable,
    #[error("{0}")]
    Failed(String),
}

fn failed(message: impl Into<String>) -> NoctaliaError {
    NoctaliaError::Failed(message.into())
}

/// A handle on the `noctalia` command. The default resolves `noctalia` through `PATH`.
#[derive(Debug, Clone)]
pub struct Noctalia {
    program: OsString,
}

impl Default for Noctalia {
    fn default() -> Self {
        Self { program: "noctalia".into() }
    }
}

impl Noctalia {
    /// Use a specific program, for example a fake in tests.
    pub fn with_program(program: impl Into<OsString>) -> Self {
        Self { program: program.into() }
    }

    /// Run `noctalia msg <arguments>` and return its standard output.
    pub fn run(&self, arguments: &[&str]) -> Result<String, NoctaliaError> {
        let spawn = || {
            Command::new(&self.program)
                .arg("msg")
                .args(arguments)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
        };
        let mut attempt = 0;
        let mut child = loop {
            match spawn() {
                Ok(child) => break child,
                // A script that was just written can be briefly busy while another thread forks.
                Err(error) if error.kind() == io::ErrorKind::ExecutableFileBusy && attempt < 20 => {
                    attempt += 1;
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Err(NoctaliaError::Unavailable),
                Err(error) => return Err(failed(format!("Could not run noctalia: {error}"))),
            }
        };
        let drain = |pipe: Option<Box<dyn Read + Send>>| {
            thread::spawn(move || {
                let mut bytes = Vec::new();
                if let Some(mut pipe) = pipe {
                    let _ = pipe.read_to_end(&mut bytes);
                }
                bytes
            })
        };
        let stdout = drain(child.stdout.take().map(|pipe| Box::new(pipe) as Box<dyn Read + Send>));
        let stderr = drain(child.stderr.take().map(|pipe| Box::new(pipe) as Box<dyn Read + Send>));
        let deadline = Instant::now() + CALL_TIMEOUT;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(5)),
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(failed(format!(
                        "Noctalia {} did not answer within {} seconds. Check that Noctalia is running.",
                        arguments.first().copied().unwrap_or("msg"),
                        CALL_TIMEOUT.as_secs()
                    )));
                }
                Err(error) => return Err(failed(format!("Could not run noctalia: {error}"))),
            }
        };
        let stdout = stdout.join().unwrap_or_default();
        let stderr = stderr.join().unwrap_or_default();
        if !status.success() {
            let stderr = String::from_utf8_lossy(&stderr);
            let stdout = String::from_utf8_lossy(&stdout);
            let detail = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
            return Err(failed(format!(
                "Noctalia {} failed. Check that Noctalia is running. {detail}",
                arguments.first().copied().unwrap_or("msg")
            )));
        }
        String::from_utf8(stdout).map_err(|_| failed("Noctalia returned text that is not UTF-8."))
    }

    /// Read `idle` through `config-get`, returning the raw text with its parsed TOML.
    pub fn read_idle(&self) -> Result<(String, Table), NoctaliaError> {
        let raw = self.run(&["config-get", "idle"])?;
        let idle = raw.parse().map_err(|error| failed(format!("Noctalia did not return idle TOML. Check that it is running. {error}")))?;
        Ok((raw, idle))
    }

    /// Apply changes with `config-set`, in order. Stops at the first failure.
    pub fn apply(&self, changes: &[Change]) -> Result<(), NoctaliaError> {
        for change in changes {
            self.run(&["config-set", &change.path, &change.value.to_string()])?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------------------------
// Which executable Noctalia should run
// ---------------------------------------------------------------------------------------------

/// `$XDG_BIN_HOME/scrnsvr`, else `~/.local/bin/scrnsvr`: the stable link `scrnsvr --install` makes.
pub fn bin_link() -> Result<PathBuf, String> {
    let bin = env::var_os("XDG_BIN_HOME").filter(|path| !path.is_empty()).map(PathBuf::from);
    let bin = match bin {
        Some(bin) => bin,
        None => PathBuf::from(env::var_os("HOME").ok_or("HOME is unset; set XDG_BIN_HOME to install scrnsvr")?).join(".local/bin"),
    };
    Ok(std::path::absolute(bin).map_err(|error| error.to_string())?.join("scrnsvr"))
}

/// The running AppImage, else the running executable. A sibling `scrnsvr` stands in for another
/// scrnsvr binary (such as the settings executable), because the command must start the CLI.
pub fn current_distribution() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("APPIMAGE").filter(|path| !path.is_empty()) {
        return std::path::absolute(path).map_err(|error| error.to_string());
    }
    let exe = env::current_exe().map_err(|error| error.to_string())?;
    if !is_scrnsvr_executable(&exe)
        && let Some(sibling) = exe.parent().map(|dir| dir.join("scrnsvr")).filter(|path| path.is_file())
    {
        return Ok(sibling);
    }
    Ok(exe)
}

/// Whether a file name is `scrnsvr` or a versioned `scrnsvr-*.AppImage`.
pub fn is_scrnsvr_executable(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str()).is_some_and(|name| {
        let name = name.to_ascii_lowercase();
        name == "scrnsvr" || (name.starts_with("scrnsvr-") && name.ends_with(".appimage"))
    })
}

/// The path Noctalia should run, and whether it is the installed stable link.
pub fn saver_executable() -> Result<(PathBuf, bool), String> {
    match bin_link().ok().filter(|link| std::fs::read_link(link).is_ok() && link.is_file()) {
        Some(link) => Ok((link, true)),
        None => Ok((current_distribution()?, false)),
    }
}

// ---------------------------------------------------------------------------------------------
// Idle behavior status and setup plan
// ---------------------------------------------------------------------------------------------

/// Whether a Noctalia command string starts `scrnsvr --open`, ignoring shell quoting and `exec`.
pub fn opens_scrnsvr(command: &str) -> bool {
    let Some(words) = shlex::split(command) else { return false };
    let mut args = words.iter().map(String::as_str);
    let program = args.next();
    let program = if program == Some("exec") { args.next() } else { program };
    program.is_some_and(|program| is_scrnsvr_executable(Path::new(program))) && args.any(|arg| arg.eq_ignore_ascii_case("--open"))
}

/// One requested `config-set`.
#[derive(Debug, Clone, PartialEq)]
pub struct Change {
    pub path: String,
    pub previous: Option<Value>,
    pub value: Value,
}

impl Change {
    /// `path  previous → value`, as the command line prints it.
    pub fn describe(&self) -> String {
        let previous = self.previous.as_ref().map_or_else(|| "(unset)".into(), ToString::to_string);
        format!("{}  {previous} → {}", self.path, self.value)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub changes: Vec<Change>,
    /// The same desired state as a TOML fragment for editing Noctalia's configuration by hand.
    pub fragment: Table,
}

fn record(changes: &mut Vec<Change>, path: String, previous: Option<&Value>, value: Value) {
    if previous != Some(&value) {
        changes.push(Change { path, previous: previous.cloned(), value });
    }
}

fn number(value: &Value) -> Option<f64> {
    value.as_float().or_else(|| value.as_integer().map(|n| n as f64)).filter(|n| n.is_finite())
}

struct Behaviors<'a> {
    order: Vec<Value>,
    table: Option<&'a Table>,
}

impl<'a> Behaviors<'a> {
    fn parse(idle: &'a Table) -> Result<Self, NoctaliaError> {
        let order = match idle.get("behavior_order") {
            Some(value) => value
                .as_array()
                .filter(|items| items.iter().all(Value::is_str))
                .ok_or_else(|| failed("Noctalia behavior_order must contain names"))?
                .clone(),
            None => Vec::new(),
        };
        let table = match idle.get("behavior") {
            Some(value) => Some(value.as_table().ok_or_else(|| failed("Noctalia idle.behavior must be a table"))?),
            None => None,
        };
        Ok(Self { order, table })
    }

    /// The first behavior (in `behavior_order`, then table order) that satisfies `wanted`.
    fn find(&self, wanted: impl Fn(&Value) -> bool) -> Option<(&'a str, &'a Value)> {
        let table = self.table?;
        self.order
            .iter()
            .filter_map(Value::as_str)
            .filter_map(|name| table.get_key_value(name))
            .chain(table.iter())
            .find(|(_, behavior)| wanted(behavior))
            .map(|(name, behavior)| (name.as_str(), behavior))
    }
}

fn runs_command(behavior: &Value) -> bool {
    behavior.get("action").and_then(Value::as_str) == Some("command")
}

/// The Noctalia behavior that launches scrnsvr, as the settings app shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct Behavior {
    pub name: String,
    /// `None` when Noctalia has no `enabled` key for it.
    pub enabled: Option<bool>,
    /// Idle seconds before the command runs.
    pub timeout: Option<f64>,
    pub command: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IdleStatus {
    pub behavior: Option<Behavior>,
    /// `idle.pre_action_fade_seconds`: Noctalia's own tint before it runs the command.
    pub fade_seconds: Option<f64>,
    /// How many idle behaviors Noctalia has, whatever they do.
    pub behavior_count: usize,
}

/// Find the behavior whose command already runs scrnsvr, if any.
pub fn idle_status(idle: &Table) -> Result<IdleStatus, NoctaliaError> {
    let behaviors = Behaviors::parse(idle)?;
    let behavior = behaviors
        .find(|behavior| runs_command(behavior) && behavior.get("command").and_then(Value::as_str).is_some_and(opens_scrnsvr))
        .map(|(name, behavior)| Behavior {
            name: name.into(),
            enabled: behavior.get("enabled").and_then(Value::as_bool),
            timeout: behavior.get("timeout").and_then(number),
            command: behavior.get("command").and_then(Value::as_str).unwrap_or_default().into(),
        });
    Ok(IdleStatus {
        behavior,
        fade_seconds: idle.get("pre_action_fade_seconds").and_then(number),
        behavior_count: behaviors.table.map_or(0, Table::len),
    })
}

fn addressable(name: &str) -> bool {
    !name.is_empty() && name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

/// Plan the `config-set` calls that make Noctalia launch `executable --open`.
///
/// A behavior that already runs scrnsvr is reused; otherwise `idle.behavior.scrnsvr` is created
/// and appended to `behavior_order`. The behavior is enabled, keeps its timeout unless `timeout`
/// is given (600 s when it has none), and `idle.pre_action_fade_seconds` becomes 0 so only
/// scrnsvr fades.
pub fn plan(idle: &Table, executable: &Path, timeout: Option<f64>) -> Result<Plan, NoctaliaError> {
    let behaviors = Behaviors::parse(idle)?;
    let executable = executable.to_str().ok_or_else(|| failed("Noctalia requires a UTF-8 executable path"))?;
    let command = format!("{} --open", shlex::try_quote(executable).map_err(|error| failed(error.to_string()))?);
    let chosen = behaviors
        .find(|behavior| {
            runs_command(behavior)
                && behavior.get("command").and_then(Value::as_str).is_some_and(|old| old == command || opens_scrnsvr(old))
        })
        .map(|(name, _)| name);
    let name = chosen.unwrap_or("scrnsvr");
    if chosen.is_none() && behaviors.table.is_some_and(|table| table.contains_key(name)) {
        return Err(failed("Noctalia's scrnsvr idle behavior already runs a different action; rename it before setup"));
    }
    if !addressable(name) {
        return Err(failed(format!("Noctalia behavior {name:?} cannot be addressed by config-set")));
    }
    let existing = behaviors.table.and_then(|table| table.get(name));
    let seconds = timeout
        .or_else(|| existing.and_then(|behavior| behavior.get("timeout")).and_then(number).filter(|seconds| *seconds >= 0.0))
        .unwrap_or(DEFAULT_TIMEOUT_SECONDS);
    let desired = Table::from_iter([
        ("action".into(), Value::String("command".into())),
        ("command".into(), Value::String(command)),
        ("enabled".into(), Value::Boolean(true)),
        ("timeout".into(), Value::Float(seconds)),
    ]);

    let mut changes = Vec::new();
    let path = format!("idle.behavior.{name}");
    if let Some(existing) = existing {
        for (key, value) in &desired {
            let previous = existing.get(key);
            if key == "timeout" && previous.and_then(Value::as_integer).is_some_and(|old| old as f64 == seconds) {
                continue;
            }
            record(&mut changes, format!("{path}.{key}"), previous, value.clone());
        }
    } else {
        record(&mut changes, path, None, Value::Table(desired.clone()));
    }
    let mut desired_order = behaviors.order;
    if !desired_order.iter().any(|item| item.as_str() == Some(name)) {
        desired_order.push(Value::String(name.into()));
        record(&mut changes, "idle.behavior_order".into(), idle.get("behavior_order"), Value::Array(desired_order.clone()));
    }
    let fade = Value::Float(0.0);
    if idle.get("pre_action_fade_seconds").and_then(Value::as_integer) != Some(0) {
        record(&mut changes, "idle.pre_action_fade_seconds".into(), idle.get("pre_action_fade_seconds"), fade.clone());
    }
    let idle = Table::from_iter([
        ("behavior_order".into(), Value::Array(desired_order)),
        ("pre_action_fade_seconds".into(), fade),
        ("behavior".into(), Value::Table(Table::from_iter([(name.into(), Value::Table(desired))]))),
    ]);
    Ok(Plan { changes, fragment: Table::from_iter([("idle".into(), Value::Table(idle))]) })
}

/// The one `config-set` that changes only an existing scrnsvr behavior's timeout.
pub fn timeout_change(behavior: &Behavior, seconds: f64) -> Result<Option<Change>, NoctaliaError> {
    if !seconds.is_finite() || seconds < 0.0 {
        return Err(failed("The timeout must be zero or more seconds."));
    }
    if !addressable(&behavior.name) {
        return Err(failed(format!("Noctalia behavior {:?} cannot be addressed by config-set", behavior.name)));
    }
    Ok((behavior.timeout != Some(seconds)).then(|| Change {
        path: format!("idle.behavior.{}.timeout", behavior.name),
        previous: behavior.timeout.map(Value::Float),
        value: Value::Float(seconds),
    }))
}

// ---------------------------------------------------------------------------------------------
// Desktop colors
// ---------------------------------------------------------------------------------------------

/// `$XDG_CONFIG_HOME/noctalia/colors.json`.
pub fn colors_path() -> Option<PathBuf> {
    dirs::config_dir().map(|base| base.join("noctalia/colors.json"))
}

/// Validate the whole file and map Noctalia's five roles (`mPrimary` and so on) to scrnsvr's.
pub fn parse_colors(value: &serde_json::Value) -> Result<ColorRoles, String> {
    let object = value.as_object().ok_or("Expected a Noctalia colors object.")?;
    let role = |key: &str| -> Result<String, String> {
        let color = object.get(key).and_then(serde_json::Value::as_str);
        let digits = color
            .and_then(|color| color.strip_prefix('#'))
            .filter(|digits| matches!(digits.len(), 3 | 6) && digits.bytes().all(|byte| byte.is_ascii_hexdigit()));
        let digits = digits.ok_or_else(|| format!("Noctalia color {key} must be a hex color such as #aabbcc."))?;
        let digits = if digits.len() == 3 { digits.chars().flat_map(|digit| [digit, digit]).collect() } else { digits.to_owned() };
        Ok(format!("#{}", digits.to_ascii_lowercase()))
    };
    Ok(ColorRoles {
        primary: role("mPrimary")?,
        secondary: role("mSecondary")?,
        tertiary: role("mTertiary")?,
        surface: role("mSurface")?,
        on_surface: role("mOnSurface")?,
    })
}

/// Read and validate Noctalia's color file. Failures say what to do next.
pub fn load_colors(path: &Path) -> Result<ColorRoles, String> {
    let source = match std::fs::read_to_string(path) {
        Ok(source) => source,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(format!("Noctalia colors were not found at {}. Open Noctalia and choose a color scheme first.", path.display()));
        }
        Err(error) => return Err(format!("Could not import Noctalia colors: {error}")),
    };
    let json = serde_json::from_str(&source).map_err(|_| format!("Noctalia colors at {} are not valid JSON.", path.display()))?;
    parse_colors(&json).map_err(|error| format!("Could not import Noctalia colors: {error}"))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    const EXISTING: &str = r#"
behavior_order = [ 'lock', 'screensaver' ]
pre_action_fade_seconds = 2.0

[behavior.lock]
action = 'lock'
enabled = true
timeout = 900.0

[behavior.screensaver]
action = 'command'
command = 'Scrnsvr-0.5.0.AppImage --open'
enabled = false
timeout = 742.5
"#;

    fn table(text: &str) -> Table {
        text.parse().unwrap()
    }

    /// A `noctalia` that serves `current` for `config-get`, records `config-set`, then serves `after`.
    fn fake(root: &Path, current: &str, after: &str) -> Noctalia {
        let script = root.join("noctalia");
        fs::write(root.join("current"), current).unwrap();
        fs::write(root.join("after"), after).unwrap();
        fs::write(
            &script,
            format!(
                r#"#!/bin/sh
root='{}'
printf '%s|%s|%s\n' "$2" "$3" "$4" >> "$root/calls"
case "$2" in
    config-get)
        if [ -f "$root/wrote" ]; then /bin/cat "$root/after"; else /bin/cat "$root/current"; fi ;;
    config-set) : > "$root/wrote" ;;
    *) exit 9 ;;
esac
"#,
                root.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        Noctalia::with_program(script)
    }

    #[test]
    fn recognizes_shell_quoted_and_versioned_saver_commands() {
        for command in ["scrnsvr --open", "Scrnsvr-0.5.0.AppImage --open", "exec '/opt/My Apps/SCRNSVR-1.0.APPIMAGE' --OPEN"] {
            assert!(opens_scrnsvr(command), "{command}");
        }
        for command in ["scrnsvr --preview", "echo 'scrnsvr --open'", "other-scrnsvr --open", "scrnsvr --openly"] {
            assert!(!opens_scrnsvr(command), "{command}");
        }
    }

    #[test]
    fn new_behavior_preserves_order_and_uses_a_valid_inline_table() {
        let idle = table("behavior_order = ['screen-off']\npre_action_fade_seconds = 2.0");
        let plan = plan(&idle, Path::new("/opt/My Apps/Scrnsvr-1.0.AppImage"), None).unwrap();
        let change = &plan.changes[0];
        assert_eq!(change.path, "idle.behavior.scrnsvr");
        let inline = format!("value = {}", change.value).parse::<Table>().unwrap();
        assert_eq!(inline["value"]["timeout"].as_float(), Some(600.0));
        assert_eq!(inline["value"]["command"].as_str(), Some("'/opt/My Apps/Scrnsvr-1.0.AppImage' --open"));
        assert_eq!(plan.changes[1].path, "idle.behavior_order");
        assert_eq!(plan.changes[1].value, Value::Array(vec![Value::String("screen-off".into()), Value::String("scrnsvr".into())]));
        assert_eq!(plan.changes[2].path, "idle.pre_action_fade_seconds");
    }

    #[test]
    fn status_reads_the_behavior_that_runs_scrnsvr() {
        let status = idle_status(&table(EXISTING)).unwrap();
        assert_eq!(
            status.behavior,
            Some(Behavior {
                name: "screensaver".into(),
                enabled: Some(false),
                timeout: Some(742.5),
                command: "Scrnsvr-0.5.0.AppImage --open".into()
            })
        );
        assert_eq!(status.fade_seconds, Some(2.0));
        assert_eq!(status.behavior_count, 2);

        let none = idle_status(&table("[behavior.lock]\naction = 'lock'\ntimeout = 5")).unwrap();
        assert_eq!(none.behavior, None);
        assert_eq!(none.fade_seconds, None);
        let integer = idle_status(&table("[behavior.s]\naction = 'command'\ncommand = 'scrnsvr --open'\ntimeout = 600")).unwrap();
        assert_eq!(integer.behavior.unwrap().timeout, Some(600.0));
        assert!(idle_status(&table("behavior = 3")).is_err());
        assert!(idle_status(&table("behavior_order = [1]")).is_err());
    }

    #[test]
    fn plan_updates_the_existing_behavior_and_keeps_its_timeout() {
        let plan = plan(&table(EXISTING), Path::new("/home/me/.local/bin/scrnsvr"), None).unwrap();
        let paths: Vec<_> = plan.changes.iter().map(|change| change.path.as_str()).collect();
        assert_eq!(paths, ["idle.behavior.screensaver.command", "idle.behavior.screensaver.enabled", "idle.pre_action_fade_seconds"]);
        assert_eq!(
            plan.changes[0].describe(),
            "idle.behavior.screensaver.command  \"Scrnsvr-0.5.0.AppImage --open\" → \"/home/me/.local/bin/scrnsvr --open\""
        );
        let explicit = super::plan(&table(EXISTING), Path::new("/home/me/.local/bin/scrnsvr"), Some(55.25)).unwrap();
        assert!(explicit.changes.iter().any(|change| change.path.ends_with(".timeout") && change.value == Value::Float(55.25)));
        assert_eq!(explicit.fragment["idle"]["behavior"]["screensaver"]["timeout"].as_float(), Some(55.25));
    }

    #[test]
    fn a_matching_configuration_needs_no_changes_and_a_foreign_behavior_blocks_setup() {
        let matching = table(
            "behavior_order = ['scrnsvr']\npre_action_fade_seconds = 0.0\n[behavior.scrnsvr]\naction='command'\ncommand='/bin/scrnsvr --open'\nenabled=true\ntimeout=600.0",
        );
        assert!(plan(&matching, Path::new("/bin/scrnsvr"), None).unwrap().changes.is_empty());
        let integer_fade = table("pre_action_fade_seconds = 0");
        assert!(!plan(&integer_fade, Path::new("/bin/scrnsvr"), None).unwrap().changes.iter().any(|c| c.path.ends_with("fade_seconds")));
        let foreign = table("[behavior.scrnsvr]\naction='lock'");
        assert!(plan(&foreign, Path::new("/bin/scrnsvr"), None).unwrap_err().to_string().contains("different action"));
    }

    #[test]
    fn timeout_change_touches_only_the_timeout() {
        let status = idle_status(&table(EXISTING)).unwrap().behavior.unwrap();
        let change = timeout_change(&status, 90.0).unwrap().unwrap();
        assert_eq!(change.path, "idle.behavior.screensaver.timeout");
        assert_eq!(change.previous, Some(Value::Float(742.5)));
        assert_eq!(change.value, Value::Float(90.0));
        assert_eq!(timeout_change(&status, 742.5).unwrap(), None);
        assert!(timeout_change(&status, f64::NAN).is_err());
        assert!(timeout_change(&status, -1.0).is_err());
        let odd = Behavior { name: "has space".into(), ..status };
        assert!(timeout_change(&odd, 30.0).is_err());
    }

    #[test]
    fn the_client_reads_and_applies_through_the_noctalia_command() {
        let temp = tempfile::tempdir().unwrap();
        let noctalia = fake(temp.path(), EXISTING, "behavior_order = ['screensaver']");
        let (raw, idle) = noctalia.read_idle().unwrap();
        assert!(raw.contains("screensaver"));
        let plan = plan(&idle, Path::new("/home/me/.local/bin/scrnsvr"), Some(300.0)).unwrap();
        noctalia.apply(&plan.changes).unwrap();
        let calls = fs::read_to_string(temp.path().join("calls")).unwrap();
        assert_eq!(calls.lines().next(), Some("config-get|idle|"));
        assert!(calls.contains("config-set|idle.behavior.screensaver.command|\"/home/me/.local/bin/scrnsvr --open\""));
        assert!(calls.contains("config-set|idle.pre_action_fade_seconds|0.0"));
        assert_eq!(noctalia.read_idle().unwrap().1["behavior_order"].as_array().unwrap().len(), 1, "reads the state after the writes");
    }

    #[test]
    fn missing_failing_and_malformed_noctalia_report_distinct_errors() {
        let temp = tempfile::tempdir().unwrap();
        let missing = Noctalia::with_program(temp.path().join("absent"));
        assert_eq!(missing.read_idle().unwrap_err(), NoctaliaError::Unavailable);

        let script = temp.path().join("noctalia");
        fs::write(&script, "#!/bin/sh\nprintf 'no shell running' >&2\nexit 1\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        let error = Noctalia::with_program(&script).read_idle().unwrap_err().to_string();
        assert!(error.contains("Noctalia config-get failed. Check that Noctalia is running. no shell running"), "{error}");

        fs::write(&script, "#!/bin/sh\nprintf 'not = [toml'\n").unwrap();
        let error = Noctalia::with_program(&script).read_idle().unwrap_err().to_string();
        assert!(error.contains("did not return idle TOML"), "{error}");
    }

    #[test]
    fn colors_are_validated_as_a_whole_and_short_hex_expands() {
        let json = |text: &str| serde_json::from_str::<serde_json::Value>(text).unwrap();
        let roles = parse_colors(&json(
            r##"{"mPrimary":"#EBBCBA","mSecondary":"#9ccfd8","mTertiary":"#abc","mSurface":"#191724","mOnSurface":"#e0def4","mError":"bad"}"##,
        ))
        .unwrap();
        assert_eq!((roles.primary.as_str(), roles.tertiary.as_str(), roles.on_surface.as_str()), ("#ebbcba", "#aabbcc", "#e0def4"));
        for bad in [
            r##"{"mPrimary":"#fff","mSecondary":"#fff","mTertiary":"#fff","mSurface":"#ffff","mOnSurface":"#fff"}"##,
            r##"{"mPrimary":"#fff","mSecondary":"red","mTertiary":"#fff","mSurface":"#fff","mOnSurface":"#fff"}"##,
            r##"{"mPrimary":"#fff"}"##,
        ] {
            assert!(parse_colors(&json(bad)).unwrap_err().contains("must be a hex color"), "{bad}");
        }
        assert_eq!(parse_colors(&json("[1]")).unwrap_err(), "Expected a Noctalia colors object.");
    }

    #[test]
    fn color_files_report_actionable_failures() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("colors.json");
        let error = load_colors(&path).unwrap_err();
        assert!(error.contains("were not found at") && error.contains("choose a color scheme first"), "{error}");
        fs::write(&path, "{ nope").unwrap();
        assert!(load_colors(&path).unwrap_err().contains("not valid JSON"));
        fs::write(&path, r##"{"mPrimary":"#fff"}"##).unwrap();
        assert!(load_colors(&path).unwrap_err().starts_with("Could not import Noctalia colors: Noctalia color mSecondary"));
        fs::write(&path, r##"{"mPrimary":"#111","mSecondary":"#222","mTertiary":"#333","mSurface":"#444","mOnSurface":"#555"}"##).unwrap();
        assert_eq!(load_colors(&path).unwrap().surface, "#444444");
    }
}

use std::fs;
use std::io;
use std::path::Path;
use std::process::Command;

use toml::{Table, Value};

use crate::{Result, install};

struct Change {
    path: String,
    previous: Option<Value>,
    value: Value,
}

struct Plan {
    changes: Vec<Change>,
    fragment: Table,
}

fn run_noctalia(arguments: &[&str]) -> Result<String> {
    let output = Command::new("noctalia").arg("msg").args(arguments).output().map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            "Noctalia is unavailable: install the noctalia CLI and start Noctalia in your Wayland session".into()
        } else {
            format!("Could not run noctalia: {error}")
        }
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
        return Err(format!("Noctalia {} failed. Check that Noctalia is running. {detail}", arguments[0]).into());
    }
    Ok(String::from_utf8(output.stdout)?)
}

fn read_idle() -> Result<(String, Table)> {
    let raw = run_noctalia(&["config-get", "idle"])?;
    let idle = raw.parse().map_err(|error| format!("Noctalia did not return idle TOML. Check that it is running. {error}"))?;
    Ok((raw, idle))
}

fn opens_scrnsvr(command: &str) -> bool {
    let Some(words) = shlex::split(command) else { return false };
    let mut args = words.iter().map(String::as_str);
    let program = args.next();
    let program = if program == Some("exec") { args.next() } else { program };
    program.is_some_and(|program| install::is_scrnsvr_executable(Path::new(program))) && args.any(|arg| arg.eq_ignore_ascii_case("--open"))
}

fn record(changes: &mut Vec<Change>, path: String, previous: Option<&Value>, value: Value) {
    if previous != Some(&value) {
        changes.push(Change { path, previous: previous.cloned(), value });
    }
}

fn plan(idle: &Table, executable: &Path, timeout: Option<f64>) -> Result<Plan> {
    let order = match idle.get("behavior_order") {
        Some(value) => {
            value.as_array().filter(|items| items.iter().all(Value::is_str)).ok_or("Noctalia behavior_order must contain names")?.clone()
        }
        None => Vec::new(),
    };
    let empty = Table::new();
    let behaviors = match idle.get("behavior") {
        Some(value) => value.as_table().ok_or("Noctalia idle.behavior must be a table")?,
        None => &empty,
    };
    let executable = executable.to_str().ok_or("Noctalia requires a UTF-8 executable path")?;
    let command = format!("{} --open", shlex::try_quote(executable)?);
    let is_saver = |behavior: &Value| {
        behavior.get("action").and_then(Value::as_str) == Some("command")
            && behavior.get("command").and_then(Value::as_str).is_some_and(|old| old == command || opens_scrnsvr(old))
    };
    let chosen = order
        .iter()
        .filter_map(Value::as_str)
        .filter_map(|name| behaviors.get_key_value(name))
        .chain(behaviors.iter())
        .find(|(_, behavior)| is_saver(behavior))
        .map(|(name, _)| name.as_str());
    let name = chosen.unwrap_or("scrnsvr");
    if chosen.is_none() && behaviors.contains_key(name) {
        return Err("Noctalia's scrnsvr idle behavior already runs a different action; rename it before setup".into());
    }
    if !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') || name.is_empty() {
        return Err(format!("Noctalia behavior {name:?} cannot be addressed by config-set").into());
    }
    let existing = behaviors.get(name);
    let seconds = timeout
        .or_else(|| {
            existing
                .and_then(|behavior| behavior.get("timeout"))
                .and_then(|value| value.as_float().or_else(|| value.as_integer().map(|n| n as f64)))
                .filter(|seconds| seconds.is_finite() && *seconds >= 0.0)
        })
        .unwrap_or(600.0);
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
    let mut desired_order = order;
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

pub fn setup(apply: bool, timeout: Option<f64>) -> Result<()> {
    let (_, current) = read_idle()?;
    let link = install::bin_link().ok().filter(|link| fs::read_link(link).is_ok() && link.is_file());
    let installed = link.is_some();
    let executable = match link {
        Some(link) => link,
        None => install::current_distribution()?,
    };
    let proposed = plan(&current, &executable, timeout)?;
    if proposed.changes.is_empty() {
        println!("Noctalia idle settings already match.");
    } else {
        for change in &proposed.changes {
            let previous = change.previous.as_ref().map_or_else(|| "(unset)".into(), ToString::to_string);
            println!("{}  {previous} → {}", change.path, change.value);
        }
    }
    if apply {
        for change in &proposed.changes {
            run_noctalia(&["config-set", &change.path, &change.value.to_string()])?;
        }
        let (raw, updated) = read_idle()?;
        println!("Noctalia idle settings after setup\n{raw}");
        if !plan(&updated, &executable, timeout)?.changes.is_empty() {
            return Err("Noctalia did not retain all requested idle settings".into());
        }
    } else {
        println!("\nEquivalent TOML fragment\n{}", toml::to_string_pretty(&proposed.fragment)?);
        if !installed {
            println!(
                "Note: no installed link was found, so the command names {}.\nRun scrnsvr --install first to give Noctalia a stable path.\n",
                executable.display()
            );
        }
        if !proposed.changes.is_empty() {
            let timeout = timeout.map_or_else(String::new, |seconds| format!(" --timeout {seconds}"));
            println!(
                "To make these changes, run
  scrnsvr --setup-noctalia --apply{timeout}"
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let idle = "behavior_order = ['screen-off']\npre_action_fade_seconds = 2.0".parse::<Table>().unwrap();
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
}

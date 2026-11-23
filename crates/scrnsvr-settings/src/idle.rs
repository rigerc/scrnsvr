//! What the settings app knows about Noctalia's idle launcher, and how it changes it.
//!
//! The blocking functions here run `noctalia msg` and must be called off the UI thread. They read
//! with `config-get` and write only with `config-set`, never to Noctalia's files, and nothing is
//! written until the caller passes a plan the user confirmed.

use std::path::PathBuf;

use scrnsvr_core::noctalia::{
    Behavior, Change, IdleStatus, Noctalia, NoctaliaError, Plan, idle_status, plan, saver_executable, timeout_change,
};
use toml::Table;

/// Where Noctalia is run from and which command it should be given.
#[derive(Clone, Default)]
pub struct IdleSource {
    pub noctalia: Noctalia,
    /// The command to plan for: `(path, installed)`. `None` resolves it when probing, like the CLI.
    pub executable: Option<(PathBuf, bool)>,
}

/// What a probe of Noctalia found.
#[derive(Debug, Clone, PartialEq)]
pub enum Idle {
    /// Nothing has been read yet.
    Unchecked,
    /// The `noctalia` program is not installed.
    Absent,
    /// Noctalia did not answer usefully. The message says what to check.
    Failed(String),
    Ready(Box<Ready>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Ready {
    pub status: IdleStatus,
    /// The `idle` table as read, the input to any plan.
    pub idle: Table,
    /// The command Noctalia should run, and whether it is the installed `scrnsvr` link.
    pub executable: PathBuf,
    pub installed: bool,
}

impl Ready {
    /// What `scrnsvr --setup-noctalia` would change, optionally with a new timeout in seconds.
    pub fn proposal(&self, timeout: Option<f64>) -> Result<Plan, NoctaliaError> {
        if timeout.is_some_and(|seconds| !seconds.is_finite() || seconds < 0.0) {
            return Err(NoctaliaError::Failed("The timeout must be zero or more seconds.".into()));
        }
        plan(&self.idle, &self.executable, timeout)
    }

    /// The change that sets only the existing behavior's timeout.
    pub fn timeout_change(&self, seconds: f64) -> Result<Option<Change>, NoctaliaError> {
        match &self.status.behavior {
            Some(behavior) => timeout_change(behavior, seconds),
            None => Err(NoctaliaError::Failed("Noctalia does not launch scrnsvr yet. Set it up first.".into())),
        }
    }
}

/// Read Noctalia's idle settings.
pub fn probe(source: &IdleSource) -> Idle {
    let (_, idle) = match source.noctalia.read_idle() {
        Ok(read) => read,
        Err(NoctaliaError::Unavailable) => return Idle::Absent,
        Err(error) => return Idle::Failed(error.to_string()),
    };
    let status = match idle_status(&idle) {
        Ok(status) => status,
        Err(error) => return Idle::Failed(error.to_string()),
    };
    let (executable, installed) = match &source.executable {
        Some(choice) => choice.clone(),
        None => match saver_executable() {
            Ok(choice) => choice,
            Err(error) => return Idle::Failed(error),
        },
    };
    Idle::Ready(Box::new(Ready { status, idle, executable, installed }))
}

/// Apply a confirmed plan, then read Noctalia again and check that it kept every change.
pub fn apply(source: &IdleSource, plan: &Plan, timeout: Option<f64>) -> Result<Idle, String> {
    source.noctalia.apply(&plan.changes).map_err(|error| error.to_string())?;
    let after = probe(source);
    match &after {
        Idle::Ready(updated) => {
            let remaining = updated.proposal(timeout).map_err(|error| error.to_string())?;
            if !remaining.changes.is_empty() {
                return Err("Noctalia did not keep all the requested idle settings. Review them in Noctalia.".into());
            }
        }
        Idle::Failed(error) => return Err(error.clone()),
        _ => return Err("Noctalia stopped answering after the change.".into()),
    }
    Ok(after)
}

/// Apply only a timeout change, then read Noctalia again and check it.
pub fn apply_timeout(source: &IdleSource, change: &Change, behavior: &Behavior, seconds: f64) -> Result<Idle, String> {
    source.noctalia.apply(std::slice::from_ref(change)).map_err(|error| error.to_string())?;
    let after = probe(source);
    match &after {
        Idle::Ready(updated) if updated.status.behavior.as_ref().and_then(|b| b.timeout) == Some(seconds) => Ok(after),
        Idle::Ready(_) => Err(format!("Noctalia did not keep the new timeout for {}.", behavior.name)),
        Idle::Failed(error) => Err(error.clone()),
        _ => Err("Noctalia stopped answering after the change.".into()),
    }
}

/// Human wording for seconds: `10 min`, `1 min 30 s`, `45 s`.
pub fn duration_text(seconds: f64) -> String {
    let whole = seconds.round() as u64;
    match (whole / 60, whole % 60) {
        (0, s) => format!("{s} s"),
        (m, 0) => format!("{m} min"),
        (m, s) => format!("{m} min {s} s"),
    }
}

/// A hypridle listener that runs scrnsvr after `seconds`.
pub fn hypridle_snippet(seconds: f64) -> String {
    format!("listener {{\n    timeout = {}\n    on-timeout = scrnsvr --open\n}}", seconds.round().max(1.0) as u64)
}

/// A stand-in `noctalia` for tests of this module and of the settings view.
#[cfg(test)]
pub(crate) mod testing {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};

    use scrnsvr_core::noctalia::Noctalia;

    use super::IdleSource;

    /// A `noctalia` that records calls and serves `after` once `config-set` was called.
    pub(crate) fn fake(root: &Path, before: &str, after: &str) -> IdleSource {
        let script = root.join("noctalia");
        fs::write(root.join("before"), before).unwrap();
        fs::write(root.join("after"), after).unwrap();
        fs::write(
            &script,
            format!(
                "#!/bin/sh\nroot='{}'\nprintf '%s|%s|%s\\n' \"$2\" \"$3\" \"$4\" >> \"$root/calls\"\ncase \"$2\" in\n  config-get) if [ -f \"$root/wrote\" ]; then /bin/cat \"$root/after\"; else /bin/cat \"$root/before\"; fi ;;\n  config-set) : > \"$root/wrote\" ;;\n  *) exit 9 ;;\nesac\n",
                root.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        IdleSource { noctalia: Noctalia::with_program(script), executable: Some((PathBuf::from("/home/me/.local/bin/scrnsvr"), true)) }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    use super::testing::fake;
    use super::*;

    const EXISTING: &str = "behavior_order = ['screensaver']\npre_action_fade_seconds = 2.0\n[behavior.screensaver]\naction = 'command'\ncommand = 'scrnsvr --open'\nenabled = false\ntimeout = 742.5\n";
    const SETUP: &str = "behavior_order = ['screensaver']\npre_action_fade_seconds = 0.0\n[behavior.screensaver]\naction = 'command'\ncommand = '/home/me/.local/bin/scrnsvr --open'\nenabled = true\ntimeout = 742.5\n";

    fn ready(idle: Idle) -> Ready {
        match idle {
            Idle::Ready(ready) => *ready,
            other => panic!("expected a ready state, got {other:?}"),
        }
    }

    #[test]
    fn probing_reports_the_behavior_its_timeout_and_the_command_to_plan_for() {
        let temp = tempfile::tempdir().unwrap();
        let source = fake(temp.path(), EXISTING, SETUP);
        let ready = ready(probe(&source));
        let behavior = ready.status.behavior.as_ref().unwrap();
        assert_eq!((behavior.name.as_str(), behavior.enabled, behavior.timeout), ("screensaver", Some(false), Some(742.5)));
        assert_eq!(ready.status.fade_seconds, Some(2.0));
        assert!(ready.installed);
        assert!(!temp.path().join("wrote").exists(), "probing never writes");
        let calls = fs::read_to_string(temp.path().join("calls")).unwrap();
        assert_eq!(calls.trim(), "config-get|idle|");
    }

    #[test]
    fn probing_distinguishes_a_missing_cli_from_a_session_that_is_not_running() {
        let temp = tempfile::tempdir().unwrap();
        let missing = IdleSource { noctalia: Noctalia::with_program(temp.path().join("nope")), executable: None };
        assert_eq!(probe(&missing), Idle::Absent);
        let script = temp.path().join("noctalia");
        fs::write(&script, "#!/bin/sh\nprintf 'no shell running' >&2\nexit 1\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        let down = IdleSource { noctalia: Noctalia::with_program(script), executable: None };
        match probe(&down) {
            Idle::Failed(message) => assert!(message.contains("no shell running"), "{message}"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_proposal_lists_the_changes_and_applying_writes_only_after_the_caller_confirms() {
        let temp = tempfile::tempdir().unwrap();
        let source = fake(temp.path(), EXISTING, SETUP);
        let ready = ready(probe(&source));
        let plan = ready.proposal(None).unwrap();
        let paths: Vec<_> = plan.changes.iter().map(|change| change.path.as_str()).collect();
        assert_eq!(paths, ["idle.behavior.screensaver.command", "idle.behavior.screensaver.enabled", "idle.pre_action_fade_seconds"]);
        assert!(!temp.path().join("wrote").exists(), "planning does not write");
        assert!(ready.proposal(Some(-1.0)).is_err());

        let after = apply(&source, &plan, None).unwrap();
        let calls = fs::read_to_string(temp.path().join("calls")).unwrap();
        assert_eq!(calls.matches("config-set").count(), 3);
        assert!(calls.contains("config-set|idle.behavior.screensaver.enabled|true"));
        let updated = self::ready(after);
        assert_eq!(updated.status.behavior.clone().unwrap().enabled, Some(true));
        assert!(updated.proposal(None).unwrap().changes.is_empty(), "the second look finds nothing left to do");
    }

    #[test]
    fn a_change_noctalia_does_not_keep_is_reported() {
        let temp = tempfile::tempdir().unwrap();
        let source = fake(temp.path(), EXISTING, EXISTING);
        let ready = ready(probe(&source));
        let plan = ready.proposal(None).unwrap();
        let error = apply(&source, &plan, None).unwrap_err();
        assert!(error.contains("did not keep"), "{error}");
    }

    #[test]
    fn the_timeout_edit_writes_one_setting_and_verifies_it() {
        let temp = tempfile::tempdir().unwrap();
        let after = EXISTING.replace("742.5", "90.0");
        let source = fake(temp.path(), EXISTING, &after);
        let ready = ready(probe(&source));
        let behavior = ready.status.behavior.clone().unwrap();
        assert!(ready.timeout_change(742.5).unwrap().is_none());
        let change = ready.timeout_change(90.0).unwrap().unwrap();
        let updated = self::ready(apply_timeout(&source, &change, &behavior, 90.0).unwrap());
        assert_eq!(updated.status.behavior.unwrap().timeout, Some(90.0));
        let calls = fs::read_to_string(temp.path().join("calls")).unwrap();
        assert_eq!(calls.matches("config-set").count(), 1);
        assert!(calls.contains("config-set|idle.behavior.screensaver.timeout|90.0"));
    }

    #[test]
    fn without_a_launching_behavior_only_setup_can_change_noctalia() {
        let temp = tempfile::tempdir().unwrap();
        let source = fake(temp.path(), "behavior_order = ['lock']\n[behavior.lock]\naction='lock'\ntimeout=900.0", SETUP);
        let ready = ready(probe(&source));
        assert!(ready.status.behavior.is_none());
        assert!(ready.timeout_change(30.0).is_err());
        let plan = ready.proposal(None).unwrap();
        assert_eq!(plan.changes[0].path, "idle.behavior.scrnsvr");
        assert!(plan.changes.iter().any(|change| change.path == "idle.behavior_order"));
    }

    #[test]
    fn text_helpers_cover_the_other_setups() {
        assert_eq!(duration_text(600.0), "10 min");
        assert_eq!(duration_text(90.0), "1 min 30 s");
        assert_eq!(duration_text(45.0), "45 s");
        assert_eq!(hypridle_snippet(600.0), "listener {\n    timeout = 600\n    on-timeout = scrnsvr --open\n}");
        assert!(hypridle_snippet(0.0).contains("timeout = 1\n"));
    }
}

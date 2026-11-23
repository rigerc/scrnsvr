use std::env;
use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::Path;
use std::process::{Command, Output};

fn cli() -> Command {
    Command::new(env!("CARGO_BIN_EXE_scrnsvr"))
}

fn fixture(root: &Path, existing: &str) -> Command {
    let fake_bin = root.join("fake-bin");
    fs::create_dir(&fake_bin).unwrap();
    let script = fake_bin.join("noctalia");
    fs::write(
        &script,
        r#"#!/bin/sh
printf '%s|%s|%s|%s\n' "$1" "$2" "$3" "$4" >> "$TEST_NOCTALIA/calls"
case "$2" in
    config-get)
        file="$TEST_NOCTALIA/current"
        if [ -f "$TEST_NOCTALIA/wrote" ]; then file="$TEST_NOCTALIA/result"; fi
        /bin/cat "$file"
        ;;
    config-set)
        : > "$TEST_NOCTALIA/wrote"
        ;;
    *) exit 9 ;;
esac
"#,
    )
    .unwrap();
    fs::set_permissions(script, fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(root.join("current"), existing).unwrap();
    let mut command = cli();
    command
        .env("PATH", fake_bin)
        .env("XDG_BIN_HOME", root.join("user-bin"))
        .env("APPIMAGE", root.join("Scrnsvr-current.AppImage"))
        .env("TEST_NOCTALIA", root);
    command
}

fn assert_success(output: &Output) -> String {
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8(output.stdout.clone()).unwrap()
}

const EXISTING_IDLE: &str = r#"
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
locked_timeout = 0.0
resume_command = ''
"#;

#[test]
fn noctalia_dry_run_reuses_screensaver_and_keeps_the_existing_timeout() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let output = fixture(root, EXISTING_IDLE).args(["--setup-noctalia"]).output().unwrap();
    let output = assert_success(&output);
    assert!(output.contains("idle.behavior.screensaver.command"));
    assert!(output.contains("Scrnsvr-0.5.0.AppImage --open"));
    assert!(output.contains("Scrnsvr-current.AppImage --open"));
    assert!(output.contains("[idle.behavior.screensaver]"));
    assert!(output.contains("timeout = 742.5"));
    assert!(output.contains("pre_action_fade_seconds = 0.0"));
    assert_eq!(fs::read_to_string(root.join("calls")).unwrap(), "msg|config-get|idle|\n");
}

#[test]
fn noctalia_apply_uses_installed_link_and_updates_only_changed_settings() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let mut command = fixture(root, EXISTING_IDLE);
    let executable = root.join("Scrnsvr-current.AppImage");
    fs::write(&executable, b"").unwrap();
    let bin = root.join("user-bin");
    fs::create_dir(&bin).unwrap();
    let link = bin.join("scrnsvr");
    symlink(executable, &link).unwrap();
    let configured_command = format!("{} --open", link.display());
    let updated = EXISTING_IDLE
        .replace("pre_action_fade_seconds = 2.0", "pre_action_fade_seconds = 0.0")
        .replace("Scrnsvr-0.5.0.AppImage --open", &configured_command)
        .replace("enabled = false", "enabled = true")
        .replace("timeout = 742.5", "timeout = 55.25");
    fs::write(root.join("result"), updated).unwrap();
    let output = command.args(["--setup-noctalia", "--apply", "--timeout", "55.25"]).output().unwrap();
    assert!(assert_success(&output).contains("Noctalia idle settings after setup"));
    assert_eq!(
        fs::read_to_string(root.join("calls")).unwrap(),
        format!(
            "msg|config-get|idle|\nmsg|config-set|idle.behavior.screensaver.command|\"{configured_command}\"\nmsg|config-set|idle.behavior.screensaver.enabled|true\nmsg|config-set|idle.behavior.screensaver.timeout|55.25\nmsg|config-set|idle.pre_action_fade_seconds|0.0\nmsg|config-get|idle|\n"
        )
    );
}

#[test]
fn noctalia_apply_creates_a_behavior_and_appends_it_to_the_order() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let mut command = fixture(root, "behavior_order = ['lock']\npre_action_fade_seconds = 2.0");
    let executable = root.join("Scrnsvr-current.AppImage");
    fs::write(
        root.join("result"),
        format!(
            "behavior_order = ['lock', 'scrnsvr']\npre_action_fade_seconds = 0.0\n\n[behavior.scrnsvr]\naction = 'command'\ncommand = '{} --open'\nenabled = true\ntimeout = 600.0\n",
            executable.display()
        ),
    )
    .unwrap();
    let output = command.args(["--setup-noctalia", "--apply"]).output().unwrap();
    assert_success(&output);
    let calls = fs::read_to_string(root.join("calls")).unwrap();
    let mut calls = calls.lines();
    assert_eq!(calls.next(), Some("msg|config-get|idle|"));
    let creation = calls.next().unwrap().strip_prefix("msg|config-set|idle.behavior.scrnsvr|").unwrap();
    let value: toml::Table = format!("value = {creation}").parse().unwrap();
    assert_eq!(value["value"]["timeout"].as_float(), Some(600.0));
    assert_eq!(calls.next(), Some("msg|config-set|idle.behavior_order|[\"lock\", \"scrnsvr\"]"));
    assert_eq!(calls.next(), Some("msg|config-set|idle.pre_action_fade_seconds|0.0"));
    assert_eq!(calls.next(), Some("msg|config-get|idle|"));
}

#[test]
fn reports_missing_or_inactive_noctalia_and_removed_daemon() {
    let temp = tempfile::tempdir().unwrap();
    let missing = cli().args(["--setup-noctalia"]).env("PATH", temp.path()).output().unwrap();
    assert_eq!(missing.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&missing.stderr).contains("Noctalia is unavailable"));
    let mut inactive = fixture(temp.path(), EXISTING_IDLE);
    fs::write(temp.path().join("fake-bin/noctalia"), "#!/bin/sh\nprintf 'no shell running' >&2\nexit 1\n").unwrap();
    let inactive = inactive.args(["--setup-noctalia"]).output().unwrap();
    assert_eq!(inactive.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&inactive.stderr).contains("no shell running"));
    let daemon = cli().arg("--daemon").output().unwrap();
    assert_eq!(daemon.status.code(), Some(2));
    let error = String::from_utf8_lossy(&daemon.stderr);
    assert!(error.contains("--setup-noctalia"));
    assert!(error.contains("hypridle"));
}

/// A private copy of the CLI beside fake `scrnsvr-settings` and `scrnsvr-renderer` scripts, so sibling lookup is deterministic.
fn isolated(root: &Path, settings: &str, renderer: &str) -> Command {
    let bin = root.join("isolated-bin");
    fs::create_dir(&bin).unwrap();
    fs::copy(env!("CARGO_BIN_EXE_scrnsvr"), bin.join("scrnsvr")).unwrap();
    for (name, body) in [("scrnsvr-settings", settings), ("scrnsvr-renderer", renderer)] {
        let path = bin.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let mut command = Command::new(bin.join("scrnsvr"));
    command.env("PATH", root.join("empty-path")).env_remove("WAYLAND_DISPLAY").env("XDG_RUNTIME_DIR", root.join("runtime"));
    fs::create_dir_all(root.join("runtime")).unwrap();
    command
}

#[test]
fn settings_launch_next_to_the_executable_with_and_without_arguments() {
    let temp = tempfile::tempdir().unwrap();
    for args in [&[][..], &["--settings"], &["-s"], &["--open", "--settings"]] {
        let marker = temp.path().join("launched");
        let _ = fs::remove_file(&marker);
        let status =
            isolated_clean(temp.path(), &format!("echo \"$#\" > '{}'; exit 7", marker.display()), "exit 0").args(args).status().unwrap();
        assert_eq!(status.code(), Some(7), "the settings exit status is propagated for {args:?}");
        assert_eq!(fs::read_to_string(&marker).unwrap().trim(), "0", "settings receive no arguments");
    }
}

fn isolated_clean(root: &Path, settings: &str, renderer: &str) -> Command {
    let _ = fs::remove_dir_all(root.join("isolated-bin"));
    isolated(root, settings, renderer)
}

#[test]
fn open_reports_a_missing_renderer_and_missing_wayland_with_exit_one() {
    let temp = tempfile::tempdir().unwrap();
    let bin = temp.path().join("only-cli");
    fs::create_dir(&bin).unwrap();
    fs::copy(env!("CARGO_BIN_EXE_scrnsvr"), bin.join("scrnsvr")).unwrap();
    fs::create_dir(temp.path().join("runtime")).unwrap();
    let output = Command::new(bin.join("scrnsvr"))
        .arg("--open")
        .env("PATH", temp.path())
        .env("XDG_RUNTIME_DIR", temp.path().join("runtime"))
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("scrnsvr-renderer is unavailable"));

    let output = isolated_clean(temp.path(), "exit 0", "exit 0").arg("--open").output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("Cannot connect to Wayland"));
    let output = isolated_clean(temp.path(), "exit 0", "exit 0").arg("--open").env_remove("XDG_RUNTIME_DIR").output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("XDG_RUNTIME_DIR"));
}

fn hold_saver_lock(root: &Path) -> fs::File {
    use std::os::fd::AsRawFd;
    let dir = root.join("runtime/scrnsvr");
    fs::create_dir_all(&dir).unwrap();
    let lock = fs::File::create(dir.join("saver.lock")).unwrap();
    // SAFETY: the descriptor is live for the call and kept open by the caller.
    assert_eq!(unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) }, 0);
    fs::write(dir.join("saver.pid"), format!("{}\n", std::process::id())).unwrap();
    lock
}

#[test]
fn second_open_exits_zero_while_the_saver_lock_is_held() {
    let temp = tempfile::tempdir().unwrap();
    let _lock = hold_saver_lock(temp.path());
    let output = isolated_clean(temp.path(), "exit 0", "exit 0").arg("--open").output().unwrap();
    assert_eq!(output.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&output.stderr).contains("already running"));
}

#[test]
fn dismiss_exits_zero_without_a_saver_and_signals_the_lock_holder() {
    let temp = tempfile::tempdir().unwrap();
    assert_eq!(isolated_clean(temp.path(), "exit 0", "exit 0").arg("--dismiss").status().unwrap().code(), Some(0));
    assert_eq!(
        isolated_clean(temp.path(), "exit 0", "exit 0").arg("--dismiss").env_remove("XDG_RUNTIME_DIR").status().unwrap().code(),
        Some(0)
    );

    // A real holder: a child that takes the lock, writes its PID and reports the SIGUSR1 it receives.
    let marker = temp.path().join("signalled");
    let dir = temp.path().join("runtime/scrnsvr");
    fs::create_dir_all(&dir).unwrap();
    let script = format!(
        "exec 9>'{lock}'; flock -n 9 || exit 3; echo $$ > '{pid}'; trap 'echo usr1 > \"{marker}\"; exit 0' USR1; while :; do sleep 0.05; done",
        lock = dir.join("saver.lock").display(),
        pid = dir.join("saver.pid").display(),
        marker = marker.display()
    );
    let mut holder = Command::new("sh").args(["-c", &script]).spawn().unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while !dir.join("saver.pid").exists() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let status = isolated_clean(temp.path(), "exit 0", "exit 0").arg("--dismiss").status().unwrap();
    assert_eq!(status.code(), Some(0));
    assert!(holder.wait().unwrap().success());
    assert_eq!(fs::read_to_string(marker).unwrap().trim(), "usr1");
}

#[test]
fn install_links_the_appimage_or_current_executable_and_protects_other_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let bin_home = root.join("xdg-bin");
    let appimage = root.join("Scrnsvr-1.0.0.AppImage");
    let run = |force: bool, appimage: Option<&Path>| {
        let mut command = cli();
        command.arg("--install").env("XDG_BIN_HOME", &bin_home).env_remove("APPIMAGE");
        if let Some(path) = appimage {
            command.env("APPIMAGE", path);
        }
        if force {
            command.arg("--force");
        }
        command.output().unwrap()
    };
    assert!(assert_success(&run(false, Some(&appimage))).starts_with("Linked"));
    assert_eq!(fs::read_link(bin_home.join("scrnsvr")).unwrap(), appimage);
    assert!(assert_success(&run(false, Some(&appimage))).starts_with("Already linked"));
    // Without $APPIMAGE the link targets this executable.
    assert_success(&run(false, None));
    assert_eq!(fs::read_link(bin_home.join("scrnsvr")).unwrap(), Path::new(env!("CARGO_BIN_EXE_scrnsvr")));

    let link = bin_home.join("scrnsvr");
    fs::remove_file(&link).unwrap();
    fs::write(&link, b"user script").unwrap();
    let refused = run(false, Some(&appimage));
    assert_eq!(refused.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&refused.stderr).contains("--force"));
    assert_eq!(fs::read(&link).unwrap(), b"user script");
    assert_success(&run(true, Some(&appimage)));
    assert_eq!(fs::read_link(&link).unwrap(), appimage);
    fs::remove_file(&link).unwrap();
    symlink("/usr/bin/true", &link).unwrap();
    assert_eq!(run(false, Some(&appimage)).status.code(), Some(1));
    assert_eq!(fs::read_link(&link).unwrap(), Path::new("/usr/bin/true"));
}

#[test]
fn thumbnail_reports_each_failed_shader_without_retrying_and_exits_nonzero() {
    let temp = tempfile::tempdir().unwrap();
    let count = temp.path().join("count");
    let renderer = format!("echo x >> '{}'; echo 'boom' >&2; exit 1", count.display());
    let output_dir = temp.path().join("thumbs");
    let output = isolated_clean(temp.path(), "exit 0", &renderer)
        .args(["--thumbnail", "--frames", "2", "--output"])
        .arg(&output_dir)
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("scrnsvr thumbnail flow-field: renderer returned"), "{stderr}");
    assert!(stderr.contains("41 of 41 thumbnail captures failed"), "{stderr}");
    assert_eq!(fs::read_to_string(count).unwrap().lines().count(), 41, "one attempt per shader");
    assert_eq!(fs::read_dir(output_dir).unwrap().count(), 0);
}

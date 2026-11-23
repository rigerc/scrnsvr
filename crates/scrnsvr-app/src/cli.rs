mod controller;
mod install;
mod instance;
mod noctalia;
mod preview;
mod thumbnail;

use std::env;
use std::ffi::{CString, OsString};
use std::os::unix::ffi::OsStrExt;
use std::path::PathBuf;
use std::process::{Command, ExitCode};
use std::sync::atomic::{AtomicBool, Ordering};

use scrnsvr_core::config::{Config, config_path};

const HELP: &str = "Usage: scrnsvr [MODE] [OPTIONS]

With no mode, open settings.
  -s, --settings      Open the settings application
      --open          Start the full-screen Wayland screensaver
      --dismiss       Fade out the running screensaver
      --preview       Open a windowed preview without shuffle
      --shader <id>   Choose the starting shader for --open or --preview
      --thumbnail     Render a 640×360 PNG for each built-in shader
      --output <dir>  Thumbnail directory (default: assets/thumbnails)
      --frames <n>    Thumbnail frames per shader (default: 3)
      --install       Link scrnsvr into $XDG_BIN_HOME or ~/.local/bin
      --force         Replace an unrelated file or link when installing
      --setup-noctalia  Show the Noctalia idle setup
      --apply         Apply the Noctalia idle setup
      --timeout <seconds>  Override the Noctalia idle timeout
  -h, --help          Print help";

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Debug, PartialEq, Eq)]
enum Mode {
    Settings,
    Open,
    Dismiss,
    RemovedDaemon,
    Preview,
    Thumbnail,
    Install,
    SetupNoctalia,
    Help,
}

#[derive(Debug)]
struct Options {
    mode: Mode,
    shader: Option<String>,
    output: PathBuf,
    frames: u32,
    force: bool,
    apply: bool,
    timeout: Option<f64>,
}

impl Options {
    fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Self> {
        let mut args = args.into_iter();
        let (mut settings, mut open, mut daemon, mut preview, mut thumbnails) = (false, false, false, false, false);
        let (mut dismiss, mut install, mut setup) = (false, false, false);
        let mut options = Self {
            mode: Mode::Settings,
            shader: None,
            output: "assets/thumbnails".into(),
            frames: 3,
            force: false,
            apply: false,
            timeout: None,
        };
        while let Some(arg) = args.next() {
            let mut value = || args.next().ok_or_else(|| format!("{} requires a value", arg.to_string_lossy()));
            match arg.to_str() {
                Some("-h" | "--help") => {
                    options.mode = Mode::Help;
                    return Ok(options);
                }
                Some("-s" | "--settings") => settings = true,
                Some("--open") => open = true,
                Some("--daemon") => daemon = true,
                Some("--preview") => preview = true,
                Some("--thumbnail") => thumbnails = true,
                Some("--dismiss") => dismiss = true,
                Some("--install") => install = true,
                Some("--setup-noctalia") => setup = true,
                Some("--force") => options.force = true,
                Some("--apply") => options.apply = true,
                Some("--timeout") => {
                    let seconds = value()?
                        .to_str()
                        .and_then(|text| text.parse::<f64>().ok())
                        .filter(|seconds| seconds.is_finite() && *seconds >= 0.0)
                        .ok_or("--timeout must be a finite, non-negative number of seconds")?;
                    options.timeout = Some(seconds);
                }
                Some("--shader") => options.shader = Some(value()?.into_string().map_err(|_| "Shader ID must be UTF-8")?),
                Some("--output") => options.output = value()?.into(),
                Some("--frames") => {
                    if let Some(frames) = value()?.to_str().and_then(|value| value.parse().ok()).filter(|frames| *frames > 0) {
                        options.frames = frames;
                    }
                }
                _ => return Err(format!("Unknown argument {}", arg.to_string_lossy()).into()),
            }
        }
        if daemon {
            options.mode = Mode::RemovedDaemon;
            return Ok(options);
        }
        let actions = usize::from(dismiss) + usize::from(install) + usize::from(setup);
        if actions > 1 || (actions == 1 && (settings || open || preview || thumbnails)) {
            return Err("--dismiss, --install, and --setup-noctalia must be used on their own".into());
        }
        if options.force && !install {
            return Err("--force requires --install".into());
        }
        if (options.apply || options.timeout.is_some()) && !setup {
            return Err("--apply and --timeout require --setup-noctalia".into());
        }
        options.mode = if dismiss {
            Mode::Dismiss
        } else if install {
            Mode::Install
        } else if setup {
            Mode::SetupNoctalia
        } else if thumbnails {
            Mode::Thumbnail
        } else if settings {
            Mode::Settings
        } else if preview {
            Mode::Preview
        } else if open {
            Mode::Open
        } else {
            Mode::Settings
        };
        Ok(options)
    }
}

fn load_config() -> Config {
    let Some(path) = config_path() else { return Config::default() };
    let loaded = Config::load(&path);
    if let Some(error) = loaded.error {
        eprintln!("scrnsvr: {error}; using defaults");
    }
    for warning in loaded.warnings {
        eprintln!("scrnsvr: {warning}");
    }
    loaded.config
}

fn executable(name: &str) -> Result<PathBuf> {
    let current = env::current_exe()?;
    let sibling = current.with_file_name(name);
    let path = env::var_os("PATH").unwrap_or_default();
    let executable = std::iter::once(sibling)
        .chain(env::split_paths(&path).map(|dir| dir.join(name)))
        .find(|path| {
            path.is_file()
                && CString::new(path.as_os_str().as_bytes()).is_ok_and(|path| {
                    // SAFETY: the CString is live and NUL-terminated.
                    unsafe { libc::access(path.as_ptr(), libc::X_OK) == 0 }
                })
        })
        .ok_or_else(|| format!("{name} is unavailable; checked next to {} and on PATH", current.display()))?;
    // A relative PATH entry still needs a slash when handed to Command.
    Ok(std::path::absolute(executable)?)
}

static STOP: AtomicBool = AtomicBool::new(false);

extern "C" fn stop(_: libc::c_int) {
    STOP.store(true, Ordering::Relaxed);
}

fn install_signals() -> std::io::Result<()> {
    // SAFETY: sigaction is initialized and the handler only stores to a lock-free atomic.
    unsafe {
        let mut action: libc::sigaction = std::mem::zeroed();
        action.sa_sigaction = stop as *const () as usize;
        libc::sigemptyset(&mut action.sa_mask);
        for signal in [libc::SIGTERM, libc::SIGINT, libc::SIGUSR1] {
            if libc::sigaction(signal, &action, std::ptr::null_mut()) != 0 {
                return Err(std::io::Error::last_os_error());
            }
        }
    }
    Ok(())
}

fn run(options: Options) -> Result<u8> {
    match options.mode {
        Mode::Help => println!("{HELP}"),
        Mode::Settings => {
            let status = Command::new(executable("scrnsvr-settings")?).status()?;
            return Ok(status.code().and_then(|code| u8::try_from(code).ok()).unwrap_or(1));
        }
        Mode::Open => {
            install_signals()?;
            let dir = instance::runtime_directory().ok_or("XDG_RUNTIME_DIR must be set for the Wayland saver")?;
            if let Some(instance) = instance::Instance::open(&dir)? {
                controller::open(options.shader.as_deref(), &instance)?;
            } else {
                eprintln!("scrnsvr: a saver is already running");
            }
        }
        Mode::Dismiss => {
            if let Some(dir) = instance::runtime_directory() {
                instance::dismiss(&dir)?;
            }
        }
        Mode::RemovedDaemon => {
            eprintln!(
                "scrnsvr: the built-in daemon was removed. Use scrnsvr --setup-noctalia or configure hypridle to run scrnsvr --open."
            );
            return Ok(2);
        }
        Mode::Preview => {
            install_signals()?;
            preview::run(options.shader.as_deref())?;
        }
        Mode::Thumbnail => thumbnail::run(&options.output, options.frames)?,
        Mode::Install => {
            let link = install::bin_link()?;
            let target = install::current_distribution()?;
            let updated = install::install(&link, &target, options.force)?;
            let action = if updated { "Linked" } else { "Already linked" };
            println!("{action} {} → {}", link.display(), target.display());
        }
        Mode::SetupNoctalia => noctalia::setup(options.apply, options.timeout)?,
    }
    Ok(0)
}

fn main() -> ExitCode {
    match Options::parse(env::args_os().skip(1)).and_then(run) {
        Ok(code) => ExitCode::from(code),
        Err(error) => {
            eprintln!("scrnsvr: {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    fn parse(args: &[&str]) -> Result<Options> {
        Options::parse(args.iter().map(OsString::from))
    }

    #[test]
    fn launch_precedence_for_every_combination() {
        let descending =
            [("--thumbnail", Mode::Thumbnail), ("--settings", Mode::Settings), ("--preview", Mode::Preview), ("--open", Mode::Open)];
        for mask in 0..1 << descending.len() {
            let selected: Vec<_> = descending.iter().enumerate().filter(|(i, _)| mask & (1 << i) != 0).map(|(_, entry)| entry).collect();
            let expected = selected.first().map_or(&Mode::Settings, |(_, mode)| mode);
            let flags: Vec<_> = selected.iter().map(|(flag, _)| *flag).collect();
            assert_eq!(&parse(&flags).unwrap().mode, expected, "{flags:?}");
            assert_eq!(&parse(&flags.into_iter().rev().collect::<Vec<_>>()).unwrap().mode, expected);
        }
        assert_eq!(parse(&["--daemon", "-s"]).unwrap().mode, Mode::RemovedDaemon);
    }

    #[test]
    fn parses_mode_arguments_and_defaults() {
        let options = parse(&["--preview", "--shader", "plasma", "--output", "/tmp/out", "--frames", "8"]).unwrap();
        assert_eq!(options.shader.as_deref(), Some("plasma"));
        assert_eq!(options.output, Path::new("/tmp/out"));
        assert_eq!(options.frames, 8);
        let defaults = parse(&["--frames", "-1"]).unwrap();
        assert_eq!(defaults.frames, 3);
        assert_eq!(defaults.output, Path::new("assets/thumbnails"));
        assert!(parse(&["--backend", "window"]).is_err());
        assert!(parse(&["--shader"]).is_err());
    }

    #[test]
    fn setup_install_and_dismiss_are_explicit() {
        assert_eq!(parse(&["--dismiss"]).unwrap().mode, Mode::Dismiss);
        let options = parse(&["--force", "--install"]).unwrap();
        assert_eq!(options.mode, Mode::Install);
        assert!(options.force);
        let options = parse(&["--setup-noctalia", "--apply", "--timeout", "30.5"]).unwrap();
        assert_eq!(options.mode, Mode::SetupNoctalia);
        assert!(options.apply);
        assert_eq!(options.timeout, Some(30.5));
        for flags in [
            &["--install", "--open"][..],
            &["--force"],
            &["--apply"],
            &["--timeout", "5"],
            &["--install-service"],
            &["--setup-noctalia", "--timeout", "NaN"],
            &["--dismiss", "--preview"],
        ] {
            assert!(parse(flags).is_err(), "{flags:?}");
        }
    }
}

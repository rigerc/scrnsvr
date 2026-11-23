//! XDG state and a revision-based autosave queue.

use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use scrnsvr_core::config::{Config, config_path};

use crate::idle::IdleSource;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
pub struct UiState {
    pub favorites: BTreeSet<String>,
}

impl UiState {
    fn load(path: &Path) -> Result<Self, String> {
        match fs::read_to_string(path) {
            Ok(text) => toml::from_str(&text).map_err(|error| error.to_string()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(error.to_string()),
        }
    }

    fn save(&self, path: &Path) -> Result<(), String> {
        let write = || -> io::Result<()> {
            let directory = path.parent().expect("UI file has a parent");
            fs::create_dir_all(directory)?;
            let mut temp = tempfile::NamedTempFile::new_in(directory)?;
            let content = toml::to_string(self).map_err(io::Error::other)?;
            temp.write_all(content.as_bytes())?;
            temp.as_file().sync_all()?;
            temp.persist(path)?;
            File::open(directory)?.sync_all()
        };
        write().map_err(|error| format!("{}: {error}", path.display()))
    }
}

#[derive(Clone, Default)]
pub struct Paths {
    pub config: Option<PathBuf>,
    pub ui: Option<PathBuf>,
    /// Noctalia's color file. `None` reads `$XDG_CONFIG_HOME/noctalia/colors.json`.
    pub colors: Option<PathBuf>,
    /// The `noctalia` command and the command it is told to run.
    pub idle: IdleSource,
}

impl Paths {
    pub fn native() -> Self {
        Self { config: config_path(), ui: dirs::state_dir().map(|dir| dir.join("scrnsvr/ui.toml")), ..Self::default() }
    }

    pub fn load(&self) -> (Config, UiState, Vec<String>, Option<String>) {
        let (config, warnings) = match &self.config {
            Some(path) => {
                let load = Config::load(path);
                let mut warnings = load.warnings;
                warnings.extend(load.error.map(|error| error.to_string()));
                (load.config, warnings)
            }
            None => (Config::default(), vec!["The configuration directory is unavailable.".into()]),
        };
        let favorites = self.ui.as_deref().map(UiState::load).unwrap_or_else(|| Err("The state directory is unavailable.".into()));
        match favorites {
            Ok(ui) => (config, ui, warnings, None),
            Err(error) => (config, UiState::default(), warnings, Some(error)),
        }
    }
}

pub const DEBOUNCE: Duration = Duration::from_millis(300);

#[derive(Debug, Default)]
pub struct SaveQueue {
    revision: u64,
    queued_at: Option<Instant>,
    pub saving: bool,
    pub error: Option<String>,
}

impl SaveQueue {
    pub fn edit(&mut self, now: Instant) {
        self.revision += 1;
        self.queued_at = Some(now + DEBOUNCE);
    }

    pub fn pending(&self) -> bool {
        self.saving || self.queued_at.is_some()
    }

    pub fn due(&self) -> Option<Instant> {
        self.queued_at
    }

    pub fn retry(&mut self, now: Instant) {
        if self.queued_at.is_some() || (self.error.is_some() && !self.saving) {
            self.queued_at = Some(now);
        }
    }

    pub fn take(&mut self, now: Instant) -> Option<u64> {
        if self.saving || now < self.queued_at? {
            return None;
        }
        self.queued_at = None;
        self.saving = true;
        Some(self.revision)
    }

    pub fn finish(&mut self, revision: u64, result: Result<(), String>) {
        self.saving = false;
        if self.revision == revision {
            self.error = result.err();
        }
    }
}

pub fn save_config(config: &Config, path: Option<&Path>) -> Result<(), String> {
    config.save(path.ok_or("The configuration directory is unavailable.")?).map_err(|error| error.to_string())
}

pub fn save_ui(ui: &UiState, path: Option<&Path>) -> Result<(), String> {
    ui.save(path.ok_or("The state directory is unavailable.")?)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::time::{Duration, Instant};

    use scrnsvr_core::config::Config;

    use super::{DEBOUNCE, Paths, SaveQueue, UiState, save_config, save_ui};

    #[test]
    fn favorites_round_trip_independently_and_malformed_data_recovers() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("state/scrnsvr/ui.toml");
        let config = temp.path().join("config/scrnsvr/config.toml");
        let paths = Paths { ui: Some(path.clone()), config: Some(config.clone()), ..Paths::default() };
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "favorites = invalid").unwrap();
        let (_, mut ui, _, warning) = paths.load();
        assert!(warning.is_some());
        assert!(ui.favorites.is_empty());
        ui.favorites.insert("plasma".into());
        save_ui(&ui, Some(&path)).unwrap();
        assert_eq!(paths.load().1, ui);
        assert!(paths.load().3.is_none());
        assert!(!config.exists());
    }

    #[test]
    fn continuous_edits_coalesce_and_inflight_saves_do_not_overwrite_newer_edits() {
        let mut queue = SaveQueue::default();
        let now = Instant::now();
        queue.edit(now);
        let later = now + Duration::from_millis(120);
        queue.edit(later);
        assert_eq!(queue.take(now + DEBOUNCE), None);
        let revision = queue.take(later + DEBOUNCE).unwrap();
        queue.edit(later + DEBOUNCE);
        assert!(queue.pending());
        assert_eq!(queue.take(later + DEBOUNCE * 2), None);
        queue.finish(revision, Err("old save failed".into()));
        assert!(queue.error.is_none());
        let newer = queue.take(later + DEBOUNCE * 2).unwrap();
        assert!(newer > revision);
        queue.finish(newer, Ok(()));
        assert!(!queue.pending());
    }

    #[test]
    fn unwritable_config_can_be_retried_with_latest_edits() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let directory = temp.path().join("scrnsvr");
        fs::create_dir(&directory).unwrap();
        let path = directory.join("config.toml");
        let mut config = Config { shader: "plasma".into(), ..Config::default() };
        let mut queue = SaveQueue::default();
        let now = Instant::now();
        queue.edit(now);
        let revision = queue.take(now + DEBOUNCE).unwrap();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o500)).unwrap();
        // Root bypasses chmod. /proc supplies an unwritable directory even in that runner.
        let target =
            if fs::File::create(directory.join("permission-probe")).is_ok() { Path::new("/proc/self/scrnsvr-test.toml") } else { &path };
        queue.finish(revision, save_config(&config, Some(target)));
        assert!(queue.error.is_some());
        assert!(!queue.pending());
        assert!(!path.exists());

        config.shader = "aurora-veil".into();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
        queue.retry(now + DEBOUNCE);
        let revision = queue.take(now + DEBOUNCE).unwrap();
        queue.finish(revision, save_config(&config, Some(&path)));
        assert!(queue.error.is_none());
        assert_eq!(Config::load(&path).config.shader, "aurora-veil");
    }

    #[test]
    fn malformed_config_reports_a_warning_and_preserves_file_until_an_edit() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("config.toml");
        fs::write(&path, "bad = [").unwrap();
        let paths = Paths { config: Some(path.clone()), ..Paths::default() };
        let (config, ui, warnings, _) = paths.load();
        assert_eq!(config, Config::default());
        assert_eq!(ui, UiState::default());
        assert!(!warnings.is_empty());
        assert_eq!(fs::read_to_string(path).unwrap(), "bad = [");
    }
}

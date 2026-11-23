//! Gallery thumbnails: what to render, in which order, and what is ready.
//!
//! Every visual gets a clean 640×360 image (defaults only, no effects or clock) rendered by
//! `scrnsvr-renderer --capture` in the background and cached under
//! `$XDG_CACHE_HOME/scrnsvr/thumbnails/<id>-<key>.png`. The key hashes the scene sent to the
//! renderer, so editing a custom shader or upgrading the app asks for a fresh image while the old
//! one keeps showing until it is ready. At most [`CONCURRENCY`] captures run at once.
//!
//! This module is plain state; the settings window starts the captures and reports results.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use scrnsvr_core::SceneSpec;
use scrnsvr_core::thumbnail::{cache_key, cached_path};

/// Captures that may run at the same time. Each is a short-lived renderer process.
pub const CONCURRENCY: usize = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum State {
    Queued,
    Rendering,
    Ready,
    Failed(String),
}

#[derive(Debug, Clone)]
pub struct Entry {
    pub key: String,
    pub state: State,
    /// The last image that is ready for this visual, shown while a newer one renders.
    pub shown: Option<PathBuf>,
}

/// One capture to run: the scene to render and where to put the PNG.
#[derive(Debug, Clone)]
pub struct Job {
    pub id: String,
    pub key: String,
    pub scene: Arc<SceneSpec>,
    pub output: PathBuf,
}

#[derive(Debug, Default)]
pub struct Thumbnails {
    directory: Option<PathBuf>,
    frames: u32,
    entries: HashMap<String, Entry>,
    queue: VecDeque<Job>,
    active: usize,
}

impl Thumbnails {
    pub fn new(directory: Option<PathBuf>, frames: u32) -> Self {
        Self { directory, frames, ..Self::default() }
    }

    pub fn available(&self) -> bool {
        self.directory.is_some()
    }

    /// Ask for the image of `id` for `scene`. Does nothing when it is already ready or on its way;
    /// finds it on disk when an earlier run left it; otherwise queues a capture, ahead of the
    /// others when `urgent` (the visual was just edited or selected).
    pub fn want(&mut self, id: &str, scene: SceneSpec, urgent: bool) {
        let Some(directory) = &self.directory else { return };
        let key = cache_key(&scene, self.frames);
        let path = cached_path(directory, id, &key);
        let previous = self.entries.get(id);
        if previous.is_some_and(|entry| entry.key == key && !matches!(entry.state, State::Failed(_))) {
            return;
        }
        let shown = previous.and_then(|entry| entry.shown.clone());
        self.queue.retain(|job| job.id != id);
        if path.is_file() {
            self.entries.insert(id.into(), Entry { key, state: State::Ready, shown: Some(path) });
            return;
        }
        self.entries.insert(id.into(), Entry { key: key.clone(), state: State::Queued, shown });
        let job = Job { id: id.into(), key, scene: Arc::new(scene), output: path };
        if urgent { self.queue.push_front(job) } else { self.queue.push_back(job) }
    }

    /// The next capture to start, if a slot is free.
    pub fn next_job(&mut self) -> Option<Job> {
        if self.active >= CONCURRENCY {
            return None;
        }
        let job = self.queue.pop_front()?;
        self.active += 1;
        if let Some(entry) = self.entries.get_mut(&job.id) {
            entry.state = State::Rendering;
        }
        Some(job)
    }

    /// Record a finished capture. A result for an older request (the source changed meanwhile) is
    /// dropped, and its file is left for the next prune.
    pub fn finished(&mut self, job: &Job, result: Result<(), String>) {
        self.active = self.active.saturating_sub(1);
        let Some(entry) = self.entries.get_mut(&job.id).filter(|entry| entry.key == job.key) else { return };
        match result {
            Ok(()) => {
                entry.state = State::Ready;
                entry.shown = Some(job.output.clone());
            }
            Err(error) => entry.state = State::Failed(error),
        }
    }

    pub fn entry(&self, id: &str) -> Option<&Entry> {
        self.entries.get(id)
    }

    /// The image to show for `id`: the ready one, or the previous one while a new one renders.
    pub fn image(&self, id: &str) -> Option<&Path> {
        self.entries.get(id).and_then(|entry| entry.shown.as_deref())
    }

    pub fn failure(&self, id: &str) -> Option<&str> {
        match &self.entries.get(id)?.state {
            State::Failed(error) => Some(error),
            _ => None,
        }
    }

    pub fn forget(&mut self, id: &str) {
        self.entries.remove(id);
        self.queue.retain(|job| job.id != id);
    }

    pub fn pending(&self) -> usize {
        self.queue.len() + self.active
    }

    pub fn directory(&self) -> Option<&Path> {
        self.directory.as_deref()
    }

    pub fn ready_count(&self) -> usize {
        self.entries.values().filter(|entry| entry.state == State::Ready).count()
    }
}

#[cfg(test)]
mod tests {
    use scrnsvr_core::catalog::Catalog;
    use scrnsvr_core::config::CustomShader;
    use scrnsvr_core::thumbnail::clean_scene;

    use super::*;

    fn scene(id: &str, source: &str) -> SceneSpec {
        let custom = [CustomShader { id: "custom-a".into(), title: "A".into(), source: source.into() }];
        clean_scene(Catalog::builtin(), &custom, id).unwrap()
    }

    fn thumbnails(directory: &Path) -> Thumbnails {
        Thumbnails::new(Some(directory.to_path_buf()), 3)
    }

    #[test]
    fn requests_are_deduplicated_limited_and_ordered() {
        let directory = tempfile::tempdir().unwrap();
        let mut thumbnails = thumbnails(directory.path());
        for id in ["plasma", "flow-field", "aurora-veil"] {
            thumbnails.want(id, scene(id, ""), false);
            thumbnails.want(id, scene(id, ""), false);
        }
        assert_eq!(thumbnails.pending(), 3);
        thumbnails.want("tidal-caustics", scene("tidal-caustics", ""), true);
        let first = thumbnails.next_job().unwrap();
        let second = thumbnails.next_job().unwrap();
        assert_eq!((first.id.as_str(), second.id.as_str()), ("tidal-caustics", "plasma"), "urgent first, then in request order");
        assert!(thumbnails.next_job().is_none(), "two at a time");
        assert_eq!(thumbnails.entry("plasma").unwrap().state, State::Rendering);
        thumbnails.finished(&first, Ok(()));
        assert_eq!(thumbnails.image("tidal-caustics"), Some(first.output.as_path()));
        assert_eq!(thumbnails.next_job().unwrap().id, "flow-field");
        assert_eq!(thumbnails.pending(), 3);
    }

    #[test]
    fn an_existing_cache_file_is_used_without_rendering() {
        let directory = tempfile::tempdir().unwrap();
        let mut thumbnails = thumbnails(directory.path());
        let plasma = scene("plasma", "");
        let path = cached_path(directory.path(), "plasma", &cache_key(&plasma, 3));
        std::fs::write(&path, "png").unwrap();
        thumbnails.want("plasma", plasma, false);
        assert_eq!(thumbnails.image("plasma"), Some(path.as_path()));
        assert_eq!(thumbnails.pending(), 0);
        assert_eq!(thumbnails.ready_count(), 1);
    }

    #[test]
    fn an_edit_invalidates_the_key_keeps_the_old_image_and_drops_stale_results() {
        let directory = tempfile::tempdir().unwrap();
        let mut thumbnails = thumbnails(directory.path());
        thumbnails.want("custom-a", scene("custom-a", "void main(){gl_FragColor=vec4(1.0);}"), false);
        let old = thumbnails.next_job().unwrap();
        thumbnails.finished(&old, Ok(()));
        let old_path = old.output.clone();

        thumbnails.want("custom-a", scene("custom-a", "void main(){gl_FragColor=vec4(0.0);}"), true);
        assert_eq!(thumbnails.image("custom-a"), Some(old_path.as_path()), "the previous image stays until the new one is ready");
        let newer = thumbnails.next_job().unwrap();
        assert_ne!(newer.key, old.key);
        // The shader changes again while that capture runs: its result must not be shown.
        thumbnails.want("custom-a", scene("custom-a", "void main(){gl_FragColor=vec4(0.3);}"), true);
        thumbnails.finished(&newer, Ok(()));
        assert_eq!(thumbnails.image("custom-a"), Some(old_path.as_path()));
        assert_eq!(thumbnails.entry("custom-a").unwrap().state, State::Queued);
        let latest = thumbnails.next_job().unwrap();
        thumbnails.finished(&latest, Ok(()));
        assert_eq!(thumbnails.image("custom-a"), Some(latest.output.as_path()));
    }

    #[test]
    fn failures_are_reported_per_visual_and_retried_on_the_next_request() {
        let directory = tempfile::tempdir().unwrap();
        let mut thumbnails = thumbnails(directory.path());
        thumbnails.want("plasma", scene("plasma", ""), false);
        let job = thumbnails.next_job().unwrap();
        thumbnails.finished(&job, Err("renderer returned exit status: 2".into()));
        assert_eq!(thumbnails.failure("plasma"), Some("renderer returned exit status: 2"));
        assert!(thumbnails.image("plasma").is_none());
        thumbnails.want("plasma", scene("plasma", ""), false);
        assert_eq!(thumbnails.entry("plasma").unwrap().state, State::Queued, "asking again retries");
        thumbnails.forget("plasma");
        assert_eq!(thumbnails.pending(), 0, "forgetting drops the queued retry");
    }

    #[test]
    fn without_a_cache_directory_nothing_is_queued() {
        let mut thumbnails = Thumbnails::new(None, 3);
        thumbnails.want("plasma", scene("plasma", ""), false);
        assert!(!thumbnails.available());
        assert_eq!(thumbnails.pending(), 0);
    }
}

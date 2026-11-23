//! Checking a custom shader while it is edited.
//!
//! A source passes when the GLSL policy accepts it and a real GLES compile and link succeed.
//! The compile runs in `scrnsvr-renderer --compile-check`, the binary the saver renders with, so
//! "valid here" means "the saver will show it". Driver diagnostics come back on the user's lines.
//!
//! [`Drafts`] holds the editing state independent of GPUI: what is being checked, which result is
//! current, and what the shader's last valid source is. Only a valid, current result is applied;
//! an invalid edit leaves the saved source (and so the preview) alone.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use scrnsvr_core::compile_check::{CheckError, CompileChecker};
use scrnsvr_core::diagnostics::{Diagnostic, map_driver_log, policy_diagnostic};
use scrnsvr_core::exec::find_executable;
use scrnsvr_core::source::custom_fragment_source_mapped;

/// How long after the last keystroke a source is checked.
pub const DEBOUNCE: Duration = Duration::from_millis(400);

/// Compiles a wrapped fragment source. Implemented by the renderer client and by test doubles.
pub trait ShaderChecker: Send + Sync {
    /// `Ok(None)`: it compiles and links. `Ok(Some(log))`: the driver rejected it.
    fn check(&self, fragment: &str) -> Result<Option<String>, CheckError>;
}

/// The real checker: one long-lived `scrnsvr-renderer --compile-check` child.
pub struct RendererChecker {
    program: Option<PathBuf>,
    child: Mutex<Option<CompileChecker>>,
}

impl RendererChecker {
    /// `program` of `None` finds `scrnsvr-renderer` next to this program or on `PATH` on first use.
    pub fn new(program: Option<PathBuf>) -> Self {
        Self { program, child: Mutex::new(None) }
    }
}

impl ShaderChecker for RendererChecker {
    fn check(&self, fragment: &str) -> Result<Option<String>, CheckError> {
        let mut child = self.child.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if child.is_none() {
            let program = match &self.program {
                Some(program) => program.clone(),
                None => find_executable("scrnsvr-renderer").map_err(CheckError::Unavailable)?,
            };
            *child = Some(CompileChecker::new(program));
        }
        child.as_mut().expect("created above").check(fragment)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    Valid,
    Invalid(Vec<Diagnostic>),
    /// The policy accepted the source but the GPU check could not run, so nothing was saved.
    Unchecked(String),
}

/// Policy checks, then a GPU compile, on the caller's (background) thread.
pub fn validate(source: &str, checker: &dyn ShaderChecker) -> Verdict {
    let mapped = match custom_fragment_source_mapped(source) {
        Ok(mapped) => mapped,
        Err(rejected) => return Verdict::Invalid(vec![policy_diagnostic(&rejected)]),
    };
    match checker.check(&mapped.source) {
        Ok(None) => Verdict::Valid,
        Ok(Some(log)) => Verdict::Invalid(map_driver_log(&mapped, &log)),
        Err(error) => Verdict::Unchecked(error.to_string()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Status {
    /// The editor matches the saved source.
    #[default]
    Saved,
    /// An edit is waiting for its check.
    Checking,
    /// The last edit is valid and was applied.
    Applied,
    Invalid(Vec<Diagnostic>),
    Unchecked(String),
}

/// Per-shader draft state. A revision identifies one edit; results for older revisions are stale.
#[derive(Debug, Default)]
pub struct Drafts {
    counter: u64,
    latest: HashMap<String, u64>,
    status: HashMap<String, Status>,
    /// Text the user typed that is not (yet) the saved source, kept while another shader is selected.
    text: HashMap<String, String>,
}

impl Drafts {
    /// Record an edit of `id` and return its revision. `saved` is the shader's current source:
    /// typing it back restores the saved state without a check.
    pub fn edit(&mut self, id: &str, text: &str, saved: &str) -> Option<u64> {
        self.counter += 1;
        self.latest.insert(id.into(), self.counter);
        if text.trim() == saved.trim() {
            self.text.remove(id);
            self.status.insert(id.into(), Status::Saved);
            return None;
        }
        self.text.insert(id.into(), text.into());
        self.status.insert(id.into(), Status::Checking);
        Some(self.counter)
    }

    /// Apply a check result. Returns `true` when it is current and valid, so the caller should
    /// store `text` as the shader's source.
    pub fn finish(&mut self, id: &str, revision: u64, verdict: Verdict) -> bool {
        if self.latest.get(id) != Some(&revision) {
            return false;
        }
        match verdict {
            Verdict::Valid => {
                self.text.remove(id);
                self.status.insert(id.into(), Status::Applied);
                true
            }
            Verdict::Invalid(diagnostics) => {
                self.status.insert(id.into(), Status::Invalid(diagnostics));
                false
            }
            Verdict::Unchecked(reason) => {
                self.status.insert(id.into(), Status::Unchecked(reason));
                false
            }
        }
    }

    pub fn status(&self, id: &str) -> &Status {
        self.status.get(id).unwrap_or(&Status::Saved)
    }

    /// The unsaved text for `id`, if any.
    pub fn draft(&self, id: &str) -> Option<&str> {
        self.text.get(id).map(String::as_str)
    }

    /// Whether any shader has an edit that is waiting for its result.
    pub fn busy(&self) -> bool {
        self.status.values().any(|status| *status == Status::Checking)
    }

    /// Forget a deleted shader. Results still in flight for it become stale.
    pub fn forget(&mut self, id: &str) {
        self.latest.remove(id);
        self.status.remove(id);
        self.text.remove(id);
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    /// A checker that compiles anything not containing `BROKEN`, and counts its calls.
    #[derive(Default)]
    pub struct Fake {
        pub calls: AtomicUsize,
        pub unavailable: bool,
    }

    impl ShaderChecker for Fake {
        fn check(&self, fragment: &str) -> Result<Option<String>, CheckError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.unavailable {
                return Err(CheckError::Unavailable("no renderer".into()));
            }
            // Report the error on the line of the BROKEN token, as a driver would.
            Ok(fragment
                .lines()
                .position(|line| line.contains("BROKEN"))
                .map(|index| format!("Shader compile failed: 0({}) : error C1008: undefined variable \"BROKEN\"", index + 1)))
        }
    }

    #[test]
    fn policy_failures_never_reach_the_gpu_and_driver_errors_land_on_user_lines() {
        let fake = Fake::default();
        let rejected = validate("#version 300 es\nvoid main(){}", &fake);
        assert!(matches!(&rejected, Verdict::Invalid(items) if items[0].line == Some(1)), "{rejected:?}");
        assert_eq!(fake.calls.load(Ordering::SeqCst), 0);

        let source = "// header\nfloat a = 1.0;\nvoid mainImage(out vec4 c, in vec2 p) {\n  c = vec4(BROKEN);\n}";
        let verdict = validate(source, &fake);
        assert_eq!(verdict, Verdict::Invalid(vec![Diagnostic::error(Some(4), "undefined variable \"BROKEN\"")]));
        assert_eq!(validate("void main(){}", &fake), Verdict::Valid);
        let down = Fake { unavailable: true, ..Fake::default() };
        assert!(matches!(validate("void main(){}", &down), Verdict::Unchecked(reason) if reason.contains("no renderer")));
    }

    #[test]
    fn only_the_latest_valid_result_is_applied_and_invalid_ones_keep_the_saved_source() {
        let mut drafts = Drafts::default();
        let saved = "void main(){}";
        assert_eq!(drafts.edit("custom-a", "\n void main(){}  \n", saved), None, "surrounding whitespace is not an edit");
        let one = drafts.edit("custom-a", "void main(){gl_FragColor=vec4(1.0);}", saved).unwrap();
        let two = drafts.edit("custom-a", "void main(){BROKEN}", saved).unwrap();
        assert!(drafts.busy());
        assert!(!drafts.finish("custom-a", one, Verdict::Valid), "a result for an older edit is stale");
        assert_eq!(*drafts.status("custom-a"), Status::Checking);
        let diagnostics = vec![Diagnostic::error(Some(1), "bad")];
        assert!(!drafts.finish("custom-a", two, Verdict::Invalid(diagnostics.clone())));
        assert_eq!(*drafts.status("custom-a"), Status::Invalid(diagnostics));
        assert_eq!(drafts.draft("custom-a"), Some("void main(){BROKEN}"), "the invalid text stays available to the editor");
        assert!(!drafts.busy());

        let three = drafts.edit("custom-a", "void main(){gl_FragColor=vec4(0.5);}", saved).unwrap();
        assert!(drafts.finish("custom-a", three, Verdict::Valid));
        assert_eq!(*drafts.status("custom-a"), Status::Applied);
        assert_eq!(drafts.draft("custom-a"), None);

        // Typing the saved text back needs no check and discards the draft.
        let four = drafts.edit("custom-a", "void main(){BROKEN}", saved).unwrap();
        assert_eq!(drafts.edit("custom-a", saved, saved), None);
        assert!(!drafts.finish("custom-a", four, Verdict::Valid));
        assert_eq!(*drafts.status("custom-a"), Status::Saved);
        let five = drafts.edit("custom-a", "x", saved).unwrap();
        drafts.forget("custom-a");
        assert!(!drafts.finish("custom-a", five, Verdict::Valid));
    }

    #[test]
    fn an_unavailable_check_keeps_the_draft_and_reports_why() {
        let mut drafts = Drafts::default();
        let revision = drafts.edit("custom-a", "new", "old").unwrap();
        assert!(!drafts.finish("custom-a", revision, Verdict::Unchecked("no GPU".into())));
        assert_eq!(*drafts.status("custom-a"), Status::Unchecked("no GPU".into()));
        assert_eq!(drafts.draft("custom-a"), Some("new"));
    }
}

//! The custom shader editor: state, the debounced check-and-apply flow, and its panel.
//!
//! Editing is autosaved. Each edit starts a debounce; when it elapses the text is validated off
//! the UI thread (policy checks, then a GLES compile in `scrnsvr-renderer --compile-check`). A
//! valid, current result replaces the shader's saved source, which updates the preview, the
//! thumbnail and the autosaved config. An invalid one only reports its diagnostics on the editor's
//! lines: the saved source and the preview keep the last valid version.

use std::sync::Arc;

use gpui_kit::base::input::{
    Diagnostic, DiagnosticSeverity, GutterDecoration, GutterDecorationCollection, RangeDecoration, RangeDecorationCollection,
    RangeDecorationStyle,
};
use gpui_kit::component::input::{Editor, EditorState, Escape, Input, InputState, Position};
use gpui_kit::component::{Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use scrnsvr_core::diagnostics::Diagnostic as ShaderDiagnostic;
use scrnsvr_core::source::MAX_CUSTOM_SOURCE_CHARS;

use crate::app::Settings;
use crate::model::custom::{self, DEFAULT_TITLE};
use crate::validation::{DEBOUNCE, Drafts, ShaderChecker, Status, validate};
use crate::view::{INK, MUTED, QUIET, SAVED, SIGNAL_HOVER, button, label, live, note, status};

pub struct CustomUi {
    pub title: Entity<InputState>,
    pub editor: Entity<EditorState>,
    /// Tints the lines with errors and marks them in the gutter: Kit paints diagnostic underlines
    /// only with a highlight theme, which this app does not use.
    error_lines: RangeDecorationCollection,
    error_gutter: GutterDecorationCollection,
    pub drafts: Drafts,
    /// The shader whose text the editor holds.
    pub shown: Option<String>,
    /// The text last put into the editor by the app, so that is not mistaken for typing.
    synced: String,
    /// A rejected rename or import, shown beside the title.
    pub message: Option<String>,
    pub confirm_delete: bool,
    pub confirm_focus: FocusHandle,
    pub delete_focus: FocusHandle,
    pub add_focus: FocusHandle,
    debounce: Option<Task<()>>,
    /// The edit the debounce is waiting to check: `(shader, revision, text)`.
    pending: Option<(String, u64, String)>,
    pub checker: Arc<dyn ShaderChecker>,
}

impl CustomUi {
    pub fn new(checker: Arc<dyn ShaderChecker>, window: &mut Window, cx: &mut Context<Settings>) -> Self {
        let editor = cx.new(|cx| EditorState::new(window, cx));
        let (error_lines, error_gutter) = editor.update(cx, |state, cx| {
            state.set_gutter_decorations_width(px(4.), cx);
            (state.create_range_decorations_collection(Vec::new(), cx), state.create_gutter_decorations_collection(Vec::new(), cx))
        });
        Self {
            title: cx.new(|cx| InputState::new(window, cx).placeholder("Shader name")),
            editor,
            error_lines,
            error_gutter,
            drafts: Drafts::default(),
            shown: None,
            synced: String::new(),
            message: None,
            confirm_delete: false,
            confirm_focus: cx.focus_handle(),
            delete_focus: cx.focus_handle(),
            add_focus: cx.focus_handle(),
            debounce: None,
            pending: None,
            checker,
        }
    }

    /// Whether an edit is waiting for its check (the window should not close and drop it).
    pub fn busy(&self) -> bool {
        self.pending.is_some() || self.drafts.busy()
    }
}

/// Where the editor should show `diagnostics`: the whole of each reported line.
fn markers(text: &str, diagnostics: &[ShaderDiagnostic]) -> Vec<Diagnostic> {
    let lines: Vec<&str> = text.split('\n').collect();
    diagnostics
        .iter()
        .filter_map(|diagnostic| {
            let line = (diagnostic.line? as usize).checked_sub(1).filter(|line| *line < lines.len())?;
            let width = lines[line].trim_end_matches('\r').encode_utf16().count() as u32;
            let (start, end) = (Position::new(line as u32, 0), Position::new(line as u32, width.max(1)));
            Some(Diagnostic::new(start..end, diagnostic.message.clone()).with_severity(DiagnosticSeverity::Error).with_source("GLSL"))
        })
        .collect()
}

/// The byte range of each reported line, for tinting. An empty line takes its newline.
fn line_ranges(text: &str, diagnostics: &[ShaderDiagnostic]) -> Vec<std::ops::Range<usize>> {
    let mut starts = vec![0];
    starts.extend(text.match_indices('\n').map(|(at, _)| at + 1));
    let mut ranges: Vec<std::ops::Range<usize>> = diagnostics
        .iter()
        .filter_map(|diagnostic| {
            let line = (diagnostic.line? as usize).checked_sub(1).filter(|line| *line < starts.len())?;
            let start = starts[line];
            let end = starts.get(line + 1).map_or(text.len(), |next| next - 1);
            let end = if end > start { end } else { (start + 1).min(text.len()) };
            (end > start).then_some(start..end)
        })
        .collect();
    ranges.sort_by_key(|range| range.start);
    ranges.dedup();
    ranges
}

impl Settings {
    fn selected_custom_id(&self) -> Option<String> {
        self.model.is_custom().then(|| self.model.visual().id.clone())
    }

    fn set_editor_text(&mut self, text: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.custom.synced = text.to_owned();
        self.custom.editor.update(cx, |state, cx| state.set_value(text.to_owned(), window, cx));
    }

    /// Show the diagnostics of the shown shader's last check on the editor's lines.
    fn show_markers(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.custom.shown.clone() else { return };
        let text = self.custom.editor.read(cx).value().to_string();
        let marked = match self.custom.drafts.status(&id) {
            Status::Invalid(diagnostics) => markers(&text, diagnostics),
            _ => Vec::new(),
        };
        let ranges = match self.custom.drafts.status(&id) {
            Status::Invalid(diagnostics) => line_ranges(&text, diagnostics),
            _ => Vec::new(),
        };
        let color: Hsla = rgb(SIGNAL_HOVER).into();
        self.custom.error_lines.set(
            ranges
                .iter()
                .map(|range| RangeDecoration::new(range.clone()).with_style(RangeDecorationStyle::Fill).with_color(color.opacity(0.28)))
                .collect(),
            cx,
        );
        self.custom.error_gutter.set(ranges.into_iter().map(|range| GutterDecoration::new(range).with_color(color)).collect(), cx);
        self.custom.editor.update(cx, |state, cx| {
            if let Some(set) = state.diagnostics_mut() {
                set.clear();
                set.extend(marked);
            }
            cx.notify();
        });
    }

    /// Point the editor at the selected custom shader, or at nothing for a built-in.
    pub fn sync_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let id = self.selected_custom_id();
        if id == self.custom.shown {
            return;
        }
        self.custom.shown = id.clone();
        self.custom.confirm_delete = false;
        self.custom.message = None;
        let Some(id) = id else { return };
        let (title, saved) = match self.model.custom(&id) {
            Some(shader) => (shader.title.clone(), shader.source.clone()),
            None => return,
        };
        let text = self.custom.drafts.draft(&id).map_or(saved, str::to_owned);
        self.custom.title.update(cx, |state, cx| state.set_value(title, window, cx));
        self.set_editor_text(&text, window, cx);
        self.show_markers(cx);
    }

    /// Before leaving a shader, start the check of an edit that is still waiting for its debounce.
    pub fn flush_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.custom.debounce = None;
        if let Some((id, revision, text)) = self.custom.pending.take() {
            self.check_now(id, revision, text, window, cx);
        }
    }

    /// The editor's text changed. Programmatic changes arrive here too and are ignored.
    pub fn source_edited(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.custom.shown.clone() else { return };
        let text = self.custom.editor.read(cx).value().to_string();
        if text == self.custom.synced {
            return;
        }
        self.custom.synced = text.clone();
        let saved = self.model.custom(&id).map(|shader| shader.source.clone()).unwrap_or_default();
        self.custom.debounce = None;
        self.custom.pending = None;
        match self.custom.drafts.edit(&id, &text, &saved) {
            None => {}
            Some(revision) => {
                self.custom.pending = Some((id.clone(), revision, text));
                self.custom.debounce = Some(cx.spawn_in(window, async move |this, cx| {
                    cx.background_executor().timer(DEBOUNCE).await;
                    let _ = this.update_in(cx, |this, window, cx| {
                        if let Some((id, revision, text)) = this.custom.pending.take() {
                            this.check_now(id, revision, text, window, cx);
                        }
                    });
                }));
            }
        }
        self.show_markers(cx);
        cx.notify();
    }

    /// Validate `text` on a background thread and apply the result if it is still current.
    fn check_now(&mut self, id: String, revision: u64, text: String, window: &mut Window, cx: &mut Context<Self>) {
        let checker = Arc::clone(&self.custom.checker);
        cx.spawn_in(window, async move |this, cx| {
            let source = text.clone();
            let verdict = cx.background_executor().spawn(async move { validate(&source, &*checker) }).await;
            let _ = this.update_in(cx, |this, window, cx| this.checked(&id, revision, text, verdict, window, cx));
        })
        .detach();
        cx.notify();
    }

    fn checked(
        &mut self,
        id: &str,
        revision: u64,
        text: String,
        verdict: crate::validation::Verdict,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.custom.drafts.finish(id, revision, verdict) && matches!(self.model.set_custom_source(id, &text), Ok(true)) {
            if self.model.visual().id == id {
                self.update_scene();
            }
            self.request_thumbnail(id, true, cx);
            self.config_changed(window, cx);
        }
        if self.custom.shown.as_deref() == Some(id) {
            self.show_markers(cx);
        }
        if self.close_after_save && !self.custom.busy() && !self.config_save.pending() && self.config_save.error.is_none() {
            window.remove_window();
        }
        cx.notify();
    }

    /// Check the current text again, for when the GPU check could not run.
    pub fn recheck(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.custom.shown.clone() else { return };
        let text = self.custom.editor.read(cx).value().to_string();
        let saved = self.model.custom(&id).map(|shader| shader.source.clone()).unwrap_or_default();
        if let Some(revision) = self.custom.drafts.edit(&id, &text, &saved) {
            self.check_now(id, revision, text, window, cx);
        }
    }

    pub fn add_custom_shader(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.flush_editor(window, cx);
        match self.model.add_custom(DEFAULT_TITLE, custom::template(), rand::random()) {
            Ok(id) => {
                self.visuals_changed(window, cx);
                self.request_thumbnail(&id, true, cx);
                self.custom.title.update(cx, |state, cx| {
                    state.focus(window, cx);
                    state.select_all(window, cx);
                });
            }
            Err(error) => self.custom.message = Some(error.into()),
        }
        cx.notify();
    }

    /// Apply the name field: on Enter or when it loses focus.
    pub fn commit_title(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.custom.shown.clone() else { return };
        let title = self.custom.title.read(cx).value().to_string();
        match self.model.rename_custom(&id, &title) {
            Ok(true) => {
                self.custom.message = None;
                self.visuals_changed(window, cx);
            }
            Ok(false) => self.custom.message = None,
            Err(error) => self.custom.message = Some(error.into()),
        }
        cx.notify();
    }

    pub fn ask_delete(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.custom.confirm_delete = true;
        self.custom.confirm_focus.focus(window, cx);
        cx.notify();
    }

    pub fn cancel_delete(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.custom.confirm_delete = false;
        self.custom.delete_focus.focus(window, cx);
        cx.notify();
    }

    pub fn delete_custom_shader(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.custom.shown.clone() else { return };
        self.custom.debounce = None;
        self.custom.pending = None;
        self.custom.drafts.forget(&id);
        self.thumbnails.forget(&id);
        if let Some(directory) = self.thumbnails.directory() {
            // An empty key matches no image, so every cached image of the deleted shader goes.
            scrnsvr_core::thumbnail::prune(directory, &id, "");
        }
        self.model.delete_custom(&id);
        self.custom.shown = None;
        self.visuals_changed(window, cx);
        self.pause_focus.focus(window, cx);
    }

    /// Replace the source with a file's contents, offering the file name to a still-unnamed shader.
    pub fn import_shader_file(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.custom.shown.clone() else { return };
        let picked =
            cx.prompt_for_paths(PathPromptOptions { files: true, directories: false, multiple: false, prompt: Some("Import".into()) });
        cx.spawn_in(window, async move |this, cx| {
            let Ok(Ok(Some(paths))) = picked.await else { return };
            let Some(path) = paths.into_iter().next() else { return };
            let read = cx.background_executor().spawn(async move { read_import(&path) }).await;
            let _ = this.update_in(cx, |this, window, cx| this.imported(&id, read, window, cx));
        })
        .detach();
    }

    pub fn imported(&mut self, id: &str, read: Result<(String, String), String>, window: &mut Window, cx: &mut Context<Self>) {
        if self.custom.shown.as_deref() != Some(id) {
            return;
        }
        match read {
            Ok((stem, text)) => {
                self.custom.message = None;
                self.set_editor_text(&text, window, cx);
                self.custom.synced.clear(); // Treat the new text as the user's edit.
                self.source_edited(window, cx);
                if self.model.custom(id).is_some_and(|shader| shader.title == DEFAULT_TITLE) && !stem.is_empty() {
                    self.custom.title.update(cx, |state, cx| state.set_value(stem, window, cx));
                    self.commit_title(window, cx);
                }
            }
            Err(error) => self.custom.message = Some(error),
        }
        cx.notify();
    }

    /// The editor panel under the preview, for a selected custom shader.
    pub fn custom_workspace(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let id = self.custom.shown.clone().unwrap_or_default();
        let broken = self.model.broken_custom().contains(&id.as_str());
        let status_line = self.editor_status(&id, broken);
        let title = self.model.custom(&id).map_or_else(String::new, |shader| shader.title.clone());
        v_flex()
            .gap_3()
            .child(label("CUSTOM SHADER"))
            .child(
                h_flex()
                    .gap_2()
                    .items_center()
                    .child(div().flex_1().min_w_0().child(Input::new(&self.custom.title).small().aria_label("Shader name")))
                    .child(
                        button("import-shader", "Import…")
                            .tooltip("Replace the source with a GLSL file (up to 100 KB)")
                            .accessibility_label("Import a GLSL file")
                            .on_click(cx.listener(|this, _, window, cx| this.import_shader_file(window, cx))),
                    )
                    .child(
                        button("delete-shader", "Delete")
                            .track_focus(&self.custom.delete_focus)
                            .accessibility_label(format!("Delete {title}"))
                            .on_click(cx.listener(|this, _, window, cx| this.ask_delete(window, cx))),
                    ),
            )
            .when(self.custom.confirm_delete, |this| {
                this.child(
                    h_flex()
                        .gap_2()
                        .items_center()
                        .flex_wrap()
                        .child(note(format!("Delete “{title}”? It is also removed from favorites and shuffle.")))
                        .child(
                            button("confirm-delete", "Delete shader")
                                .track_focus(&self.custom.confirm_focus)
                                .on_click(cx.listener(|this, _, window, cx| this.delete_custom_shader(window, cx))),
                        )
                        .child(button("cancel-delete", "Keep").on_click(cx.listener(|this, _, window, cx| this.cancel_delete(window, cx)))),
                )
            })
            .children(self.custom.message.clone().map(|message| {
                live("custom-message", message).text_size(px(13.)).text_color(rgb(SIGNAL_HOVER))
            }))
            .child(
                // Tab indents inside the editor, so Escape is the way out for keyboard users.
                div()
                    .h(px(240.))
                    .on_action(cx.listener(|_, _: &Escape, window, cx| {
                        window.focus_next(cx);
                        cx.stop_propagation();
                    }))
                    .child(Editor::new(&self.custom.editor).h(px(240.)).aria_label("Shader source (GLSL ES 1.00)")),
            )
            .child(note("Single-pass GLSL ES 1.00 with mainImage or main. uTime, uResolution, iTime, iResolution, iMouse, iDate and uAudio are supplied. Esc leaves the editor; Tab indents."))
            .child(self.editor_messages(&id, status_line, cx))
    }

    /// One line saying whether the edit has been applied.
    fn editor_status(&self, id: &str, broken: bool) -> (SharedString, u32) {
        match self.custom.drafts.status(id) {
            Status::Saved if broken => {
                ("This saved source does not pass the shader checks, so it is not shown. Fix it below.".into(), SIGNAL_HOVER)
            }
            Status::Saved => ("Saved. Edits are checked and saved automatically.".into(), QUIET),
            Status::Checking => ("Checking…".into(), MUTED),
            Status::Applied => ("Compiled and saved. The preview shows this version.".into(), SAVED),
            Status::Invalid(_) => ("Not saved. The preview keeps the last valid version.".into(), SIGNAL_HOVER),
            Status::Unchecked(_) => ("Not saved: the GPU check could not run.".into(), SIGNAL_HOVER),
        }
    }

    fn editor_messages(&self, id: &str, (line, color): (SharedString, u32), cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let text = self.custom.editor.read(cx).value();
        let too_long = text.encode_utf16().count() > MAX_CUSTOM_SOURCE_CHARS;
        let details: Vec<(String, u32)> = match self.custom.drafts.status(id) {
            Status::Invalid(diagnostics) => diagnostics.iter().map(|diagnostic| (diagnostic.display(), INK)).collect(),
            Status::Unchecked(reason) => vec![(reason.clone(), MUTED)],
            _ => Vec::new(),
        };
        // One live region holds the verdict and its diagnostics, so assistive technology reads them together.
        let spoken = std::iter::once(line.to_string()).chain(details.iter().map(|(text, _)| text.clone())).collect::<Vec<_>>().join(" ");
        v_flex()
            .gap_1()
            .child(
                status("custom-status")
                    .aria_label(spoken)
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(div().text_size(px(13.)).text_color(rgb(color)).child(line))
                    .children(
                        details
                            .into_iter()
                            .map(|(text, color)| div().text_size(px(12.)).font_family("monospace").text_color(rgb(color)).child(text)),
                    ),
            )
            .when(too_long, |this| this.child(note("Shader source can have at most 100,000 characters.")))
            .when(matches!(self.custom.drafts.status(id), Status::Unchecked(_)), |this| {
                this.child(
                    div().child(button("recheck", "Check again").on_click(cx.listener(|this, _, window, cx| this.recheck(window, cx)))),
                )
            })
    }
}

/// Read a GLSL file for import: its name without the extension and its text.
/// Limits: under 100 KB, and text a shader can hold.
pub fn read_import(path: &std::path::Path) -> Result<(String, String), String> {
    const LIMIT: u64 = 100_000;
    let size = std::fs::metadata(path).map_err(|error| format!("Could not read {}: {error}", path.display()))?.len();
    if size > LIMIT {
        return Err("Shader files must be smaller than 100 KB.".into());
    }
    let text = std::fs::read_to_string(path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let stem = path.file_stem().and_then(|stem| stem.to_str()).unwrap_or_default();
    Ok((stem.chars().take(100).collect(), text))
}

#[cfg(test)]
mod tests {
    use scrnsvr_core::diagnostics::Diagnostic as Shader;

    use super::{line_ranges, markers, read_import};

    #[test]
    fn markers_cover_the_reported_line_and_skip_unplaceable_messages() {
        let text = "float a;\nvoid main() {\n  oops;\n}";
        let found = markers(text, &[Shader::error(Some(3), "undefined"), Shader::error(None, "general"), Shader::error(Some(99), "far")]);
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].range.start.line, found[0].range.end.character), (2, 7));
        assert_eq!(found[0].message, "undefined");
    }

    #[test]
    fn line_ranges_cover_each_reported_line_without_its_newline() {
        let text = "ab\n\ncd\nlast";
        let errors =
            [Shader::error(Some(1), "a"), Shader::error(Some(2), "blank"), Shader::error(Some(4), "d"), Shader::error(Some(1), "again")];
        assert_eq!(line_ranges(text, &errors), [0..2, 3..4, 7..11]);
        assert!(line_ranges("", &[Shader::error(Some(1), "x")]).is_empty());
    }

    #[test]
    fn imports_respect_the_size_limit_and_name_the_shader_after_the_file() {
        let directory = tempfile::tempdir().unwrap();
        let small = directory.path().join("Lava Lamp.frag");
        std::fs::write(&small, "void main(){}").unwrap();
        assert_eq!(read_import(&small).unwrap(), ("Lava Lamp".into(), "void main(){}".into()));
        let big = directory.path().join("big.glsl");
        std::fs::write(&big, "x".repeat(100_001)).unwrap();
        assert_eq!(read_import(&big).unwrap_err(), "Shader files must be smaller than 100 KB.");
        let binary = directory.path().join("blob.glsl");
        std::fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_import(&binary).unwrap_err().starts_with("Could not read"));
        assert!(read_import(&directory.path().join("missing.glsl")).unwrap_err().starts_with("Could not read"));
    }
}

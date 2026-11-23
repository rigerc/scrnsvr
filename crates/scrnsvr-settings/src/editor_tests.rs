//! Headless tests of the custom shader editor, thumbnails and the fullscreen preview.
//!
//! Explicit imports: the `gpui_kit` glob also exports GPUI's `test` macro, which would shadow the
//! built-in `#[test]` that `#[gpui::test]` expands to.

use std::fs;
use std::os::fd::AsRawFd as _;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use gpui_kit::{AnyWindowHandle, AppContext as _, Entity, Focusable as _, TestAppContext, WindowOptions};
use scrnsvr_core::config::Config;

use crate::app::Settings;
use crate::fullscreen::{ALREADY_RUNNING, Fullscreen};
use crate::persistence::Paths;
use crate::testing;
use crate::validation::Status;
use crate::validation::tests::Fake;

struct Harness {
    window: AnyWindowHandle,
    settings: Entity<Settings>,
    root: tempfile::TempDir,
    checker: Arc<Fake>,
}

impl Harness {
    fn open(cx: &mut TestAppContext, checker: Fake, scrnsvr: &str) -> Self {
        let root = tempfile::tempdir().unwrap();
        let checker = Arc::new(checker);
        let runtime = root.path().join("runtime");
        fs::create_dir(&runtime).unwrap();
        let config = root.path().join("config.toml");
        let paths = Paths {
            config: Some(config.clone()),
            ui: Some(root.path().join("ui.toml")),
            cache: Some(root.path().join("cache")),
            renderer: Some(testing::renderer(root.path())),
            scrnsvr: Some(testing::scrnsvr(root.path(), &scrnsvr.replace("$CONFIG", &config.display().to_string()))),
            runtime: Some(runtime),
            checker: Some(checker.clone()),
            ..Paths::default()
        };
        let (window, settings) = cx.update(|cx| {
            gpui_kit::init(cx);
            crate::view::init_theme(cx);
            gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| cx.new(|cx| Settings::open(paths, window, cx))).unwrap()
        });
        Self { window, settings, root, checker }
    }

    fn act<R>(
        &self,
        cx: &mut TestAppContext,
        action: impl FnOnce(&mut Settings, &mut gpui_kit::Window, &mut gpui_kit::Context<Settings>) -> R,
    ) -> R {
        cx.update_window(self.window, |_, window, cx| self.settings.update(cx, |settings, cx| action(settings, window, cx))).unwrap()
    }

    fn draw(&self, cx: &mut TestAppContext) {
        cx.update_window(self.window, |_, window, cx| window.draw(cx).clear(cx)).unwrap();
    }

    fn read<R>(&self, cx: &mut TestAppContext, read: impl FnOnce(&Settings) -> R) -> R {
        cx.read(|cx| read(self.settings.read(cx)))
    }

    fn config(&self) -> Config {
        Config::load(&self.root.path().join("config.toml")).config
    }

    fn settle(&self, cx: &mut TestAppContext, millis: u64) {
        cx.executor().advance_clock(Duration::from_millis(millis));
        cx.run_until_parked();
    }

    fn set_source(&self, cx: &mut TestAppContext, text: &str) {
        let text = text.to_owned();
        self.act(cx, |settings, window, cx| settings.custom.editor.update(cx, |state, cx| state.replace_all(text, window, cx)));
        cx.run_until_parked();
    }

    fn editor_text(&self, cx: &mut TestAppContext) -> String {
        cx.read(|cx| self.settings.read(cx).custom.editor.read(cx).value().to_string())
    }

    fn status(&self, cx: &mut TestAppContext) -> Status {
        self.read(cx, |settings| settings.custom.drafts.status(settings.custom.shown.as_deref().unwrap_or_default()).clone())
    }

    fn markers(&self, cx: &mut TestAppContext) -> usize {
        cx.read(|cx| {
            let editor = self.settings.read(cx).custom.editor.clone();
            editor.read(cx).diagnostics().map_or(0, |set| set.len())
        })
    }

    fn selected_id(&self, cx: &mut TestAppContext) -> String {
        self.read(cx, |settings| settings.model.visual().id.clone())
    }

    fn saved_source(&self, cx: &mut TestAppContext) -> String {
        let id = self.selected_id(cx);
        self.read(cx, |settings| settings.model.custom(&id).unwrap().source.clone())
    }

    fn captures(&self) -> usize {
        fs::read_to_string(self.root.path().join("captures.log")).map_or(0, |log| log.lines().count())
    }

    fn cached(&self) -> Vec<String> {
        let mut names: Vec<_> = fs::read_dir(self.root.path().join("cache"))
            .map(|entries| {
                entries.flatten().map(|entry| entry.file_name().into_string().unwrap()).filter(|name| name.ends_with(".png")).collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }
}

const VALID: &str = "void mainImage(out vec4 color, in vec2 fragCoord) {\n  color = vec4(1.0, 0.0, 0.0, 1.0);\n}";
const OTHER: &str = "void mainImage(out vec4 color, in vec2 fragCoord) {\n  color = vec4(0.0, 1.0, 0.0, 1.0);\n}";
const BROKEN: &str = "// comment\nvoid mainImage(out vec4 color, in vec2 fragCoord) {\n  color = vec4(BROKEN);\n}";

#[gpui::test]
fn shaders_are_added_renamed_and_deleted_and_the_config_follows(cx: &mut TestAppContext) {
    let h = Harness::open(cx, Fake::default(), "exit 0");
    h.act(cx, |settings, window, cx| settings.add_custom_shader(window, cx));
    h.draw(cx);
    let id = h.selected_id(cx);
    assert!(id.starts_with("custom-my-shader-"), "{id}");
    assert_eq!(h.editor_text(cx), scrnsvr_core::source::CUSTOM_TEMPLATE);
    assert_eq!(h.read(cx, |settings| settings.model.visual().title.clone()), "My shader");
    h.settle(cx, 500);
    assert_eq!(h.config().custom_shaders.len(), 1);
    assert_eq!(h.config().shader, id);

    // Renaming keeps the ID, the source and the selection, and re-sorts the bank.
    h.act(cx, |settings, window, cx| {
        settings.custom.title.update(cx, |state, cx| state.set_value("Zebra stripes", window, cx));
        settings.commit_title(window, cx);
    });
    h.settle(cx, 500);
    assert_eq!(h.config().custom_shaders[0].title, "Zebra stripes");
    assert_eq!(h.config().custom_shaders[0].id, id);
    assert_eq!(h.selected_id(cx), id);
    // An empty name is refused with a message and nothing changes.
    h.act(cx, |settings, window, cx| {
        settings.custom.title.update(cx, |state, cx| state.set_value("   ", window, cx));
        settings.commit_title(window, cx);
    });
    assert_eq!(h.read(cx, |settings| settings.custom.message.clone()).as_deref(), Some("Enter a name for this shader."));
    assert_eq!(h.read(cx, |settings| settings.model.visual().title.clone()), "Zebra stripes");

    // Favorite, shuffle and delete: every reference goes with it.
    h.act(cx, |settings, window, cx| {
        let index = settings.model.selected;
        settings.favorite(index, window, cx);
        settings.toggle_shuffle_entry(&id, None, window, cx);
        settings.ask_delete(window, cx);
    });
    assert!(h.read(cx, |settings| settings.custom.confirm_delete));
    h.act(cx, |settings, window, cx| settings.cancel_delete(window, cx));
    assert_eq!(h.config().custom_shaders.len(), 1, "keeping the shader changes nothing");
    h.act(cx, |settings, window, cx| settings.delete_custom_shader(window, cx));
    h.draw(cx);
    h.settle(cx, 500);
    let config = h.config();
    assert!(config.custom_shaders.is_empty() && config.rotation.entries.is_empty());
    assert_eq!(config.shader, "flow-field");
    assert_eq!(h.selected_id(cx), "flow-field");
    assert!(h.read(cx, |settings| settings.model.ui.favorites.is_empty()));
    assert!(h.read(cx, |settings| settings.custom.shown.is_none()));
}

#[gpui::test]
fn valid_edits_apply_after_the_debounce_and_invalid_ones_keep_the_last_valid_source(cx: &mut TestAppContext) {
    let h = Harness::open(cx, Fake::default(), "exit 0");
    h.act(cx, |settings, window, cx| settings.add_custom_shader(window, cx));
    h.draw(cx);
    h.settle(cx, 500);

    // Typing is debounced: no check until 400 ms after the last keystroke, then one.
    h.set_source(cx, VALID);
    h.settle(cx, 300);
    h.set_source(cx, OTHER);
    h.settle(cx, 300);
    assert_eq!(h.checker.calls.load(Ordering::SeqCst), 0, "still within the debounce of the last edit");
    assert_eq!(h.status(cx), Status::Checking);
    h.settle(cx, 150);
    assert_eq!(h.checker.calls.load(Ordering::SeqCst), 1, "one check for two edits");
    assert_eq!(h.status(cx), Status::Applied);
    assert_eq!(h.saved_source(cx), OTHER);
    h.settle(cx, 500);
    assert_eq!(h.config().custom_shaders[0].source, OTHER, "the valid edit was autosaved");

    // A broken edit reports the line in the user's source and changes nothing saved.
    h.set_source(cx, BROKEN);
    h.settle(cx, 500);
    let Status::Invalid(diagnostics) = h.status(cx) else { panic!("expected diagnostics, got {:?}", h.status(cx)) };
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].line, Some(3), "line 3 of the user's source, not of the wrapped one");
    assert_eq!(diagnostics[0].display(), "Line 3: undefined variable \"BROKEN\"");
    assert_eq!(h.markers(cx), 1, "the editor underlines the line");
    assert_eq!(h.saved_source(cx), OTHER, "the preview keeps the last valid version");
    h.draw(cx);
    h.settle(cx, 500);
    assert_eq!(h.config().custom_shaders[0].source, OTHER, "invalid source is never written");
    assert_eq!(h.editor_text(cx), BROKEN, "the draft stays in the editor");

    // A policy failure never reaches the GPU.
    let calls = h.checker.calls.load(Ordering::SeqCst);
    h.set_source(cx, "uniform float exposure;\nvoid main(){}");
    h.settle(cx, 500);
    assert_eq!(h.checker.calls.load(Ordering::SeqCst), calls);
    assert!(matches!(h.status(cx), Status::Invalid(items) if items[0].line == Some(1)));

    // Fixing the source recovers: the markers clear and the new source is saved.
    h.set_source(cx, VALID);
    h.settle(cx, 500);
    assert_eq!(h.status(cx), Status::Applied);
    assert_eq!(h.markers(cx), 0);
    h.settle(cx, 500);
    assert_eq!(h.config().custom_shaders[0].source, VALID);

    // Typing the saved text back restores the saved state without a check.
    let calls = h.checker.calls.load(Ordering::SeqCst);
    h.set_source(cx, BROKEN);
    h.set_source(cx, VALID);
    h.settle(cx, 500);
    assert_eq!(h.status(cx), Status::Saved);
    assert_eq!(h.checker.calls.load(Ordering::SeqCst), calls);
}

#[gpui::test]
fn a_draft_survives_switching_shaders_and_a_pending_check_is_not_lost(cx: &mut TestAppContext) {
    let h = Harness::open(cx, Fake::default(), "exit 0");
    h.act(cx, |settings, window, cx| settings.add_custom_shader(window, cx));
    h.draw(cx);
    let id = h.selected_id(cx);
    // An edit made just before clicking another tile is checked at once and still applied.
    h.set_source(cx, OTHER);
    h.act(cx, |settings, window, cx| {
        let flow = settings.model.visual_index("flow-field").unwrap();
        settings.select(flow, window, cx);
    });
    h.settle(cx, 50);
    assert_eq!(h.read(cx, |settings| settings.model.custom(&id).unwrap().source.clone()), OTHER);
    // A broken draft comes back, with its diagnostics, when the shader is selected again.
    h.act(cx, |settings, window, cx| {
        let index = settings.model.visual_index(&id).unwrap();
        settings.select(index, window, cx);
    });
    h.set_source(cx, BROKEN);
    h.settle(cx, 500);
    h.act(cx, |settings, window, cx| {
        let flow = settings.model.visual_index("flow-field").unwrap();
        settings.select(flow, window, cx);
    });
    h.act(cx, |settings, window, cx| {
        let index = settings.model.visual_index(&id).unwrap();
        settings.select(index, window, cx);
    });
    assert_eq!(h.editor_text(cx), BROKEN);
    assert_eq!(h.markers(cx), 1);
    assert!(matches!(h.status(cx), Status::Invalid(_)));
}

#[gpui::test]
fn without_the_gpu_check_nothing_is_saved_and_the_reason_is_shown(cx: &mut TestAppContext) {
    let h = Harness::open(cx, Fake { unavailable: true, ..Fake::default() }, "exit 0");
    h.act(cx, |settings, window, cx| settings.add_custom_shader(window, cx));
    h.draw(cx);
    h.settle(cx, 500);
    h.set_source(cx, OTHER);
    h.settle(cx, 500);
    assert!(matches!(h.status(cx), Status::Unchecked(reason) if reason.contains("no renderer")));
    h.settle(cx, 500);
    assert_eq!(h.config().custom_shaders[0].source, scrnsvr_core::source::CUSTOM_TEMPLATE);
    h.draw(cx);
}

#[gpui::test]
fn thumbnails_render_in_the_background_cache_on_disk_and_follow_edits(cx: &mut TestAppContext) {
    let h = Harness::open(cx, Fake::default(), "exit 0");
    cx.run_until_parked();
    let builtin = h.read(cx, |settings| settings.model.visuals.len());
    assert_eq!(builtin, 41);
    assert_eq!(h.cached().len(), 41, "one file per visual: {:?}", h.cached());
    assert_eq!(h.captures(), 41);
    assert!(h.read(cx, |settings| settings.model.visuals.iter().all(|visual| settings.thumbnails.image(&visual.id).is_some())));
    h.draw(cx);

    // A restart finds them on disk instead of rendering again.
    let before = h.captures();
    h.act(cx, |settings, window, cx| {
        settings.thumbnails = crate::thumbnails::Thumbnails::new(settings.paths.cache.clone(), scrnsvr_core::thumbnail::DEFAULT_FRAMES);
        settings.request_all_thumbnails(cx);
        let _ = window;
    });
    cx.run_until_parked();
    assert_eq!(h.captures(), before);

    // A custom shader gets its own tile image, regenerated after a valid edit, and removed on delete.
    h.act(cx, |settings, window, cx| settings.add_custom_shader(window, cx));
    h.draw(cx);
    cx.run_until_parked();
    let id = h.selected_id(cx);
    let custom: Vec<_> = h.cached().into_iter().filter(|name| name.starts_with(&id)).collect();
    assert_eq!(custom.len(), 1, "{custom:?}");
    h.set_source(cx, OTHER);
    h.settle(cx, 500);
    let edited: Vec<_> = h.cached().into_iter().filter(|name| name.starts_with(&id)).collect();
    assert_eq!(edited.len(), 1, "the stale image is pruned: {edited:?}");
    assert_ne!(edited, custom, "an edit changes the cache key");
    // A rejected edit does not touch the thumbnail.
    h.set_source(cx, BROKEN);
    h.settle(cx, 500);
    assert_eq!(h.cached().into_iter().filter(|name| name.starts_with(&id)).collect::<Vec<_>>(), edited);
    h.act(cx, |settings, window, cx| settings.delete_custom_shader(window, cx));
    cx.run_until_parked();
    assert!(h.cached().iter().all(|name| !name.starts_with(&id)));
    assert_eq!(h.cached().len(), 41);
}

#[gpui::test]
fn a_failing_renderer_leaves_placeholders_and_the_reason(cx: &mut TestAppContext) {
    let h = Harness::open(cx, Fake::default(), "exit 0");
    cx.run_until_parked();
    h.act(cx, |settings, _, cx| {
        settings.paths.renderer =
            Some(testing::script(&h.root.path().join("bad-renderer"), "echo 'scrnsvr-renderer: EGL is unavailable' >&2; exit 2"));
        settings.thumbnails = crate::thumbnails::Thumbnails::new(Some(h.root.path().join("empty-cache")), 3);
        settings.request_all_thumbnails(cx);
    });
    cx.run_until_parked();
    h.draw(cx);
    let failure = h.read(cx, |settings| settings.thumbnails.failure("plasma").map(str::to_owned));
    assert!(failure.as_ref().is_some_and(|error| error.contains("EGL is unavailable")), "{failure:?}");
    assert!(h.read(cx, |settings| settings.thumbnails.image("plasma").is_none()));
}

#[gpui::test]
fn fullscreen_preview_saves_first_then_opens_the_selected_visual(cx: &mut TestAppContext) {
    let launched = r#"cp "$CONFIG" "$(dirname "$CONFIG")/config-at-launch""#;
    let h = Harness::open(cx, Fake::default(), launched);
    h.act(cx, |settings, window, cx| {
        settings.select(settings.model.visual_index("plasma").unwrap(), window, cx);
        settings.set_uniform("speed", scrnsvr_core::catalog::SettingValue::Number(0.77), window, cx);
        settings.start_fullscreen(window, cx);
    });
    assert_eq!(h.read(cx, |settings| settings.fullscreen.clone()), Fullscreen::Saving);
    h.settle(cx, 600);
    assert_eq!(h.read(cx, |settings| settings.fullscreen.clone()), Fullscreen::Idle, "the saver ended");
    let log = fs::read_to_string(h.root.path().join("scrnsvr.log")).unwrap();
    assert_eq!(log.trim(), "--open --shader plasma");
    let at_launch = Config::load(&h.root.path().join("config-at-launch")).config;
    assert_eq!(at_launch.shader, "plasma");
    assert_eq!(
        at_launch.shaders["plasma"]["speed"],
        scrnsvr_core::catalog::SettingValue::Number(0.77),
        "the edit was on disk before the saver started"
    );
    h.draw(cx);
}

#[gpui::test]
fn fullscreen_preview_reports_a_running_saver_and_launch_failures(cx: &mut TestAppContext) {
    let h = Harness::open(cx, Fake::default(), "echo 'scrnsvr: No Wayland outputs are available' >&2; exit 1");
    // A failing launch shows the saver's own message and can be dismissed.
    h.act(cx, |settings, window, cx| settings.start_fullscreen(window, cx));
    h.settle(cx, 600);
    assert_eq!(h.read(cx, |settings| settings.fullscreen.clone()), Fullscreen::Failed("No Wayland outputs are available".into()));
    h.draw(cx);
    h.act(cx, |settings, _, cx| settings.dismiss_fullscreen_message(cx));
    assert_eq!(h.read(cx, |settings| settings.fullscreen.clone()), Fullscreen::Idle);

    // A saver that already holds the lock is not launched over.
    let lock = fs::File::create(h.root.path().join("runtime/saver.lock")).unwrap();
    // SAFETY: the descriptor is live.
    assert_eq!(unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) }, 0);
    let launches = fs::read_to_string(h.root.path().join("scrnsvr.log")).unwrap().lines().count();
    h.act(cx, |settings, window, cx| settings.start_fullscreen(window, cx));
    h.settle(cx, 600);
    assert_eq!(h.read(cx, |settings| settings.fullscreen.clone()), Fullscreen::Failed(ALREADY_RUNNING.into()));
    assert_eq!(fs::read_to_string(h.root.path().join("scrnsvr.log")).unwrap().lines().count(), launches);
    h.draw(cx);

    // A missing program is reported rather than ignored.
    drop(lock);
    h.act(cx, |settings, window, cx| {
        settings.paths.scrnsvr = Some(PathBuf::from("/nonexistent/scrnsvr"));
        settings.fullscreen = Fullscreen::Idle;
        settings.start_fullscreen(window, cx);
    });
    h.settle(cx, 600);
    assert!(matches!(h.read(cx, |settings| settings.fullscreen.clone()), Fullscreen::Failed(error) if error.contains("Could not start")));
}

#[gpui::test]
fn the_editor_does_not_trap_keyboard_focus(cx: &mut TestAppContext) {
    let h = Harness::open(cx, Fake::default(), "exit 0");
    h.act(cx, |settings, window, cx| settings.add_custom_shader(window, cx));
    h.draw(cx);
    let focused = |h: &Harness, cx: &mut TestAppContext| {
        cx.update_window(h.window, |_, window, cx| {
            let settings = h.settings.read(cx);
            (settings.custom.editor.focus_handle(cx).is_focused(window), settings.custom.title.focus_handle(cx).is_focused(window))
        })
        .unwrap()
    };
    h.act(cx, |settings, window, cx| settings.custom.editor.update(cx, |state, cx| state.focus(window, cx)));
    h.draw(cx);
    assert_eq!(focused(&h, cx), (true, false));
    // Tab indents inside the editor...
    let before = h.editor_text(cx);
    cx.simulate_keystrokes(h.window, "tab");
    assert_eq!(focused(&h, cx), (true, false));
    assert_ne!(h.editor_text(cx), before);
    // ...so Escape is the way out, and it moves on without touching the text.
    let edited = h.editor_text(cx);
    cx.simulate_keystrokes(h.window, "escape");
    assert_eq!(focused(&h, cx), (false, false), "focus left the editor");
    assert_eq!(h.editor_text(cx), edited);
}

//! Headless tests of the Effects, Looks & Shuffle, Clock and Settings tabs.
//!
//! Explicit imports: the `gpui_kit` glob also exports GPUI's `test` macro, which would shadow the
//! built-in `#[test]` that `#[gpui::test]` expands to.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use gpui_kit::component::input::InputState;
use gpui_kit::{AnyWindowHandle, AppContext as _, Entity, TestAppContext, WindowOptions};
use scrnsvr_core::catalog::SettingValue;
use scrnsvr_core::clock::ClockPosition;
use scrnsvr_core::config::Config;

use crate::app::{Settings, Tab};
use crate::controls::Target;
use crate::idle::{Idle, IdleSource, testing::fake};
use crate::persistence::Paths;

const BEFORE: &str = "behavior_order = ['lock', 'screensaver']\npre_action_fade_seconds = 2.0\n[behavior.lock]\naction = 'lock'\nenabled = false\ntimeout = 600.0\n[behavior.screensaver]\naction = 'command'\ncommand = 'Scrnsvr-0.5.0.AppImage --open'\nenabled = false\ntimeout = 742.5\n";
const AFTER: &str = "behavior_order = ['lock', 'screensaver']\npre_action_fade_seconds = 0.0\n[behavior.lock]\naction = 'lock'\nenabled = false\ntimeout = 600.0\n[behavior.screensaver]\naction = 'command'\ncommand = '/home/me/.local/bin/scrnsvr --open'\nenabled = true\ntimeout = 450.0\n";

struct Harness {
    window: AnyWindowHandle,
    settings: Entity<Settings>,
    config: PathBuf,
    root: tempfile::TempDir,
}

impl Harness {
    fn open(cx: &mut TestAppContext) -> Self {
        let root = tempfile::tempdir().unwrap();
        let idle = fake(root.path(), BEFORE, AFTER);
        Self::with(cx, root, idle, None)
    }

    fn with(cx: &mut TestAppContext, root: tempfile::TempDir, idle: IdleSource, colors: Option<PathBuf>) -> Self {
        let config = root.path().join("config.toml");
        let paths = Paths { config: Some(config.clone()), ui: Some(root.path().join("ui.toml")), colors, idle, ..Paths::default() };
        let (window, settings) = cx.update(|cx| {
            gpui_kit::init(cx);
            crate::view::init_theme(cx);
            gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| cx.new(|cx| Settings::open(paths, window, cx))).unwrap()
        });
        Self { window, settings, config, root }
    }

    fn act(&self, cx: &mut TestAppContext, action: impl FnOnce(&mut Settings, &mut gpui_kit::Window, &mut gpui_kit::Context<Settings>)) {
        cx.update_window(self.window, |_, window, cx| self.settings.update(cx, |settings, cx| action(settings, window, cx))).unwrap();
    }

    fn draw(&self, cx: &mut TestAppContext) {
        cx.update_window(self.window, |_, window, cx| window.draw(cx).clear(cx)).unwrap();
    }

    fn read<R>(&self, cx: &mut TestAppContext, read: impl FnOnce(&Settings) -> R) -> R {
        cx.read(|cx| read(self.settings.read(cx)))
    }

    /// Let the 400 ms save debounce and any background work finish, then load what was written.
    fn saved(&self, cx: &mut TestAppContext) -> Config {
        cx.executor().advance_clock(Duration::from_millis(500));
        cx.run_until_parked();
        Config::load(&self.config).config
    }

    fn calls(&self) -> String {
        fs::read_to_string(self.root.path().join("calls")).unwrap_or_default()
    }

    fn show(&self, cx: &mut TestAppContext, tab: Tab) {
        self.act(cx, |settings, window, cx| settings.show_tab(tab, window, cx));
        self.draw(cx);
    }
}

fn value(cx: &mut TestAppContext, input: &Entity<InputState>) -> String {
    cx.read(|cx| input.read(cx).value().to_string())
}

fn ids(settings: &Settings) -> Vec<String> {
    settings.model.config.effects.layers.iter().map(|layer| layer.id.clone()).collect()
}

#[gpui::test]
fn tabs_use_roving_focus_with_wrap_around_and_every_tab_draws(cx: &mut TestAppContext) {
    let app = Harness::open(cx);
    for tab in Tab::ALL {
        app.show(cx, tab);
        cx.run_until_parked();
        assert_eq!(app.read(cx, |settings| settings.tab), tab);
    }
    app.act(cx, |settings, window, cx| settings.step_tab(Tab::Visuals, window, cx));
    app.draw(cx);
    for (keys, expected) in [
        ("right", Tab::Effects),
        ("right", Tab::Looks),
        ("end", Tab::Settings),
        ("right", Tab::Visuals),
        ("left", Tab::Settings),
        ("home", Tab::Visuals),
    ] {
        cx.simulate_keystrokes(app.window, keys);
        app.draw(cx);
        assert_eq!(app.read(cx, |settings| settings.tab), expected, "after {keys}");
        let focused =
            cx.update_window(app.window, |_, window, cx| app.settings.read(cx).tab_focus[expected as usize].is_focused(window)).unwrap();
        assert!(focused, "the {expected:?} tab takes focus after {keys}");
    }
}

#[gpui::test]
fn the_effect_stack_adds_reorders_removes_and_saves_in_order(cx: &mut TestAppContext) {
    let app = Harness::open(cx);
    app.show(cx, Tab::Effects);
    for effect in ["vhs-distortion", "vignette", "bloom"] {
        app.act(cx, |settings, window, cx| {
            settings.effects_ui.chosen = effect.into();
            settings.add_effect(window, cx);
        });
    }
    app.draw(cx);
    assert_eq!(app.read(cx, ids), ["effect-1", "effect-2", "effect-3"]);
    assert_eq!(app.read(cx, |settings| settings.effects_ui.controls["effect-2"].len()), 5, "one widget per manifest control");

    // A control edit saves without touching order, and the layer keeps its other defaults.
    app.act(cx, |settings, window, cx| {
        settings.set_control(&Target::Effect("effect-1".into()), "intensity", SettingValue::Number(0.35), window, cx)
    });
    // The focused layer moves with Alt+Down, and the same key moves it back with Alt+Up.
    app.act(cx, |settings, window, cx| settings.effects_ui.focus["effect-1"].focus(window, cx));
    app.draw(cx);
    cx.simulate_keystrokes(app.window, "alt-down");
    assert_eq!(app.read(cx, ids), ["effect-2", "effect-1", "effect-3"]);
    assert!(app.read(cx, |settings| settings.effects_ui.message.clone()).unwrap().contains("layer 2"));
    let focused =
        cx.update_window(app.window, |_, window, cx| app.settings.read(cx).effects_ui.focus["effect-1"].is_focused(window)).unwrap();
    assert!(focused, "focus follows the moved layer");
    app.draw(cx);
    cx.simulate_keystrokes(app.window, "alt-up");
    assert_eq!(app.read(cx, ids), ["effect-1", "effect-2", "effect-3"]);

    app.act(cx, |settings, window, cx| settings.move_effect(0, false, window, cx));
    app.act(cx, |settings, window, cx| settings.set_effect_enabled(0, false, window, cx));
    app.act(cx, |settings, window, cx| settings.remove_effect(2, window, cx));
    let saved = app.saved(cx);
    let layers: Vec<_> = saved.effects.layers.iter().map(|layer| (layer.id.as_str(), layer.effect_id.as_str(), layer.enabled)).collect();
    assert_eq!(layers, [("effect-2", "vignette", false), ("effect-1", "vhs-distortion", true)]);
    assert_eq!(saved.effects.layers[1].values["intensity"], SettingValue::Number(0.35));

    // Bypassing keeps the stack, and reset returns only that layer's values.
    app.act(cx, |settings, window, cx| settings.set_effects_enabled(false, window, cx));
    app.act(cx, |settings, window, cx| settings.reset_effect(1, window, cx));
    let saved = app.saved(cx);
    assert!(!saved.effects.enabled && saved.effects.layers.len() == 2 && saved.effects.layers[1].values.is_empty());
    assert!(app.read(cx, |settings| settings.effects_ui.controls.contains_key("effect-1")));
}

#[gpui::test]
fn the_eight_layer_limit_holds_and_every_catalog_effect_draws_its_controls(cx: &mut TestAppContext) {
    let app = Harness::open(cx);
    app.show(cx, Tab::Effects);
    let catalog: Vec<_> =
        scrnsvr_core::catalog::Catalog::builtin().effects.iter().map(|effect| (effect.id.clone(), effect.uniforms.len())).collect();
    for (id, uniforms) in &catalog {
        app.act(cx, |settings, window, cx| {
            settings.effects_ui.chosen = id.clone();
            settings.add_effect(window, cx);
            let layer = settings.model.config.effects.layers.last().unwrap().id.clone();
            assert_eq!(settings.effects_ui.controls[&layer].len(), *uniforms, "{id}");
            assert!(settings.effects_ui.expanded.contains(&layer), "a new layer opens its controls");
        });
        app.draw(cx);
        app.act(cx, |settings, window, cx| settings.remove_effect(0, window, cx));
    }
    assert_eq!(app.read(cx, ids), Vec::<String>::new());
    assert!(app.read(cx, |settings| settings.effects_ui.message.clone()).unwrap().contains("0 layers remaining"));

    for _ in 0..8 {
        app.act(cx, |settings, window, cx| settings.add_effect(window, cx));
    }
    app.act(cx, |settings, window, cx| settings.add_effect(window, cx));
    app.draw(cx);
    assert_eq!(app.read(cx, |settings| settings.model.config.effects.layers.len()), 8);
    assert!(app.read(cx, |settings| settings.effects_ui.message.clone()).unwrap().contains("limit"));
    app.act(cx, |settings, window, cx| settings.remove_effect(3, window, cx));
    app.act(cx, |settings, window, cx| settings.add_effect(window, cx));
    assert_eq!(app.read(cx, |settings| settings.model.config.effects.layers.len()), 8);
    assert!(app.read(cx, |settings| settings.effect_warnings()).is_empty());
}

#[gpui::test]
fn a_layer_of_an_unavailable_effect_is_kept_skipped_and_reported(cx: &mut TestAppContext) {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.toml");
    fs::write(&config, "[effects]\nenabled = true\n[[effects.layers]]\nid = \"old\"\neffect_id = \"retired\"\nenabled = true\n").unwrap();
    let idle = fake(root.path(), BEFORE, AFTER);
    let app = Harness::with(cx, root, idle, None);
    app.show(cx, Tab::Effects);
    let warnings = app.read(cx, |settings| settings.effect_warnings());
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].contains("unavailable"));
    app.act(cx, |settings, window, cx| settings.set_effect_enabled(0, false, window, cx));
    assert_eq!(app.saved(cx).effects.layers[0].effect_id, "retired", "its settings are kept");
}

#[gpui::test]
fn shuffle_entries_toggle_reorder_remove_and_the_interval_clamps(cx: &mut TestAppContext) {
    let app = Harness::open(cx);
    app.show(cx, Tab::Looks);
    app.act(cx, |settings, window, cx| {
        settings.toggle_shuffle_entry("flow-field", None, window, cx);
        settings.toggle_shuffle_entry("plasma", None, window, cx);
        settings.toggle_shuffle_entry("aurora-veil", None, window, cx);
        settings.set_shuffle_enabled(true, window, cx);
        settings.set_cycling(true, window, cx);
    });
    app.draw(cx);
    assert_eq!(app.read(cx, |settings| settings.model.rotation_summary()), "Shuffling 3 looks on start and every 10 minutes.");

    // Typing past the limit clamps on Enter, and the field shows the value that was used.
    app.act(cx, |settings, window, cx| {
        settings.shuffle_ui.interval.update(cx, |input, cx| {
            input.focus(window, cx);
            input.set_value("500", window, cx);
        });
    });
    app.draw(cx);
    cx.simulate_keystrokes(app.window, "enter");
    assert_eq!(app.read(cx, |settings| settings.model.config.rotation.interval_minutes), 180.0);
    let interval = app.read(cx, |settings| settings.shuffle_ui.interval.clone());
    assert_eq!(value(cx, &interval), "180");

    app.act(cx, |settings, window, cx| settings.move_shuffle_entry(2, true, window, cx));
    app.act(cx, |settings, window, cx| settings.remove_shuffle_entry(0, window, cx));
    app.draw(cx);
    let saved = app.saved(cx);
    let order: Vec<_> = saved.rotation.entries.iter().map(|entry| entry.shader.as_str()).collect();
    assert_eq!(order, ["aurora-veil", "plasma"]);
    assert!(saved.rotation.enabled && saved.rotation.interval_minutes == 180.0);

    // Cycling off and back on restores the remembered interval. An empty list turns shuffle off.
    app.act(cx, |settings, window, cx| settings.set_cycling(false, window, cx));
    app.act(cx, |settings, window, cx| settings.set_cycling(true, window, cx));
    assert_eq!(app.read(cx, |settings| settings.model.config.rotation.interval_minutes), 180.0);
    app.act(cx, |settings, window, cx| {
        settings.remove_shuffle_entry(0, window, cx);
        settings.remove_shuffle_entry(0, window, cx);
    });
    assert!(!app.saved(cx).rotation.enabled);

    // A look is its own entry and loading it applies it in Visuals.
    app.act(cx, |settings, window, cx| {
        let plasma = settings.model.visual_index("plasma").unwrap();
        settings.select(plasma, window, cx);
        settings.set_uniform("speed", SettingValue::Number(0.9), window, cx);
        settings.look_name.update(cx, |input, cx| input.set_value("Fast", window, cx));
        settings.submit_look(window, cx);
        settings.toggle_shuffle_entry("plasma", Some("Fast"), window, cx);
        settings.model.select(0);
        settings.load_shuffle_entry(0, window, cx);
    });
    assert_eq!(app.read(cx, |settings| (settings.tab, settings.model.visual().id.clone())), (Tab::Visuals, "plasma".into()));
}

#[gpui::test]
fn the_clock_pattern_validates_live_and_falls_back_to_the_default_format(cx: &mut TestAppContext) {
    let app = Harness::open(cx);
    app.show(cx, Tab::Clock);
    app.act(cx, |settings, window, cx| {
        settings.set_clock_position(8, window, cx);
        settings.set_control(&Target::Clock, "show_seconds", SettingValue::Bool(true), window, cx);
        settings.set_control(&Target::Clock, "weight", SettingValue::Text("Bold".into()), window, cx);
        settings.clock_ui.pattern.update(cx, |input, cx| input.focus(window, cx));
    });
    app.draw(cx);
    cx.simulate_keystrokes(app.window, "% A space % H : % M");
    app.draw(cx);
    assert_eq!(app.read(cx, |settings| settings.model.config.clock.pattern.clone()).as_deref(), Some("%A %H:%M"));
    cx.simulate_keystrokes(app.window, "space % Q");
    app.draw(cx);
    let input = app.read(cx, |settings| settings.clock_ui.pattern.clone());
    let typed = value(cx, &input);
    let (state, pattern) = app.read(cx, |settings| (settings.clock_ui.pattern_state, settings.model.config.clock.pattern.clone()));
    assert_eq!(state, crate::model::clock::PatternState::Invalid);
    assert_eq!(pattern, None, "the saver falls back to its default format");
    assert_eq!(typed, "%A %H:%M %Q", "the text stays editable");
    cx.simulate_keystrokes(app.window, "backspace backspace backspace");
    assert_eq!(app.read(cx, |settings| settings.clock_ui.pattern_state), crate::model::clock::PatternState::Valid);

    let saved = app.saved(cx);
    assert_eq!(saved.clock.pattern.as_deref(), Some("%A %H:%M"));
    assert!(saved.clock.position == ClockPosition::BottomRight && saved.clock.show_seconds && saved.clock.weight == 700);

    // Switching the clock off greys the rest but keeps every value.
    app.act(cx, |settings, window, cx| settings.set_control(&Target::Clock, "enabled", SettingValue::Bool(false), window, cx));
    app.draw(cx);
    let saved = app.saved(cx);
    assert!(!saved.clock.enabled && saved.clock.show_seconds);
}

#[gpui::test]
fn global_settings_save_and_the_scheme_choices_reach_the_configuration(cx: &mut TestAppContext) {
    let app = Harness::open(cx);
    app.show(cx, Tab::Settings);
    cx.run_until_parked();
    app.act(cx, |settings, window, cx| {
        settings.set_control(&Target::Global, "fps", SettingValue::Number(30.0), window, cx);
        settings.set_control(&Target::Global, "fade_seconds", SettingValue::Number(2.5), window, cx);
        settings.set_control(&Target::Global, "monitors", SettingValue::Text("All monitors".into()), window, cx);
        settings.set_uniform("speed", SettingValue::Number(0.5), window, cx);
        settings.set_uniform("color", SettingValue::Text("#123456".into()), window, cx);
        settings.choose_global_scheme("dracula", window, cx);
        settings.choose_shader_scheme("nord", window, cx);
    });
    app.draw(cx);
    let saved = app.saved(cx);
    assert_eq!((saved.global.fps, saved.global.fade_seconds), (30, 2.5));
    assert_eq!(saved.global.monitors, scrnsvr_core::config::Monitors::All);
    assert_eq!(saved.colors.scheme, "dracula");
    assert_eq!(saved.colors.overrides["flow-field"], "nord");
    assert_eq!(saved.shaders["flow-field"]["speed"], SettingValue::Number(0.5), "other edits stay");
    assert!(!saved.shaders["flow-field"].contains_key("color"), "a scheme replaces the stored color");
    app.act(cx, |settings, window, cx| settings.choose_shader_scheme("", window, cx));
    assert!(app.saved(cx).colors.overrides.is_empty());
}

#[gpui::test]
fn noctalia_colors_import_off_the_ui_thread_with_actionable_failures(cx: &mut TestAppContext) {
    let root = tempfile::tempdir().unwrap();
    let colors = root.path().join("colors.json");
    let idle = fake(root.path(), BEFORE, AFTER);
    let app = Harness::with(cx, root, idle, Some(colors.clone()));
    app.draw(cx);
    app.act(cx, |settings, window, cx| settings.import_noctalia_colors(window, cx));
    cx.run_until_parked();
    let message = app.read(cx, |settings| settings.system_ui.import_message.clone()).unwrap();
    assert!(message.contains("were not found") && message.contains("choose a color scheme"), "{message}");

    fs::write(
        &colors,
        r##"{"mPrimary":"#ebbcba","mSecondary":"#9ccfd8","mTertiary":"#31748f","mSurface":"#191724","mOnSurface":"#e0def4"}"##,
    )
    .unwrap();
    app.act(cx, |settings, window, cx| settings.import_noctalia_colors(window, cx));
    cx.run_until_parked();
    let (message, color) =
        app.read(cx, |settings| (settings.system_ui.import_message.clone().unwrap(), settings.model.effective()["color"].clone()));
    assert!(message.starts_with("Imported Noctalia colors into"), "{message}");
    assert_eq!(color, SettingValue::Text("#ebbcba".into()));
    assert_eq!(app.saved(cx).shaders["flow-field"]["color"], SettingValue::Text("#ebbcba".into()));
    assert!(!app.read(cx, |settings| settings.system_ui.importing));
    app.act(cx, |settings, window, cx| settings.import_noctalia_colors(window, cx));
    cx.run_until_parked();
    assert!(app.read(cx, |settings| settings.system_ui.import_message.clone()).unwrap().contains("already uses"));
}

fn state(app: &Harness, cx: &mut TestAppContext) -> Idle {
    app.read(cx, |settings| settings.system_ui.idle.state.clone())
}

#[gpui::test]
fn the_idle_section_reads_noctalia_and_writes_only_after_confirmation(cx: &mut TestAppContext) {
    let app = Harness::open(cx);
    assert_eq!(state(&app, cx), Idle::Unchecked, "nothing runs until the Settings tab opens");
    assert_eq!(app.calls(), "");
    app.show(cx, Tab::Settings);
    cx.run_until_parked();
    app.draw(cx);
    let Idle::Ready(ready) = state(&app, cx) else { panic!("expected a reading") };
    let behavior = ready.status.behavior.unwrap();
    assert_eq!((behavior.name.as_str(), behavior.enabled, behavior.timeout), ("screensaver", Some(false), Some(742.5)));
    let timeout = app.read(cx, |settings| settings.system_ui.idle.timeout.clone());
    assert_eq!(value(cx, &timeout), "742.5");
    assert_eq!(app.calls().trim(), "config-get|idle|", "reading is one config-get");

    // Review shows the plan and writes nothing. Cancel leaves Noctalia alone.
    app.act(cx, |settings, window, cx| {
        settings.system_ui.idle.timeout.update(cx, |input, cx| input.set_value("450", window, cx));
        settings.review_idle_setup(window, cx);
    });
    app.draw(cx);
    let planned = app.read(cx, |settings| {
        settings.system_ui.idle.proposal.as_ref().map(|plan| plan.changes.iter().map(|change| change.path.clone()).collect::<Vec<_>>())
    });
    assert_eq!(
        planned.unwrap(),
        [
            "idle.behavior.screensaver.command",
            "idle.behavior.screensaver.enabled",
            "idle.behavior.screensaver.timeout",
            "idle.pre_action_fade_seconds"
        ]
    );
    app.act(cx, |settings, window, cx| settings.cancel_idle_setup(window, cx));
    assert!(app.read(cx, |settings| settings.system_ui.idle.proposal.is_none()));
    app.act(cx, |settings, window, cx| settings.confirm_idle_setup(window, cx));
    cx.run_until_parked();
    assert!(!app.calls().contains("config-set"), "confirming without a proposal does nothing");

    app.act(cx, |settings, window, cx| settings.review_idle_setup(window, cx));
    assert!(!app.calls().contains("config-set"));
    app.act(cx, |settings, window, cx| settings.confirm_idle_setup(window, cx));
    assert!(app.read(cx, |settings| settings.system_ui.idle.busy.is_some()), "applying runs in the background");
    cx.run_until_parked();
    app.draw(cx);
    let calls = app.calls();
    assert_eq!(calls.matches("config-set").count(), 4, "{calls}");
    assert!(calls.contains("config-set|idle.pre_action_fade_seconds|0.0"), "{calls}");
    assert!(calls.contains("config-set|idle.behavior.screensaver.timeout|450.0"), "{calls}");
    let Idle::Ready(ready) = state(&app, cx) else { panic!("expected a reading") };
    assert_eq!(ready.status.behavior.unwrap().enabled, Some(true));
    assert_eq!(ready.status.fade_seconds, Some(0.0));
    assert_eq!(app.read(cx, |settings| settings.system_ui.idle.message.clone()).map(|(ok, _)| ok), Some(true));

    // The timeout alone is one config-set, and a value Noctalia already has changes nothing.
    fs::write(app.root.path().join("after"), AFTER.replace("450.0", "90.0")).unwrap();
    app.act(cx, |settings, window, cx| {
        settings.system_ui.idle.timeout.update(cx, |input, cx| input.set_value("90", window, cx));
        settings.apply_idle_timeout(window, cx);
    });
    cx.run_until_parked();
    let calls = app.calls();
    assert_eq!(calls.matches("config-set").count(), 5, "{calls}");
    assert!(calls.contains("config-set|idle.behavior.screensaver.timeout|90.0"));
    app.act(cx, |settings, window, cx| settings.apply_idle_timeout(window, cx));
    cx.run_until_parked();
    assert_eq!(app.calls().matches("config-set").count(), 5, "an unchanged timeout is not sent again");
    app.act(cx, |settings, window, cx| {
        settings.system_ui.idle.timeout.update(cx, |input, cx| input.set_value("soon", window, cx));
        settings.apply_idle_timeout(window, cx);
    });
    let message = app.read(cx, |settings| settings.system_ui.idle.message.clone()).unwrap();
    assert!(!message.0 && message.1.contains("seconds"), "{message:?}");
}

#[gpui::test]
fn without_noctalia_the_section_offers_hypridle_and_hot_corner_instructions(cx: &mut TestAppContext) {
    let root = tempfile::tempdir().unwrap();
    let idle =
        IdleSource { noctalia: scrnsvr_core::noctalia::Noctalia::with_program(Path::new("/nonexistent/noctalia")), executable: None };
    let app = Harness::with(cx, root, idle, None);
    app.show(cx, Tab::Settings);
    cx.run_until_parked();
    app.draw(cx);
    assert_eq!(state(&app, cx), Idle::Absent);
    assert!(app.read(cx, |settings| settings.system_ui.idle.others_open), "the other setups are open by default");
    // Review and confirm without a reading do nothing.
    app.act(cx, |settings, window, cx| {
        settings.review_idle_setup(window, cx);
        settings.confirm_idle_setup(window, cx);
    });
    assert!(app.read(cx, |settings| settings.system_ui.idle.proposal.is_none()));
}

//! Scripted walkthrough for release builds launched by the compositor.

use std::io::Write as _;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use gpui_kit::*;

use scrnsvr_core::catalog::SettingValue;

use crate::app::{LookAction, Settings, Tab};
use crate::controls::Target;
use crate::idle::Idle;
use crate::model::RandomScope;
use crate::preview::PreviewSurface;

pub fn report(view: &Entity<Settings>, step: &str, cx: &mut AsyncApp) {
    cx.update(|cx| {
        let settings = view.read(cx);
        let frames = settings.preview.as_ref().map_or(0, |preview| preview.frames);
        let placement = settings.preview.as_ref().map(PreviewSurface::placement).unwrap_or_default();
        let at = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64();
        let values = settings.model.stored().cloned().unwrap_or_default();
        let config = &settings.model.config;
        let effects: Vec<_> = config.effects.layers.iter().map(|layer| format!("{}:{}{}", layer.id, layer.effect_id, if layer.enabled { "" } else { "!off" })).collect();
        let entries: Vec<_> = config.rotation.entries.iter().map(|entry| format!("{}/{}", entry.shader, entry.preset.as_deref().unwrap_or("-"))).collect();
        let idle = match &settings.system_ui.idle.state {
            Idle::Unchecked => "unchecked".to_owned(),
            Idle::Absent => "absent".to_owned(),
            Idle::Failed(error) => format!("failed({error})"),
            Idle::Ready(ready) => format!("{:?}", ready.status.behavior.as_ref().map(|behavior| (&behavior.name, behavior.enabled, behavior.timeout))),
        };
        println!(
            "step {step}: tab={:?} effects_on={} effects={effects:?} shuffle={}/{}/{entries:?} clock={:?}/{:?}/{:?}/{:?} pattern_state={:?} scheme={} overrides={:?} global={}/{}/{:?} idle={idle} idle_busy={:?} proposal={} skipped={:?} warnings={:?}",
            settings.tab,
            config.effects.enabled,
            config.rotation.enabled,
            config.rotation.interval_minutes,
            config.clock.position,
            config.clock.pattern,
            config.clock.enabled,
            config.clock.show_seconds,
            settings.clock_ui.pattern_state,
            config.colors.scheme,
            config.colors.overrides,
            config.global.fps,
            config.global.fade_seconds,
            config.global.monitors,
            settings.system_ui.idle.busy,
            settings.system_ui.idle.proposal.as_ref().map_or(0, |plan| plan.changes.len()),
            settings.preview.as_ref().map(|preview| preview.skipped_layers.clone()),
            settings.effect_warnings(),
        );
        println!(
            "step {step}: at={at:.3} shader={} frames={frames} preview={}x{}+{}+{}@{} paused={} favorites={} results={} saving={} error={:?} looks={:?} edits={values:?}",
            settings.model.visual().id, placement.width, placement.height, placement.x, placement.y, placement.scale, settings.paused,
            settings.model.ui.favorites.len(), settings.model.matches().iter().map(|(_, rows)| rows.len()).sum::<usize>(),
            settings.config_save.pending(), settings.config_save.error,
            settings.model.looks().collect::<Vec<_>>(),
        );
        let custom: Vec<_> = config.custom_shaders.iter().map(|shader| format!("{}:{}:{}b", shader.id, shader.title, shader.source.len())).collect();
        let shown = settings.custom.shown.clone().unwrap_or_default();
        let editor_status = match settings.custom.drafts.status(&shown) {
            crate::validation::Status::Invalid(items) => format!("invalid{:?}", items.iter().map(|item| item.display()).collect::<Vec<_>>()),
            other => format!("{other:?}"),
        };
        println!(
            "step {step}: thumbs={}/{}pending/{}visuals dir={:?} failure={:?} custom={custom:?} editor={shown:?} editor_status={editor_status} markers={} fullscreen={:?} selected_title={:?} favorites={:?} message={:?}",
            settings.thumbnails.ready_count(),
            settings.thumbnails.pending(),
            settings.model.visuals.len(),
            settings.thumbnails.directory(),
            settings.model.visuals.iter().find_map(|visual| settings.thumbnails.failure(&visual.id).map(|error| format!("{}: {error}", visual.id))),
            settings.custom.editor.read(cx).diagnostics().map_or(0, |set| set.len()),
            settings.fullscreen,
            settings.model.visual().title,
            settings.model.ui.favorites,
            settings.custom.message,
        );
        let _ = std::io::stdout().flush();
    });
}

fn drive(
    view: &Entity<Settings>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
    action: impl FnOnce(&mut Settings, &mut Window, &mut Context<Settings>),
) {
    let _ = window.update(cx, |_, window, cx| view.update(cx, |this, cx| action(this, window, cx)));
}

fn keys(window: AnyWindowHandle, cx: &mut AsyncApp, keys: &'static [&'static str]) {
    for key in keys {
        let _ = window.update(cx, |_, window, cx| window.dispatch_keystroke(Keystroke::parse(key).expect("smoke input"), cx));
    }
}

fn click(window: AnyWindowHandle, cx: &mut AsyncApp, x: f32, y: f32) {
    let position = point(px(x), px(y));
    let _ = window.update(cx, |_, window, cx| {
        window.dispatch_event(PlatformInput::MouseMove(MouseMoveEvent { position, ..Default::default() }), cx);
        window.dispatch_event(
            PlatformInput::MouseDown(MouseDownEvent { position, button: MouseButton::Left, click_count: 1, ..Default::default() }),
            cx,
        );
        window.dispatch_event(
            PlatformInput::MouseUp(MouseUpEvent { position, button: MouseButton::Left, click_count: 1, ..Default::default() }),
            cx,
        );
    });
}

pub async fn steps(view: Entity<Settings>, window: AnyWindowHandle, cx: &mut AsyncApp) {
    let wait = async |cx: &AsyncApp, ms: u64| cx.background_executor().timer(Duration::from_millis(ms)).await;
    wait(cx, 1500).await;
    report(&view, "start", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.
    // Thumbnails render in the background; give them time, then show how many appeared.
    for _ in 0..120 {
        if cx.update(|cx| view.read(cx).thumbnails.pending() == 0) {
            break;
        }
        wait(cx, 250).await;
    }
    wait(cx, 400).await;
    report(&view, "thumbnails", cx);
    wait(cx, 400).await; // Leave time for an external screenshot of this step.

    click(window, cx, 138.0, 115.0);
    wait(cx, 450).await;
    report(&view, "menu-open", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.
    wait(cx, 950).await;
    keys(window, cx, &["p", "l", "a", "s", "m", "a"]);
    wait(cx, 350).await;
    keys(window, cx, &["enter"]);
    wait(cx, 800).await;
    report(&view, "switched", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.

    drive(&view, window, cx, |this, window, cx| {
        this.search.update(cx, |input, cx| input.focus(window, cx));
    });
    wait(cx, 100).await;
    keys(window, cx, &["p", "l", "a", "s", "m", "a"]);
    wait(cx, 250).await;
    report(&view, "search", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.
    keys(window, cx, &["enter"]);
    drive(&view, window, cx, |this, window, cx| {
        this.favorite(this.model.selected, window, cx);
        this.filter(true, cx);
        if !this.paused {
            this.toggle_pause(cx);
        }
    });
    wait(cx, 700).await;
    report(&view, "paused", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.
    wait(cx, 1000).await;
    report(&view, "still-paused", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.

    drive(&view, window, cx, |this, window, cx| {
        if let Some(input) = this.controls.iter().find(|control| control.def.name == "brightness").and_then(|control| control.text_input())
        {
            input.update(cx, |input, cx| {
                input.set_value("0.22", window, cx);
                input.focus(window, cx);
            });
        }
    });
    wait(cx, 100).await;
    keys(window, cx, &["enter"]);
    wait(cx, 700).await;
    report(&view, "paused-edit", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.

    drive(&view, window, cx, |this, window, cx| {
        this.show_locks = true;
        this.model.toggle_lock("speed");
        if this.model.randomize(RandomScope::All, || 0.71) {
            this.finish_bulk_edit(window, cx);
        }
    });
    wait(cx, 650).await;
    report(&view, "randomized", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.
    drive(&view, window, cx, |this, window, cx| this.undo(window, cx));
    wait(cx, 650).await;
    report(&view, "undo", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.

    drive(&view, window, cx, |this, window, cx| {
        this.tab = crate::app::Tab::Looks;
        this.look_name.update(cx, |input, cx| {
            input.set_value("Smoke look", window, cx);
            input.focus(window, cx);
        });
        cx.notify();
    });
    wait(cx, 100).await;
    keys(window, cx, &["enter"]);
    wait(cx, 700).await;
    report(&view, "look-created", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.
    drive(&view, window, cx, |this, window, cx| {
        this.start_look_action(LookAction::Rename("Smoke look".into()), window, cx);
        this.look_name.update(cx, |input, cx| input.set_value("Smoke saved look", window, cx));
    });
    keys(window, cx, &["enter"]);
    wait(cx, 700).await;
    report(&view, "look-renamed", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.
    drive(&view, window, cx, |this, window, cx| {
        if this.model.reset_shader() {
            this.finish_bulk_edit(window, cx);
        }
        if this.model.apply_look("Smoke saved look") {
            this.finish_bulk_edit(window, cx);
        }
        this.toggle_pause(cx);
    });
    wait(cx, 700).await;
    report(&view, "look-applied", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.

    report(&view, "before-failure-test", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.
    wait(cx, 1250).await;
    drive(&view, window, cx, |this, window, cx| {
        this.start_look_action(LookAction::Delete("Smoke saved look".into()), window, cx);
        this.submit_look(window, cx);
    });
    wait(cx, 750).await;
    report(&view, "look-deleted", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.
    wait(cx, 1250).await;
    drive(&view, window, cx, |this, window, cx| this.retry(window, cx));
    wait(cx, 650).await;
    report(&view, "retried", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.

    custom_editor(&view, window, cx, wait).await;
    tabs(&view, window, cx, wait).await;
    custom_with_effects(&view, window, cx, wait).await;
    if std::env::var_os("SCRNSVR_SETTINGS_SMOKE_FULLSCREEN").is_some() {
        fullscreen(&view, window, cx, wait).await;
    }
    wait(cx, 850).await;
    cx.update(|cx| cx.quit());
}

const VALID: &str = "void mainImage(out vec4 color, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float wave = 0.5 + 0.5 * sin(uv.x * 12.0 + iTime * 1.5);
  color = vec4(wave, 0.35 * uv.y, 1.0 - wave, 1.0);
}";
const INVALID: &str = "void mainImage(out vec4 color, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float wave = 0.5 + 0.5 * sin(uv.x * 12.0 + iTime * 1.5);
  color = vec4(wave, oops_undeclared, 1.0 - wave, 1.0);
}";
const RECOVERED: &str = "void mainImage(out vec4 color, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float wave = 0.5 + 0.5 * sin(uv.y * 9.0 - iTime * 2.0);
  color = vec4(1.0 - wave, 0.8 * wave, 0.25 + 0.5 * uv.x, 1.0);
}";

/// The custom shader editor: add and favorite, edit validly, break it, recover and rename.
async fn custom_editor(view: &Entity<Settings>, window: AnyWindowHandle, cx: &mut AsyncApp, wait: impl AsyncFn(&AsyncApp, u64)) {
    let stage = async |name: &str, ms: u64, cx: &mut AsyncApp| {
        wait(cx, ms).await;
        report(view, name, cx);
        wait(cx, 300).await; // Leave time for an external screenshot of this step.
    };
    let type_source = |text: &'static str, cx: &mut AsyncApp| {
        drive(view, window, cx, move |this, window, cx| {
            this.custom.editor.update(cx, |state, cx| state.replace_all(text, window, cx));
        });
    };
    drive(view, window, cx, |this, window, cx| {
        if this.paused {
            this.toggle_pause(cx);
        }
        this.step_tab(Tab::Visuals, window, cx);
        this.clear_filters(window, cx);
        this.add_custom_shader(window, cx);
        let index = this.model.selected;
        this.favorite(index, window, cx);
    });
    stage("editor-added", 1200, cx).await;
    type_source(VALID, cx);
    stage("editor-valid", 1400, cx).await;
    type_source(INVALID, cx);
    stage("editor-invalid", 1400, cx).await;
    // The preview must still show the last valid version; the capture at this step compares it with editor-valid.
    type_source(RECOVERED, cx);
    stage("editor-recovered", 1500, cx).await;
    drive(view, window, cx, |this, window, cx| {
        this.custom.title.update(cx, |state, cx| state.set_value("Smoke waves", window, cx));
        this.commit_title(window, cx);
    });
    stage("editor-renamed", 900, cx).await;
    drive(view, window, cx, |this, window, cx| {
        this.select(this.model.visual_index("plasma").unwrap(), window, cx);
    });
    stage("editor-back-to-builtin", 700, cx).await;
}

/// The custom shader under the global effect stack from the earlier steps.
async fn custom_with_effects(view: &Entity<Settings>, window: AnyWindowHandle, cx: &mut AsyncApp, wait: impl AsyncFn(&AsyncApp, u64)) {
    drive(view, window, cx, |this, window, cx| {
        this.step_tab(Tab::Visuals, window, cx);
        if let Some(index) = this.model.visuals.iter().position(|visual| visual.category == "Custom") {
            this.select(index, window, cx);
            let id = this.model.visual().id.clone();
            this.toggle_shuffle_entry(&id, None, window, cx);
        }
    });
    wait(cx, 900).await;
    report(view, "custom-with-effects", cx);
    wait(cx, 300).await; // Leave time for an external screenshot of this step.
}

/// Opt-in (`SCRNSVR_SETTINGS_SMOKE_FULLSCREEN`): the fullscreen preview takes over the screen.
async fn fullscreen(view: &Entity<Settings>, window: AnyWindowHandle, cx: &mut AsyncApp, wait: impl AsyncFn(&AsyncApp, u64)) {
    drive(view, window, cx, |this, window, cx| this.start_fullscreen(window, cx));
    wait(cx, 3500).await;
    report(view, "fullscreen-showing", cx);
    wait(cx, 700).await; // Leave time for an external screenshot of this step.
    drive(view, window, cx, |this, window, cx| this.start_fullscreen(window, cx));
    wait(cx, 300).await;
    drive(view, window, cx, |this, window, cx| this.exit_fullscreen(window, cx));
    wait(cx, 2500).await;
    report(view, "fullscreen-exited", cx);
    wait(cx, 300).await;
}

/// The Effects, Looks & Shuffle, Clock and Settings tabs, reached with the keyboard where it matters.
async fn tabs(view: &Entity<Settings>, window: AnyWindowHandle, cx: &mut AsyncApp, wait: impl AsyncFn(&AsyncApp, u64)) {
    let stage = async |name: &str, cx: &mut AsyncApp| {
        wait(cx, 700).await;
        report(view, name, cx);
        wait(cx, 300).await; // Leave time for an external screenshot of this step.
    };

    // Roving focus: focus the selected tab, then Right moves to Effects and selects it.
    drive(view, window, cx, |this, window, cx| {
        if this.paused {
            this.toggle_pause(cx);
        }
        this.step_tab(Tab::Visuals, window, cx);
    });
    wait(cx, 150).await;
    keys(window, cx, &["right"]);
    stage("tab-effects-empty", cx).await;

    drive(view, window, cx, |this, window, cx| {
        for effect in ["vhs-distortion", "vignette", "bloom"] {
            this.effects_ui.chosen = effect.into();
            this.add_effect(window, cx);
        }
        this.set_control(&Target::Effect("effect-1".into()), "intensity", SettingValue::Number(0.9), window, cx);
        this.set_control(&Target::Effect("effect-2".into()), "strength", SettingValue::Number(0.8), window, cx);
    });
    stage("effects-added", cx).await;
    drive(view, window, cx, |this, window, cx| {
        this.effects_ui.expanded.clear();
        this.effects_ui.expanded.insert("effect-2".into());
        this.move_effect(1, true, window, cx);
        this.set_effect_enabled(2, false, window, cx);
    });
    stage("effects-reordered", cx).await;
    // Alt+Down from the focused layer moves it back down.
    keys(window, cx, &["alt-down"]);
    stage("effects-keyboard-move", cx).await;
    drive(view, window, cx, |this, window, cx| this.set_effects_enabled(false, window, cx));
    stage("effects-bypassed", cx).await;
    drive(view, window, cx, |this, window, cx| this.set_effects_enabled(true, window, cx));

    // Looks & Shuffle: two entries, shuffle on, a one-minute cycle.
    drive(view, window, cx, |this, window, cx| this.step_tab(Tab::Looks, window, cx));
    drive(view, window, cx, |this, window, cx| {
        this.toggle_shuffle_entry("flow-field", None, window, cx);
        this.toggle_shuffle_entry("plasma", None, window, cx);
        this.set_shuffle_enabled(true, window, cx);
        this.set_cycling(true, window, cx);
        this.shuffle_ui.interval.update(cx, |input, cx| {
            input.set_value("25", window, cx);
            input.focus(window, cx);
        });
    });
    wait(cx, 100).await;
    keys(window, cx, &["enter"]);
    stage("tab-looks-shuffle", cx).await;
    drive(view, window, cx, |this, window, cx| {
        this.move_shuffle_entry(1, true, window, cx);
        this.toggle_shuffle_entry("aurora-veil", None, window, cx);
        this.remove_shuffle_entry(2, window, cx);
    });
    stage("shuffle-reordered", cx).await;

    // Clock: bottom right with seconds, then a valid and an invalid pattern.
    drive(view, window, cx, |this, window, cx| this.step_tab(Tab::Clock, window, cx));
    drive(view, window, cx, |this, window, cx| {
        this.set_clock_position(8, window, cx);
        this.set_control(&Target::Clock, "show_seconds", SettingValue::Bool(true), window, cx);
        this.set_control(&Target::Clock, "size", SettingValue::Number(20.0), window, cx);
        this.clock_ui.pattern.update(cx, |input, cx| {
            input.focus(window, cx);
        });
    });
    wait(cx, 100).await;
    keys(window, cx, &["%", "A", "space", "%", "H", ":", "%", "M"]);
    stage("clock-pattern-valid", cx).await;
    keys(window, cx, &["space", "%", "Q"]);
    stage("clock-pattern-invalid", cx).await;
    keys(window, cx, &["backspace", "backspace", "backspace"]);
    wait(cx, 100).await;

    // Settings: Noctalia's idle state, the confirmation flow, then the global color scheme.
    drive(view, window, cx, |this, window, cx| this.step_tab(Tab::Settings, window, cx));
    stage("settings-idle-checked", cx).await;
    drive(view, window, cx, |this, window, cx| {
        this.system_ui.idle.timeout.update(cx, |input, cx| input.set_value("450", window, cx));
        this.review_idle_setup(window, cx);
    });
    stage("idle-setup-review", cx).await;
    if std::env::var_os("SCRNSVR_SETTINGS_SMOKE_NOCTALIA").is_some() {
        drive(view, window, cx, |this, window, cx| this.confirm_idle_setup(window, cx));
        wait(cx, 400).await;
        stage("idle-setup-applied", cx).await;
        drive(view, window, cx, |this, window, cx| {
            this.system_ui.idle.timeout.update(cx, |input, cx| input.set_value("90", window, cx));
            this.apply_idle_timeout(window, cx);
        });
        stage("idle-timeout-applied", cx).await;
    } else {
        drive(view, window, cx, |this, window, cx| this.cancel_idle_setup(window, cx));
        stage("idle-setup-cancelled", cx).await;
    }
    drive(view, window, cx, |this, window, cx| {
        this.set_control(&Target::Global, "fps", SettingValue::Number(30.0), window, cx);
        this.set_control(&Target::Global, "monitors", SettingValue::Text("All monitors".into()), window, cx);
        this.choose_global_scheme("dracula", window, cx);
    });
    stage("global-scheme", cx).await;
    drive(view, window, cx, |this, window, cx| {
        this.step_tab(Tab::Visuals, window, cx);
        this.choose_shader_scheme("nord", window, cx);
    });
    stage("shader-scheme", cx).await;
    keys(window, cx, &["end"]);
    stage("tab-end", cx).await;
}

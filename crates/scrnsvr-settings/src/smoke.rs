//! Scripted walkthrough for release builds launched by the compositor.

use std::io::Write as _;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use gpui_kit::*;

use crate::app::{LookAction, Settings};
use crate::model::RandomScope;
use crate::preview::PreviewSurface;

pub fn report(view: &Entity<Settings>, step: &str, cx: &mut AsyncApp) {
    cx.update(|cx| {
        let settings = view.read(cx);
        let frames = settings.preview.as_ref().map_or(0, |preview| preview.frames);
        let placement = settings.preview.as_ref().map(PreviewSurface::placement).unwrap_or_default();
        let at = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64();
        let values = settings.model.stored().cloned().unwrap_or_default();
        println!(
            "step {step}: at={at:.3} shader={} frames={frames} preview={}x{}+{}+{}@{} paused={} favorites={} results={} saving={} error={:?} looks={:?} edits={values:?}",
            settings.model.visual().id, placement.width, placement.height, placement.x, placement.y, placement.scale, settings.paused,
            settings.model.ui.favorites.len(), settings.model.matches().iter().map(|(_, rows)| rows.len()).sum::<usize>(),
            settings.config_save.pending(), settings.config_save.error,
            settings.model.looks().collect::<Vec<_>>(),
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
        this.show_looks = true;
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
    wait(cx, 850).await;
    cx.update(|cx| cx.quit());
}

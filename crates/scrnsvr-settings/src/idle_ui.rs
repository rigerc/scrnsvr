//! The Idle section of the Settings tab.
//!
//! scrnsvr has no idle detection of its own. Noctalia (or hypridle) runs `scrnsvr --open`. This
//! section shows whether Noctalia does that, edits its timeout, and offers the same setup as
//! `scrnsvr --setup-noctalia`. Every `noctalia` call runs on the background executor, and nothing
//! is written to Noctalia until the user confirms the listed changes.

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{Disableable, Selectable, Sizable, h_flex, v_flex};
use gpui_kit::component::{Icon, IconName};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use scrnsvr_core::noctalia::Plan;

use crate::app::Settings;
use crate::idle::{Idle, Ready, apply, apply_timeout, duration_text, hypridle_snippet, probe};
use crate::view::{ALERT, CANVAS, MUTED, QUIET, RAISED, SAVED, SIGNAL, action, button, dot, glyph, live, note, section};

pub struct IdleUi {
    pub state: Idle,
    /// What is running right now, if anything. Buttons that would overlap with it are disabled.
    pub busy: Option<&'static str>,
    /// The planned changes the user is being asked to confirm.
    pub proposal: Option<Plan>,
    /// The timeout the proposal was made for.
    pub proposal_timeout: Option<f64>,
    /// The last outcome, as `(succeeded, text)`.
    pub message: Option<(bool, String)>,
    pub timeout: Entity<InputState>,
    pub others_open: bool,
    pub confirm_focus: FocusHandle,
    pub setup_focus: FocusHandle,
    task: Option<Task<()>>,
    _subscription: Subscription,
}

impl IdleUi {
    pub fn new(window: &mut Window, cx: &mut Context<Settings>) -> Self {
        let timeout = cx.new(|cx| InputState::new(window, cx).default_value("600"));
        let entered = cx.subscribe_in(&timeout, window, |this, _, event: &InputEvent, window, cx| {
            if matches!(event, InputEvent::PressEnter { .. }) {
                this.apply_idle_timeout(window, cx);
            }
        });
        Self {
            state: Idle::Unchecked,
            busy: None,
            proposal: None,
            proposal_timeout: None,
            message: None,
            timeout,
            others_open: false,
            confirm_focus: cx.focus_handle(),
            setup_focus: cx.focus_handle(),
            task: None,
            _subscription: entered,
        }
    }
}

fn parse_seconds(text: &str) -> Result<f64, String> {
    text.trim()
        .parse::<f64>()
        .ok()
        .filter(|seconds| seconds.is_finite() && *seconds >= 0.0)
        .ok_or_else(|| "Enter the idle timeout in seconds, for example 600.".to_string())
}

impl Settings {
    fn idle_ui(&mut self) -> &mut IdleUi {
        &mut self.system_ui.idle
    }

    /// Read Noctalia again unless a call is already running.
    pub fn refresh_idle(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.system_ui.idle.busy.is_some() {
            return;
        }
        let source = self.paths.idle.clone();
        let ui = self.idle_ui();
        ui.busy = Some("Checking Noctalia…");
        ui.proposal = None;
        cx.notify();
        let task = cx.spawn_in(window, async move |this, cx| {
            let state = cx.background_executor().spawn(async move { probe(&source) }).await;
            let _ = this.update_in(cx, |this, window, cx| this.idle_known(state, None, window, cx));
        });
        self.idle_ui().task = Some(task);
    }

    /// Take a new reading and refresh what depends on it.
    fn idle_known(&mut self, state: Idle, message: Option<(bool, String)>, window: &mut Window, cx: &mut Context<Self>) {
        let timeout = match &state {
            Idle::Ready(ready) => ready.status.behavior.as_ref().and_then(|behavior| behavior.timeout),
            _ => None,
        };
        let ui = self.idle_ui();
        ui.busy = None;
        ui.others_open |= state == Idle::Absent;
        if let Some(seconds) = timeout {
            ui.timeout.update(cx, |input, cx| input.set_value(seconds.to_string(), window, cx));
        }
        ui.state = state;
        if message.is_some() {
            ui.message = message;
        }
        cx.notify();
    }

    fn ready(&self) -> Option<&Ready> {
        match &self.system_ui.idle.state {
            Idle::Ready(ready) => Some(ready),
            _ => None,
        }
    }

    /// Show what Set up would change and wait for the user to confirm.
    pub fn review_idle_setup(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let typed = parse_seconds(self.system_ui.idle.timeout.read(cx).value().as_ref());
        let Some(ready) = self.ready() else { return };
        let result = typed.and_then(|seconds| ready.proposal(Some(seconds)).map(|plan| (seconds, plan)).map_err(|error| error.to_string()));
        let ui = self.idle_ui();
        match result {
            Ok((seconds, plan)) if plan.changes.is_empty() => {
                ui.message = Some((true, "Noctalia idle settings already match.".into()));
                ui.proposal = None;
                let _ = seconds;
            }
            Ok((seconds, plan)) => {
                ui.proposal = Some(plan);
                ui.proposal_timeout = Some(seconds);
                ui.message = None;
                ui.confirm_focus.focus(window, cx);
            }
            Err(error) => ui.message = Some((false, error)),
        }
        cx.notify();
    }

    pub fn cancel_idle_setup(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let ui = self.idle_ui();
        ui.proposal = None;
        ui.message = None;
        ui.setup_focus.focus(window, cx);
        cx.notify();
    }

    /// Write the confirmed plan with `noctalia msg config-set`, off the UI thread.
    pub fn confirm_idle_setup(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let ui = &mut self.system_ui.idle;
        let (Some(plan), None) = (ui.proposal.take(), ui.busy) else { return };
        let timeout = ui.proposal_timeout;
        ui.busy = Some("Applying to Noctalia…");
        ui.message = None;
        let source = self.paths.idle.clone();
        cx.notify();
        let task = cx.spawn_in(window, async move |this, cx| {
            let outcome = cx.background_executor().spawn(async move { apply(&source, &plan, timeout) }).await;
            let _ = this.update_in(cx, |this, window, cx| match outcome {
                Ok(state) => {
                    this.idle_known(state, Some((true, "Noctalia now launches scrnsvr when the system is idle.".into())), window, cx);
                    this.idle_ui().setup_focus.focus(window, cx);
                }
                Err(error) => {
                    this.idle_ui().busy = None;
                    this.idle_ui().message = Some((false, error));
                    // The failure may have left Noctalia half changed, so show what it holds now.
                    this.refresh_idle(window, cx);
                }
            });
        });
        self.idle_ui().task = Some(task);
    }

    /// Change only the existing behavior's timeout.
    pub fn apply_idle_timeout(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.system_ui.idle.busy.is_some() {
            return;
        }
        let typed = parse_seconds(self.system_ui.idle.timeout.read(cx).value().as_ref());
        let planned = typed.and_then(|seconds| {
            let ready = self.ready().ok_or_else(|| "Noctalia is not ready.".to_string())?;
            let behavior =
                ready.status.behavior.clone().ok_or_else(|| "Noctalia does not launch scrnsvr yet. Set it up first.".to_string())?;
            let change = ready.timeout_change(seconds).map_err(|error| error.to_string())?;
            Ok((seconds, behavior, change))
        });
        let (seconds, behavior, change) = match planned {
            Ok(planned) => planned,
            Err(error) => {
                self.idle_ui().message = Some((false, error));
                cx.notify();
                return;
            }
        };
        let Some(change) = change else {
            self.idle_ui().message = Some((true, format!("The timeout is already {}.", duration_text(seconds))));
            cx.notify();
            return;
        };
        let source = self.paths.idle.clone();
        let ui = self.idle_ui();
        ui.busy = Some("Changing the timeout in Noctalia…");
        ui.proposal = None;
        ui.message = None;
        cx.notify();
        let task = cx.spawn_in(window, async move |this, cx| {
            let outcome = cx.background_executor().spawn(async move { apply_timeout(&source, &change, &behavior, seconds) }).await;
            let _ = this.update_in(cx, |this, window, cx| match outcome {
                Ok(state) => this.idle_known(
                    state,
                    Some((true, format!("Noctalia starts scrnsvr after {} of inactivity.", duration_text(seconds)))),
                    window,
                    cx,
                ),
                Err(error) => {
                    this.idle_ui().busy = None;
                    this.idle_ui().message = Some((false, error));
                    this.refresh_idle(window, cx);
                }
            });
        });
        self.idle_ui().task = Some(task);
    }

    pub(crate) fn idle_section(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let ui = &self.system_ui.idle;
        let busy = ui.busy.is_some();
        let seconds = parse_seconds(ui.timeout.read(cx).value().as_ref()).unwrap_or(600.0);
        section("IDLE")
            .child(note(
                "scrnsvr does not watch for idle itself. Noctalia, or hypridle, runs scrnsvr --open when the system has been idle.",
            ))
            .child(match &ui.state {
                Idle::Unchecked => note(ui.busy.unwrap_or("Noctalia has not been checked yet.")).into_any_element(),
                Idle::Absent => {
                    note("Noctalia is not installed or is not on PATH. Use hypridle or a hot corner, as shown below.").into_any_element()
                }
                Idle::Failed(error) => v_flex()
                    .gap_2()
                    .child(div().id("idle-status-alert").role(Role::Alert).text_size(px(13.)).text_color(rgb(ALERT)).child(error.clone()))
                    .into_any_element(),
                Idle::Ready(ready) => self.idle_ready(ready, cx).into_any_element(),
            })
            .children(
                ui.busy.filter(|_| ui.state != Idle::Unchecked).map(|text| live("idle-status-5", text).text_xs().text_color(rgb(MUTED))),
            )
            .children(
                ui.message.as_ref().map(|(ok, text)| {
                    live("idle-status-6", text.clone()).text_size(px(13.)).text_color(rgb(if *ok { SAVED } else { ALERT }))
                }),
            )
            .child(
                h_flex().gap_2().child(
                    action("idle-refresh", "refresh-cw", if ui.state == Idle::Unchecked { "Check Noctalia" } else { "Check again" })
                        .disabled(busy)
                        .on_click(cx.listener(|this, _, window, cx| this.refresh_idle(window, cx))),
                ),
            )
            .child(self.idle_other_setups(seconds, cx))
    }

    fn idle_ready(&self, ready: &Ready, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let ui = &self.system_ui.idle;
        let busy = ui.busy.is_some();
        let behavior = ready.status.behavior.as_ref();
        let matches = ready.proposal(None).is_ok_and(|plan| plan.changes.is_empty());
        let headline = match behavior {
            Some(behavior) if behavior.enabled != Some(false) => {
                format!("Noctalia launches scrnsvr after {}.", behavior.timeout.map_or("its timeout".into(), duration_text))
            }
            Some(_) => "Noctalia has a scrnsvr behavior, but it is turned off.".to_string(),
            None => "Noctalia does not launch scrnsvr yet.".to_string(),
        };
        let launching = behavior.is_some_and(|behavior| behavior.enabled != Some(false));
        v_flex()
            .gap_2()
            .child(h_flex().gap_2().items_center().child(dot(if launching { SIGNAL } else { ALERT }, 7.)).child(live("idle-status-7", headline).font_weight(FontWeight::MEDIUM)))
            .children(behavior.map(|behavior| {
                note(format!(
                    "Behavior “{}”, {}. Command: {}",
                    behavior.name,
                    match behavior.enabled {
                        Some(true) => "enabled",
                        Some(false) => "disabled",
                        None => "enabled state not set",
                    },
                    behavior.command
                ))
            }))
            .child(note(match ready.status.fade_seconds {
                Some(0.0) => "Noctalia’s own fade before the command is off, so only scrnsvr fades.".to_string(),
                Some(seconds) => format!("Noctalia fades the screen for {seconds} s before it runs the command, which adds to scrnsvr’s own fade. Set up turns that off."),
                None => "Noctalia’s own fade before the command is not set.".to_string(),
            }))
            .child(
                v_flex()
                    .gap_1()
                    .child(div().font_weight(FontWeight::MEDIUM).child("Idle timeout"))
                    .child(
                        h_flex()
                            .gap_2()
                            .items_center()
                            .child(div().w(px(110.)).child(Input::new(&ui.timeout).small().disabled(busy).aria_label("Noctalia idle timeout in seconds")))
                            .child(div().text_xs().text_color(rgb(QUIET)).child("seconds"))
                            .when(behavior.is_some(), |this| {
                                this.child(
                                    button("idle-apply-timeout", "Apply timeout")
                                        .disabled(busy)
                                        .on_click(cx.listener(|this, _, window, cx| this.apply_idle_timeout(window, cx))),
                                )
                            }),
                    )
                    .child(note("Changes the timeout in Noctalia only. Nothing else is touched.")),
            )
            .child(match &ui.proposal {
                Some(plan) => v_flex()
                    .gap_2()
                    .p_3()
                    .rounded(px(10.))
                    .bg(rgb(RAISED))
                    .child(div().font_weight(FontWeight::MEDIUM).child("These changes will be sent to Noctalia"))
                    .child(note("Each one is applied with noctalia msg config-set. Noctalia’s own files are not edited."))
                    .children(plan.changes.iter().map(|change| div().text_xs().font_family("monospace").child(change.describe())))
                    .when(!ready.installed, |this| {
                        this.child(note(format!(
                            "scrnsvr is not installed as a stable command, so Noctalia would run {}. Run scrnsvr --install first to give it a path that survives upgrades.",
                            ready.executable.display()
                        )))
                    })
                    .child(
                        h_flex()
                            .gap_2()
                            .child(
                                Button::new("idle-confirm").small().primary().label("Apply changes")
                                    .track_focus(&ui.confirm_focus)
                                    .disabled(busy)
                                    .on_click(cx.listener(|this, _, window, cx| this.confirm_idle_setup(window, cx))),
                            )
                            .child(button("idle-cancel", "Cancel").ghost().on_click(cx.listener(|this, _, window, cx| this.cancel_idle_setup(window, cx)))),
                    )
                    .into_any_element(),
                None => h_flex()
                    .gap_2()
                    .child(
                        Button::new("idle-setup").small().primary().icon(glyph("power")).label(if matches { "Set up (nothing to change)" } else { "Set up…" })
                            .track_focus(&ui.setup_focus)
                            .disabled(busy || matches)
                            .on_click(cx.listener(|this, _, window, cx| this.review_idle_setup(window, cx))),
                    )
                    .into_any_element(),
            })
    }

    fn idle_other_setups(&self, seconds: f64, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let open = self.system_ui.idle.others_open;
        let snippet = hypridle_snippet(seconds);
        let copy = snippet.clone();
        v_flex()
            .gap_2()
            .child(
                Button::new("idle-others").small().ghost().icon(Icon::new(if open { IconName::ChevronDown } else { IconName::ChevronRight })).label(if open { "Hide other setups" } else { "Other setups (hypridle, hot corner)" })
                    .selected(open)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.idle_ui().others_open = !this.system_ui.idle.others_open;
                        cx.notify();
                    })),
            )
            .when(open, |this| {
                this.child(div().font_weight(FontWeight::MEDIUM).child("hypridle"))
                    .child(note("Add a listener to hypridle.conf. Run scrnsvr --install once so the name resolves."))
                    .child(div().p_3().rounded(px(8.)).bg(rgb(CANVAS)).text_xs().font_family("monospace").child(snippet))
                    .child(action("idle-copy", "copy", "Copy hypridle listener").ghost().on_click(cx.listener(move |_, _, _, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(copy.clone()));
                    })))
                    .child(div().font_weight(FontWeight::MEDIUM).child("Hot corner or key binding"))
                    .child(note("Bind any hot corner or key in your compositor or panel to run scrnsvr --open. scrnsvr --dismiss closes a running screensaver."))
            })
    }
}

//! Looks & Shuffle tab: the selected visual's saved looks beside the preview, and the shuffle
//! list with its timing in the inspector.

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Escape, Input, InputEvent, InputState, NumberInput, NumberInputEvent, StepAction};
use gpui_kit::component::switch::Switch;
use gpui_kit::component::{Disableable, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use scrnsvr_core::config::RotationEntry;

use crate::app::{LookAction, Settings, Tab};
use crate::model::Model;
use crate::model::rotation::{EntryStatus, MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES};
use crate::view::{LINE, MUTED, SIGNAL_HOVER, button, label, note, status};

/// One shuffle row has four buttons that keep focus through list edits.
const LOAD: usize = 0;
const UP: usize = 1;
const DOWN: usize = 2;
const REMOVE: usize = 3;

pub struct ShuffleUi {
    pub interval: Entity<InputState>,
    focus: Vec<[FocusHandle; 4]>,
    pub message: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl ShuffleUi {
    pub fn new(model: &Model, window: &mut Window, cx: &mut Context<Settings>) -> Self {
        let interval = cx.new(|cx| InputState::new(window, cx).default_value(model.remembered_interval().to_string()));
        let committed = cx.subscribe_in(&interval, window, |this, _, event: &InputEvent, window, cx| {
            if matches!(event, InputEvent::PressEnter { .. } | InputEvent::Blur) {
                this.commit_interval(None, window, cx);
            }
        });
        let stepped = cx.subscribe_in(&interval, window, |this, _, event: &NumberInputEvent, window, cx| {
            let NumberInputEvent::Step(action) = event;
            this.commit_interval(Some(*action), window, cx);
        });
        let mut ui = Self { interval, focus: Vec::new(), message: None, _subscriptions: vec![committed, stepped] };
        ui.grow(model, cx);
        ui
    }

    /// Make sure every shuffle entry has its focus handles.
    pub fn grow(&mut self, model: &Model, cx: &mut Context<Settings>) {
        while self.focus.len() < model.config.rotation.entries.len() {
            self.focus.push([cx.focus_handle(), cx.focus_handle(), cx.focus_handle(), cx.focus_handle()]);
        }
    }
}

impl Settings {
    fn shuffle_changed(&mut self, message: impl Into<String>, window: &mut Window, cx: &mut Context<Self>) {
        self.shuffle_ui.message = Some(message.into());
        self.config_changed(window, cx);
    }

    /// Add or remove one visual's current edits (`preset` is `None`) or one of its looks.
    pub fn toggle_shuffle_entry(&mut self, shader: &str, preset: Option<&str>, window: &mut Window, cx: &mut Context<Self>) {
        let included = self.model.rotation_toggle(shader, preset);
        let title = self.model.visual_index(shader).map_or(shader, |index| self.model.visuals[index].title.as_str());
        let what = preset.map_or_else(|| format!("{title}, current edits"), |name| format!("{title}, {name}"));
        let message = if included { format!("Added {what} to shuffle.") } else { format!("Removed {what} from shuffle.") };
        self.shuffle_changed(message, window, cx);
    }

    pub fn remove_shuffle_entry(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(entry) = self.model.rotation_remove(index) else { return };
        let what = self.entry_name(&entry);
        let remaining = self.model.config.rotation.entries.len();
        self.shuffle_changed(format!("Removed {what} from shuffle. {remaining} remaining."), window, cx);
        match self.shuffle_ui.focus.get(index.min(remaining.saturating_sub(1))).filter(|_| remaining > 0) {
            Some(handles) => handles[REMOVE].focus(window, cx),
            None => self.look_name.update(cx, |state, cx| state.focus(window, cx)),
        }
    }

    pub fn move_shuffle_entry(&mut self, index: usize, up: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(target) = self.model.rotation_move(index, up) else { return };
        let what = self.entry_name(&self.model.config.rotation.entries[target]);
        self.shuffle_changed(format!("Moved {what} to position {}.", target + 1), window, cx);
        // The button that was pressed moves with the row. At the end of the list its twin takes over.
        let last = self.model.config.rotation.entries.len() - 1;
        let button = match (up, target) {
            (true, 0) => DOWN,
            (false, t) if t == last => UP,
            (true, _) => UP,
            (false, _) => DOWN,
        };
        if let Some(handles) = self.shuffle_ui.focus.get(target) {
            handles[button].focus(window, cx);
        }
    }

    /// Open an entry in the Visuals tab, applying its look to that visual's current edits.
    pub fn load_shuffle_entry(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        match self.model.entry_target(index) {
            Ok((visual, preset)) => {
                self.select(visual, window, cx);
                if let Some(name) = preset
                    && self.model.apply_look(&name)
                {
                    self.finish_bulk_edit(window, cx);
                    self.look_message = Some(format!("Applied “{name}” to current edits. The saved look stays unchanged."));
                }
                self.show_tab(Tab::Visuals, window, cx);
                self.tab_focus[Tab::Visuals as usize].focus(window, cx);
            }
            Err(error) => {
                self.shuffle_ui.message = Some(error.into());
                cx.notify();
            }
        }
    }

    pub fn set_shuffle_enabled(&mut self, enabled: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.model.set_rotation_enabled(enabled) {
            let message = if enabled { "Shuffle is on." } else { "Shuffle is off." };
            self.shuffle_changed(message, window, cx);
        }
    }

    pub fn set_cycling(&mut self, cycling: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.model.set_cycling(cycling) {
            self.shuffle_ui.interval.update(cx, |state, cx| state.set_value(self.model.remembered_interval().to_string(), window, cx));
            let message = if cycling {
                "The visual also changes while the screensaver runs."
            } else {
                "The visual changes only when the screensaver starts."
            };
            self.shuffle_changed(message, window, cx);
        }
    }

    fn commit_interval(&mut self, action: Option<StepAction>, window: &mut Window, cx: &mut Context<Self>) {
        if !self.model.cycling() {
            return;
        }
        let current = self.model.config.rotation.interval_minutes;
        let typed = self.shuffle_ui.interval.read(cx).value();
        let typed = typed.trim().parse::<f64>().ok().filter(|minutes| minutes.is_finite());
        let next = match action {
            Some(StepAction::Increment) => typed.unwrap_or(current) + 1.0,
            Some(StepAction::Decrement) => typed.unwrap_or(current) - 1.0,
            None => typed.unwrap_or(current),
        };
        let minutes = self.model.set_interval(next);
        self.shuffle_ui.interval.update(cx, |state, cx| {
            let text = minutes.to_string();
            if state.value().as_ref() != text {
                state.set_value(text, window, cx);
            }
        });
        if minutes != current {
            self.shuffle_changed(format!("The visual changes every {minutes} minutes."), window, cx);
        }
    }

    fn entry_name(&self, entry: &RotationEntry) -> String {
        format!("{}, {}", self.model.entry_title(entry), self.model.entry_detail(entry).to_lowercase())
    }

    pub(crate) fn shuffle_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let model = &self.model;
        let rotation = &model.config.rotation;
        let entries: Vec<_> = rotation.entries.iter().enumerate().collect();
        let count = entries.len();
        let last = count.saturating_sub(1);
        v_flex()
            .gap_3()
            .flex_none()
            .child(
                h_flex()
                    .justify_between()
                    .child(label("SHUFFLE LIST"))
                    .child(div().text_xs().text_color(rgb(MUTED)).child(format!("{count} {}", if count == 1 { "look" } else { "looks" }))),
            )
            .child(note("Click a look to load it in Visuals. Remove only takes it out of shuffle."))
            .when(count == 0, |this| this.child(note("Choose a visual, then add its current edits or a saved look.")))
            .children(entries.into_iter().map(|(index, entry)| {
                let status = model.entry_status(entry);
                let title = model.entry_title(entry);
                let detail = model.entry_detail(entry);
                let name = format!("{title}, {}", detail.to_lowercase());
                let handles = self.shuffle_ui.focus.get(index);
                let mut load = Button::new(("shuffle-load", index))
                    .small()
                    .ghost()
                    .w_full()
                    .disabled(status != EntryStatus::Playable)
                    .accessibility_label(format!("Load {name}"));
                let (mut up, mut down, mut remove) = (
                    button(("shuffle-up", index), "↑").ghost().disabled(index == 0).accessibility_label(format!("Move {name} up")),
                    button(("shuffle-down", index), "↓").ghost().disabled(index == last).accessibility_label(format!("Move {name} down")),
                    button(("shuffle-remove", index), "Remove").ghost().accessibility_label(format!("Remove {name} from shuffle")),
                );
                if let Some(handles) = handles {
                    load = load.track_focus(&handles[LOAD]);
                    up = up.track_focus(&handles[UP]);
                    down = down.track_focus(&handles[DOWN]);
                    remove = remove.track_focus(&handles[REMOVE]);
                }
                let problem = status != EntryStatus::Playable;
                h_flex()
                    .id(("shuffle-row", index))
                    .flex_none()
                    .gap_1()
                    .p_1()
                    .rounded(px(5.))
                    .border_1()
                    .border_color(rgb(LINE))
                    .child(
                        div().flex_1().min_w_0().child(
                            load.child(
                                v_flex().w_full().items_start().child(div().w_full().overflow_hidden().text_ellipsis().child(title)).child(
                                    div()
                                        .w_full()
                                        .overflow_hidden()
                                        .text_ellipsis()
                                        .text_xs()
                                        .text_color(rgb(if problem { SIGNAL_HOVER } else { MUTED }))
                                        .child(detail),
                                ),
                            )
                            .on_click(cx.listener(move |this, _, window, cx| this.load_shuffle_entry(index, window, cx))),
                        ),
                    )
                    .child(up.on_click(cx.listener(move |this, _, window, cx| this.move_shuffle_entry(index, true, window, cx))))
                    .child(down.on_click(cx.listener(move |this, _, window, cx| this.move_shuffle_entry(index, false, window, cx))))
                    .child(remove.on_click(cx.listener(move |this, _, window, cx| this.remove_shuffle_entry(index, window, cx))))
            }))
            .child(
                v_flex()
                    .gap_3()
                    .pt_3()
                    .border_t_1()
                    .border_color(rgb(LINE))
                    .child(label("TIMING"))
                    .child(
                        Switch::new("shuffle-enabled")
                            .small()
                            .label("Shuffle when the screensaver starts")
                            .checked(rotation.enabled)
                            .accessibility_label("Shuffle when the screensaver starts")
                            .on_change(cx.listener(|this, value, window, cx| this.set_shuffle_enabled(*value, window, cx))),
                    )
                    .child(
                        Switch::new("shuffle-cycle")
                            .small()
                            .label("Also change while it runs")
                            .checked(model.cycling())
                            .disabled(!rotation.enabled)
                            .accessibility_label("Also change while the screensaver runs")
                            .on_change(cx.listener(|this, value, window, cx| this.set_cycling(*value, window, cx))),
                    )
                    .child(
                        h_flex()
                            .gap_2()
                            .items_center()
                            .child(div().child("Change every"))
                            .child(
                                div().w(px(106.)).child(
                                    NumberInput::new(&self.shuffle_ui.interval)
                                        .small()
                                        .disabled(!rotation.enabled || !model.cycling())
                                        .accessibility_label("Minutes between changes"),
                                ),
                            )
                            .child(div().child("minutes"))
                            .child(div().text_xs().text_color(rgb(MUTED)).child(format!("{MIN_INTERVAL_MINUTES}–{MAX_INTERVAL_MINUTES}"))),
                    )
                    .child(status("looks-status-8").text_color(rgb(MUTED)).child(model.rotation_summary()))
                    .children(
                        self.shuffle_ui
                            .message
                            .clone()
                            .map(|message| status("looks-status-9").text_xs().text_color(rgb(MUTED)).child(message)),
                    ),
            )
    }

    /// The selected visual's saved looks: create, apply, rename, delete, and shuffle membership.
    pub(crate) fn looks_workspace(&self, cx: &Context<Self>) -> impl IntoElement + use<> {
        let confirm = match &self.look_action {
            Some(LookAction::Delete(name)) => Some(format!("Delete “{name}”? This also removes any shuffle entry for this look.")),
            Some(LookAction::Overwrite(name)) => Some(format!("Update “{name}” with the current edits?")),
            _ => None,
        };
        let confirming = confirm.is_some();
        let submit = match &self.look_action {
            Some(LookAction::Delete(_)) => "Delete look",
            Some(LookAction::Overwrite(_)) => "Update look",
            Some(LookAction::Rename(_)) => "Save name",
            None => "Save look",
        };
        let shader = self.model.visual().id.clone();
        let current_included = self.model.rotation_has(&shader, None);
        let rows: Vec<_> = self.model.looks().cloned().collect();
        let current_shader = shader.clone();
        v_flex()
            .id("looks")
            .gap_4()
            .flex_none()
            .on_action(cx.listener(|this, _: &Escape, window, cx| {
                this.cancel_look(window, cx);
                this.look_name.update(cx, |state, cx| state.focus(window, cx));
            }))
            .child(label("SAVED LOOKS"))
            .child(note(format!(
                "For {}. Looks save its adjustments; color schemes follow your current choice.",
                self.model.visual().title
            )))
            .child(
                h_flex()
                    .gap_2()
                    .justify_between()
                    .p_2()
                    .rounded(px(5.))
                    .border_1()
                    .border_color(rgb(LINE))
                    .child(
                        v_flex()
                            .child(div().font_weight(FontWeight::MEDIUM).child("Current edits"))
                            .child(note("Follows the adjustments you make to this visual.")),
                    )
                    .child(
                        button("current-shuffle", if current_included { "Remove from shuffle" } else { "Add to shuffle" })
                            .toggled(current_included)
                            .accessibility_label(format!(
                                "{} current edits {} shuffle",
                                if current_included { "Remove" } else { "Add" },
                                if current_included { "from" } else { "to" }
                            ))
                            .on_click(cx.listener(move |this, _, window, cx| this.toggle_shuffle_entry(&current_shader, None, window, cx))),
                    ),
            )
            .child(
                v_flex()
                    .gap_2()
                    .children(confirm.map(note))
                    .when(!confirming, |this| this.child(Input::new(&self.look_name).small().aria_label("Look name")))
                    .child(
                        h_flex()
                            .gap_2()
                            .child(
                                button("save-look", submit)
                                    .track_focus(&self.look_confirm_focus)
                                    .on_click(cx.listener(|this, _, window, cx| this.submit_look(window, cx))),
                            )
                            .when(self.look_action.is_some(), |this| {
                                this.child(button("cancel-look", "Cancel").ghost().on_click(cx.listener(|this, _, window, cx| {
                                    this.cancel_look(window, cx);
                                    this.look_name.update(cx, |state, cx| state.focus(window, cx));
                                })))
                            }),
                    )
                    .children(
                        self.look_message
                            .clone()
                            .map(|message| status("looks-status-10").text_size(px(13.)).text_color(rgb(MUTED)).child(message)),
                    ),
            )
            .when(rows.is_empty(), |this| this.child(note("Adjust this visual, then save a look to keep those settings.")))
            .children(rows.into_iter().map(|name| {
                let apply = name.clone();
                let rename = name.clone();
                let delete = name.clone();
                let shuffle = name.clone();
                let shader = shader.clone();
                let included = self.model.rotation_has(&shader, Some(&name));
                let key = SharedString::from(name.clone());
                v_flex()
                    .flex_none()
                    .gap_2()
                    .pt_2()
                    .border_t_1()
                    .border_color(rgb(LINE))
                    .child(div().font_weight(FontWeight::MEDIUM).child(name.clone()))
                    .child(
                        h_flex()
                            .flex_wrap()
                            .gap_2()
                            .child(
                                button((ElementId::from("apply"), key.clone()), "Apply")
                                    .accessibility_label(format!("Apply {name} to current edits"))
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        if this.model.apply_look(&apply) {
                                            this.finish_bulk_edit(window, cx);
                                        }
                                        this.look_message =
                                            Some(format!("Applied “{apply}” to current edits. The saved look stays unchanged."));
                                        cx.notify();
                                    })),
                            )
                            .child(
                                button(
                                    (ElementId::from("look-shuffle"), key.clone()),
                                    if included { "Remove from shuffle" } else { "Add to shuffle" },
                                )
                                .toggled(included)
                                .accessibility_label(format!(
                                    "{} {name} {} shuffle",
                                    if included { "Remove" } else { "Add" },
                                    if included { "from" } else { "to" }
                                ))
                                .on_click(
                                    cx.listener(move |this, _, window, cx| this.toggle_shuffle_entry(&shader, Some(&shuffle), window, cx)),
                                ),
                            )
                            .child(button((ElementId::from("rename"), key.clone()), "Rename").ghost().on_click(cx.listener(
                                move |this, _, window, cx| {
                                    this.start_look_action(LookAction::Rename(rename.clone()), window, cx);
                                    this.inspector_scroll.set_offset(point(px(0.), px(0.)));
                                },
                            )))
                            .child(button((ElementId::from("delete"), key), "Delete").ghost().on_click(cx.listener(
                                move |this, _, window, cx| {
                                    this.start_look_action(LookAction::Delete(delete.clone()), window, cx);
                                    this.inspector_scroll.set_offset(point(px(0.), px(0.)));
                                },
                            ))),
                    )
            }))
    }
}

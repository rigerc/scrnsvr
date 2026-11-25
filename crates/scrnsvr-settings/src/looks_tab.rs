//! Looks and shuffle: the look bar at the top of the visual editor, and the Shuffle tab with the
//! shuffle set and its timing.

use gpui_kit::component::button::{Button, ButtonCustomVariant, ButtonVariants};
use gpui_kit::component::input::{Escape, Input, InputEvent, InputState, NumberInput, NumberInputEvent, StepAction};
use gpui_kit::component::switch::Switch;
use gpui_kit::component::{Disableable, Icon, IconName, Selectable, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use scrnsvr_core::config::RotationEntry;

use crate::app::{LookAction, Settings, Tab};
use crate::model::Model;
use crate::model::rotation::{MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES};
use crate::view::{
    ALERT, BLUE, INK, LINE, MUTED, QUIET, RAISED, SIGNAL, SURFACE, action, button, dot, glyph, icon_button, label, live, mark, notice,
};

/// Each shuffle entry keeps focus handles for its move and remove actions through list edits.
const UP: usize = 0;
const DOWN: usize = 1;
const REMOVE: usize = 2;

pub struct ShuffleUi {
    pub interval: Entity<InputState>,
    focus: Vec<[FocusHandle; 3]>,
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
            self.focus.push([cx.focus_handle(), cx.focus_handle(), cx.focus_handle()]);
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
        let was_empty = self.model.config.rotation.entries.is_empty();
        let included = self.model.rotation_toggle(shader, preset);
        let title = self.visual_title(shader);
        let what = preset.map_or_else(|| format!("{title}, current edits"), |name| format!("{title}, {name}"));
        let message = if included { format!("Added {what} to shuffle.") } else { format!("Removed {what} from shuffle.") };
        let message = self.start_shuffling(was_empty, message);
        self.shuffle_changed(message, window, cx);
    }

    /// The membership a library tick or the preview's toggle changes: a visual not in the set
    /// joins with its current edits, and one that is in it leaves with all of its entries.
    pub fn toggle_shuffle_visual(&mut self, shader: &str, window: &mut Window, cx: &mut Context<Self>) {
        let title = self.visual_title(shader);
        let message = if self.model.rotation_includes_visual(shader) {
            let removed = self.model.rotation_remove_visual(shader);
            if removed == 1 {
                format!("Removed {title} from shuffle.")
            } else {
                format!("Removed {title} and its {removed} entries from shuffle.")
            }
        } else {
            let was_empty = self.model.config.rotation.entries.is_empty();
            self.model.rotation_toggle(shader, None);
            self.start_shuffling(was_empty, format!("Added {title} to shuffle."))
        };
        self.shuffle_changed(message, window, cx);
    }

    /// Add the current edits of every favorite that is not in the set yet.
    pub fn add_favorites_to_shuffle(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let missing: Vec<String> = self
            .model
            .visuals
            .iter()
            .filter(|visual| self.model.ui.favorites.contains(&visual.id) && !self.model.rotation_includes_visual(&visual.id))
            .map(|visual| visual.id.clone())
            .collect();
        if missing.is_empty() {
            self.shuffle_ui.message = Some("Every favorite is already in shuffle.".into());
            cx.notify();
            return;
        }
        let was_empty = self.model.config.rotation.entries.is_empty();
        for shader in &missing {
            self.model.rotation_toggle(shader, None);
        }
        let count = missing.len();
        let message =
            self.start_shuffling(was_empty, format!("Added {count} {} to shuffle.", if count == 1 { "favorite" } else { "favorites" }));
        self.shuffle_changed(message, window, cx);
    }

    pub fn clear_shuffle(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.model.rotation_clear() {
            self.shuffle_changed("Cleared the shuffle set. Shuffle is off.", window, cx);
        }
    }

    /// A set that was empty and has just gained entries starts shuffling, so ticking a visual
    /// does what it looks like it does. Later edits leave the switch alone.
    fn start_shuffling(&mut self, was_empty: bool, message: String) -> String {
        if was_empty && !self.model.config.rotation.entries.is_empty() && !self.model.config.rotation.enabled {
            self.model.set_rotation_enabled(true);
            format!("{message} Shuffle is on.")
        } else {
            message
        }
    }

    fn visual_title(&self, shader: &str) -> String {
        self.model.visual_index(shader).map_or_else(|| shader.to_owned(), |index| self.model.visuals[index].title.clone())
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

    /// The shuffle set: whether and how often the screensaver shuffles, and which visuals and
    /// looks it picks from. Entries are grouped by visual; each look is a chip that ticks in and out.
    pub(crate) fn shuffle_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let model = &self.model;
        let rotation = &model.config.rotation;
        let count = rotation.entries.len();
        let favorites_missing =
            model.visuals.iter().any(|visual| model.ui.favorites.contains(&visual.id) && !model.rotation_includes_visual(&visual.id));
        let timing = v_flex()
            .gap_3()
            .p_4()
            .rounded(px(10.))
            .bg(rgb(RAISED))
            .child(
                h_flex()
                    .gap_3()
                    .items_center()
                    .justify_between()
                    .child(
                        v_flex()
                            .gap_1()
                            .child(div().font_weight(FontWeight::MEDIUM).child("Shuffle when the screensaver starts"))
                            .child(live("looks-status-8", model.rotation_summary()).text_size(px(12.)).text_color(rgb(QUIET))),
                    )
                    .child(
                        Switch::new("shuffle-enabled")
                            .checked(rotation.enabled)
                            .disabled(count == 0 && !rotation.enabled)
                            .accessibility_label("Shuffle when the screensaver starts")
                            .on_change(cx.listener(|this, value, window, cx| this.set_shuffle_enabled(*value, window, cx))),
                    ),
            )
            .child(
                h_flex()
                    .gap_3()
                    .flex_wrap()
                    .items_center()
                    .pt_3()
                    .border_t_1()
                    .border_color(rgb(LINE))
                    .child(
                        Switch::new("shuffle-cycle")
                            .label("Also change while it runs")
                            .checked(model.cycling())
                            .disabled(!rotation.enabled)
                            .accessibility_label("Also change while the screensaver runs")
                            .on_change(cx.listener(|this, value, window, cx| this.set_cycling(*value, window, cx))),
                    )
                    .child(div().flex_1())
                    .child(
                        h_flex()
                            .gap_2()
                            .items_center()
                            .when(!rotation.enabled || !model.cycling(), |this| this.opacity(0.55))
                            .child(div().text_color(rgb(MUTED)).child("every"))
                            .child(
                                div().w(px(110.)).child(
                                    NumberInput::new(&self.shuffle_ui.interval)
                                        .small()
                                        .disabled(!rotation.enabled || !model.cycling())
                                        .accessibility_label("Minutes between changes"),
                                ),
                            )
                            .child(div().text_color(rgb(MUTED)).child("min"))
                            .child(
                                div()
                                    .text_size(px(11.))
                                    .text_color(rgb(QUIET))
                                    .child(format!("{MIN_INTERVAL_MINUTES}–{MAX_INTERVAL_MINUTES}")),
                            ),
                    ),
            );
        let heading = h_flex()
            .gap_2()
            .items_center()
            .child(label("SHUFFLE SET"))
            .child(
                div().text_size(px(11.)).text_color(rgb(QUIET)).child(format!("{count} {}", if count == 1 { "entry" } else { "entries" })),
            )
            .child(div().flex_1().h(px(1.)).bg(rgb(LINE)))
            .child(
                action("shuffle-favorites", "star", "Add favorites")
                    .ghost()
                    .disabled(!favorites_missing)
                    .tooltip("Add the current edits of every favorite")
                    .on_click(cx.listener(|this, _, window, cx| this.add_favorites_to_shuffle(window, cx))),
            )
            .child(
                action("shuffle-clear", "trash", "Clear")
                    .ghost()
                    .disabled(count == 0)
                    .accessibility_label("Clear the shuffle set")
                    .on_click(cx.listener(|this, _, window, cx| this.clear_shuffle(window, cx))),
            );
        let set = v_flex()
            .gap_3()
            .child(heading)
            .child(div().text_size(px(12.)).text_color(rgb(QUIET)).child(
                "The screensaver picks one entry at random. Tick visuals in the library, or use Add to shuffle beside the preview. A visual can join with its current edits, any of its saved looks, or both.",
            ))
            .when(count == 0, |this| {
                this.child(
                    v_flex()
                        .gap_3()
                        .items_center()
                        .py_8()
                        .px_4()
                        .rounded(px(10.))
                        .border_1()
                        .border_color(rgb(LINE))
                        .child(glyph("shuffle").size(px(24.)).text_color(rgb(QUIET)))
                        .child(div().font_weight(FontWeight::MEDIUM).child("The shuffle set is empty"))
                        .child(
                            div()
                                .text_center()
                                .text_size(px(13.))
                                .text_color(rgb(MUTED))
                                .child("Tick visuals in the library to add them. Shuffle turns on with the first one."),
                        ),
                )
            })
            .children(model.rotation_visuals().into_iter().map(|shader| self.shuffle_card(shader, cx)));
        v_flex()
            .gap_5()
            .flex_none()
            .child(timing)
            .child(set)
            .children(self.shuffle_ui.message.clone().map(|message| live("looks-status-9", message).text_xs().text_color(rgb(MUTED))))
    }

    /// One visual in the shuffle set: its thumbnail and title (which open it), a chip for its
    /// current edits and one for each saved look, and a button that takes the whole visual out.
    fn shuffle_card(&self, shader: String, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let model = &self.model;
        let index = model.visual_index(&shader);
        let key = SharedString::from(shader.clone());
        let title = index.map_or_else(|| shader.clone(), |index| model.visuals[index].title.clone());
        let looks: Vec<String> = model.config.presets.get(&shader).map(|looks| looks.keys().cloned().collect()).unwrap_or_default();
        // Entries naming a look that no longer exists stay visible so they can be removed.
        let missing: Vec<(usize, String)> = model
            .config
            .rotation
            .entries
            .iter()
            .enumerate()
            .filter(|(_, entry)| entry.shader == shader && entry.preset.as_ref().is_some_and(|name| !looks.contains(name)))
            .filter_map(|(position, entry)| entry.preset.clone().map(|name| (position, name)))
            .collect();
        let chip = |id: ElementId, text: String, included: bool, spoken: String| {
            Button::new(id)
                .small()
                .when(included, |this| this.info())
                .when(!included, |this| this.outline())
                .when(included, |this| this.icon(Icon::new(IconName::Check)))
                .label(text)
                .toggled(included)
                .accessibility_label(spoken)
        };
        let picture = match index.and_then(|index| self.thumbnails.image(&model.visuals[index].id)) {
            Some(path) => img(path.to_path_buf()).size_full().object_fit(ObjectFit::Cover).into_any_element(),
            None => div().size_full().flex().items_center().justify_center().child(mark(28., 0.14)).into_any_element(),
        };
        let current = model.rotation_has(&shader, None);
        let remove_shader = shader.clone();
        let current_shader = shader.clone();
        h_flex()
            .id((ElementId::from("shuffle-card"), key.clone()))
            .flex_none()
            .gap_3()
            .items_start()
            .p_2()
            .rounded(px(10.))
            .border_1()
            .border_color(rgb(LINE))
            .bg(rgb(SURFACE))
            .child(
                Button::new((ElementId::from("shuffle-open"), key.clone()))
                    .ghost()
                    .p_0()
                    .w(px(112.))
                    .h(px(63.))
                    .flex_none()
                    .rounded(px(6.))
                    .overflow_hidden()
                    .child(picture)
                    .disabled(index.is_none())
                    .accessibility_label(format!("Open {title}"))
                    .tooltip("Open it in Visuals")
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if let Some(index) = index {
                            this.select(index, window, cx);
                            this.show_tab(Tab::Visuals, window, cx);
                        }
                    })),
            )
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap_2()
                    .pt_1()
                    .child(div().overflow_hidden().text_ellipsis().whitespace_nowrap().font_weight(FontWeight::MEDIUM).child(title.clone()))
                    .when(index.is_none(), |this| {
                        this.child(notice(
                            (ElementId::from("shuffle-unknown"), key.clone()),
                            "This visual is no longer available, so the screensaver skips it.",
                            ALERT,
                        ))
                    })
                    .child(
                        h_flex()
                            .flex_wrap()
                            .gap_1()
                            .when(index.is_some(), |this| {
                                this.child(
                                    chip(
                                        (ElementId::from("shuffle-current"), key.clone()).into(),
                                        "Current edits".into(),
                                        current,
                                        format!(
                                            "{} {title}, current edits, {} shuffle",
                                            if current { "Remove" } else { "Add" },
                                            if current { "from" } else { "to" }
                                        ),
                                    )
                                    .on_click(
                                        cx.listener(move |this, _, window, cx| {
                                            this.toggle_shuffle_entry(&current_shader, None, window, cx)
                                        }),
                                    ),
                                )
                            })
                            .children(looks.into_iter().map(|name| {
                                let included = model.rotation_has(&shader, Some(&name));
                                let (look_shader, look_name) = (shader.clone(), name.clone());
                                chip(
                                    (ElementId::from("shuffle-look"), SharedString::from(format!("{shader}/{name}"))).into(),
                                    name.clone(),
                                    included,
                                    format!(
                                        "{} {title}, {name}, {} shuffle",
                                        if included { "Remove" } else { "Add" },
                                        if included { "from" } else { "to" }
                                    ),
                                )
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    this.toggle_shuffle_entry(&look_shader, Some(&look_name), window, cx)
                                }))
                            }))
                            .children(missing.into_iter().map(|(position, name)| {
                                Button::new((ElementId::from("shuffle-missing"), SharedString::from(format!("{shader}/{name}"))))
                                    .small()
                                    .danger()
                                    .icon(Icon::new(IconName::Close))
                                    .label(format!("{name} (deleted)"))
                                    .tooltip("This look was deleted, so the screensaver skips it. Remove the entry.")
                                    .accessibility_label(format!("Remove the missing look {name} from shuffle"))
                                    .on_click(cx.listener(move |this, _, window, cx| this.remove_shuffle_entry(position, window, cx)))
                            })),
                    ),
            )
            .child(
                icon_button((ElementId::from("shuffle-remove-visual"), key), "close", format!("Remove {title} from shuffle"))
                    .on_click(cx.listener(move |this, _, window, cx| this.toggle_shuffle_visual(&remove_shader, window, cx))),
            )
    }

    /// A shuffle membership toggle: blue and checked while included.
    fn shuffle_toggle(id: impl Into<ElementId>, included: bool, spoken: String) -> Button {
        Button::new(id)
            .small()
            .when(included, |this| this.info())
            .when(!included, |this| this.outline())
            .icon(if included { glyph("check") } else { glyph("shuffle") })
            .label(if included { "In shuffle" } else { "Add to shuffle" })
            .toggled(included)
            .tooltip(if included { "Take it out of shuffle" } else { "Let the screensaver shuffle to it" })
            .accessibility_label(spoken)
    }

    /// The looks of the selected visual, at the top of its editor: current edits and each saved
    /// look as chips (the open one is edited in place and shown in the preview), saving a new
    /// look, renaming or deleting the open one, and its shuffle membership.
    pub(crate) fn look_bar(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let shader = self.model.visual().id.clone();
        let active = self.model.look.clone();
        let looks: Vec<String> = self.model.looks().cloned().collect();
        let target = active.as_deref().map_or_else(|| "current edits".to_owned(), |name| format!("“{name}”"));
        let included = self.model.rotation_has(&shader, active.as_deref());
        let chip = |id: ElementId, text: String, current: bool, shuffled: bool, tooltip: String| {
            Button::new(id)
                .small()
                .outline()
                .when(current, |this| {
                    this.custom(
                        ButtonCustomVariant::new(cx)
                            .color(rgba(0x23d5ab1f).into())
                            .foreground(rgb(INK).into())
                            .hover(rgba(0x23d5ab33).into())
                            .active(rgba(0x23d5ab33).into()),
                    )
                })
                .child(
                    h_flex()
                        .gap(px(6.))
                        .items_center()
                        .when(current, |this| this.child(dot(SIGNAL, 6.)))
                        .child(div().text_color(rgb(if current { INK } else { MUTED })).child(text))
                        .when(shuffled, |this| this.child(glyph("shuffle").size(px(12.)).text_color(rgb(BLUE)))),
                )
                .selected(current)
                .toggled(current)
                .tooltip(tooltip)
        };
        let chips = h_flex()
            .flex_wrap()
            .gap_2()
            .child(
                chip(
                    "look-current".into(),
                    "Current edits".into(),
                    active.is_none(),
                    self.model.rotation_has(&shader, None),
                    "The visual's working settings".into(),
                )
                .accessibility_label("Edit current edits")
                .on_click(cx.listener(|this, _, window, cx| this.open_look(None, window, cx))),
            )
            .children(looks.iter().map(|name| {
                let open = name.clone();
                chip(
                    (ElementId::from("look-chip"), SharedString::from(name.clone())).into(),
                    name.clone(),
                    active.as_deref() == Some(name.as_str()),
                    self.model.rotation_has(&shader, Some(name)),
                    format!("Edit “{name}” in place"),
                )
                .accessibility_label(format!("Edit look {name}"))
                .on_click(cx.listener(move |this, _, window, cx| this.open_look(Some(&open), window, cx)))
            }))
            .child(
                action("new-look", "plus", "Save as look")
                    .ghost()
                    .tooltip("Keep these parameters and effects as a new look")
                    .on_click(cx.listener(|this, _, window, cx| this.start_look_action(LookAction::New, window, cx))),
            );
        let naming = matches!(self.look_action, Some(LookAction::New | LookAction::Rename(_)));
        let confirm = match &self.look_action {
            Some(LookAction::Delete(name)) => Some((format!("Delete “{name}”? Its effects and any shuffle entry go with it."), true)),
            Some(LookAction::Overwrite(name)) => Some((format!("A look called “{name}” exists. Replace it with {target}?"), false)),
            _ => None,
        };
        let cancel = || {
            button("cancel-look", "Cancel").ghost().on_click(cx.listener(|this, _, window, cx| {
                this.cancel_look(window, cx);
            }))
        };
        let footer = if naming {
            h_flex()
                .gap_2()
                .child(div().flex_1().min_w_0().child(Input::new(&self.look_name).small().aria_label("Look name")))
                .child(
                    Button::new("save-look")
                        .small()
                        .primary()
                        .icon(glyph("bookmark"))
                        .label(if matches!(self.look_action, Some(LookAction::Rename(_))) { "Rename" } else { "Save look" })
                        .track_focus(&self.look_confirm_focus)
                        .on_click(cx.listener(|this, _, window, cx| this.submit_look(window, cx))),
                )
                .child(cancel())
                .into_any_element()
        } else if let Some((text, deleting)) = confirm {
            h_flex()
                .gap_2()
                .flex_wrap()
                .items_center()
                .child(div().flex_1().min_w(px(200.)).child(notice("look-confirm", text, if deleting { ALERT } else { BLUE })))
                .child(
                    Button::new("save-look")
                        .small()
                        .when(deleting, |this| this.danger().icon(glyph("trash")).label("Delete look"))
                        .when(!deleting, |this| this.primary().label("Replace"))
                        .track_focus(&self.look_confirm_focus)
                        .on_click(cx.listener(|this, _, window, cx| this.submit_look(window, cx))),
                )
                .child(cancel())
                .into_any_element()
        } else {
            let (rename, delete) = (active.clone(), active.clone());
            let toggle_shader = shader.clone();
            let toggle_look = active.clone();
            h_flex()
                .gap_2()
                .items_center()
                .flex_wrap()
                .child(div().flex_1().min_w(px(180.)).text_size(px(12.)).text_color(rgb(QUIET)).child(match &active {
                    Some(name) => format!("Editing “{name}”. Parameters and effects save to this look."),
                    None => "Editing current edits. Parameters and effects save on their own.".to_owned(),
                }))
                .when_some(rename, |this, name| {
                    let delete = delete.expect("same look");
                    this.child(icon_button("rename-look", "pencil", format!("Rename {name}")).on_click(
                        cx.listener(move |this, _, window, cx| this.start_look_action(LookAction::Rename(name.clone()), window, cx)),
                    ))
                    .child(icon_button("delete-look", "trash", format!("Delete {delete}")).on_click(
                        cx.listener(move |this, _, window, cx| this.start_look_action(LookAction::Delete(delete.clone()), window, cx)),
                    ))
                })
                .child(
                    Self::shuffle_toggle(
                        "look-shuffle",
                        included,
                        format!("{} {target} {} shuffle", if included { "Remove" } else { "Add" }, if included { "from" } else { "to" }),
                    )
                    .on_click(
                        cx.listener(move |this, _, window, cx| {
                            this.toggle_shuffle_entry(&toggle_shader, toggle_look.as_deref(), window, cx)
                        }),
                    ),
                )
                .into_any_element()
        };
        v_flex()
            .id("looks")
            .gap_3()
            .p_3()
            .rounded(px(10.))
            .bg(rgb(RAISED))
            .flex_none()
            .on_action(cx.listener(|this, _: &Escape, window, cx| this.cancel_look(window, cx)))
            .child(
                h_flex()
                    .gap_2()
                    .items_center()
                    .child(label("LOOKS"))
                    .child(div().text_size(px(11.)).text_color(rgb(QUIET)).child((looks.len() + 1).to_string()))
                    .child(div().flex_1().h(px(1.)).bg(rgb(LINE))),
            )
            .child(chips)
            .child(footer)
            .children(self.look_message.clone().map(|message| live("looks-status-10", message).text_size(px(12.)).text_color(rgb(MUTED))))
    }
}

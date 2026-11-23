//! Effects tab: the global ordered effect stack.
//!
//! The stack belongs to the whole configuration, not to a visual, so choosing visuals or looks
//! never changes it. Layers are identified by a stable ID, which keeps their controls, focus and
//! expanded state through reordering, and keeps the preview's per-layer history attached.

use std::collections::{BTreeMap, BTreeSet};

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::Escape;
use gpui_kit::component::searchable_list::{SearchableListItem, SearchableVec};
use gpui_kit::component::select::{Select, SelectEvent, SelectState};
use gpui_kit::component::switch::Switch;
use gpui_kit::component::{Disableable, IndexPath, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use scrnsvr_core::catalog::ShaderValues;
use scrnsvr_core::config::MAX_EFFECT_LAYERS;

use crate::app::Settings;
use crate::controls::{Control, Target};
use crate::model::{self, Model, effects};
use crate::view::{LINE, MUTED, QUIET, SIGNAL_HOVER, SURFACE, button, label, note, status};

#[derive(Clone)]
pub struct EffectItem {
    id: String,
    title: SharedString,
}

impl SearchableListItem for EffectItem {
    type Value = String;

    fn title(&self) -> SharedString {
        self.title.clone()
    }

    fn value(&self) -> &String {
        &self.id
    }
}

pub type EffectChoice = SelectState<SearchableVec<EffectItem>>;

pub struct EffectsUi {
    pub choice: Entity<EffectChoice>,
    /// The catalog effect the Add button appends.
    pub chosen: String,
    /// Controls by layer ID. Layers of unavailable effects have none.
    pub controls: BTreeMap<String, Vec<Control>>,
    pub expanded: BTreeSet<String>,
    pub focus: BTreeMap<String, FocusHandle>,
    pub add_focus: FocusHandle,
    /// What the last list edit did, announced to assistive technology.
    pub message: Option<String>,
    _subscription: Subscription,
}

impl EffectsUi {
    pub fn new(model: &Model, window: &mut Window, cx: &mut Context<Settings>) -> Self {
        let items: Vec<_> =
            effects::catalog().iter().map(|def| EffectItem { id: def.id.clone(), title: def.title.clone().into() }).collect();
        let chosen = items[0].id.clone();
        let choice = cx.new(|cx| SelectState::new(SearchableVec::new(items), Some(IndexPath::new(0)), window, cx).searchable(true));
        let subscription = cx.subscribe_in(&choice, window, |this, _, event: &SelectEvent<SearchableVec<EffectItem>>, _, cx| {
            if let SelectEvent::Confirm(Some(id)) = event {
                this.effects_ui.chosen = id.clone();
                cx.notify();
            }
        });
        let mut ui = Self {
            choice,
            chosen,
            controls: BTreeMap::new(),
            expanded: BTreeSet::new(),
            focus: BTreeMap::new(),
            add_focus: cx.focus_handle(),
            message: None,
            _subscription: subscription,
        };
        for layer in &model.config.effects.layers {
            ui.build_layer(model, &layer.id, window, cx);
        }
        ui
    }

    fn build_layer(&mut self, model: &Model, id: &str, window: &mut Window, cx: &mut Context<Settings>) {
        self.focus.entry(id.into()).or_insert_with(|| cx.focus_handle());
        let Some(layer) = model.effect_index(id).map(|index| &model.config.effects.layers[index]) else { return };
        let Some(def) = model.effect_def(layer) else { return };
        let values = model.effective_effect(id);
        let controls = def
            .uniforms
            .iter()
            .map(|uniform| Control::new(uniform, Target::Effect(id.into()), &values[&uniform.name], window, cx))
            .collect();
        self.controls.insert(id.into(), controls);
    }

    fn forget_layer(&mut self, id: &str) {
        self.controls.remove(id);
        self.expanded.remove(id);
        self.focus.remove(id);
    }
}

impl Settings {
    pub fn add_effect(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let chosen = self.effects_ui.chosen.clone();
        match self.model.add_effect(&chosen) {
            Ok(index) => {
                let id = self.model.config.effects.layers[index].id.clone();
                self.effects_ui.build_layer(&self.model, &id, window, cx);
                self.effects_ui.expanded.insert(id.clone());
                self.effects_ui.message = Some(format!("Added {}.", self.model.effect_label(index)));
                self.stack_changed(window, cx);
                if let Some(focus) = self.effects_ui.focus.get(&id) {
                    focus.focus(window, cx);
                }
            }
            Err(error) => self.effects_ui.message = Some(error.message().into()),
        }
        cx.notify();
    }

    pub fn remove_effect(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let label = self.model.effect_title(index);
        let Some(layer) = self.model.remove_effect(index) else { return };
        self.effects_ui.forget_layer(&layer.id);
        let remaining = self.model.config.effects.layers.len();
        self.effects_ui.message =
            Some(format!("Removed {label}. {remaining} {} remaining.", if remaining == 1 { "layer" } else { "layers" }));
        self.stack_changed(window, cx);
        // Keep focus in the list: the layer that took this one's place, else the Add button.
        let next = self
            .model
            .config
            .effects
            .layers
            .get(index.min(remaining.saturating_sub(1)))
            .and_then(|layer| self.effects_ui.focus.get(&layer.id));
        match next {
            Some(focus) => focus.focus(window, cx),
            None => self.effects_ui.add_focus.focus(window, cx),
        }
        cx.notify();
    }

    pub fn move_effect(&mut self, index: usize, up: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.model.config.effects.layers.get(index).map(|layer| layer.id.clone()) else { return };
        let title = self.model.effect_title(index);
        let Some(target) = self.model.move_effect(index, up) else { return };
        self.effects_ui.message = Some(format!("Moved {title} to layer {}.", target + 1));
        self.stack_changed(window, cx);
        if let Some(focus) = self.effects_ui.focus.get(&id) {
            focus.focus(window, cx);
        }
        cx.notify();
    }

    pub fn set_effect_enabled(&mut self, index: usize, enabled: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.model.set_effect_enabled(index, enabled) {
            self.stack_changed(window, cx);
        }
    }

    pub fn set_effects_enabled(&mut self, enabled: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.model.set_effects_enabled(enabled) {
            self.effects_ui.message = Some(if enabled { "Effects are on." } else { "Effects are off. Your layers are kept." }.into());
            self.stack_changed(window, cx);
        }
    }

    pub fn reset_effect(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.model.config.effects.layers.get(index).map(|layer| layer.id.clone()) else { return };
        if self.model.reset_effect(&id) {
            let values = self.model.effective_effect(&id);
            for control in self.effects_ui.controls.get(&id).into_iter().flatten() {
                control.sync(&values[&control.def.name], window, cx);
            }
            self.effects_ui.message = Some(format!("Reset {} controls.", self.model.effect_label(index)));
            self.stack_changed(window, cx);
            if let Some(focus) = self.effects_ui.focus.get(&id) {
                focus.focus(window, cx);
            }
        }
        cx.notify();
    }

    pub fn toggle_effect_expanded(&mut self, id: &str, cx: &mut Context<Self>) {
        if !self.effects_ui.expanded.remove(id) {
            self.effects_ui.expanded.insert(id.into());
        }
        cx.notify();
    }

    fn stack_changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.update_scene();
        self.config_changed(window, cx);
    }

    /// Problems with the stack worth showing beside the preview, separate from save status.
    pub fn effect_warnings(&self) -> Vec<String> {
        let skipped = self.preview.as_ref().map(|preview| preview.skipped_layers.as_slice()).unwrap_or_default();
        self.model
            .config
            .effects
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| {
                if self.model.effect_def(layer).is_none() {
                    Some(format!("{}: this effect is unavailable and is skipped. Its settings are kept.", self.model.effect_label(index)))
                } else if skipped.contains(&layer.id) {
                    Some(format!("{} could not be compiled and is skipped.", self.model.effect_label(index)))
                } else {
                    None
                }
            })
            .collect()
    }

    pub(crate) fn effects_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let layers = self.model.config.effects.layers.len();
        let full = self.model.effects_full();
        v_flex()
            .gap_3()
            .flex_none()
            .child(note("Add texture to every visual, including custom shaders. The clock and gallery stay clean."))
            .child(
                Switch::new("effects-enabled")
                    .small()
                    .label("Enable effects")
                    .checked(self.model.config.effects.enabled)
                    .accessibility_label("Enable effects")
                    .on_change(cx.listener(|this, value, window, cx| this.set_effects_enabled(*value, window, cx))),
            )
            .child(
                v_flex()
                    .gap_2()
                    .pt_3()
                    .border_t_1()
                    .border_color(rgb(LINE))
                    .child(label("ADD EFFECT"))
                    .child(
                        h_flex()
                            .gap_2()
                            .child(div().flex_1().min_w_0().child(Select::new(&self.effects_ui.choice).small().disabled(full).accessibility_label("Effect to add")))
                            .child(
                                button("add-effect", "Add effect")
                                    .track_focus(&self.effects_ui.add_focus)
                                    .disabled(full)
                                    .on_click(cx.listener(|this, _, window, cx| this.add_effect(window, cx))),
                            ),
                    )
                    .child(note(if full {
                        "Eight-layer limit reached. Remove a layer to add another."
                    } else {
                        "Up to eight layers. Repeated effects have independent controls."
                    })),
            )
            .child(
                h_flex()
                    .justify_between()
                    .pt_3()
                    .border_t_1()
                    .border_color(rgb(LINE))
                    .child(label("APPLIED TOP TO BOTTOM"))
                    .child(div().text_xs().text_color(rgb(QUIET)).child(format!("{layers} / {MAX_EFFECT_LAYERS}"))),
            )
            .when(layers == 0, |this| {
                this.child(note(
                    "No effects yet. Explore analog texture, pixel patterns, lens distortion, color grading, glow, and trails. Add an effect to start your stack.",
                ))
            })
            .children((0..layers).map(|index| self.effect_layer(index, cx)))
            .child(status("effects-status-4").text_xs().text_color(rgb(MUTED)).children(self.effects_ui.message.clone()))
    }

    fn effect_layer(&self, index: usize, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let layer = &self.model.config.effects.layers[index];
        let id = SharedString::from(layer.id.clone());
        let layer_id = layer.id.clone();
        let count = self.model.config.effects.layers.len();
        let title = self.model.effect_title(index);
        let name = self.model.effect_label(index);
        let def = self.model.effect_def(layer);
        let expanded = self.effects_ui.expanded.contains(&layer.id) && def.is_some();
        let values = self.model.effective_effect(&layer.id);
        let edited = self.model.effect_edited(&layer.id);
        let focus = self.effects_ui.focus.get(&layer.id);
        let marker = if expanded { "▾" } else { "▸" };
        let (toggle_id, up_id, down_id, reset_id, remove_id) = (id.clone(), id.clone(), id.clone(), id.clone(), id.clone());
        let mut summary = Button::new((ElementId::from("effect-summary"), id.clone()))
            .small()
            .ghost()
            .w_full()
            .child(div().w_full().overflow_hidden().text_ellipsis().text_left().child(format!("{marker} {}. {title}", index + 1)))
            .accessibility_label(format!("{name}, {}", if expanded { "collapse controls" } else { "expand controls" }));
        if let Some(focus) = focus {
            summary = summary.track_focus(focus);
        }
        v_flex()
            .id((ElementId::from("effect-layer"), id.clone()))
            .flex_none()
            .gap_2()
            .p_2()
            .rounded(px(5.))
            .border_1()
            .border_color(rgb(LINE))
            .bg(rgb(SURFACE))
            .on_key_down(cx.listener(move |this, event: &KeyDownEvent, window, cx| {
                if !event.keystroke.modifiers.alt {
                    return;
                }
                match event.keystroke.key.as_str() {
                    "up" => this.move_effect(index, true, window, cx),
                    "down" => this.move_effect(index, false, window, cx),
                    _ => return,
                }
                cx.stop_propagation();
            }))
            .child(
                h_flex()
                    .gap_2()
                    .child(div().flex_1().min_w_0().child(summary.on_click({
                        let id = layer_id.clone();
                        cx.listener(move |this, _, _, cx| this.toggle_effect_expanded(&id, cx))
                    })))
                    .child(
                        Switch::new((ElementId::from("effect-enabled"), toggle_id))
                            .small()
                            .checked(layer.enabled)
                            .accessibility_label(format!("Enable {name}"))
                            .on_change(cx.listener(move |this, value, window, cx| this.set_effect_enabled(index, *value, window, cx))),
                    ),
            )
            .when(def.is_none(), |this| {
                this.child(note("Unavailable effect. This layer is skipped and its settings are kept. Remove it or keep it for later."))
            })
            .when(expanded, |this| {
                let def = def.expect("expanded layers have a definition");
                this.child(note(def.description.clone())).children(
                    self.effects_ui
                        .controls
                        .get(&layer_id)
                        .into_iter()
                        .flatten()
                        .filter(|control| model::visible(&control.def, &values))
                        .map(|control| self.effect_control_row(control, &values, cx)),
                )
            })
            .child(
                h_flex()
                    .flex_wrap()
                    .gap_1()
                    .child(
                        button((ElementId::from("effect-up"), up_id), "Move up")
                            .disabled(index == 0)
                            .accessibility_label(format!("Move up: {name}"))
                            .on_click(cx.listener(move |this, _, window, cx| this.move_effect(index, true, window, cx))),
                    )
                    .child(
                        button((ElementId::from("effect-down"), down_id), "Move down")
                            .disabled(index + 1 == count)
                            .accessibility_label(format!("Move down: {name}"))
                            .on_click(cx.listener(move |this, _, window, cx| this.move_effect(index, false, window, cx))),
                    )
                    .child(
                        button((ElementId::from("effect-reset"), reset_id), "Reset")
                            .ghost()
                            .disabled(!edited)
                            .accessibility_label(format!("Reset {name}"))
                            .on_click(cx.listener(move |this, _, window, cx| this.reset_effect(index, window, cx))),
                    )
                    .child(
                        button((ElementId::from("effect-remove"), remove_id), "Remove")
                            .ghost()
                            .accessibility_label(format!("Remove {name}"))
                            .on_click(cx.listener(move |this, _, window, cx| this.remove_effect(index, window, cx))),
                    ),
            )
    }

    fn effect_control_row(&self, control: &Control, values: &ShaderValues, cx: &Context<Self>) -> impl IntoElement + use<> {
        let def = &control.def;
        let target = control.target.clone();
        let name = SharedString::from(def.name.clone());
        let escape_target = target.clone();
        let escape_name = def.name.clone();
        let key = target.key();
        v_flex()
            .id((ElementId::from(SharedString::from(format!("control-{key}"))), name))
            .flex_none()
            .gap_1()
            .on_action(cx.listener(move |this, event: &Escape, window, cx| {
                this.cancel_control_edit(&escape_target, &escape_name, event, window, cx)
            }))
            .child(div().font_weight(FontWeight::MEDIUM).child(def.title().to_owned()))
            .children(def.description.clone().map(note))
            .child(control.element(&values[&def.name], false, cx))
            .children(
                self.control_error
                    .as_ref()
                    .filter(|(error_key, field, _)| *error_key == key && *field == def.name)
                    .map(|(_, _, error)| div().text_xs().text_color(rgb(SIGNAL_HOVER)).child(error.clone())),
            )
    }
}

//! The Effects pane of the visual editor: the ordered effect stack of the look being edited.
//!
//! Every look, and each visual's current edits, carries its own stack. Choosing another visual or
//! look rebuilds these controls. Within a stack, layers are identified by a stable ID, which keeps
//! their controls, focus and expanded state through reordering, and keeps the preview's per-layer
//! history attached.

use std::collections::{BTreeMap, BTreeSet};

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::Escape;
use gpui_kit::component::searchable_list::{SearchableListItem, SearchableVec};
use gpui_kit::component::select::{Select, SelectEvent, SelectState};
use gpui_kit::component::switch::Switch;
use gpui_kit::component::{Disableable, Icon, IconName, IndexPath, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use scrnsvr_core::catalog::ShaderValues;
use scrnsvr_core::config::MAX_EFFECT_LAYERS;

use crate::app::Settings;
use crate::controls::{Control, Target};
use crate::model::{self, Model, effects};
use crate::view::{
    ALERT, CONTROL, CONTROL_HOVER, INK, LINE, MUTED, QUIET, RAISED, SIGNAL, STRONG_LINE, SURFACE, dot, glyph, icon_button, live, notice,
    section,
};

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
        ui.rebuild(model, window, cx);
        ui
    }

    /// Controls for every layer of the stack now being edited. Expanded layers stay open when the
    /// new stack has a layer with the same ID.
    pub fn rebuild(&mut self, model: &Model, window: &mut Window, cx: &mut Context<Settings>) {
        let ids: Vec<String> = model.effects().layers.iter().map(|layer| layer.id.clone()).collect();
        self.controls.clear();
        self.focus.retain(|id, _| ids.contains(id));
        self.expanded.retain(|id| ids.contains(id));
        self.message = None;
        for id in &ids {
            self.build_layer(model, id, window, cx);
        }
    }

    fn build_layer(&mut self, model: &Model, id: &str, window: &mut Window, cx: &mut Context<Settings>) {
        self.focus.entry(id.into()).or_insert_with(|| cx.focus_handle());
        let Some(layer) = model.effect_index(id).map(|index| &model.effects().layers[index]) else { return };
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
    pub fn rebuild_effects(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.effects_ui.rebuild(&self.model, window, cx);
    }

    pub fn add_effect(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let chosen = self.effects_ui.chosen.clone();
        match self.model.add_effect(&chosen) {
            Ok(index) => {
                let id = self.model.effects().layers[index].id.clone();
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
        let remaining = self.model.effects().layers.len();
        self.effects_ui.message =
            Some(format!("Removed {label}. {remaining} {} remaining.", if remaining == 1 { "layer" } else { "layers" }));
        self.stack_changed(window, cx);
        // Keep focus in the list: the layer that took this one's place, else the Add button.
        let next =
            self.model.effects().layers.get(index.min(remaining.saturating_sub(1))).and_then(|layer| self.effects_ui.focus.get(&layer.id));
        match next {
            Some(focus) => focus.focus(window, cx),
            None => self.effects_ui.add_focus.focus(window, cx),
        }
        cx.notify();
    }

    pub fn move_effect(&mut self, index: usize, up: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.model.effects().layers.get(index).map(|layer| layer.id.clone()) else { return };
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
        let Some(id) = self.model.effects().layers.get(index).map(|layer| layer.id.clone()) else { return };
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
            .effects()
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
        let layers = self.model.effects().layers.len();
        let full = self.model.effects_full();
        let enabled = self.model.effects().enabled;
        let target = self.model.look.as_deref().map_or_else(|| "current edits".to_owned(), |name| format!("“{name}”"));
        v_flex()
            .gap_6()
            .flex_none()
            .child(
                h_flex()
                    .gap_3()
                    .items_center()
                    .justify_between()
                    .p_3()
                    .rounded(px(10.))
                    .bg(rgb(RAISED))
                    .child(v_flex().gap_1().child(div().font_weight(FontWeight::MEDIUM).child(format!("Effects on {target}"))).child(
                        div().text_size(px(12.)).text_color(rgb(QUIET)).child(if enabled {
                            format!("{layers} of {MAX_EFFECT_LAYERS} layers. Other looks keep their own stacks. The clock and library stay clean.")
                        } else {
                            "Off for this look. Its layers are kept.".into()
                        }),
                    ))
                    .child(
                        Switch::new("effects-enabled")
                            .checked(enabled)
                            .accessibility_label("Enable effects")
                            .on_change(cx.listener(|this, value, window, cx| this.set_effects_enabled(*value, window, cx))),
                    ),
            )
            .child(
                section("ADD A LAYER")
                    .child(
                        h_flex()
                            .gap_2()
                            .child(
                                div().flex_1().min_w_0().child(
                                    Select::new(&self.effects_ui.choice).small().disabled(full).accessibility_label("Effect to add"),
                                ),
                            )
                            .child(
                                Button::new("add-effect")
                                    .small()
                                    .primary()
                                    .icon(IconName::Plus)
                                    .label("Add")
                                    .accessibility_label("Add effect")
                                    .track_focus(&self.effects_ui.add_focus)
                                    .disabled(full)
                                    .on_click(cx.listener(|this, _, window, cx| this.add_effect(window, cx))),
                            ),
                    )
                    .child(div().text_size(px(12.)).text_color(rgb(QUIET)).child(if full {
                        "Eight-layer limit reached. Remove a layer to add another."
                    } else {
                        "Up to eight layers. Repeated effects keep their own controls."
                    })),
            )
            .child(
                section("STACK, APPLIED TOP TO BOTTOM")
                    .when(layers == 0, |this| {
                        this.child(
                            v_flex()
                                .gap_3()
                                .items_center()
                                .py_6()
                                .px_4()
                                .rounded(px(10.))
                                .border_1()
                                .border_color(rgb(LINE))
                                .child(glyph("layers").size(px(22.)).text_color(rgb(QUIET)))
                                .child(div().text_center().text_size(px(13.)).text_color(rgb(MUTED)).child(
                                    "No layers yet. Try analog texture, pixel patterns, lens distortion, color grading, glow or trails.",
                                )),
                        )
                    })
                    .children((0..layers).map(|index| self.effect_layer(index, cx))),
            )
            .child(live("effects-status-4", self.effects_ui.message.clone().unwrap_or_default()).text_xs().text_color(rgb(MUTED)))
    }

    fn effect_layer(&self, index: usize, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let layer = &self.model.effects().layers[index];
        let id = SharedString::from(layer.id.clone());
        let layer_id = layer.id.clone();
        let count = self.model.effects().layers.len();
        let title = self.model.effect_title(index);
        let name = self.model.effect_label(index);
        let def = self.model.effect_def(layer);
        let expanded = self.effects_ui.expanded.contains(&layer.id) && def.is_some();
        let values = self.model.effective_effect(&layer.id);
        let edited = self.model.effect_edited(&layer.id);
        let focus = self.effects_ui.focus.get(&layer.id);
        let active = layer.enabled && self.model.effects().enabled;
        let (toggle_id, up_id, down_id, reset_id, remove_id) = (id.clone(), id.clone(), id.clone(), id.clone(), id.clone());
        let mut summary = Button::new((ElementId::from("effect-summary"), id.clone()))
            .small()
            .ghost()
            .w_full()
            .child(
                h_flex()
                    .w_full()
                    .gap_2()
                    .items_center()
                    .child(Icon::new(if expanded { IconName::ChevronDown } else { IconName::ChevronRight }).text_color(rgb(QUIET)))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .overflow_hidden()
                            .text_ellipsis()
                            .whitespace_nowrap()
                            .text_left()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(rgb(if active { INK } else { MUTED }))
                            .child(title),
                    )
                    .when(edited, |this| this.child(dot(SIGNAL, 5.))),
            )
            .accessibility_label(format!("{name}, {}", if expanded { "collapse controls" } else { "expand controls" }));
        if let Some(focus) = focus {
            summary = summary.track_focus(focus);
        }
        v_flex()
            .id((ElementId::from("effect-layer"), id.clone()))
            .flex_none()
            .gap_2()
            .p_2()
            .rounded(px(10.))
            .border_1()
            .border_color(rgb(if expanded { STRONG_LINE } else { LINE }))
            .bg(rgb(if expanded { RAISED } else { SURFACE }))
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
                    .items_center()
                    .child(
                        div()
                            .flex_none()
                            .size(px(22.))
                            .rounded(px(6.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .bg(rgb(if active { CONTROL_HOVER } else { CONTROL }))
                            .text_size(px(11.))
                            .font_weight(FontWeight::BOLD)
                            .text_color(rgb(if active { SIGNAL } else { QUIET }))
                            .child((index + 1).to_string()),
                    )
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
                this.child(notice(
                    (ElementId::from("effect-missing"), id.clone()),
                    "Unavailable effect. This layer is skipped and its settings are kept. Remove it or keep it for later.",
                    ALERT,
                ))
            })
            .when(expanded, |this| {
                let def = def.expect("expanded layers have a definition");
                this.child(
                    v_flex()
                        .gap_4()
                        .px_2()
                        .pt_1()
                        .pb_2()
                        .child(div().text_size(px(12.)).text_color(rgb(QUIET)).child(def.description.clone()))
                        .children(
                            self.effects_ui
                                .controls
                                .get(&layer_id)
                                .into_iter()
                                .flatten()
                                .filter(|control| model::visible(&control.def, &values))
                                .map(|control| self.effect_control_row(control, &values, cx)),
                        ),
                )
            })
            .child(
                h_flex()
                    .gap_1()
                    .pt_1()
                    .border_t_1()
                    .border_color(rgb(LINE))
                    .child(
                        icon_button((ElementId::from("effect-up"), up_id), "chevron-up", format!("Move up: {name}"))
                            .disabled(index == 0)
                            .on_click(cx.listener(move |this, _, window, cx| this.move_effect(index, true, window, cx))),
                    )
                    .child(
                        icon_button((ElementId::from("effect-down"), down_id), "chevron-down", format!("Move down: {name}"))
                            .disabled(index + 1 == count)
                            .on_click(cx.listener(move |this, _, window, cx| this.move_effect(index, false, window, cx))),
                    )
                    .child(div().flex_1())
                    .child(
                        icon_button((ElementId::from("effect-reset"), reset_id), "rotate-ccw", format!("Reset {name}"))
                            .disabled(!edited)
                            .on_click(cx.listener(move |this, _, window, cx| this.reset_effect(index, window, cx))),
                    )
                    .child(
                        icon_button((ElementId::from("effect-remove"), remove_id), "trash", format!("Remove {name}"))
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
            .gap(px(6.))
            .on_action(cx.listener(move |this, event: &Escape, window, cx| {
                this.cancel_control_edit(&escape_target, &escape_name, event, window, cx)
            }))
            .child(div().font_weight(FontWeight::MEDIUM).child(def.title().to_owned()))
            .children(def.description.clone().map(|text| div().text_size(px(12.)).text_color(rgb(QUIET)).child(text)))
            .child(control.element(&values[&def.name], false, cx))
            .children(
                self.control_error
                    .as_ref()
                    .filter(|(error_key, field, _)| *error_key == key && *field == def.name)
                    .map(|(_, _, error)| div().text_xs().text_color(rgb(ALERT)).child(error.clone())),
            )
    }
}

//! Stable Kit component state for each manifest uniform.

use gpui_kit::component::color_picker::{ColorPicker, ColorPickerEvent, ColorPickerState};
use gpui_kit::component::input::{Escape, Input, InputEvent, InputState, NumberInput, NumberInputEvent, StepAction};
use gpui_kit::component::searchable_list::SearchableVec;
use gpui_kit::component::select::{Select, SelectEvent, SelectState};
use gpui_kit::component::slider::{Slider, SliderEvent, SliderState};
use gpui_kit::component::switch::Switch;
use gpui_kit::component::{Disableable, IndexPath, Sizable, h_flex, v_flex};
use gpui_kit::*;
use scrnsvr_core::catalog::{SettingValue, UniformDef};

use crate::app::{Settings, TextSelect};
use crate::model::{snap, step};

/// What a control edits. Every target uses the same widgets and commit rules.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    /// A manifest uniform of the selected visual.
    Shader,
    /// A manifest uniform of one effect layer, by layer ID.
    Effect(String),
    Clock,
    Global,
}

impl Target {
    pub fn key(&self) -> String {
        match self {
            Self::Shader => "shader".into(),
            Self::Effect(id) => format!("effect:{id}"),
            Self::Clock => "clock".into(),
            Self::Global => "global".into(),
        }
    }
}

pub struct Control {
    pub def: UniformDef,
    pub target: Target,
    widget: Widget,
    _subscriptions: Vec<Subscription>,
}

enum Widget {
    Numeric { slider: Option<Entity<SliderState>>, input: Entity<InputState> },
    Color { picker: Entity<ColorPickerState>, input: Entity<InputState> },
    Select(Entity<TextSelect>),
    Bool,
}

impl Control {
    pub fn new(def: &UniformDef, target: Target, value: &SettingValue, window: &mut Window, cx: &mut Context<Settings>) -> Self {
        let mut subscriptions = Vec::new();
        let widget = match value {
            SettingValue::Number(value) => {
                let input = cx.new(|cx| InputState::new(window, cx).default_value(value.to_string()));
                let slider = def.is_slider().then(|| {
                    let slider = cx.new(|_| {
                        SliderState::new()
                            .min(def.min.unwrap_or(0.0) as f32)
                            .max(def.max.unwrap_or(1.0) as f32)
                            .step(step(def) as f32)
                            .default_value(*value as f32)
                    });
                    let input = input.clone();
                    let def = def.clone();
                    let target = target.clone();
                    subscriptions.push(cx.subscribe_in(&slider, window, move |this, _, event: &SliderEvent, window, cx| {
                        let SliderEvent::Change(value) = event else { return };
                        let value = snap(&def, f64::from(value.start()));
                        input.update(cx, |state, cx| state.set_value(value.to_string(), window, cx));
                        this.set_control(&target, &def.name, SettingValue::Number(value), window, cx);
                    }));
                    slider
                });
                let name = def.name.clone();
                let key = target.clone();
                subscriptions.push(cx.subscribe_in(&input, window, move |this, _, event: &InputEvent, window, cx| {
                    if matches!(event, InputEvent::PressEnter { .. } | InputEvent::Blur) {
                        this.commit_number(&key, &name, None, window, cx);
                    }
                }));
                let name = def.name.clone();
                let key = target.clone();
                subscriptions.push(cx.subscribe_in(&input, window, move |this, _, event: &NumberInputEvent, window, cx| {
                    let NumberInputEvent::Step(action) = event;
                    this.commit_number(&key, &name, Some(*action), window, cx);
                }));
                Widget::Numeric { slider, input }
            }
            SettingValue::Bool(_) => Widget::Bool,
            SettingValue::Text(hex) if def.kind == scrnsvr_core::catalog::UniformKind::Color => {
                let picker = cx.new(|cx| ColorPickerState::new(window, cx).default_value(hex_to_color(hex)));
                let input = cx.new(|cx| InputState::new(window, cx).default_value(hex.to_lowercase()));
                let name = def.name.clone();
                let key = target.clone();
                subscriptions.push(cx.subscribe_in(&picker, window, move |this, _, event: &ColorPickerEvent, window, cx| {
                    if let ColorPickerEvent::Change(Some(color)) = event {
                        let hex = color_to_hex(*color);
                        // Shader colors are RGB. Bring the picker back to the stored opaque value.
                        if let Some(control) = this.control(&key, &name) {
                            control.sync(&SettingValue::Text(hex.clone()), window, cx);
                        }
                        this.clear_control_error(&key, &name, cx);
                        this.set_control(&key, &name, SettingValue::Text(hex), window, cx);
                    }
                }));
                let name = def.name.clone();
                let key = target.clone();
                subscriptions.push(cx.subscribe_in(&input, window, move |this, _, event: &InputEvent, window, cx| {
                    if matches!(event, InputEvent::Blur | InputEvent::PressEnter { .. }) {
                        this.commit_color(&key, &name, window, cx);
                    }
                }));
                Widget::Color { picker, input }
            }
            SettingValue::Text(value) => {
                let options: Vec<_> = def.options.iter().cloned().map(SharedString::from).collect();
                let selected = def.options.iter().position(|item| item == value).map(IndexPath::new);
                let state = cx.new(|cx| SelectState::new(SearchableVec::new(options), selected, window, cx).searchable(false));
                let name = def.name.clone();
                let key = target.clone();
                subscriptions.push(cx.subscribe_in(
                    &state,
                    window,
                    move |this, _, event: &SelectEvent<SearchableVec<SharedString>>, window, cx| {
                        if let SelectEvent::Confirm(Some(value)) = event {
                            this.set_control(&key, &name, SettingValue::Text(value.to_string()), window, cx);
                        }
                    },
                ));
                Widget::Select(state)
            }
        };
        Self { def: def.clone(), target, widget, _subscriptions: subscriptions }
    }

    pub fn text_input(&self) -> Option<&Entity<InputState>> {
        match &self.widget {
            Widget::Numeric { input, .. } | Widget::Color { input, .. } => Some(input),
            Widget::Select(_) | Widget::Bool => None,
        }
    }

    pub fn focus_handle(&self, cx: &App) -> Option<FocusHandle> {
        match &self.widget {
            Widget::Numeric { input, .. } | Widget::Color { input, .. } => Some(input.read(cx).focus_handle(cx)),
            Widget::Select(state) => Some(state.read(cx).focus_handle(cx)),
            Widget::Bool => None,
        }
    }

    pub fn sync(&self, value: &SettingValue, window: &mut Window, cx: &mut App) {
        match (&self.widget, value) {
            (Widget::Numeric { slider, input }, SettingValue::Number(value)) => {
                if let Some(slider) = slider {
                    slider.update(cx, |state, cx| state.set_value(*value as f32, window, cx));
                }
                input.update(cx, |state, cx| {
                    let text = value.to_string();
                    if state.value().as_ref() != text {
                        state.set_value(text, window, cx);
                    }
                });
            }
            (Widget::Color { picker, input }, SettingValue::Text(hex)) => {
                picker.update(cx, |state, cx| state.set_value(hex_to_color(hex), window, cx));
                input.update(cx, |state, cx| {
                    let text = hex.to_lowercase();
                    if state.value().as_ref() != text {
                        state.set_value(text, window, cx);
                    }
                });
            }
            (Widget::Select(state), SettingValue::Text(value)) => {
                state.update(cx, |state, cx| state.set_selected_value(&value.clone().into(), window, cx));
            }
            _ => {}
        }
    }

    pub fn element(&self, value: &SettingValue, disabled: bool, cx: &Context<Settings>) -> AnyElement {
        let label = self.def.title().to_owned();
        let name = self.def.name.clone();
        let target = self.target.clone();
        match &self.widget {
            Widget::Numeric { slider, input } => h_flex()
                .gap_3()
                .children(slider.as_ref().map(|slider| {
                    div().flex_1().min_w(px(35.)).child(Slider::new(slider).disabled(disabled).accessibility_label(label.clone()))
                }))
                .child(div().flex_none().w(px(106.)).child(NumberInput::new(input).small().disabled(disabled).accessibility_label(label)))
                .children(self.def.unit.as_ref().map(|unit| div().text_xs().child(unit.clone())))
                .into_any_element(),
            Widget::Color { picker, input } => {
                let swatch = match value {
                    SettingValue::Text(hex) => hex_to_color(hex),
                    _ => hex_to_color("#000000"),
                };
                h_flex()
                    .gap_2()
                    .child(if disabled {
                        div()
                            .size(px(24.))
                            .rounded(px(4.))
                            .border_1()
                            .border_color(rgb(crate::view::STRONG_LINE))
                            .bg(swatch)
                            .into_any_element()
                    } else {
                        ColorPicker::new(picker).small().label("Choose").accessibility_label(format!("Choose {label}")).into_any_element()
                    })
                    .child(div().w(px(104.)).child(Input::new(input).small().disabled(disabled).aria_label(format!("{label} hex value"))))
                    .into_any_element()
            }
            Widget::Select(state) => Select::new(state).small().disabled(disabled).accessibility_label(label).into_any_element(),
            Widget::Bool => {
                Switch::new((ElementId::from(SharedString::from(format!("switch-{}", target.key()))), SharedString::from(name.clone())))
                    .small()
                    .checked(*value == SettingValue::Bool(true))
                    .disabled(disabled)
                    .accessibility_label(label)
                    .on_change(
                        cx.listener(move |this, value, window, cx| {
                            this.set_control(&target, &name, SettingValue::Bool(*value), window, cx)
                        }),
                    )
                    .into_any_element()
            }
        }
    }
}

impl Settings {
    /// The controls of one target, in manifest order.
    pub fn controls_of(&self, target: &Target) -> &[Control] {
        match target {
            Target::Shader => &self.controls,
            Target::Effect(id) => self.effects_ui.controls.get(id).map_or(&[], Vec::as_slice),
            Target::Clock => &self.clock_ui.controls,
            Target::Global => &self.system_ui.controls,
        }
    }

    pub fn control(&self, target: &Target, name: &str) -> Option<&Control> {
        self.controls_of(target).iter().find(|control| control.def.name == name)
    }

    /// The value a control shows: stored edits over inherited values over defaults.
    pub fn control_value(&self, target: &Target, name: &str) -> Option<SettingValue> {
        match target {
            Target::Shader => self.model.effective().remove(name),
            Target::Effect(id) => self.model.effective_effect(id).remove(name),
            Target::Clock => Some(self.model.clock_value(name)),
            Target::Global => Some(self.model.global_value(name)),
        }
    }

    /// Store a control value in the model, then refresh what depends on it.
    pub fn set_control(&mut self, target: &Target, name: &str, value: SettingValue, window: &mut Window, cx: &mut Context<Self>) {
        match target {
            Target::Shader => self.set_uniform(name, value, window, cx),
            Target::Effect(id) => {
                if self.model.set_effect_value(id, name, value) {
                    self.update_scene();
                    self.config_changed(window, cx);
                }
            }
            Target::Clock => {
                if self.model.set_clock_value(name, value) {
                    self.update_clock();
                    self.config_changed(window, cx);
                }
            }
            Target::Global => {
                if self.model.set_global_value(name, value) {
                    self.config_changed(window, cx);
                }
            }
        }
    }

    fn commit_number(&mut self, target: &Target, name: &str, action: Option<StepAction>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(control) = self.control(target, name) else { return };
        let Widget::Numeric { input, .. } = &control.widget else { return };
        let Some(SettingValue::Number(previous)) = self.control_value(target, name) else { return };
        let raw = input.read(cx).value();
        if action.is_none() && raw.as_ref() == previous.to_string() {
            return;
        }
        let parsed = raw.trim().parse::<f64>().ok().filter(|value| value.is_finite());
        if action.is_none() && parsed.is_none() {
            control.sync(&SettingValue::Number(previous), window, cx);
            return;
        }
        let mut next = parsed.unwrap_or(previous);
        if let Some(action) = action {
            let sign = if matches!(action, StepAction::Increment) { 1.0 } else { -1.0 };
            next += sign * step(&control.def);
        }
        let value = SettingValue::Number(snap(&control.def, next));
        control.sync(&value, window, cx);
        if value != SettingValue::Number(previous) {
            self.set_control(target, name, value, window, cx);
        }
    }

    fn commit_color(&mut self, target: &Target, name: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(control) = self.control(target, name) else { return };
        let Widget::Color { input, .. } = &control.widget else { return };
        let raw = input.read(cx).value();
        let trimmed = raw.trim();
        let digits = trimmed.strip_prefix('#').unwrap_or(trimmed);
        if digits.len() != 6 || !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            self.control_error = Some((target.key(), name.into(), "Enter six hex digits, for example #ef7b4d.".into()));
            cx.notify();
            return;
        }
        let value = SettingValue::Text(format!("#{}", digits.to_lowercase()));
        control.sync(&value, window, cx);
        self.clear_control_error(target, name, cx);
        if let Some(SettingValue::Text(previous)) = self.control_value(target, name)
            && !previous.eq_ignore_ascii_case(&format!("#{digits}"))
        {
            self.set_control(target, name, value, window, cx);
        }
    }

    pub fn cancel_control_edit(&mut self, target: &Target, name: &str, _: &Escape, window: &mut Window, cx: &mut Context<Self>) {
        if let (Some(control), Some(value)) = (self.control(target, name), self.control_value(target, name)) {
            control.sync(&value, window, cx);
        }
        self.clear_control_error(target, name, cx);
    }

    pub fn clear_control_error(&mut self, target: &Target, name: &str, cx: &mut Context<Self>) {
        if self.control_error.as_ref().is_some_and(|(key, field, _)| *key == target.key() && field == name) {
            self.control_error = None;
            cx.notify();
        }
    }

    /// A labeled control row for clock and global settings: heading, help, widget and any error.
    pub fn simple_row(&self, target: &Target, name: &str, disabled: bool, cx: &Context<Self>) -> Option<impl IntoElement + use<>> {
        let control = self.control(target, name)?;
        let def = &control.def;
        let value = self.control_value(target, name)?;
        let key = target.key();
        let escape_name = def.name.clone();
        let escape_target = target.clone();
        let heading = div().font_weight(FontWeight::MEDIUM).flex_1().child(def.title().to_owned());
        let row = if def.kind == scrnsvr_core::catalog::UniformKind::Bool {
            h_flex().gap_2().justify_between().child(heading).child(control.element(&value, disabled, cx)).into_any_element()
        } else {
            v_flex()
                .gap(px(6.))
                .child(heading)
                .children(def.description.clone().map(|text| div().text_size(px(12.)).text_color(rgb(crate::view::QUIET)).child(text)))
                .child(control.element(&value, disabled, cx))
                .children(
                    self.control_error
                        .as_ref()
                        .filter(|(error_key, field, _)| *error_key == key && *field == def.name)
                        .map(|(_, _, error)| div().text_xs().text_color(rgb(crate::view::ALERT)).child(error.clone())),
                )
                .into_any_element()
        };
        Some(
            div()
                .id((ElementId::from(SharedString::from(format!("row-{key}"))), SharedString::from(def.name.clone())))
                .flex_none()
                .on_action(cx.listener(move |this, event: &Escape, window, cx| {
                    this.cancel_control_edit(&escape_target, &escape_name, event, window, cx)
                }))
                .child(row),
        )
    }
}

fn hex_to_color(hex: &str) -> Hsla {
    rgb(u32::from_str_radix(&hex[1..], 16).expect("valid catalog or configured color")).into()
}

fn color_to_hex(color: Hsla) -> String {
    let color = Rgba::from(color);
    let channel = |value: f32| (value.clamp(0., 1.) * 255.).round() as u8;
    format!("#{:02x}{:02x}{:02x}", channel(color.r), channel(color.g), channel(color.b))
}

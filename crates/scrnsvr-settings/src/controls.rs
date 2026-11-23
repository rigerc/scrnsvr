//! Stable Kit component state for each manifest uniform.

use gpui_kit::component::color_picker::{ColorPicker, ColorPickerEvent, ColorPickerState};
use gpui_kit::component::input::{Escape, Input, InputEvent, InputState, NumberInput, NumberInputEvent, StepAction};
use gpui_kit::component::searchable_list::SearchableVec;
use gpui_kit::component::select::{Select, SelectEvent, SelectState};
use gpui_kit::component::slider::{Slider, SliderEvent, SliderState};
use gpui_kit::component::switch::Switch;
use gpui_kit::component::{IndexPath, Sizable, h_flex};
use gpui_kit::*;
use scrnsvr_core::catalog::{SettingValue, UniformDef};

use crate::app::{Settings, TextSelect};
use crate::model::{snap, step};

pub struct Control {
    pub def: UniformDef,
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
    pub fn new(def: &UniformDef, value: &SettingValue, window: &mut Window, cx: &mut Context<Settings>) -> Self {
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
                    subscriptions.push(cx.subscribe_in(&slider, window, move |this, _, event: &SliderEvent, window, cx| {
                        let SliderEvent::Change(value) = event else { return };
                        let value = snap(&def, f64::from(value.start()));
                        input.update(cx, |state, cx| state.set_value(value.to_string(), window, cx));
                        this.set_uniform(&def.name, SettingValue::Number(value), window, cx);
                    }));
                    slider
                });
                let name = def.name.clone();
                subscriptions.push(cx.subscribe_in(&input, window, move |this, _, event: &InputEvent, window, cx| {
                    if matches!(event, InputEvent::PressEnter { .. } | InputEvent::Blur) {
                        this.commit_number(&name, None, window, cx);
                    }
                }));
                let name = def.name.clone();
                subscriptions.push(cx.subscribe_in(&input, window, move |this, _, event: &NumberInputEvent, window, cx| {
                    let NumberInputEvent::Step(action) = event;
                    this.commit_number(&name, Some(*action), window, cx);
                }));
                Widget::Numeric { slider, input }
            }
            SettingValue::Bool(_) => Widget::Bool,
            SettingValue::Text(hex) if def.kind == scrnsvr_core::catalog::UniformKind::Color => {
                let picker = cx.new(|cx| ColorPickerState::new(window, cx).default_value(hex_to_color(hex)));
                let input = cx.new(|cx| InputState::new(window, cx).default_value(hex.to_lowercase()));
                let name = def.name.clone();
                subscriptions.push(cx.subscribe_in(&picker, window, move |this, _, event: &ColorPickerEvent, window, cx| {
                    if let ColorPickerEvent::Change(Some(color)) = event {
                        let hex = color_to_hex(*color);
                        // Shader colors are RGB. Bring the picker back to the stored opaque value.
                        if let Some(control) = this.controls.iter().find(|control| control.def.name == name) {
                            control.sync(&SettingValue::Text(hex.clone()), window, cx);
                        }
                        this.clear_control_error(&name, cx);
                        this.set_uniform(&name, SettingValue::Text(hex), window, cx);
                    }
                }));
                let name = def.name.clone();
                subscriptions.push(cx.subscribe_in(&input, window, move |this, _, event: &InputEvent, window, cx| {
                    if matches!(event, InputEvent::Blur | InputEvent::PressEnter { .. }) {
                        this.commit_color(&name, window, cx);
                    }
                }));
                Widget::Color { picker, input }
            }
            SettingValue::Text(value) => {
                let options: Vec<_> = def.options.iter().cloned().map(SharedString::from).collect();
                let selected = def.options.iter().position(|item| item == value).map(IndexPath::new);
                let state = cx.new(|cx| SelectState::new(SearchableVec::new(options), selected, window, cx).searchable(false));
                let name = def.name.clone();
                subscriptions.push(cx.subscribe_in(
                    &state,
                    window,
                    move |this, _, event: &SelectEvent<SearchableVec<SharedString>>, window, cx| {
                        if let SelectEvent::Confirm(Some(value)) = event {
                            this.set_uniform(&name, SettingValue::Text(value.to_string()), window, cx);
                        }
                    },
                ));
                Widget::Select(state)
            }
        };
        Self { def: def.clone(), widget, _subscriptions: subscriptions }
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

    pub fn element(&self, value: &SettingValue, cx: &Context<Settings>) -> AnyElement {
        let label = self.def.title().to_owned();
        let name = self.def.name.clone();
        match &self.widget {
            Widget::Numeric { slider, input } => h_flex()
                .gap_3()
                .children(
                    slider
                        .as_ref()
                        .map(|slider| div().flex_1().min_w(px(35.)).child(Slider::new(slider).accessibility_label(label.clone()))),
                )
                .child(div().flex_none().w(px(106.)).child(NumberInput::new(input).small().accessibility_label(label)))
                .children(self.def.unit.as_ref().map(|unit| div().text_xs().child(unit.clone())))
                .into_any_element(),
            Widget::Color { picker, input } => h_flex()
                .gap_2()
                .child(ColorPicker::new(picker).small().label("Choose").accessibility_label(format!("Choose {label}")))
                .child(div().w(px(104.)).child(Input::new(input).small().aria_label(format!("{label} hex value"))))
                .into_any_element(),
            Widget::Select(state) => Select::new(state).small().accessibility_label(label).into_any_element(),
            Widget::Bool => Switch::new((ElementId::from("switch"), SharedString::from(name.clone())))
                .small()
                .checked(*value == SettingValue::Bool(true))
                .accessibility_label(label)
                .on_change(cx.listener(move |this, value, window, cx| this.set_uniform(&name, SettingValue::Bool(*value), window, cx)))
                .into_any_element(),
        }
    }
}

impl Settings {
    fn commit_number(&mut self, name: &str, action: Option<StepAction>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(control) = self.controls.iter().find(|control| control.def.name == name) else { return };
        let Widget::Numeric { input, .. } = &control.widget else { return };
        let values = self.model.effective();
        let SettingValue::Number(previous) = values[name] else { return };
        let raw = input.read(cx).value();
        if action.is_none() && raw.as_ref() == previous.to_string() {
            return;
        }
        let parsed = raw.trim().parse::<f64>().ok().filter(|value| value.is_finite());
        if action.is_none() && parsed.is_none() {
            control.sync(&values[name], window, cx);
            return;
        }
        let mut next = parsed.unwrap_or(previous);
        if let Some(action) = action {
            let sign = if matches!(action, StepAction::Increment) { 1.0 } else { -1.0 };
            next += sign * step(&control.def);
        }
        let value = SettingValue::Number(snap(&control.def, next));
        control.sync(&value, window, cx);
        if value != values[name] {
            self.set_uniform(name, value, window, cx);
        }
    }

    fn commit_color(&mut self, name: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(control) = self.controls.iter().find(|control| control.def.name == name) else { return };
        let Widget::Color { input, .. } = &control.widget else { return };
        let raw = input.read(cx).value();
        let trimmed = raw.trim();
        let digits = trimmed.strip_prefix('#').unwrap_or(trimmed);
        if digits.len() != 6 || !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            self.selected_control_error = Some((name.into(), "Enter six hex digits, for example #ef7b4d.".into()));
            cx.notify();
            return;
        }
        let values = self.model.effective();
        let value = SettingValue::Text(format!("#{}", digits.to_lowercase()));
        control.sync(&value, window, cx);
        self.clear_control_error(name, cx);
        if let SettingValue::Text(previous) = &values[name]
            && !previous.eq_ignore_ascii_case(&format!("#{digits}"))
        {
            self.set_uniform(name, value, window, cx);
        }
    }

    pub fn cancel_control_edit(&mut self, name: &str, _: &Escape, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(control) = self.controls.iter().find(|control| control.def.name == name) {
            control.sync(&self.model.effective()[name], window, cx);
        }
        self.clear_control_error(name, cx);
    }

    fn clear_control_error(&mut self, name: &str, cx: &mut Context<Self>) {
        if self.selected_control_error.as_ref().is_some_and(|(key, _)| key == name) {
            self.selected_control_error = None;
            cx.notify();
        }
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

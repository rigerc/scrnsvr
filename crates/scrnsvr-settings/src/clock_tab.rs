//! Clock tab: every clock setting, edited live in the preview.

use gpui_kit::component::button::Button;
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{Disableable, Selectable, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use scrnsvr_core::clock::ClockFont;

use crate::app::Settings;
use crate::controls::{Control, Target};
use crate::model::Model;
use crate::model::clock::{POSITIONS, PatternState, clock_defs};
use crate::view::{LINE, MUTED, QUIET, SIGNAL, SIGNAL_HOVER, label, live, note};

pub struct ClockUi {
    pub controls: Vec<Control>,
    pub custom_font: Entity<InputState>,
    pub pattern: Entity<InputState>,
    pub pattern_state: PatternState,
    _subscriptions: Vec<Subscription>,
}

impl ClockUi {
    pub fn new(model: &Model, window: &mut Window, cx: &mut Context<Settings>) -> Self {
        let controls = clock_defs().iter().map(|def| Control::new(def, Target::Clock, &model.clock_value(&def.name), window, cx)).collect();
        let custom_font = cx
            .new(|cx| InputState::new(window, cx).placeholder("e.g. JetBrains Mono").default_value(model.config.clock.custom_font.clone()));
        let pattern = cx.new(|cx| {
            InputState::new(window, cx).placeholder("%H:%M").default_value(model.config.clock.pattern.clone().unwrap_or_default())
        });
        let font_changed = cx.subscribe_in(&custom_font, window, |this, input, event: &InputEvent, window, cx| {
            if matches!(event, InputEvent::Change) {
                let name = input.read(cx).value().to_string();
                if this.model.set_custom_font(&name) {
                    this.update_clock();
                    this.config_changed(window, cx);
                }
            }
        });
        let pattern_changed = cx.subscribe_in(&pattern, window, |this, input, event: &InputEvent, window, cx| {
            if matches!(event, InputEvent::Change) {
                let text = input.read(cx).value().to_string();
                let (state, changed) = this.model.set_clock_pattern(&text);
                this.clock_ui.pattern_state = state;
                if changed {
                    this.update_clock();
                    this.config_changed(window, cx);
                }
                cx.notify();
            }
        });
        let pattern_state = if model.config.clock.pattern.is_some() { PatternState::Valid } else { PatternState::Default };
        Self { controls, custom_font, pattern, pattern_state, _subscriptions: vec![font_changed, pattern_changed] }
    }
}

impl Settings {
    pub fn update_clock(&mut self) {
        if let Some(preview) = self.preview.as_mut() {
            preview.set_clock(self.model.config.clock.clone());
        }
    }

    pub fn set_clock_position(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        if self.model.set_clock_position(POSITIONS[index].0) {
            self.update_clock();
            self.config_changed(window, cx);
        }
    }

    fn clock_row(&self, name: &str, disabled: bool, cx: &Context<Self>) -> Option<impl IntoElement + use<>> {
        self.simple_row(&Target::Clock, name, disabled, cx)
    }

    pub(crate) fn clock_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let enabled = self.model.config.clock.enabled;
        let disabled = !enabled;
        let position = self.model.config.clock.position;
        let custom = self.model.config.clock.font == ClockFont::Custom;
        let now = chrono::Local::now();
        let (time, date) = self.model.clock_example(&now);
        let state = self.clock_ui.pattern_state;
        let grid = (0..3).map(|row| {
            h_flex().gap_1().children((0..3).map(|column| {
                let index = row * 3 + column;
                let (value, name, arrow) = POSITIONS[index];
                let selected = value == position;
                Button::new(("clock-position", index))
                    .small()
                    .outline()
                    .w(px(40.))
                    .label(arrow)
                    .selected(selected)
                    .toggled(selected)
                    .disabled(disabled)
                    .accessibility_label(name)
                    .tooltip(name)
                    .on_click(cx.listener(move |this, _, window, cx| this.set_clock_position(index, window, cx)))
            }))
        });
        v_flex()
            .gap_4()
            .flex_none()
            .children(self.clock_row("enabled", false, cx))
            .child(
                v_flex()
                    .gap_4()
                    .when(disabled, |this| this.opacity(0.5))
                    .child(
                        v_flex()
                            .gap_1()
                            .child(
                                h_flex()
                                    .gap_2()
                                    .child(div().font_weight(FontWeight::MEDIUM).child("Placement"))
                                    .child(div().text_xs().text_color(rgb(QUIET)).child(POSITIONS.iter().find(|(value, ..)| *value == position).map_or("", |(_, name, _)| *name))),
                            )
                            .child(v_flex().gap_1().children(grid)),
                    )
                    .children(self.clock_row("font", disabled, cx))
                    .when(custom, |this| {
                        this.child(
                            v_flex()
                                .gap_1()
                                .child(div().font_weight(FontWeight::MEDIUM).child("Installed font name"))
                                .child(Input::new(&self.clock_ui.custom_font).small().disabled(disabled).aria_label("Installed font name"))
                                .child(note("Uses a font installed on this computer.")),
                        )
                    })
                    .children(self.clock_row("weight", disabled, cx))
                    .children(self.clock_row("size", disabled, cx))
                    .children(self.clock_row("color", disabled, cx))
                    .children(self.clock_row("opacity", disabled, cx))
                    .children(self.clock_row("margin", disabled, cx))
                    .child(
                        v_flex()
                            .gap_3()
                            .pt_3()
                            .border_t_1()
                            .border_color(rgb(LINE))
                            .child(label("TIME AND DATE"))
                            .children(self.clock_row("format", disabled, cx))
                            .children(self.clock_row("show_seconds", disabled, cx))
                            .children(self.clock_row("show_date", disabled, cx))
                            .children(self.clock_row("shadow", disabled, cx)),
                    )
                    .child(
                        v_flex()
                            .gap_2()
                            .pt_3()
                            .border_t_1()
                            .border_color(rgb(LINE))
                            .child(label("CUSTOM TIME PATTERN"))
                            .child(Input::new(&self.clock_ui.pattern).small().disabled(disabled).cleanable(true).aria_label("Custom time pattern"))
                            .child(note("Optional strftime-style pattern for the time line, for example %H:%M, %-I:%M %p or %a %H:%M:%S. Leave it empty to use the format above. The date line still follows Show date."))
                            .child(match state {
                                PatternState::Invalid => live("clock-status-1", "This pattern can’t be used, so the clock shows the default format until it is fixed.")
                                    .text_size(px(13.))
                                    .text_color(rgb(SIGNAL_HOVER)),
                                PatternState::Valid => live("clock-status-2", "Using your pattern.").text_size(px(13.)).text_color(rgb(MUTED)),
                                PatternState::Default => live("clock-status-3", "Using the default format.").text_size(px(13.)).text_color(rgb(MUTED)),
                            })
                            .child(
                                v_flex()
                                    .gap_1()
                                    .p_2()
                                    .rounded(px(5.))
                                    .border_1()
                                    .border_color(rgb(if state == PatternState::Invalid { SIGNAL } else { LINE }))
                                    .child(div().text_xs().text_color(rgb(QUIET)).child("EXAMPLE NOW"))
                                    .child(div().text_size(px(20.)).child(time))
                                    .when(!date.is_empty(), |this| this.child(div().text_size(px(13.)).text_color(rgb(MUTED)).child(date))),
                            ),
                    ),
            )
    }
}

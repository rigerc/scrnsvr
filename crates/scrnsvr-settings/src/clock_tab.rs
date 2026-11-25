//! Clock tab: every clock setting, edited live in the preview.

use gpui_kit::component::button::{Button, ButtonCustomVariant, ButtonVariants};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{Disableable, Selectable, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use scrnsvr_core::clock::ClockFont;

use crate::app::Settings;
use crate::controls::{Control, Target};
use crate::model::Model;
use crate::model::clock::{POSITIONS, PatternState, clock_defs};
use crate::view::{ALERT, CANVAS, CONTROL_HOVER, INK, LINE, MUTED, QUIET, RAISED, SIGNAL, STRONG_LINE, dot, notice, section};

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

    /// Placement as a miniature of the screen: nine spots, the chosen one holding a little clock.
    fn placement(&self, disabled: bool, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let position = self.model.config.clock.position;
        let cells = (0..3).map(|row| {
            h_flex().flex_1().gap(px(3.)).children((0..3).map(|column| {
                let index = row * 3 + column;
                let (value, name, _) = POSITIONS[index];
                let selected = value == position;
                let align = match column {
                    0 => "start",
                    1 => "center",
                    _ => "end",
                };
                let marker = h_flex()
                    .size_full()
                    .px_2()
                    .items_center()
                    .when(align == "start", |this| this.justify_start())
                    .when(align == "center", |this| this.justify_center())
                    .when(align == "end", |this| this.justify_end())
                    .child(if selected {
                        h_flex()
                            .gap(px(3.))
                            .items_center()
                            .child(dot(SIGNAL, 6.))
                            .child(div().w(px(22.)).h(px(4.)).rounded_full().bg(rgb(INK)))
                            .into_any_element()
                    } else {
                        dot(STRONG_LINE, 4.).into_any_element()
                    });
                Button::new(("clock-position", index))
                    .custom(
                        ButtonCustomVariant::new(cx)
                            .color(if selected { rgba(0x23d5ab1f).into() } else { transparent_black() })
                            .foreground(rgb(INK).into())
                            .hover(rgb(CONTROL_HOVER).into())
                            .active(rgb(CONTROL_HOVER).into()),
                    )
                    .flex_1()
                    .h_full()
                    .p_0()
                    .rounded(px(4.))
                    .child(marker)
                    .selected(selected)
                    .toggled(selected)
                    .disabled(disabled)
                    .accessibility_label(name)
                    .tooltip(name)
                    .on_click(cx.listener(move |this, _, window, cx| this.set_clock_position(index, window, cx)))
            }))
        });
        let name = POSITIONS.iter().find(|(value, ..)| *value == position).map_or("", |(_, name, _)| *name);
        v_flex()
            .gap_2()
            .child(
                h_flex()
                    .justify_between()
                    .child(div().font_weight(FontWeight::MEDIUM).child("Placement"))
                    .child(div().text_size(px(12.)).text_color(rgb(QUIET)).child(name)),
            )
            .child(
                v_flex()
                    .w_full()
                    .max_w(px(320.))
                    .h(px(150.))
                    .p(px(4.))
                    .gap(px(3.))
                    .rounded(px(10.))
                    .border_2()
                    .border_color(rgb(STRONG_LINE))
                    .bg(rgb(CANVAS))
                    .children(cells),
            )
    }

    pub(crate) fn clock_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let enabled = self.model.config.clock.enabled;
        let disabled = !enabled;
        let custom = self.model.config.clock.font == ClockFont::Custom;
        let now = chrono::Local::now();
        let (time, date) = self.model.clock_example(&now);
        let state = self.clock_ui.pattern_state;
        v_flex()
            .gap_6()
            .flex_none()
            .child(
                v_flex()
                    .gap_3()
                    .p_3()
                    .rounded(px(10.))
                    .bg(rgb(RAISED))
                    .children(self.clock_row("enabled", false, cx))
                    .child(
                        v_flex()
                            .py_3()
                            .items_center()
                            .rounded(px(8.))
                            .bg(rgb(CANVAS))
                            .border_1()
                            .border_color(rgb(if state == PatternState::Invalid { ALERT } else { LINE }))
                            .when(disabled, |this| this.opacity(0.5))
                            .child(div().text_size(px(26.)).line_height(px(32.)).child(time))
                            .when(!date.is_empty(), |this| this.child(div().text_size(px(12.)).text_color(rgb(MUTED)).child(date))),
                    ),
            )
            .child(
                v_flex()
                    .gap_6()
                    .when(disabled, |this| this.opacity(0.5))
                    .child(section("POSITION").child(self.placement(disabled, cx)).children(self.clock_row("margin", disabled, cx)))
                    .child(
                        section("TYPE")
                            .gap_4()
                            .children(self.clock_row("font", disabled, cx))
                            .when(custom, |this| {
                                this.child(
                                    v_flex()
                                        .gap(px(6.))
                                        .child(div().font_weight(FontWeight::MEDIUM).child("Installed font name"))
                                        .child(Input::new(&self.clock_ui.custom_font).small().disabled(disabled).aria_label("Installed font name"))
                                        .child(div().text_size(px(12.)).text_color(rgb(QUIET)).child("Uses a font installed on this computer.")),
                                )
                            })
                            .children(self.clock_row("weight", disabled, cx))
                            .children(self.clock_row("size", disabled, cx)),
                    )
                    .child(
                        section("APPEARANCE")
                            .gap_4()
                            .children(self.clock_row("color", disabled, cx))
                            .children(self.clock_row("opacity", disabled, cx))
                            .children(self.clock_row("shadow", disabled, cx)),
                    )
                    .child(
                        section("TIME AND DATE")
                            .gap_4()
                            .children(self.clock_row("format", disabled, cx))
                            .children(self.clock_row("show_seconds", disabled, cx))
                            .children(self.clock_row("show_date", disabled, cx))
                            .child(
                                v_flex()
                                    .gap(px(6.))
                                    .child(div().font_weight(FontWeight::MEDIUM).child("Custom time pattern"))
                                    .child(div().text_size(px(12.)).text_color(rgb(QUIET)).child(
                                        "Optional strftime pattern for the time line, such as %H:%M, %-I:%M %p or %a %H:%M:%S. Leave it empty to use the format above. The date line still follows Show date.",
                                    ))
                                    .child(
                                        Input::new(&self.clock_ui.pattern)
                                            .small()
                                            .disabled(disabled)
                                            .cleanable(true)
                                            .aria_label("Custom time pattern"),
                                    )
                                    .child(match state {
                                        PatternState::Invalid => notice(
                                            "clock-status-1",
                                            "This pattern can’t be used, so the clock shows the default format until it is fixed.",
                                            ALERT,
                                        ),
                                        PatternState::Valid => notice("clock-status-2", "Using your pattern.", SIGNAL),
                                        PatternState::Default => notice("clock-status-3", "Using the default format.", QUIET),
                                    }),
                            ),
                    ),
            )
    }
}

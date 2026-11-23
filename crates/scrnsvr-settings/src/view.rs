//! Three-pane visual mixer and its compact layout.

use gpui_kit::component::button::{Button, ButtonCustomVariant, ButtonVariants};
use gpui_kit::component::input::{Escape, Input};
use gpui_kit::component::select::Select;
use gpui_kit::component::{ActiveTheme, Disableable, Icon, IconName, Selectable, Sizable, Theme, ThemeMode, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use scrnsvr_core::catalog::{ShaderValues, UniformKind};

use crate::app::{LookAction, Settings};
use crate::controls::Control;
use crate::model::{self, RandomScope};
use crate::preview::Placement;

const CANVAS: u32 = 0x171819;
const SURFACE: u32 = 0x191a1b;
const PREVIEW_SURFACE: u32 = 0x1a1b1c;
const RAISED: u32 = 0x222425;
const CONTROL: u32 = 0x252728;
const LINE: u32 = 0x343738;
const STRONG_LINE: u32 = 0x505455;
const INK: u32 = 0xebe9e2;
const MUTED: u32 = 0xb6b5ae;
const QUIET: u32 = 0x959892;
const SIGNAL: u32 = 0xef7b4d;
const SIGNAL_HOVER: u32 = 0xff976d;
const SAVED: u32 = 0x85c6a1;

pub fn init_theme(cx: &mut App) {
    Theme::change(ThemeMode::Dark, None, cx);
    let fonts = cx.text_system().all_font_names();
    let interface_font = ["Inter Tight", "Liberation Sans"].into_iter().find(|name| fonts.iter().any(|installed| installed == name));
    Theme::update(cx, |theme| {
        theme.background = rgb(CANVAS).into();
        theme.foreground = rgb(INK).into();
        theme.popover = rgb(RAISED).into();
        theme.popover_foreground = rgb(INK).into();
        theme.primary = rgb(SIGNAL).into();
        theme.primary_hover = rgb(SIGNAL_HOVER).into();
        theme.primary_foreground = rgb(CANVAS).into();
        theme.secondary = rgb(CONTROL).into();
        theme.secondary_foreground = rgb(INK).into();
        theme.muted = rgb(CONTROL).into();
        theme.muted_foreground = rgb(MUTED).into();
        theme.accent = rgb(CONTROL).into();
        theme.accent_foreground = rgb(INK).into();
        theme.border = rgb(LINE).into();
        theme.input = rgb(STRONG_LINE).into();
        theme.ring = rgb(SIGNAL).into();
        theme.slider_bar = rgb(SIGNAL).into();
        theme.slider_thumb = rgb(SIGNAL).into();
        theme.button = rgb(CONTROL).into();
        theme.button_hover = rgb(RAISED).into();
        theme.button_foreground = rgb(INK).into();
        theme.shadow = false;
        theme.radius = px(5.);
        theme.radius_lg = px(8.);
        if let Some(font) = interface_font {
            theme.font_family = font.into();
        }
        theme.font_size = px(14.);
    });
}

fn button(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Button {
    Button::new(id).small().outline().label(label)
}

fn label(text: impl Into<SharedString>) -> Div {
    div().text_size(px(11.)).font_weight(FontWeight::BOLD).text_color(rgb(MUTED)).child(text.into())
}

fn note(text: impl Into<SharedString>) -> Div {
    div().text_size(px(13.)).text_color(rgb(MUTED)).child(text.into())
}

impl Render for Settings {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let viewport = window.viewport_size();
        let width = f32::from(viewport.width);
        let height = f32::from(viewport.height);
        let desktop = width > 980.;
        let stacked = width <= 620.;
        let bank_width = if desktop { (width * 0.25).max(250.) } else { 250. };
        let inspector_width = (width * 0.25).max(272.);
        let stage_column_width = if stacked {
            width
        } else if desktop {
            width - bank_width - inspector_width
        } else {
            width - bank_width
        };
        let workspace_height = (height - 54.).max(1.);
        let top_height = if desktop || stacked { workspace_height } else { (workspace_height * 0.6).max(200.) };
        let display_aspect = window
            .display(cx)
            .map(|display| {
                let bounds = display.bounds();
                f32::from(bounds.size.width) / f32::from(bounds.size.height)
            })
            .filter(|ratio| ratio.is_finite() && *ratio > 0.)
            .unwrap_or(16. / 9.);
        let stage_width = (stage_column_width - 40.).clamp(1., 1100.);
        let stage_height = (stage_width / display_aspect).min((top_height - 155.).max(120.));
        let stage_width = stage_width.min(stage_height * display_aspect);

        let menu_width = (bank_width + 160.).min(width - 40.).max(200.);
        let bank = self.bank(menu_width, cx);
        let preview = self.stage(stage_width, stage_height, cx);
        let inspector = self.inspector(cx);
        let workspace = if desktop {
            h_flex()
                .items_stretch()
                .size_full()
                .child(div().w(px(bank_width)).flex_none().h_full().child(bank))
                .child(div().flex_1().h_full().min_w_0().child(preview))
                .child(div().w(px(inspector_width)).flex_none().h_full().child(inspector))
                .into_any_element()
        } else if stacked {
            v_flex()
                .id("stacked-workspace")
                .size_full()
                .overflow_y_scroll()
                .child(div().h(px(stage_height + 180.)).flex_none().child(preview))
                .child(div().h(px(290.)).flex_none().child(bank))
                .child(div().h(px(500.)).flex_none().child(inspector))
                .into_any_element()
        } else {
            v_flex()
                .size_full()
                .child(
                    h_flex()
                        .h(px(top_height))
                        .flex_none()
                        .items_stretch()
                        .child(div().w(px(bank_width)).flex_none().child(bank))
                        .child(div().flex_1().min_w_0().child(preview)),
                )
                .child(div().flex_1().min_h_0().child(inspector))
                .into_any_element()
        };

        v_flex()
            .size_full()
            .font_family(cx.theme().font_family.clone())
            .text_size(px(14.))
            .text_color(rgb(INK))
            .child(self.header(stacked, cx))
            .child(div().flex_1().min_h_0().child(workspace))
    }
}

impl Settings {
    fn header(&self, compact: bool, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let tabs = [("Visuals", false), ("Saved looks", true)].map(|(name, looks)| {
            let active = self.show_looks == looks;
            div()
                .h_full()
                .flex()
                .items_center()
                .border_b_2()
                .border_color(if active { rgb(SIGNAL).into() } else { transparent_black() })
                .child(
                    button(name, name)
                        .custom(
                            ButtonCustomVariant::new(cx)
                                .foreground(rgb(if active { SIGNAL } else { MUTED }).into())
                                .hover(rgb(RAISED).into()),
                        )
                        .selected(active)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.show_looks = looks;
                            this.inspector_scroll.set_offset(point(px(0.), px(0.)));
                            cx.notify();
                        })),
                )
        });
        let failed = self.config_save.error.is_some();
        let status = if self.config_save.pending() {
            "Saving…"
        } else if failed {
            "Could not save"
        } else {
            "Saved locally"
        };
        h_flex()
            .h(px(54.))
            .flex_none()
            .justify_between()
            .px(if compact { px(10.) } else { px(20.) })
            .border_b_1()
            .border_color(rgb(LINE))
            .bg(rgb(CANVAS))
            .child(
                h_flex()
                    .h_full()
                    .gap(if compact { px(8.) } else { px(24.) })
                    .child(div().text_size(px(17.)).font_weight(FontWeight::SEMIBOLD).child("scrnsvr"))
                    .children(tabs),
            )
            .child(
                h_flex()
                    .gap_2()
                    .min_w_0()
                    .when(!self.load_warnings.is_empty(), |this| {
                        this.child(button("load-warning", "Config details").ghost().on_click(cx.listener(|this, _, _, cx| {
                            this.warning_details = !this.warning_details;
                            cx.notify();
                        })))
                    })
                    .child(
                        div()
                            .id("save-status")
                            .track_focus(&self.save_status_focus)
                            .role(Role::Status)
                            .text_xs()
                            .text_color(rgb(if failed {
                                SIGNAL_HOVER
                            } else if self.config_save.pending() {
                                MUTED
                            } else {
                                SAVED
                            }))
                            .child(status),
                    )
                    .when(failed && !self.config_save.pending(), |this| {
                        this.child(button("retry-save", "Retry save").on_click(cx.listener(|this, _, window, cx| {
                            this.save_status_focus.focus(window, cx);
                            this.retry(window, cx);
                        })))
                    }),
            )
    }

    fn bank(&self, menu_width: f32, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let groups = self.model.matches();
        let count: usize = groups.iter().map(|(_, rows)| rows.len()).sum();
        let mut layout_index = 0;
        let visible_rows: Vec<_> = groups
            .iter()
            .flat_map(|(_, rows)| {
                layout_index += 1; // Category heading consumes a scroll item.
                rows.iter()
                    .map(|index| {
                        let row = (layout_index, *index);
                        layout_index += 1;
                        row
                    })
                    .collect::<Vec<_>>()
            })
            .collect();
        let filter = self.model.favorites_only;
        let scroll = v_flex()
            .id("shader-list")
            .track_scroll(&self.bank_scroll)
            .flex_1()
            .min_h_0()
            .gap_1()
            .px_1()
            .py_1()
            .overflow_y_scroll()
            .on_key_down(cx.listener(move |this, event: &KeyDownEvent, window, cx| {
                let direction = match event.keystroke.key.as_str() {
                    "up" => -1,
                    "down" => 1,
                    "home" => 0,
                    "end" => 2,
                    _ => return,
                };
                let Some(focused) = window.focused(cx) else { return };
                let Some(current) = visible_rows.iter().position(|(_, index)| this.row_focus[*index] == focused) else { return };
                let last = visible_rows.len() - 1;
                let next = match direction {
                    0 => 0,
                    2 => last,
                    _ => current.saturating_add_signed(direction).min(last),
                };
                let (position, index) = visible_rows[next];
                this.row_focus[index].focus(window, cx);
                this.bank_scroll.scroll_to_item(position);
                cx.stop_propagation();
            }))
            .children(groups.into_iter().flat_map(|(group, rows)| {
                std::iter::once(label(group.to_uppercase()).pt_3().pb_1().into_any_element())
                    .chain(rows.into_iter().map(|index| self.bank_row(index, cx).into_any_element()))
            }));
        let storage_error = self.ui_save.error.as_ref().or(self.ui_warning.as_ref());
        v_flex()
            .size_full()
            .p_4()
            .gap_3()
            .bg(rgb(SURFACE))
            .border_r_1()
            .border_color(rgb(LINE))
            .child(label("SHADER BANK"))
            .child(
                div().flex_none().child(
                    Select::new(&self.quick_picker)
                        .small()
                        .menu_width(px(menu_width))
                        .menu_max_h(px(360.))
                        .accessibility_label("Quick select visual"),
                ),
            )
            .child(Input::new(&self.search).small().cleanable(true).aria_label("Search visuals"))
            .child(
                h_flex()
                    .flex_none()
                    .gap_2()
                    .child(button("all", "All").selected(!filter).on_click(cx.listener(|this, _, _, cx| this.filter(false, cx))))
                    .child(
                        button("favorites", "Favorites")
                            .selected(filter)
                            .track_focus(&self.filters_focus)
                            .on_click(cx.listener(|this, _, _, cx| this.filter(true, cx))),
                    )
                    .child(div().flex_1())
                    .child(
                        div().text_xs().text_color(rgb(QUIET)).child(format!("{count} {}", if count == 1 { "visual" } else { "visuals" })),
                    ),
            )
            .when_some(storage_error, |this, error| {
                this.child(note("Favorites are available for this session only.")).when(
                    self.ui_save.error.is_some() && !self.ui_save.pending(),
                    |this| {
                        this.child(
                            button("retry-favorites", "Retry favorites")
                                .tooltip(error.clone())
                                .on_click(cx.listener(|this, _, window, cx| this.retry(window, cx))),
                        )
                    },
                )
            })
            .when(count == 0, |this| {
                this.child(
                    v_flex().gap_2().items_start().child(note("No visuals match these filters.")).child(
                        button("clear", "Clear filters").on_click(cx.listener(|this, _, window, cx| this.clear_filters(window, cx))),
                    ),
                )
            })
            .child(scroll)
    }

    fn bank_row(&self, index: usize, cx: &Context<Self>) -> impl IntoElement + use<> {
        let visual = &self.model.visuals[index];
        let selected = self.model.selected == index;
        let favorite = self.model.ui.favorites.contains(&visual.id);
        let favorite_label =
            if favorite { format!("Remove {} from favorites", visual.title) } else { format!("Add {} to favorites", visual.title) };
        h_flex()
            .id(("shader", index))
            .flex_none()
            .gap_1()
            .p_1()
            .rounded(px(5.))
            .border_1()
            .border_color(rgb(if selected { SIGNAL } else { LINE }))
            .bg(rgb(if selected { RAISED } else { SURFACE }))
            .child(
                div().flex_1().min_w_0().child(
                    Button::new(("choose", index))
                        .small()
                        .ghost()
                        .w_full()
                        .child(
                            div()
                                .w_full()
                                .overflow_hidden()
                                .text_ellipsis()
                                .text_color(rgb(if selected { SIGNAL } else { INK }))
                                .child(visual.title.clone()),
                        )
                        .accessibility_label(visual.title.clone())
                        .selected(selected)
                        .track_focus(&self.row_focus[index])
                        .on_click(cx.listener(move |this, _, window, cx| this.select(index, window, cx))),
                ),
            )
            .child(
                Button::new(("favorite", index))
                    .small()
                    .ghost()
                    .icon(Icon::new(IconName::Star).text_color(rgb(if favorite { SIGNAL } else { QUIET })))
                    .selected(favorite)
                    .accessibility_label(favorite_label.clone())
                    .tooltip(favorite_label)
                    .on_click(cx.listener(move |this, _, window, cx| this.favorite(index, window, cx))),
            )
    }

    fn stage(&self, width: f32, height: f32, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let entity = cx.entity().downgrade();
        let hole = canvas(
            |_, _, _| {},
            move |bounds, _, window, cx| {
                let bounds = bounds.intersect(&window.content_mask().bounds);
                let placement = Placement {
                    x: f32::from(bounds.origin.x).round() as i32,
                    y: f32::from(bounds.origin.y).round() as i32,
                    width: f32::from(bounds.size.width).max(0.).round() as i32,
                    height: f32::from(bounds.size.height).max(0.).round() as i32,
                    scale: window.scale_factor().ceil().max(1.) as i32,
                };
                let _ = entity.update(cx, |this, _| {
                    if let Some(preview) = this.preview.as_mut() {
                        preview.place(placement);
                    }
                });
            },
        )
        .size_full();
        let visual = self.model.visual();
        let space = v_flex()
            .id("preview-caption")
            .overflow_y_scroll()
            .flex_1()
            .min_h_0()
            .items_center()
            .gap_4()
            .p_5()
            .bg(rgb(PREVIEW_SURFACE))
            .child(
                v_flex()
                    .w(px(width))
                    .max_w_full()
                    .gap_3()
                    .child(
                        div()
                            .border_t_1()
                            .border_color(rgb(LINE))
                            .pt_3()
                            .text_size(px(36.))
                            .line_height(px(41.))
                            .child(visual.title.clone()),
                    )
                    .when(!visual.description.is_empty(), |this| this.child(note(visual.description.clone())))
                    .child(
                        h_flex()
                            .flex_wrap()
                            .gap_2()
                            .child(
                                button("pause", if self.paused { "Resume preview" } else { "Pause preview" })
                                    .track_focus(&self.pause_focus)
                                    .disabled(self.preview.is_none())
                                    .on_click(cx.listener(|this, _, _, cx| this.toggle_pause(cx))),
                            )
                            .children(self.model.undo_label().map(|undo| {
                                button("preview-undo", undo)
                                    .track_focus(&self.undo_focus)
                                    .on_click(cx.listener(|this, _, window, cx| this.undo(window, cx)))
                            })),
                    )
                    .children(self.preview_error.clone().map(note))
                    .children(self.config_save.error.as_ref().map(|error| note(format!("Your edits are still here. {error}"))))
                    .when(self.close_after_save && (self.config_save.error.is_some() || self.ui_save.error.is_some()), |this| {
                        this.child(button("discard-and-close", "Close without saving").on_click(|_, window, _| window.remove_window()))
                    })
                    .when(self.warning_details, |this| this.children(self.load_warnings.iter().cloned().map(note))),
            );
        v_flex()
            .size_full()
            .child(h_flex().h(px(20.)).flex_none().bg(rgb(PREVIEW_SURFACE)))
            .child(
                h_flex()
                    .flex_none()
                    .h(px(height))
                    .items_stretch()
                    .child(div().flex_1().bg(rgb(PREVIEW_SURFACE)))
                    .child(div().relative().w(px(width)).h_full().flex_none().child(hole).when(self.preview.is_none(), |this| {
                        this.bg(rgb(CANVAS))
                            .child(div().absolute().inset_0().flex().items_center().justify_center().child("Preview unavailable"))
                    }))
                    .child(div().flex_1().bg(rgb(PREVIEW_SURFACE))),
            )
            .child(space)
    }

    fn inspector(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let values = self.model.effective();
        let has_controls = !self.controls.is_empty();
        v_flex()
            .size_full()
            .p_4()
            .gap_3()
            .bg(rgb(SURFACE))
            .border_l_1()
            .border_color(rgb(LINE))
            .child(label(if self.show_looks { "SAVED LOOKS" } else { "INSPECTOR" }))
            .child(
                v_flex()
                    .id("inspector-scroll")
                    .track_scroll(&self.inspector_scroll)
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .gap_4()
                    .px_1()
                    .pb_2()
                    .when(self.show_looks, |this| this.child(self.looks(cx)))
                    .when(!self.show_looks && !has_controls, |this| this.child(note("This visual has no adjustable parameters.")))
                    .when(!self.show_looks && has_controls, |this| {
                        this.child(self.control_toolbar(cx))
                            .children(["Motion", "Shape", "Color"].into_iter().filter_map(|group| self.control_group(group, &values, cx)))
                            .when(self.controls.iter().any(|control| control.def.advanced), |this| {
                                this.child(
                                    button("advanced", if self.advanced { "Hide advanced" } else { "Advanced" })
                                        .selected(self.advanced)
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.advanced = !this.advanced;
                                            cx.notify();
                                        })),
                                )
                                .when(self.advanced, |this| {
                                    this.children(
                                        self.controls
                                            .iter()
                                            .filter(|control| control.def.advanced && model::visible(&control.def, &values))
                                            .map(|control| self.control_row(control, &values, cx)),
                                    )
                                })
                            })
                    }),
            )
    }

    fn control_toolbar(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        v_flex()
            .gap_2()
            .pb_3()
            .border_b_1()
            .border_color(rgb(LINE))
            .flex_none()
            .child(
                h_flex()
                    .gap_2()
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(Select::new(&self.random_scope).small().menu_width(px(165.)).accessibility_label("Randomize scope")),
                    )
                    .child(button("randomize", "Randomize").on_click(cx.listener(|this, _, window, cx| {
                        let selected = this.random_scope.read(cx).selected_value().map(|value| value.as_ref());
                        let scope = RandomScope::OPTIONS
                            .into_iter()
                            .find(|(label, _)| Some(*label) == selected)
                            .map_or(RandomScope::Structure, |(_, scope)| scope);
                        if this.model.randomize(scope, rand::random) {
                            this.finish_bulk_edit(window, cx);
                        }
                    }))),
            )
            .child(
                h_flex()
                    .flex_wrap()
                    .gap_2()
                    .child(button("reset-shader", "Reset shader").disabled(self.model.stored().is_none()).on_click(cx.listener(
                        |this, _, window, cx| {
                            if this.model.reset_shader() {
                                this.finish_bulk_edit(window, cx);
                                this.pause_focus.focus(window, cx);
                            }
                        },
                    )))
                    .child(
                        button("show-locks", if self.show_locks { "Hide locks" } else { "Show locks" }).selected(self.show_locks).on_click(
                            cx.listener(|this, _, _, cx| {
                                this.show_locks = !this.show_locks;
                                cx.notify();
                            }),
                        ),
                    ),
            )
    }

    fn control_group(&self, group: &str, values: &ShaderValues, cx: &Context<Self>) -> Option<impl IntoElement + use<>> {
        let controls: Vec<_> = self
            .controls
            .iter()
            .filter(|control| !control.def.advanced && model::group(&control.def) == group && model::visible(&control.def, values))
            .collect();
        (!controls.is_empty()).then(|| {
            v_flex()
                .gap_3()
                .flex_none()
                .child(label(group.to_uppercase()))
                .children(controls.into_iter().map(|control| self.control_row(control, values, cx)))
        })
    }

    fn control_row(&self, control: &Control, values: &ShaderValues, cx: &Context<Self>) -> impl IntoElement + use<> {
        let def = &control.def;
        let locked = self.model.locked(&def.name);
        let edited = self.model.stored().is_some_and(|values| values.contains_key(&def.name));
        let title = def.title();
        let name = SharedString::from(def.name.clone());
        let reset_name = name.clone();
        let lock_name = name.clone();
        let escape_name = name.clone();
        let color_source = (def.kind == UniformKind::Color).then(|| {
            if edited {
                "Custom"
            } else if values[&def.name] == def.default {
                "Built-in"
            } else {
                "From scheme"
            }
        });
        v_flex()
            .id((ElementId::from("uniform"), name.clone()))
            .flex_none()
            .gap_1()
            .on_action(cx.listener(move |this, event: &Escape, window, cx| this.cancel_control_edit(&escape_name, event, window, cx)))
            .child(
                h_flex()
                    .gap_2()
                    .justify_between()
                    .child(div().font_weight(FontWeight::MEDIUM).flex_1().child(title.to_owned()))
                    .when(self.show_locks || locked, |this| {
                        this.child(
                            button((ElementId::from("lock"), name.clone()), if locked { "Locked" } else { "Lock" })
                                .ghost()
                                .selected(locked)
                                .accessibility_label(format!("Lock {title} during randomization"))
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    this.model.toggle_lock(&lock_name);
                                    if !this.show_locks && !this.model.locked(&lock_name) {
                                        this.focus_control(&lock_name, window, cx);
                                    }
                                    cx.notify();
                                })),
                        )
                    })
                    .child(
                        button((ElementId::from("reset"), name), "Reset")
                            .ghost()
                            .disabled(!edited)
                            .accessibility_label(format!("Reset {title}"))
                            .on_click(cx.listener(move |this, _, window, cx| this.reset_control(&reset_name, window, cx))),
                    ),
            )
            .children(def.description.clone().map(note))
            .child(control.element(&values[&def.name], cx))
            .children(color_source.map(|source| div().text_xs().text_color(rgb(QUIET)).child(source)))
            .children(
                self.selected_control_error
                    .as_ref()
                    .filter(|(name, _)| *name == def.name)
                    .map(|(_, error)| div().text_xs().text_color(rgb(SIGNAL_HOVER)).child(error.clone())),
            )
    }

    fn looks(&self, cx: &Context<Self>) -> impl IntoElement + use<> {
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
        let rows: Vec<_> = self.model.looks().cloned().collect();
        v_flex()
            .id("looks")
            .gap_4()
            .flex_none()
            .on_action(cx.listener(|this, _: &Escape, window, cx| {
                this.cancel_look(window, cx);
                this.look_name.update(cx, |state, cx| state.focus(window, cx));
            }))
            .child(div().text_lg().child(self.model.visual().title.clone()))
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
                    .children(self.look_message.clone().map(note)),
            )
            .when(rows.is_empty(), |this| this.child(note("Adjust this visual, then save a look to keep those settings.")))
            .children(rows.into_iter().map(|name| {
                let apply = name.clone();
                let rename = name.clone();
                let delete = name.clone();
                let key = SharedString::from(name.clone());
                v_flex()
                    .flex_none()
                    .gap_2()
                    .pt_2()
                    .border_t_1()
                    .border_color(rgb(LINE))
                    .child(div().font_weight(FontWeight::MEDIUM).child(name))
                    .child(
                        h_flex()
                            .flex_wrap()
                            .gap_2()
                            .child(button((ElementId::from("apply"), key.clone()), "Apply").on_click(cx.listener(
                                move |this, _, window, cx| {
                                    if this.model.apply_look(&apply) {
                                        this.finish_bulk_edit(window, cx);
                                    }
                                    this.look_message = Some(format!("Applied “{apply}”."));
                                    cx.notify();
                                },
                            )))
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

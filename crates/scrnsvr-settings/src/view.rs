//! Three-pane visual mixer and its compact layout.

use gpui_kit::component::button::{Button, ButtonCustomVariant, ButtonVariants};
use gpui_kit::component::input::{Escape, Input};
use gpui_kit::component::select::Select;
use gpui_kit::component::{ActiveTheme, Disableable, Icon, IconName, Selectable, Sizable, Theme, ThemeMode, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use scrnsvr_core::catalog::{ShaderValues, UniformKind};

use crate::app::{Settings, Tab};
use crate::controls::{Control, Target};
use crate::fullscreen::Fullscreen;
use crate::model::{self, RandomScope};
use crate::preview::Placement;

pub(crate) const CANVAS: u32 = 0x171819;
pub(crate) const SURFACE: u32 = 0x191a1b;
pub(crate) const PREVIEW_SURFACE: u32 = 0x1a1b1c;
pub(crate) const RAISED: u32 = 0x222425;
pub(crate) const CONTROL: u32 = 0x252728;
pub(crate) const LINE: u32 = 0x343738;
pub(crate) const STRONG_LINE: u32 = 0x505455;
pub(crate) const INK: u32 = 0xebe9e2;
pub(crate) const MUTED: u32 = 0xb6b5ae;
pub(crate) const QUIET: u32 = 0x959892;
pub(crate) const SIGNAL: u32 = 0xef7b4d;
pub(crate) const SIGNAL_HOVER: u32 = 0xff976d;
pub(crate) const SAVED: u32 = 0x85c6a1;

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

pub(crate) fn button(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Button {
    Button::new(id).small().outline().label(label)
}

pub(crate) fn label(text: impl Into<SharedString>) -> Div {
    div().text_size(px(11.)).font_weight(FontWeight::BOLD).text_color(rgb(MUTED)).child(text.into())
}

/// A live-region line: assistive technology announces changes to its text.
pub(crate) fn status(id: impl Into<ElementId>) -> Stateful<Div> {
    div().id(id).role(Role::Status)
}

/// A live-region line with its text. GPUI does not expose plain text in the accessibility tree,
/// so the text is also the region's label, which is what a screen reader reads and announces.
pub(crate) fn live(id: impl Into<ElementId>, text: impl Into<SharedString>) -> Stateful<Div> {
    let text = text.into();
    status(id).aria_label(text.clone()).child(text)
}

pub(crate) fn note(text: impl Into<SharedString>) -> Div {
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
        let editing = self.tab == Tab::Visuals && self.model.is_custom();
        let reserved = if self.tab == Tab::Looks || editing { 380. } else { 155. };
        let stage_height = (stage_width / display_aspect).min((top_height - reserved).max(120.));
        let stage_width = stage_width.min(stage_height * display_aspect);

        let menu_width = (bank_width + 160.).min(width - 40.).max(200.);
        let columns = if width >= 1700. { 3 } else { 2 };
        let bank = self.bank(bank_width, menu_width, columns, cx);
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
        let tabs = Tab::ALL.map(|tab| {
            let active = self.tab == tab;
            div()
                .h_full()
                .flex()
                .flex_none()
                .items_center()
                .border_b_2()
                .border_color(if active { rgb(SIGNAL).into() } else { transparent_black() })
                .child(
                    button(("tab", tab as usize), tab.title())
                        .custom(
                            ButtonCustomVariant::new(cx)
                                .foreground(rgb(if active { SIGNAL } else { MUTED }).into())
                                .hover(rgb(RAISED).into()),
                        )
                        .selected(active)
                        .toggled(active)
                        .track_focus(&self.tab_focus[tab as usize])
                        // Roving focus: only the selected tab is reached with Tab. Arrow keys move along the row.
                        .tab_stop(active)
                        .on_click(cx.listener(move |this, _, window, cx| this.show_tab(tab, window, cx))),
                )
        });
        let tab_row = h_flex()
            .id("tabs")
            .role(Role::TabList)
            .h_full()
            .min_w_0()
            .gap(if compact { px(2.) } else { px(12.) })
            .overflow_x_scroll()
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                let current = this.tab;
                let next = match event.keystroke.key.as_str() {
                    "left" => current.offset(-1),
                    "right" => current.offset(1),
                    "home" => Tab::Visuals,
                    "end" => Tab::Settings,
                    _ => return,
                };
                // Only react while a tab itself has focus, not controls inside the panel.
                if !this.tab_focus.iter().any(|handle| handle.is_focused(window)) {
                    return;
                }
                this.step_tab(next, window, cx);
                cx.stop_propagation();
            }))
            .children(tabs);
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
            .px(if compact { px(8.) } else { px(20.) })
            .border_b_1()
            .border_color(rgb(LINE))
            .bg(rgb(CANVAS))
            .child(
                h_flex()
                    .h_full()
                    .min_w_0()
                    .gap(if compact { px(6.) } else { px(24.) })
                    .when(!compact, |this| this.child(div().text_size(px(17.)).font_weight(FontWeight::SEMIBOLD).child("scrnsvr")))
                    .child(tab_row),
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
                            .aria_label(status)
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

    fn bank(&self, bank_width: f32, menu_width: f32, columns: usize, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let groups = self.model.matches();
        let count: usize = groups.iter().map(|(_, rows)| rows.len()).sum();
        // Panel padding (2 × 16), its border and the list's padding (2 × 4) come off the width.
        let tile_width = ((bank_width - 41. - 8. * (columns as f32 - 1.)) / columns as f32).floor().max(64.);
        let mut layout_index = 0;
        let mut tiles = Vec::new();
        for (_, rows) in &groups {
            layout_index += 1; // Category heading consumes a scroll item.
            for chunk in rows.chunks(columns) {
                tiles.extend(chunk.iter().map(|index| (layout_index, *index)));
                layout_index += 1; // Each row of tiles is one scroll item.
            }
        }
        let visible_rows = tiles;
        let filter = self.model.favorites_only;
        let scroll = v_flex()
            .id("shader-list")
            .track_scroll(&self.bank_scroll)
            .flex_1()
            .min_h_0()
            .gap_2()
            .px_1()
            .py_1()
            .overflow_y_scroll()
            .on_key_down(cx.listener(move |this, event: &KeyDownEvent, window, cx| {
                let Some(focused) = window.focused(cx) else { return };
                let Some(current) = visible_rows.iter().position(|(_, index)| this.row_focus[*index] == focused) else { return };
                let last = visible_rows.len() - 1;
                let next = match event.keystroke.key.as_str() {
                    "left" => current.saturating_sub(1),
                    "right" => (current + 1).min(last),
                    "up" => current.saturating_sub(columns),
                    "down" => (current + columns).min(last),
                    "home" => 0,
                    "end" => last,
                    _ => return,
                };
                let (position, index) = visible_rows[next];
                this.row_focus[index].focus(window, cx);
                this.bank_scroll.scroll_to_item(position);
                cx.stop_propagation();
            }))
            .children(groups.into_iter().flat_map(|(group, rows)| {
                let tiles: Vec<_> = rows
                    .chunks(columns)
                    .map(|chunk| {
                        h_flex()
                            .gap_2()
                            .items_start()
                            .flex_none()
                            .children(chunk.iter().map(|index| self.bank_tile(*index, tile_width, cx).into_any_element()))
                            .into_any_element()
                    })
                    .collect();
                std::iter::once(label(group.to_uppercase()).pt_3().pb_1().into_any_element()).chain(tiles)
            }));
        let storage_error = self.ui_save.error.as_ref().or(self.ui_warning.as_ref());
        v_flex()
            .size_full()
            .p_4()
            .gap_3()
            .bg(rgb(SURFACE))
            .border_r_1()
            .border_color(rgb(LINE))
            .child(
                h_flex().justify_between().items_center().child(label("SHADER BANK")).child(
                    button("add-shader", "Add shader")
                        .track_focus(&self.custom.add_focus)
                        .accessibility_label("Add custom shader")
                        .tooltip("Add a custom GLSL shader")
                        .on_click(cx.listener(|this, _, window, cx| this.add_custom_shader(window, cx))),
                ),
            )
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

    /// A portrait thumbnail with the visual's name beneath it. The active tile gains a coral border and name.
    fn bank_tile(&self, index: usize, width: f32, cx: &Context<Self>) -> impl IntoElement + use<> {
        let visual = &self.model.visuals[index];
        let selected = self.model.selected == index;
        let favorite = self.model.ui.favorites.contains(&visual.id);
        let favorite_label =
            if favorite { format!("Remove {} from favorites", visual.title) } else { format!("Add {} to favorites", visual.title) };
        let height = (width * 157. / 125.).round();
        let picture = match self.thumbnails.image(&visual.id) {
            Some(path) => img(path.to_path_buf()).size_full().object_fit(ObjectFit::Cover).into_any_element(),
            None => {
                let (text, tip) = match self.thumbnails.failure(&visual.id) {
                    Some(error) => ("No preview", Some(error.to_owned())),
                    None if self.thumbnails.available() => ("Rendering…", None),
                    None => ("No preview", None),
                };
                div()
                    .id(("placeholder", index))
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_size(px(11.))
                    .text_color(rgb(QUIET))
                    .when_some(tip, |this, tip| {
                        this.tooltip(move |window, cx| gpui_kit::component::tooltip::Tooltip::new(tip.clone()).build(window, cx))
                    })
                    .child(text)
                    .into_any_element()
            }
        };
        v_flex()
            .id(("shader", index))
            .w(px(width))
            .flex_none()
            .gap_1()
            .child(
                div()
                    .relative()
                    .w(px(width))
                    .h(px(height))
                    .rounded(px(5.))
                    .overflow_hidden()
                    .border_2()
                    .border_color(rgb(if selected { SIGNAL } else { LINE }))
                    .bg(rgb(RAISED))
                    .child(
                        Button::new(("choose", index))
                            .ghost()
                            .size_full()
                            .p_0()
                            .child(picture)
                            .accessibility_label(visual.title.clone())
                            .selected(selected)
                            .toggled(selected)
                            .track_focus(&self.row_focus[index])
                            .on_click(cx.listener(move |this, _, window, cx| this.select(index, window, cx))),
                    )
                    .child(
                        div().absolute().top_1().right_1().rounded(px(4.)).bg(rgba(0x171819cc)).child(
                            Button::new(("favorite", index))
                                .small()
                                .ghost()
                                .icon(Icon::new(IconName::Star).text_color(rgb(if favorite { SIGNAL } else { MUTED })))
                                .selected(favorite)
                                .accessibility_label(favorite_label.clone())
                                .tooltip(favorite_label)
                                .on_click(cx.listener(move |this, _, window, cx| this.favorite(index, window, cx))),
                        ),
                    ),
            )
            .child(
                div()
                    .w_full()
                    .overflow_hidden()
                    .text_ellipsis()
                    .whitespace_nowrap()
                    .text_size(px(13.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(rgb(if selected { SIGNAL } else { INK }))
                    .child(visual.title.clone()),
            )
    }

    fn fullscreen_button(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        match &self.fullscreen {
            Fullscreen::Showing => button("fullscreen", "Exit fullscreen")
                .accessibility_label("Exit the fullscreen preview")
                .on_click(cx.listener(|this, _, window, cx| this.exit_fullscreen(window, cx))),
            state => button("fullscreen", "Fullscreen preview")
                .accessibility_label("Show this visual fullscreen, the way the screensaver does")
                .disabled(*state == Fullscreen::Saving)
                .on_click(cx.listener(|this, _, window, cx| this.start_fullscreen(window, cx))),
        }
    }

    fn fullscreen_note(&self, cx: &mut Context<Self>) -> Option<impl IntoElement + use<>> {
        let (text, failed) = match &self.fullscreen {
            Fullscreen::Idle => return None,
            Fullscreen::Saving => ("Saving your edits, then opening the fullscreen preview…".to_owned(), false),
            Fullscreen::Showing => ("The fullscreen preview is showing. Press any key or move the pointer to close it.".to_owned(), false),
            Fullscreen::Failed(error) => (error.clone(), true),
        };
        Some(
            h_flex()
                .gap_2()
                .items_center()
                .flex_wrap()
                .child(live("fullscreen-status", text).text_size(px(13.)).text_color(rgb(if failed { SIGNAL_HOVER } else { MUTED })))
                .when(failed, |this| {
                    this.child(
                        button("dismiss-fullscreen-error", "Dismiss")
                            .ghost()
                            .on_click(cx.listener(|this, _, _, cx| this.dismiss_fullscreen_message(cx))),
                    )
                }),
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
                            .child(self.fullscreen_button(cx))
                            .children(self.model.undo_label().map(|undo| {
                                button("preview-undo", undo)
                                    .track_focus(&self.undo_focus)
                                    .on_click(cx.listener(|this, _, window, cx| this.undo(window, cx)))
                            })),
                    )
                    .children(self.fullscreen_note(cx))
                    .children(self.preview_error.clone().map(note))
                    .children(
                        self.effect_warnings()
                            .into_iter()
                            .map(|warning| live("effect-warning", warning).text_size(px(13.)).text_color(rgb(SIGNAL_HOVER))),
                    )
                    .children(self.config_save.error.as_ref().map(|error| note(format!("Your edits are still here. {error}"))))
                    .when(self.close_after_save && (self.config_save.error.is_some() || self.ui_save.error.is_some()), |this| {
                        this.child(button("discard-and-close", "Close without saving").on_click(|_, window, _| window.remove_window()))
                    })
                    .when(self.warning_details, |this| this.children(self.load_warnings.iter().cloned().map(note)))
                    .when(self.tab == Tab::Looks, |this| {
                        this.child(div().pt_3().border_t_1().border_color(rgb(LINE)).child(self.looks_workspace(cx)))
                    })
                    .when(self.tab == Tab::Visuals && self.model.is_custom(), |this| {
                        this.child(div().pt_3().border_t_1().border_color(rgb(LINE)).child(self.custom_workspace(cx)))
                    }),
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
        let heading = match self.tab {
            Tab::Visuals => "INSPECTOR",
            Tab::Effects => "GLOBAL EFFECTS",
            Tab::Looks => "SHUFFLE",
            Tab::Clock => "CLOCK OVERLAY",
            Tab::Settings => "SETTINGS",
        };
        let body = match self.tab {
            Tab::Visuals => self.visuals_inspector(cx).into_any_element(),
            Tab::Effects => self.effects_panel(cx).into_any_element(),
            Tab::Looks => self.shuffle_panel(cx).into_any_element(),
            Tab::Clock => self.clock_panel(cx).into_any_element(),
            Tab::Settings => self.system_panel(cx).into_any_element(),
        };
        v_flex().size_full().p_4().gap_3().bg(rgb(SURFACE)).border_l_1().border_color(rgb(LINE)).child(label(heading)).child(
            v_flex()
                .id("inspector-scroll")
                .track_scroll(&self.inspector_scroll)
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .gap_4()
                .px_1()
                .pb_2()
                .child(body),
        )
    }

    fn visuals_inspector(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let values = self.model.effective();
        let has_controls = !self.controls.is_empty();
        v_flex()
            .gap_4()
            .when(!has_controls && self.model.is_custom(), |this| {
                this.child(note("Custom shaders have no adjustable parameters. Edit the source under the preview."))
            })
            .when(!has_controls && !self.model.is_custom(), |this| this.child(note("This visual has no adjustable parameters.")))
            .when(has_controls, |this| {
                this.child(self.control_toolbar(cx))
                    .children(["Motion", "Shape", "Color"].into_iter().filter_map(|group| self.control_group(group, &values, cx)))
                    .when(self.controls.iter().any(|control| control.def.advanced), |this| {
                        this.child(
                            button("advanced", if self.advanced { "Hide advanced" } else { "Advanced" }).selected(self.advanced).on_click(
                                cx.listener(|this, _, _, cx| {
                                    this.advanced = !this.advanced;
                                    cx.notify();
                                }),
                            ),
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
            })
            .child(self.color_section(cx))
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
                    )
                    .child(button("open-save-look", "Save look").on_click(cx.listener(|this, _, window, cx| {
                        this.show_tab(Tab::Looks, window, cx);
                        this.look_name.update(cx, |state, cx| state.focus(window, cx));
                    }))),
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
            .on_action(cx.listener(move |this, event: &Escape, window, cx| {
                this.cancel_control_edit(&Target::Shader, &escape_name, event, window, cx)
            }))
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
            .child(control.element(&values[&def.name], false, cx))
            .children(color_source.map(|source| div().text_xs().text_color(rgb(QUIET)).child(source)))
            .children(
                self.control_error
                    .as_ref()
                    .filter(|(key, name, _)| *key == Target::Shader.key() && *name == def.name)
                    .map(|(_, _, error)| div().text_xs().text_color(rgb(SIGNAL_HOVER)).child(error.clone())),
            )
    }
}

//! The visual mixer in the Focus identity: a brand bar, the library, the live stage and the
//! inspector, with compact layouts for narrow windows.

use gpui_kit::component::button::{Button, ButtonCustomVariant, ButtonVariants};
use gpui_kit::component::input::{Escape, Input};
use gpui_kit::component::select::Select;
use gpui_kit::component::{ActiveTheme, Disableable, Icon, IconName, Selectable, Sizable, Theme, ThemeMode, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use scrnsvr_core::catalog::{ShaderValues, UniformKind};

use crate::app::{LookAction, Pane, Settings, Tab};
use crate::controls::{Control, Target};
use crate::fullscreen::Fullscreen;
use crate::model::{self, RandomScope};
use crate::preview::Placement;

// The Focus palette. Night (#101522) is the brand's own ground; the shell steps a little darker
// for chrome and darker still behind the preview, so shader color always reads brightest.
pub(crate) const CANVAS: u32 = 0x0b0f19;
pub(crate) const NIGHT: u32 = 0x101522;
pub(crate) const SURFACE: u32 = NIGHT;
pub(crate) const PREVIEW_SURFACE: u32 = 0x080b13;
pub(crate) const RAISED: u32 = 0x161d2d;
pub(crate) const CONTROL: u32 = 0x1a2234;
pub(crate) const CONTROL_HOVER: u32 = 0x232d44;
pub(crate) const LINE: u32 = 0x1f283a;
pub(crate) const STRONG_LINE: u32 = 0x34405a;
pub(crate) const INK: u32 = 0xedf1f7;
pub(crate) const MUTED: u32 = 0xa8b2c4;
pub(crate) const QUIET: u32 = 0x8590a6;
/// Brand teal: selection, focus, the active section and adjustable values.
pub(crate) const SIGNAL: u32 = 0x23d5ab;
pub(crate) const SIGNAL_HOVER: u32 = 0x5be5c4;
/// Brand blue, lifted for text on Night: work in progress and shuffle membership.
pub(crate) const BLUE: u32 = 0x8aa6ff;
/// The brand blue itself, as a fill under white: shuffle membership.
pub(crate) const BRAND_BLUE: u32 = 0x3268ff;
/// Problems only. Kept warm so it never reads as a selection.
pub(crate) const ALERT: u32 = 0xff8f70;
pub(crate) const SAVED: u32 = 0x8fe3c8;

pub fn init_theme(cx: &mut App) {
    Theme::change(ThemeMode::Dark, None, cx);
    let fonts = cx.text_system().all_font_names();
    let interface_font =
        ["Inter Tight", "Inter", "Liberation Sans"].into_iter().find(|name| fonts.iter().any(|installed| installed == name));
    Theme::update(cx, |theme| {
        theme.background = rgb(CANVAS).into();
        theme.foreground = rgb(INK).into();
        theme.popover = rgb(RAISED).into();
        theme.popover_foreground = rgb(INK).into();
        theme.primary = rgb(SIGNAL).into();
        theme.primary_hover = rgb(SIGNAL_HOVER).into();
        theme.primary_active = rgb(SIGNAL).into();
        theme.primary_foreground = rgb(NIGHT).into();
        theme.button_primary = rgb(SIGNAL).into();
        theme.button_primary_hover = rgb(SIGNAL_HOVER).into();
        theme.button_primary_active = rgb(SIGNAL).into();
        theme.button_primary_foreground = rgb(NIGHT).into();
        theme.secondary = rgb(CONTROL).into();
        theme.secondary_hover = rgb(CONTROL_HOVER).into();
        theme.secondary_active = rgb(CONTROL_HOVER).into();
        theme.secondary_foreground = rgb(INK).into();
        theme.muted = rgb(CONTROL).into();
        theme.muted_foreground = rgb(MUTED).into();
        theme.accent = rgb(CONTROL_HOVER).into();
        theme.accent_foreground = rgb(INK).into();
        theme.border = rgb(LINE).into();
        theme.input = rgb(STRONG_LINE).into();
        theme.ring = rgb(SIGNAL).into();
        theme.caret = rgb(SIGNAL).into();
        theme.selection = rgba(0x23d5ab40).into();
        theme.slider_bar = rgb(SIGNAL).into();
        theme.slider_thumb = rgb(INK).into();
        theme.switch = rgb(STRONG_LINE).into();
        theme.switch_thumb = rgb(INK).into();
        theme.list_hover = rgb(CONTROL_HOVER).into();
        theme.list_active = rgba(0x23d5ab26).into();
        theme.list_active_border = rgb(SIGNAL).into();
        theme.scrollbar = transparent_black();
        theme.scrollbar_thumb = rgba(0xa8b2c440).into();
        theme.scrollbar_thumb_hover = rgba(0xa8b2c480).into();
        theme.button = rgb(CONTROL).into();
        theme.button_hover = rgb(CONTROL_HOVER).into();
        theme.button_active = rgb(CONTROL_HOVER).into();
        theme.button_foreground = rgb(INK).into();
        theme.button_info = rgb(BRAND_BLUE).into();
        theme.button_info_hover = rgb(0x4a7bff).into();
        theme.button_info_active = rgb(0x3268ff).into();
        theme.button_info_foreground = rgb(0xffffff).into();
        theme.button_danger = rgb(ALERT).into();
        theme.button_danger_hover = rgb(0xffa68d).into();
        theme.button_danger_active = rgb(ALERT).into();
        theme.button_danger_foreground = rgb(NIGHT).into();
        theme.danger = rgb(ALERT).into();
        theme.success = rgb(SAVED).into();
        theme.info = rgb(BLUE).into();
        theme.shadow = false;
        theme.radius = px(6.);
        theme.radius_lg = px(10.);
        if let Some(font) = interface_font {
            theme.font_family = font.into();
        }
        theme.font_size = px(14.);
    });
}

/// A Lucide glyph from Kit's bundle or the extra set in `assets/icons`.
pub(crate) fn glyph(name: &str) -> Icon {
    Icon::default().path(format!("icons/{name}.svg"))
}

pub(crate) fn button(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Button {
    Button::new(id).small().outline().label(label)
}

/// A labelled button that leads with a glyph.
pub(crate) fn action(id: impl Into<ElementId>, icon: &str, label: impl Into<SharedString>) -> Button {
    button(id, label).icon(glyph(icon))
}

/// A glyph-only button. The label is spoken and shown as a tooltip.
pub(crate) fn icon_button(id: impl Into<ElementId>, icon: &str, label: impl Into<SharedString>) -> Button {
    let label = label.into();
    Button::new(id).small().ghost().icon(glyph(icon)).accessibility_label(label.clone()).tooltip(label)
}

/// A small uppercase group label.
pub(crate) fn label(text: impl Into<SharedString>) -> Div {
    div().text_size(px(11.)).font_weight(FontWeight::BOLD).text_color(rgb(QUIET)).child(text.into())
}

/// A group label followed by a hairline that runs to the panel edge.
pub(crate) fn rule(text: impl Into<SharedString>) -> Div {
    h_flex().gap_2().items_center().child(label(text)).child(div().flex_1().h(px(1.)).bg(rgb(LINE)))
}

/// A titled group inside a panel: a ruled label above its rows.
pub(crate) fn section(text: impl Into<SharedString>) -> Div {
    v_flex().gap_3().flex_none().child(rule(text))
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

/// The focal dot from the Focus mark. It marks whatever is current: the open section, the chosen
/// visual, the save state.
pub(crate) fn dot(color: u32, size: f32) -> Div {
    div().flex_none().size(px(size)).rounded_full().bg(rgb(color))
}

/// A status line led by a dot in its tone, announced when it changes.
pub(crate) fn notice(id: impl Into<ElementId>, text: impl Into<SharedString>, tone: u32) -> Div {
    h_flex()
        .gap_2()
        .items_start()
        .child(div().pt(px(6.)).child(dot(tone, 6.)))
        .child(live(id, text).flex_1().min_w_0().text_size(px(13.)).text_color(rgb(if tone == ALERT { ALERT } else { MUTED })))
}

/// The Focus symbol in white at `opacity`, for empty and waiting states.
pub(crate) fn mark(width: f32, opacity: f32) -> Svg {
    svg().path("brand/symbol.svg").w(px(width)).h(px(width * 176. / 232.)).text_color(hsla(0., 0., 1., opacity))
}

impl Tab {
    fn icon(self) -> &'static str {
        match self {
            Self::Visuals => "images",
            Self::Shuffle => "shuffle",
            Self::Clock => "clock",
            Self::Settings => "settings",
        }
    }

    /// The content panel's heading and the line under it. Visuals is headed by the visual itself.
    fn heading(self) -> (&'static str, &'static str) {
        match self {
            Self::Visuals => ("Visual", "Pick a look, then tune its parameters and effects. Everything saves on its own."),
            Self::Shuffle => ("Shuffle", "The visuals and looks the screensaver picks from at random, and how often it changes."),
            Self::Clock => ("Clock overlay", "Drawn above every visual, in the preview and on screen."),
            Self::Settings => ("System", "Playback, colors, idle and this install."),
        }
    }
}

impl Render for Settings {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let viewport = window.viewport_size();
        let width = f32::from(viewport.width);
        let height = f32::from(viewport.height);
        let stacked = width <= 760.;
        let collapsed = self.model.ui.preview_collapsed;
        let library_width = if stacked { width } else { (width * 0.22).clamp(232., 440.) };
        let preview_width = if stacked {
            width
        } else if collapsed {
            RAIL_WIDTH
        } else {
            (width * 0.34).clamp(300., 680.)
        };
        let display_aspect = window
            .display(cx)
            .map(|display| {
                let bounds = display.bounds();
                f32::from(bounds.size.width) / f32::from(bounds.size.height)
            })
            .filter(|ratio| ratio.is_finite() && *ratio > 0.)
            .unwrap_or(16. / 9.);
        // The screen fills the panel's width, less its 16px gutters, and never more than half the
        // window's height, so the deck under it stays in view.
        let screen_width = (preview_width - 32.).max(1.);
        let screen_height = (screen_width / display_aspect).min((height - HEADER_HEIGHT) * 0.5).max(1.);
        let screen_width = screen_width.min(screen_height * display_aspect);

        let columns = if library_width >= 400. { 3 } else { 2 };
        let library = self.bank(library_width, columns, cx);
        let content = self.content(cx);
        let preview = self.preview_panel(screen_width, screen_height, stacked, cx);
        let workspace = if stacked {
            v_flex()
                .id("stacked-workspace")
                .size_full()
                .overflow_y_scroll()
                .child(div().flex_none().when(!collapsed, |this| this.h(px(screen_height + 260.))).child(preview))
                .child(div().h(px(340.)).flex_none().border_t_1().border_color(rgb(LINE)).child(library))
                .child(div().h(px(640.)).flex_none().border_t_1().border_color(rgb(LINE)).child(content))
                .into_any_element()
        } else {
            h_flex()
                .items_stretch()
                .size_full()
                .child(div().w(px(library_width)).flex_none().h_full().child(library))
                .child(div().flex_1().h_full().min_w_0().child(content))
                .child(div().w(px(preview_width)).flex_none().h_full().child(preview))
                .into_any_element()
        };

        v_flex()
            .size_full()
            .font_family(cx.theme().font_family.clone())
            .text_size(px(14.))
            .text_color(rgb(INK))
            .child(self.header(width, cx))
            .child(div().flex_1().min_h_0().child(workspace))
    }
}

const HEADER_HEIGHT: f32 = 56.;
/// The folded preview panel.
const RAIL_WIDTH: f32 = 52.;

impl Settings {
    /// The brand bar: the Focus app icon and wordmark, the section switcher and the save state.
    fn header(&self, width: f32, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let compact = width <= 620.;
        // Every section names itself on wide windows. Narrower, only the open one keeps its label.
        let all_labels = width > 1120.;
        let tabs = Tab::ALL.map(|tab| {
            let active = self.tab == tab;
            let labelled = all_labels || (active && !compact);
            let style = ButtonCustomVariant::new(cx)
                .color(if active { rgb(CONTROL).into() } else { transparent_black() })
                .foreground(rgb(if active { INK } else { MUTED }).into())
                .hover(rgb(RAISED).into())
                .active(rgb(CONTROL_HOVER).into());
            let mut item = Button::new(("tab", tab as usize))
                .custom(style)
                .rounded(px(8.))
                .h(px(34.))
                .px(px(if labelled { 12. } else { 9. }))
                .icon(glyph(tab.icon()).text_color(rgb(if active { SIGNAL } else { QUIET })))
                .accessibility_label(tab.title())
                .selected(active)
                .toggled(active)
                .track_focus(&self.tab_focus[tab as usize])
                // Roving focus: only the selected tab is reached with Tab. Arrow keys move along the row.
                .tab_stop(active)
                .on_click(cx.listener(move |this, _, window, cx| this.show_tab(tab, window, cx)));
            if labelled {
                item = item.label(tab.title());
            } else {
                item = item.tooltip(tab.title());
            }
            item
        });
        let tab_row = h_flex()
            .id("tabs")
            .role(Role::TabList)
            .h_full()
            .min_w_0()
            .items_center()
            .gap_1()
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
        let pending = self.config_save.pending();
        let (status, tone) = if pending {
            ("Saving…", BLUE)
        } else if failed {
            ("Could not save", ALERT)
        } else {
            ("Saved locally", SIGNAL)
        };
        let brand = h_flex()
            .id("brand")
            .flex_none()
            .gap(px(10.))
            .items_center()
            .aria_label("scrnsvr")
            .child(img("brand/appicon-small.svg").size(px(28.)).flex_none())
            .when(width > 820., |this| this.child(svg().path("brand/wordmark.svg").w(px(98.)).h(px(14.)).text_color(rgb(INK))));
        h_flex()
            .h(px(HEADER_HEIGHT))
            .flex_none()
            .justify_between()
            .gap_4()
            .px(px(if compact { 10. } else { 16. }))
            .border_b_1()
            .border_color(rgb(LINE))
            .bg(rgb(CANVAS))
            .child(h_flex().h_full().min_w_0().items_center().gap(px(if compact { 10. } else { 28. })).child(brand).child(tab_row))
            .child(
                h_flex()
                    .gap_2()
                    .flex_none()
                    .items_center()
                    .when(!self.load_warnings.is_empty(), |this| {
                        this.child(
                            Button::new("load-warning")
                                .small()
                                .ghost()
                                .icon(IconName::TriangleAlert)
                                .when(!compact, |this| this.label("Config details"))
                                .accessibility_label("Config details")
                                .tooltip("Some of your configuration could not be read")
                                .selected(self.warning_details)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.warning_details = !this.warning_details;
                                    cx.notify();
                                })),
                        )
                    })
                    .child(
                        h_flex()
                            .id("save-status")
                            .track_focus(&self.save_status_focus)
                            .role(Role::Status)
                            .aria_label(status)
                            .gap_2()
                            .items_center()
                            .h(px(28.))
                            .px(px(10.))
                            .rounded_full()
                            .bg(rgb(RAISED))
                            .child(dot(tone, 7.))
                            .when(!compact || failed, |this| {
                                this.child(div().text_size(px(12.)).text_color(rgb(if failed { ALERT } else { MUTED })).child(status))
                            }),
                    )
                    .when(failed && !pending, |this| {
                        this.child(action("retry-save", "refresh-cw", "Retry save").on_click(cx.listener(|this, _, window, cx| {
                            this.save_status_focus.focus(window, cx);
                            this.retry(window, cx);
                        })))
                    }),
            )
    }

    fn bank(&self, bank_width: f32, columns: usize, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let groups = self.model.matches();
        let count: usize = groups.iter().map(|(_, rows)| rows.len()).sum();
        let total = self.model.visuals.len();
        // Panel padding (2 × 16), its border and the list's padding (2 × 2) come off the width.
        let gap = 10.;
        let tile_width = ((bank_width - 37. - gap * (columns as f32 - 1.)) / columns as f32).floor().max(64.);
        // A folded collection shows only its heading. Search and the collection filter open every
        // group they match, so results never hide behind a folded heading.
        let searching = !self.model.query.trim().is_empty() || self.model.collection.is_some();
        let folded = |group: &str| !searching && self.model.ui.collapsed.contains(group);
        let mut layout_index: usize = 0;
        let mut tiles = Vec::new();
        for (group, rows) in &groups {
            layout_index += 1; // The collection heading consumes a scroll item.
            if folded(group) {
                continue;
            }
            for chunk in rows.chunks(columns) {
                tiles.extend(chunk.iter().map(|index| (layout_index, *index)));
                layout_index += 1; // Each row of tiles is one scroll item.
            }
        }
        // Bring the chosen visual into view once, after the window first lays out.
        if self.reveal_selected.replace(false)
            && let Some(&(position, _)) = tiles.iter().find(|(_, index)| *index == self.model.selected)
        {
            self.bank_scroll.scroll_to_top_of_item(position.saturating_sub(1));
        }
        let visible_rows = tiles;
        let favorites = self.model.favorites_only;
        let collection = self.model.collection.clone();
        let scroll = v_flex()
            .id("shader-list")
            .track_scroll(&self.bank_scroll)
            .flex_1()
            .min_h_0()
            .gap(px(gap))
            .p(px(2.))
            .pb_4()
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
                let closed = folded(&group);
                let toggle = group.clone();
                let heading = div().pt_2().child(
                    Button::new((ElementId::from("collection"), SharedString::from(group.clone())))
                        .ghost()
                        .small()
                        .w_full()
                        .px_1()
                        .disabled(searching)
                        .accessibility_label(format!("{group}, {} visuals, {}", rows.len(), if closed { "folded" } else { "open" }))
                        .tooltip(if closed { "Show this collection" } else { "Fold this collection" })
                        .child(
                            h_flex()
                                .w_full()
                                .gap_2()
                                .items_center()
                                .child(
                                    Icon::new(if closed { IconName::ChevronRight } else { IconName::ChevronDown })
                                        .size(px(12.))
                                        .text_color(rgb(QUIET)),
                                )
                                .child(label(group.to_uppercase()))
                                .child(div().text_size(px(11.)).text_color(rgb(QUIET)).child(rows.len().to_string()))
                                .child(div().flex_1().h(px(1.)).bg(rgb(LINE))),
                        )
                        .on_click(cx.listener(move |this, _, window, cx| this.toggle_collection(&toggle, window, cx))),
                );
                let rows = if closed { Vec::new() } else { rows };
                let tiles: Vec<_> = rows
                    .chunks(columns)
                    .map(|chunk| {
                        h_flex()
                            .gap(px(gap))
                            .items_start()
                            .flex_none()
                            .children(chunk.iter().map(|index| self.bank_tile(*index, tile_width, cx).into_any_element()))
                            .into_any_element()
                    })
                    .collect();
                std::iter::once(heading.into_any_element()).chain(tiles)
            }));
        let storage_error = self.ui_save.error.as_ref().or(self.ui_warning.as_ref());
        // One row of filters: everything, favorites, or a single collection.
        let chip = |id: ElementId, text: String, icon: Option<&str>, active: bool| {
            Button::new(id)
                .xsmall()
                .custom(
                    ButtonCustomVariant::new(cx)
                        .color(if active { rgba(0x23d5ab1f).into() } else { rgb(RAISED).into() })
                        .foreground(rgb(if active { INK } else { MUTED }).into())
                        .hover(rgb(CONTROL_HOVER).into())
                        .active(rgb(CONTROL_HOVER).into()),
                )
                .rounded_full()
                .px_2()
                .label(text)
                .when_some(icon, |this, icon| this.icon(glyph(icon).text_color(rgb(if active { SIGNAL } else { QUIET }))))
                .selected(active)
                .toggled(active)
        };
        let names: Vec<String> = self
            .model
            .collections()
            .into_iter()
            .filter(|name| self.model.visuals.iter().any(|visual| visual.collection == *name))
            .map(Into::into)
            .collect();
        let filters = h_flex()
            .id("library-filters")
            .role(Role::TabList)
            .flex_none()
            .flex_wrap()
            .gap(px(6.))
            .child(
                chip("all".into(), "All".into(), None, !favorites && collection.is_none())
                    .on_click(cx.listener(|this, _, _, cx| this.filter(false, cx))),
            )
            .child(
                chip("favorites".into(), "Favorites".into(), Some("star"), favorites)
                    .track_focus(&self.filters_focus)
                    .on_click(cx.listener(|this, _, _, cx| this.filter(true, cx))),
            )
            .children(names.into_iter().map(|name| {
                let pick = name.clone();
                let active = collection.as_deref() == Some(name.as_str());
                chip((ElementId::from("filter"), SharedString::from(name.clone())).into(), name, None, active)
                    .on_click(cx.listener(move |this, _, _, cx| this.filter_collection(&pick, cx)))
            }));
        v_flex()
            .size_full()
            .p_4()
            .gap_3()
            .bg(rgb(SURFACE))
            .border_r_1()
            .border_color(rgb(LINE))
            .child(
                h_flex()
                    .justify_between()
                    .items_center()
                    .child(
                        h_flex()
                            .gap_2()
                            .items_baseline()
                            .child(div().text_size(px(15.)).font_weight(FontWeight::SEMIBOLD).child("Library"))
                            .child(div().text_size(px(12.)).text_color(rgb(QUIET)).child(if count == total {
                                format!("{total} visuals")
                            } else {
                                format!("{count} of {total}")
                            })),
                    )
                    .child(
                        action("add-shader", "plus", "New shader")
                            .ghost()
                            .track_focus(&self.custom.add_focus)
                            .accessibility_label("Add custom shader")
                            .tooltip("Write or import a GLSL shader")
                            .on_click(cx.listener(|this, _, window, cx| this.add_custom_shader(window, cx))),
                    ),
            )
            .child(
                Input::new(&self.search)
                    .small()
                    .prefix(Icon::new(IconName::Search).text_color(rgb(QUIET)))
                    .cleanable(true)
                    .aria_label("Search visuals"),
            )
            .child(filters)
            .when(self.tab == Tab::Shuffle, |this| {
                this.child(notice("shuffle-hint", "Tick visuals to add them to the shuffle set. Untick to take them out.", BRAND_BLUE))
            })
            .when_some(storage_error, |this, error| {
                this.child(notice("favorites-storage", "Favorites are kept for this session only.", ALERT)).when(
                    self.ui_save.error.is_some() && !self.ui_save.pending(),
                    |this| {
                        this.child(
                            action("retry-favorites", "refresh-cw", "Retry favorites")
                                .tooltip(error.clone())
                                .on_click(cx.listener(|this, _, window, cx| this.retry(window, cx))),
                        )
                    },
                )
            })
            .when(count == 0, |this| {
                this.child(
                    v_flex()
                        .gap_3()
                        .py_6()
                        .items_center()
                        .child(mark(56., 0.16))
                        .child(note(if favorites && self.model.query.trim().is_empty() {
                            "No favorites yet. Star a visual to keep it here."
                        } else {
                            "No visuals match these filters."
                        }))
                        .child(
                            action("clear", "close", "Clear filters")
                                .on_click(cx.listener(|this, _, window, cx| this.clear_filters(window, cx))),
                        ),
                )
            })
            .child(scroll)
    }

    /// A landscape thumbnail, the same shape as the screen it will fill, with the name beneath.
    /// The chosen visual gains a teal frame and the focal dot.
    fn bank_tile(&self, index: usize, width: f32, cx: &Context<Self>) -> impl IntoElement + use<> {
        let visual = &self.model.visuals[index];
        let selected = self.model.selected == index;
        let favorite = self.model.ui.favorites.contains(&visual.id);
        let favorite_label =
            if favorite { format!("Remove {} from favorites", visual.title) } else { format!("Add {} to favorites", visual.title) };
        let shuffled = self.model.rotation_includes_visual(&visual.id);
        // On Looks & Shuffle every tile carries a tick box for the shuffle set. Elsewhere members
        // only wear a small badge, so the set stays visible without inviting stray clicks.
        let picking = self.tab == Tab::Shuffle;
        let shuffle_label =
            if shuffled { format!("Remove {} from shuffle", visual.title) } else { format!("Add {} to shuffle", visual.title) };
        let shuffle_id = visual.id.clone();
        let height = (width * 9. / 16.).round();
        let picture = match self.thumbnails.image(&visual.id) {
            Some(path) => img(path.to_path_buf()).size_full().object_fit(ObjectFit::Cover).into_any_element(),
            None => {
                let (text, tip) = match self.thumbnails.failure(&visual.id) {
                    Some(error) => ("No preview", Some(error.to_owned())),
                    None if self.thumbnails.available() => ("Rendering…", None),
                    None => ("No preview", None),
                };
                v_flex()
                    .id(("placeholder", index))
                    .size_full()
                    .gap_1()
                    .items_center()
                    .justify_center()
                    .text_size(px(11.))
                    .text_color(rgb(QUIET))
                    .when_some(tip, |this, tip| {
                        this.tooltip(move |window, cx| gpui_kit::component::tooltip::Tooltip::new(tip.clone()).build(window, cx))
                    })
                    .child(mark((width * 0.22).clamp(18., 40.), 0.14))
                    .child(text)
                    .into_any_element()
            }
        };
        v_flex()
            .id(("shader", index))
            .w(px(width))
            .flex_none()
            .gap(px(6.))
            .child(
                div()
                    .relative()
                    .w(px(width))
                    .h(px(height))
                    .rounded(px(8.))
                    .overflow_hidden()
                    .border_2()
                    .border_color(if selected { rgba(0x23d5abff) } else { rgba(0xffffff0f) })
                    .bg(rgb(RAISED))
                    .child(
                        Button::new(("choose", index))
                            .ghost()
                            .size_full()
                            .p_0()
                            .rounded(px(6.))
                            .child(picture)
                            .accessibility_label(visual.title.clone())
                            .selected(selected)
                            .toggled(selected)
                            .track_focus(&self.row_focus[index])
                            .on_click(cx.listener(move |this, _, window, cx| this.select(index, window, cx))),
                    )
                    .when(picking, |this| {
                        let pick = Button::new(("shuffle-pick", index))
                            .xsmall()
                            .selected(shuffled)
                            .toggled(shuffled)
                            .accessibility_label(shuffle_label.clone())
                            .tooltip(shuffle_label)
                            .on_click(cx.listener(move |this, _, window, cx| this.toggle_shuffle_visual(&shuffle_id, window, cx)));
                        this.child(div().absolute().top(px(4.)).left(px(4.)).rounded(px(6.)).bg(rgba(0x0b0f19cc)).child(if shuffled {
                            pick.info().icon(Icon::new(IconName::Check))
                        } else {
                            pick.ghost().icon(Icon::new(IconName::Plus).text_color(rgb(INK)))
                        }))
                    })
                    .when(shuffled && !picking, |this| {
                        this.child(
                            div()
                                .absolute()
                                .top(px(6.))
                                .left(px(6.))
                                .p(px(3.))
                                .rounded(px(5.))
                                .bg(rgb(BRAND_BLUE))
                                .child(glyph("shuffle").size(px(11.)).text_color(rgb(0xffffff))),
                        )
                    })
                    .child(
                        div().absolute().top(px(4.)).right(px(4.)).rounded(px(6.)).bg(rgba(0x0b0f19b3)).child(
                            Button::new(("favorite", index))
                                .xsmall()
                                .ghost()
                                .icon(Icon::new(if favorite { IconName::StarFill } else { IconName::Star }).text_color(rgb(if favorite {
                                    SIGNAL
                                } else {
                                    MUTED
                                })))
                                .selected(favorite)
                                .accessibility_label(favorite_label.clone())
                                .tooltip(favorite_label)
                                .on_click(cx.listener(move |this, _, window, cx| this.favorite(index, window, cx))),
                        ),
                    ),
            )
            .child(
                h_flex().w_full().gap(px(6.)).items_center().when(selected, |this| this.child(dot(SIGNAL, 6.))).child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .overflow_hidden()
                        .text_ellipsis()
                        .whitespace_nowrap()
                        .text_size(px(13.))
                        .font_weight(if selected { FontWeight::SEMIBOLD } else { FontWeight::NORMAL })
                        .text_color(rgb(if selected { INK } else { MUTED }))
                        .child(visual.title.clone()),
                ),
            )
    }

    fn fullscreen_button(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        match &self.fullscreen {
            Fullscreen::Showing => action("fullscreen", "minimize", "Exit fullscreen")
                .accessibility_label("Exit the fullscreen preview")
                .on_click(cx.listener(|this, _, window, cx| this.exit_fullscreen(window, cx))),
            state => action("fullscreen", "maximize", "Fullscreen")
                .accessibility_label("Show this visual fullscreen, the way the screensaver does")
                .tooltip("Show it fullscreen, the way the screensaver does")
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
                .child(div().flex_1().min_w_0().child(notice("fullscreen-status", text, if failed { ALERT } else { BLUE })))
                .when(failed, |this| {
                    this.child(
                        button("dismiss-fullscreen-error", "Dismiss")
                            .ghost()
                            .on_click(cx.listener(|this, _, _, cx| this.dismiss_fullscreen_message(cx))),
                    )
                }),
        )
    }

    /// Whether this visual is in the shuffle set, as one toggle: adding takes its current edits,
    /// removing takes every entry for it.
    fn visual_shuffle_toggle(&self, id: &'static str, cx: &mut Context<Self>) -> Button {
        let visual = self.model.visual();
        let included = self.model.rotation_includes_visual(&visual.id);
        let shader = visual.id.clone();
        Button::new(id)
            .small()
            .when(included, |this| this.info())
            .when(!included, |this| this.outline())
            .icon(if included { Icon::new(IconName::Check) } else { glyph("shuffle") })
            .label(if included { "In shuffle" } else { "Add to shuffle" })
            .toggled(included)
            .accessibility_label(if included {
                format!("Remove {} from shuffle", visual.title)
            } else {
                format!("Add {} to shuffle", visual.title)
            })
            .tooltip(if included { "Take it out of the shuffle set" } else { "Let the screensaver shuffle to it" })
            .on_click(cx.listener(move |this, _, window, cx| this.toggle_shuffle_visual(&shader, window, cx)))
    }

    /// The live preview on the right: the screen, what is on it, and its transport. Folded, it
    /// becomes a rail that keeps play and fullscreen in reach.
    fn preview_panel(&self, width: f32, height: f32, stacked: bool, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let collapsed = self.model.ui.preview_collapsed;
        let toggle = icon_button(
            "preview-toggle",
            if collapsed { "panel-right-open" } else { "panel-right-close" },
            if collapsed { "Show preview" } else { "Hide preview" },
        )
        .on_click(cx.listener(|this, _, window, cx| this.toggle_preview(window, cx)));
        let playing = !self.paused && self.preview.is_some();
        let pause =
            icon_button("pause", if self.paused { "play" } else { "pause" }, if self.paused { "Resume preview" } else { "Pause preview" })
                .track_focus(&self.pause_focus)
                .disabled(self.preview.is_none())
                .on_click(cx.listener(|this, _, _, cx| this.toggle_pause(cx)));
        if collapsed && !stacked {
            return v_flex()
                .size_full()
                .items_center()
                .gap_2()
                .pt_3()
                .bg(rgb(PREVIEW_SURFACE))
                .border_l_1()
                .border_color(rgb(LINE))
                .child(toggle)
                .child(div().w(px(20.)).h(px(1.)).bg(rgb(LINE)))
                .child(pause)
                .child(
                    icon_button("fullscreen", "maximize", "Show this visual fullscreen, the way the screensaver does")
                        .disabled(self.fullscreen == Fullscreen::Saving)
                        .on_click(cx.listener(|this, _, window, cx| this.start_fullscreen(window, cx))),
                )
                .child(div().pt_2().child(dot(if playing { SIGNAL } else { QUIET }, 6.)))
                .into_any_element();
        }
        let header = h_flex()
            .flex_none()
            .h(px(48.))
            .px_4()
            .gap_2()
            .items_center()
            .justify_between()
            .child(
                h_flex()
                    .gap_2()
                    .items_center()
                    .child(dot(if playing { SIGNAL } else { QUIET }, 7.))
                    .child(div().text_size(px(13.)).font_weight(FontWeight::SEMIBOLD).child("Live preview"))
                    .child(div().text_size(px(12.)).text_color(rgb(QUIET)).child(if playing { "Playing" } else { "Paused" })),
            )
            .child(toggle);
        if collapsed {
            return v_flex().w_full().bg(rgb(PREVIEW_SURFACE)).child(header).into_any_element();
        }
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
        let favorite = self.model.ui.favorites.contains(&visual.id);
        let mut facts = vec![visual.collection.as_str()];
        if let Some(look) = self.model.look.as_deref() {
            facts.push(look);
        }
        if favorite {
            facts.push("Favorite");
        }
        let screen = h_flex()
            .flex_none()
            .h(px(height))
            .items_stretch()
            .child(div().flex_1().bg(rgb(PREVIEW_SURFACE)))
            .child(div().relative().w(px(width)).h_full().flex_none().child(hole).when(self.preview.is_none(), |this| {
                this.bg(rgb(CANVAS)).rounded(px(8.)).child(
                    v_flex()
                        .absolute()
                        .inset_0()
                        .gap_3()
                        .items_center()
                        .justify_center()
                        .text_color(rgb(MUTED))
                        .child(mark(64., 0.2))
                        .child("Preview unavailable"),
                )
            }))
            .child(div().flex_1().bg(rgb(PREVIEW_SURFACE)));
        let deck = v_flex()
            .id("preview-caption")
            .overflow_y_scroll()
            .flex_1()
            .min_h_0()
            .px_4()
            .pt_4()
            .pb_6()
            .gap_4()
            .child(
                v_flex()
                    .gap_1()
                    .child(div().text_size(px(12.)).text_color(rgb(QUIET)).child(facts.join("  ·  ")))
                    .child(div().text_size(px(22.)).line_height(px(28.)).font_weight(FontWeight::MEDIUM).child(visual.title.clone()))
                    .when(!visual.description.is_empty(), |this| {
                        this.child(div().text_size(px(13.)).text_color(rgb(MUTED)).child(visual.description.clone()))
                    }),
            )
            .child(
                h_flex()
                    .flex_wrap()
                    .gap_2()
                    .child(
                        action("pause-labelled", if self.paused { "play" } else { "pause" }, if self.paused { "Resume" } else { "Pause" })
                            .accessibility_label(if self.paused { "Resume preview" } else { "Pause preview" })
                            .disabled(self.preview.is_none())
                            .on_click(cx.listener(|this, _, _, cx| this.toggle_pause(cx))),
                    )
                    .child(self.fullscreen_button(cx))
                    .child(self.visual_shuffle_toggle("preview-shuffle", cx))
                    .children(self.model.undo_label().map(|undo| {
                        action("preview-undo", "undo-2", undo)
                            .track_focus(&self.undo_focus)
                            .on_click(cx.listener(|this, _, window, cx| this.undo(window, cx)))
                    })),
            )
            .children(self.fullscreen_note(cx))
            .children(self.preview_error.clone().map(|error| notice("preview-error", error, ALERT)))
            .children(self.effect_warnings().into_iter().map(|warning| notice("effect-warning", warning, ALERT)));
        // Only the header, the screen's side fillers and the deck paint. The screen's own rectangle
        // stays clear so the preview subsurface beneath the window shows through it.
        v_flex()
            .size_full()
            .when(!stacked, |this| this.border_l_1().border_color(rgb(LINE)))
            .child(header.bg(rgb(PREVIEW_SURFACE)))
            .child(screen)
            .child(deck.bg(rgb(PREVIEW_SURFACE)))
            .into_any_element()
    }

    /// The selected tab, in the middle: a heading, any problem that concerns the whole window, and
    /// the tab's own controls.
    fn content(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let (title, detail) = self.tab.heading();
        let title: SharedString = if self.tab == Tab::Visuals { self.model.visual().title.clone().into() } else { title.into() };
        let body = match self.tab {
            Tab::Visuals => {
                let pane = match self.pane {
                    Pane::Parameters => v_flex()
                        .gap_8()
                        .when(self.model.is_custom(), |this| this.child(self.custom_workspace(cx)))
                        .child(self.visuals_inspector(cx))
                        .into_any_element(),
                    Pane::Effects => self.effects_panel(cx).into_any_element(),
                };
                v_flex().gap_5().child(self.look_bar(cx)).child(self.pane_switch(cx)).child(pane).into_any_element()
            }
            Tab::Shuffle => self.shuffle_panel(cx).into_any_element(),
            Tab::Clock => self.clock_panel(cx).into_any_element(),
            Tab::Settings => self.system_panel(cx).into_any_element(),
        };
        let problems =
            v_flex()
                .gap_2()
                .children(
                    self.config_save.error.as_ref().map(|error| notice("save-error", format!("Your edits are still here. {error}"), ALERT)),
                )
                .when(self.close_after_save && (self.config_save.error.is_some() || self.ui_save.error.is_some()), |this| {
                    this.child(h_flex().child(
                        action("discard-and-close", "close", "Close without saving").on_click(|_, window, _| window.remove_window()),
                    ))
                })
                .when(self.warning_details, |this| {
                    this.child(
                        v_flex()
                            .gap_2()
                            .p_3()
                            .rounded(px(10.))
                            .bg(rgb(RAISED))
                            .child(label("CONFIGURATION"))
                            .children(self.load_warnings.iter().cloned().map(note)),
                    )
                });
        v_flex()
            .size_full()
            .bg(rgb(CANVAS))
            .child(
                v_flex()
                    .flex_none()
                    .gap_1()
                    .px_6()
                    .pt_5()
                    .pb_4()
                    .border_b_1()
                    .border_color(rgb(LINE))
                    .child(
                        h_flex()
                            .gap_2()
                            .items_center()
                            .child(glyph(self.tab.icon()).size(px(18.)).text_color(rgb(SIGNAL)))
                            .child(div().text_size(px(20.)).font_weight(FontWeight::SEMIBOLD).child(title)),
                    )
                    .child(div().text_size(px(13.)).text_color(rgb(QUIET)).child(detail)),
            )
            .child(
                v_flex()
                    .id("inspector-scroll")
                    .track_scroll(&self.inspector_scroll)
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .px_6()
                    .pt_5()
                    .pb_8()
                    .child(v_flex().w_full().max_w(px(760.)).gap_5().child(problems).child(body)),
            )
    }

    /// Parameters or effects of the look being edited, as one segmented control.
    fn pane_switch(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let layers = self.model.effects().layers.len();
        let segment = |pane: Pane, id: &'static str, icon: &str, text: String| {
            let active = self.pane == pane;
            Button::new(id)
                .small()
                .custom(
                    ButtonCustomVariant::new(cx)
                        .color(if active { rgb(CONTROL_HOVER).into() } else { transparent_black() })
                        .foreground(rgb(if active { INK } else { MUTED }).into())
                        .hover(rgb(CONTROL).into())
                        .active(rgb(CONTROL_HOVER).into()),
                )
                .rounded(px(6.))
                .flex_1()
                .icon(glyph(icon).text_color(rgb(if active { SIGNAL } else { QUIET })))
                .label(text)
                .selected(active)
                .toggled(active)
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.pane = pane;
                    this.inspector_scroll.set_offset(point(px(0.), px(0.)));
                    cx.notify();
                }))
        };
        h_flex()
            .id("editor-panes")
            .role(Role::TabList)
            .flex_none()
            .p(px(3.))
            .gap(px(3.))
            .rounded(px(8.))
            .bg(rgb(RAISED))
            .child(segment(Pane::Parameters, "pane-parameters", "sliders-horizontal", "Parameters".into()))
            .child(segment(
                Pane::Effects,
                "pane-effects",
                "sparkles",
                if layers == 0 { "Effects".into() } else { format!("Effects · {layers}") },
            ))
    }

    fn visuals_inspector(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let values = self.model.effective();
        let has_controls = !self.controls.is_empty();
        v_flex()
            .gap_6()
            .when(!has_controls && self.model.is_custom(), |this| {
                this.child(note("Custom shaders have no adjustable parameters. Edit the source under the preview."))
            })
            .when(!has_controls && !self.model.is_custom(), |this| this.child(note("This visual has no adjustable parameters.")))
            .when(has_controls, |this| {
                this.child(self.control_toolbar(cx))
                    .children(["Motion", "Shape", "Color"].into_iter().filter_map(|group| self.control_group(group, &values, cx)))
                    .when(self.controls.iter().any(|control| control.def.advanced), |this| {
                        this.child(
                            v_flex()
                                .gap_4()
                                .child(
                                    Button::new("advanced")
                                        .small()
                                        .ghost()
                                        .w_full()
                                        .icon(Icon::new(if self.advanced { IconName::ChevronDown } else { IconName::ChevronRight }))
                                        .label(if self.advanced { "Hide advanced" } else { "Advanced" })
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
                                }),
                        )
                    })
            })
            .child(self.color_section(cx))
    }

    /// Randomize with its scope, then the per-visual actions.
    fn control_toolbar(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        v_flex()
            .gap_2()
            .p_3()
            .rounded(px(10.))
            .bg(rgb(RAISED))
            .flex_none()
            .child(
                h_flex()
                    .gap_2()
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(Select::new(&self.random_scope).small().menu_width(px(180.)).accessibility_label("Randomize scope")),
                    )
                    .child(Button::new("randomize").small().primary().icon(glyph("dices")).label("Randomize").on_click(cx.listener(
                        |this, _, window, cx| {
                            let selected = this.random_scope.read(cx).selected_value().map(|value| value.as_ref());
                            let scope = RandomScope::OPTIONS
                                .into_iter()
                                .find(|(label, _)| Some(*label) == selected)
                                .map_or(RandomScope::Structure, |(_, scope)| scope);
                            if this.model.randomize(scope, rand::random) {
                                this.finish_bulk_edit(window, cx);
                            }
                        },
                    ))),
            )
            .child(
                h_flex()
                    .flex_wrap()
                    .gap_1()
                    .child(
                        action("reset-shader", "rotate-ccw", "Reset parameters").ghost().disabled(self.model.stored().is_none()).on_click(
                            cx.listener(|this, _, window, cx| {
                                if this.model.reset_shader() {
                                    this.finish_bulk_edit(window, cx);
                                    this.pause_focus.focus(window, cx);
                                }
                            }),
                        ),
                    )
                    .child(
                        action(
                            "show-locks",
                            if self.show_locks { "lock" } else { "lock-open" },
                            if self.show_locks { "Hide locks" } else { "Locks" },
                        )
                        .ghost()
                        .tooltip("Keep chosen parameters fixed when you randomize")
                        .selected(self.show_locks)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.show_locks = !this.show_locks;
                            cx.notify();
                        })),
                    )
                    .child(action("open-save-look", "bookmark", "Save as look").ghost().on_click(cx.listener(|this, _, window, cx| {
                        this.start_look_action(LookAction::New, window, cx);
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
            section(group.to_uppercase()).gap_5().children(controls.into_iter().map(|control| self.control_row(control, values, cx)))
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
            .gap(px(6.))
            .on_action(cx.listener(move |this, event: &Escape, window, cx| {
                this.cancel_control_edit(&Target::Shader, &escape_name, event, window, cx)
            }))
            .child(
                h_flex()
                    .gap_1()
                    .items_center()
                    .justify_between()
                    .child(
                        h_flex()
                            .flex_1()
                            .min_w_0()
                            .gap_2()
                            .items_center()
                            .child(div().font_weight(FontWeight::MEDIUM).child(title.to_owned()))
                            .when(edited, |this| this.child(dot(SIGNAL, 5.))),
                    )
                    .when(self.show_locks || locked, |this| {
                        this.child(
                            icon_button(
                                (ElementId::from("lock"), name.clone()),
                                if locked { "lock" } else { "lock-open" },
                                format!("Lock {title} during randomization"),
                            )
                            .selected(locked)
                            .when(locked, |this| this.icon(glyph("lock").text_color(rgb(SIGNAL))))
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
                        icon_button((ElementId::from("reset"), name), "rotate-ccw", format!("Reset {title}"))
                            .disabled(!edited)
                            .on_click(cx.listener(move |this, _, window, cx| this.reset_control(&reset_name, window, cx))),
                    ),
            )
            .children(def.description.clone().map(|text| div().text_size(px(12.)).text_color(rgb(QUIET)).child(text)))
            .child(control.element(&values[&def.name], false, cx))
            .children(color_source.map(|source| div().text_size(px(11.)).text_color(rgb(QUIET)).child(source)))
            .children(
                self.control_error
                    .as_ref()
                    .filter(|(key, name, _)| *key == Target::Shader.key() && *name == def.name)
                    .map(|(_, _, error)| div().text_xs().text_color(rgb(ALERT)).child(error.clone())),
            )
    }
}

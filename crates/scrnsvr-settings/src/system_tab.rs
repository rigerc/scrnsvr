//! Settings tab (frame rate, fade, monitors, the global color scheme, Noctalia idle) and the
//! per-visual color scheme and Noctalia color import shown in the Visuals inspector.

use gpui_kit::component::IndexPath;
use gpui_kit::component::searchable_list::{SearchableListItem, SearchableVec};
use gpui_kit::component::select::{Select, SelectEvent, SelectState};
use gpui_kit::component::{Disableable, Sizable, v_flex};
use gpui_kit::*;
use scrnsvr_core::noctalia;

use crate::app::Settings;
use crate::controls::{Control, Target};
use crate::idle_ui::IdleUi;
use crate::model::Model;
use crate::model::clock::global_defs;
use crate::model::colors::{self, NONE};
use crate::view::{LINE, MUTED, button, label, note, status};

#[derive(Clone)]
pub struct SchemeItem {
    id: String,
    title: SharedString,
}

impl SearchableListItem for SchemeItem {
    type Value = String;

    fn title(&self) -> SharedString {
        self.title.clone()
    }

    fn value(&self) -> &String {
        &self.id
    }
}

pub type SchemeSelect = SelectState<SearchableVec<SchemeItem>>;

fn items(leading: &[(&str, &str)]) -> Vec<SchemeItem> {
    leading
        .iter()
        .map(|(id, title)| (id.to_string(), title.to_string()))
        .chain(colors::schemes())
        .map(|(id, title)| SchemeItem { id, title: title.into() })
        .collect()
}

fn position(items: &[SchemeItem], id: &str) -> usize {
    items.iter().position(|item| item.id == id).unwrap_or(0)
}

pub struct SystemUi {
    pub controls: Vec<Control>,
    pub global_scheme: Entity<SchemeSelect>,
    pub shader_scheme: Entity<SchemeSelect>,
    /// Reading Noctalia's colors for the visual that was selected when the import began.
    pub importing: bool,
    pub import_message: Option<String>,
    pub import_task: Option<Task<()>>,
    pub idle: IdleUi,
    _subscriptions: Vec<Subscription>,
}

impl SystemUi {
    pub fn new(model: &Model, window: &mut Window, cx: &mut Context<Settings>) -> Self {
        let controls =
            global_defs().iter().map(|def| Control::new(def, Target::Global, &model.global_value(&def.name), window, cx)).collect();
        let global_items = items(&[(NONE, "Built-in colors")]);
        let global_index = position(&global_items, &model.config.colors.scheme);
        let global_scheme = cx
            .new(|cx| SelectState::new(SearchableVec::new(global_items), Some(IndexPath::new(global_index)), window, cx).searchable(true));
        let shader_items = items(&[("", "Use global scheme"), (NONE, "Built-in colors")]);
        let shader_index = position(&shader_items, model.shader_scheme().unwrap_or(""));
        let shader_scheme = cx
            .new(|cx| SelectState::new(SearchableVec::new(shader_items), Some(IndexPath::new(shader_index)), window, cx).searchable(true));
        let global_chosen =
            cx.subscribe_in(&global_scheme, window, |this, _, event: &SelectEvent<SearchableVec<SchemeItem>>, window, cx| {
                if let SelectEvent::Confirm(Some(id)) = event {
                    this.choose_global_scheme(id, window, cx);
                }
            });
        let shader_chosen =
            cx.subscribe_in(&shader_scheme, window, |this, _, event: &SelectEvent<SearchableVec<SchemeItem>>, window, cx| {
                if let SelectEvent::Confirm(Some(id)) = event {
                    this.choose_shader_scheme(id, window, cx);
                }
            });
        Self {
            controls,
            global_scheme,
            shader_scheme,
            importing: false,
            import_message: None,
            import_task: None,
            idle: IdleUi::new(window, cx),
            _subscriptions: vec![global_chosen, shader_chosen],
        }
    }
}

impl Settings {
    pub fn choose_global_scheme(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.model.config.colors.scheme == id {
            return;
        }
        self.model.set_global_scheme(id);
        self.colors_changed(window, cx);
    }

    pub fn choose_shader_scheme(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let next = (!id.is_empty()).then_some(id);
        if self.model.shader_scheme() == next {
            return;
        }
        self.model.set_shader_scheme(next);
        self.colors_changed(window, cx);
    }

    fn colors_changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.system_ui.import_message = None;
        self.finish_bulk_edit(window, cx);
    }

    /// Show the selected visual's scheme choice after the selection changed.
    pub fn sync_shader_scheme(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let id = self.model.shader_scheme().unwrap_or("").to_owned();
        self.system_ui.shader_scheme.update(cx, |state, cx| {
            if state.selected_value() != Some(&id) {
                state.set_selected_value(&id, window, cx);
            }
        });
        self.system_ui.import_message = None;
    }

    /// Read Noctalia's colors off the UI thread and apply them to the visual selected now.
    pub fn import_noctalia_colors(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.system_ui.importing || !self.model.has_color_controls() {
            return;
        }
        let (shader_id, title) = (self.model.visual().id.clone(), self.model.visual().title.clone());
        let path = self.paths.colors.clone().or_else(noctalia::colors_path);
        self.system_ui.importing = true;
        self.system_ui.import_message = Some("Reading Noctalia colors…".into());
        cx.notify();
        self.system_ui.import_task = Some(cx.spawn_in(window, async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    match path {
                        Some(path) => noctalia::load_colors(&path),
                        None => Err("The configuration directory is unavailable.".into()),
                    }
                })
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                this.system_ui.importing = false;
                this.system_ui.import_message = Some(match result {
                    Ok(roles) => {
                        let changed = this.model.import_colors(&shader_id, &roles);
                        // The selection may have moved while the file was read. The colors still belong to the
                        // visual the import began on, so only refresh what is on screen.
                        if this.model.visual().id == shader_id {
                            this.finish_bulk_edit(window, cx);
                        } else if changed {
                            this.config_changed(window, cx);
                        }
                        if changed {
                            format!("Imported Noctalia colors into {title}.")
                        } else {
                            format!("{title} already uses these Noctalia colors.")
                        }
                    }
                    Err(error) => error,
                });
                cx.notify();
            });
        }));
    }

    /// Per-visual scheme and Noctalia import, at the end of the Visuals inspector.
    pub(crate) fn color_section(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let colored = self.model.has_color_controls();
        v_flex()
            .gap_2()
            .flex_none()
            .pt_3()
            .border_t_1()
            .border_color(rgb(LINE))
            .child(label("COLOR SCHEME"))
            .child(
                Select::new(&self.system_ui.shader_scheme)
                    .small()
                    .disabled(!colored)
                    .menu_max_h(px(320.))
                    .accessibility_label("Color scheme for this visual"),
            )
            .child(status("system-status-11").text_size(px(13.)).text_color(rgb(MUTED)).child(self.model.color_hint()))
            .child(
                button("import-noctalia", if self.system_ui.importing { "Importing…" } else { "Import Noctalia colors" })
                    .disabled(!colored || self.system_ui.importing)
                    .on_click(cx.listener(|this, _, window, cx| this.import_noctalia_colors(window, cx))),
            )
            .child(status("system-status-12").text_size(px(13.)).text_color(rgb(MUTED)).child(
                self.system_ui.import_message.clone().unwrap_or_else(|| {
                    if colored {
                        "Apply your desktop palette to this visual.".into()
                    } else {
                        "This visual uses a built-in palette. Choose one with color controls to import colors.".into()
                    }
                }),
            ))
    }

    pub(crate) fn system_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        v_flex()
            .gap_4()
            .flex_none()
            .child(
                v_flex()
                    .gap_3()
                    .child(label("PLAYBACK"))
                    .children(["fps", "fade_seconds", "monitors"].into_iter().filter_map(|name| self.simple_row(&Target::Global, name, false, cx))),
            )
            .child(
                v_flex()
                    .gap_2()
                    .pt_3()
                    .border_t_1()
                    .border_color(rgb(LINE))
                    .child(label("COLORS"))
                    .child(div().font_weight(FontWeight::MEDIUM).child("Global color scheme"))
                    .child(Select::new(&self.system_ui.global_scheme).small().menu_max_h(px(320.)).accessibility_label("Global color scheme"))
                    .child(note("Applies to every visual that does not choose its own scheme. Choosing a scheme replaces custom colors you set on visuals.")),
            )
            .child(self.idle_section(cx))
    }
}

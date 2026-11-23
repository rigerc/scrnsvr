//! Connects the settings model, component state, preview and background saves.

use std::time::Duration;

use gpui_kit::component::IndexPath;
use gpui_kit::component::input::{InputEvent, InputState};
use gpui_kit::component::searchable_list::{SearchableListItem, SearchableVec};
use gpui_kit::component::select::{SelectEvent, SelectState};
use gpui_kit::*;
use raw_window_handle::{HasDisplayHandle, HasWindowHandle};
use scrnsvr_core::catalog::SettingValue;

use crate::clock_tab::ClockUi;
use crate::controls::{Control, Target};
use crate::effects_tab::EffectsUi;
use crate::looks_tab::ShuffleUi;
use crate::model::{Model, RandomScope};
use crate::persistence::{self, Paths, SaveQueue};
use crate::preview::PreviewSurface;
use crate::system_tab::SystemUi;

pub type TextSelect = SelectState<SearchableVec<SharedString>>;

#[derive(Clone)]
pub struct VisualItem {
    index: usize,
    title: SharedString,
}

impl SearchableListItem for VisualItem {
    type Value = usize;

    fn title(&self) -> SharedString {
        self.title.clone()
    }

    fn value(&self) -> &usize {
        &self.index
    }
}

#[derive(Clone)]
pub enum LookAction {
    Rename(String),
    Delete(String),
    Overwrite(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tab {
    Visuals,
    Effects,
    Looks,
    Clock,
    Settings,
}

impl Tab {
    pub const ALL: [Self; 5] = [Self::Visuals, Self::Effects, Self::Looks, Self::Clock, Self::Settings];

    pub fn title(self) -> &'static str {
        match self {
            Self::Visuals => "Visuals",
            Self::Effects => "Effects",
            Self::Looks => "Looks & Shuffle",
            Self::Clock => "Clock",
            Self::Settings => "Settings",
        }
    }

    /// The tab `steps` places along from this one, wrapping around.
    pub fn offset(self, steps: isize) -> Self {
        Self::ALL[(self as isize + steps).rem_euclid(Self::ALL.len() as isize) as usize]
    }
}

pub struct Settings {
    pub model: Model,
    pub tab: Tab,
    pub tab_focus: Vec<FocusHandle>,
    pub effects_ui: EffectsUi,
    pub shuffle_ui: ShuffleUi,
    pub clock_ui: ClockUi,
    pub system_ui: SystemUi,
    pub search: Entity<InputState>,
    pub quick_picker: Entity<SelectState<SearchableVec<VisualItem>>>,
    pub random_scope: Entity<TextSelect>,
    pub look_name: Entity<InputState>,
    pub look_confirm_focus: FocusHandle,
    pub look_action: Option<LookAction>,
    pub look_message: Option<String>,
    pub controls: Vec<Control>,
    pub advanced: bool,
    pub show_locks: bool,
    /// A rejected entry in one control, as `(target key, control name, message)`.
    pub control_error: Option<(String, String, String)>,
    pub preview: Option<PreviewSurface>,
    pub preview_error: Option<String>,
    pub paused: bool,
    playback_chosen: bool,
    pub config_save: SaveQueue,
    pub ui_save: SaveQueue,
    pub load_warnings: Vec<String>,
    pub ui_warning: Option<String>,
    pub warning_details: bool,
    pub close_after_save: bool,
    pub filters_focus: FocusHandle,
    pub row_focus: Vec<FocusHandle>,
    pub bank_scroll: ScrollHandle,
    pub inspector_scroll: ScrollHandle,
    pub undo_focus: FocusHandle,
    pub pause_focus: FocusHandle,
    pub save_status_focus: FocusHandle,
    pub(crate) paths: Paths,
    save_running: bool,
    save_task: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
    _preview_task: Task<()>,
    _clock_task: Task<()>,
}

impl Settings {
    pub(crate) fn open(paths: Paths, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (config, ui, load_warnings, ui_warning) = paths.load();
        let model = Model::new(config, ui);
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search visuals"));
        let search_changed = cx.subscribe_in(&search, window, |this, input, event: &InputEvent, window, cx| match event {
            InputEvent::Change => {
                this.model.query = input.read(cx).value().to_string();
                this.bank_scroll.set_offset(point(px(0.), px(0.)));
                cx.notify();
            }
            InputEvent::PressEnter { .. } => {
                if let Some(index) = this.model.matches().first().and_then(|(_, rows)| rows.first()).copied() {
                    this.select(index, window, cx);
                    this.row_focus[index].focus(window, cx);
                }
            }
            _ => {}
        });
        let items: Vec<_> =
            model.visuals.iter().enumerate().map(|(index, visual)| VisualItem { index, title: visual.title.clone().into() }).collect();
        let quick_picker =
            cx.new(|cx| SelectState::new(SearchableVec::new(items), Some(IndexPath::new(model.selected)), window, cx).searchable(true));
        let picked = cx.subscribe_in(&quick_picker, window, |this, _, event: &SelectEvent<SearchableVec<VisualItem>>, window, cx| {
            if let SelectEvent::Confirm(Some(index)) = event {
                this.select(*index, window, cx);
            }
        });
        let random_scope = cx.new(|cx| {
            let scopes = RandomScope::OPTIONS.map(|(label, _)| SharedString::from(label)).to_vec();
            SelectState::new(SearchableVec::new(scopes), Some(IndexPath::new(0)), window, cx).searchable(false)
        });
        let look_name = cx.new(|cx| InputState::new(window, cx).placeholder("Look name"));
        let look_enter = cx.subscribe_in(&look_name, window, |this, _, event: &InputEvent, window, cx| {
            if matches!(event, InputEvent::PressEnter { .. }) {
                this.submit_look(window, cx);
            }
        });
        let (preview, preview_error) = match (window.display_handle(), window.window_handle()) {
            (Ok(display), Ok(handle)) => match PreviewSurface::attach(display.as_raw(), handle.as_raw()) {
                Ok(preview) => (Some(preview), None),
                Err(error) => (None, Some(error.to_string())),
            },
            _ => (None, Some("The window has no native preview handle.".into())),
        };
        let preview_task = cx.spawn_in(window, async move |this, cx| {
            let mut interval = Duration::ZERO;
            loop {
                cx.background_executor().timer(interval).await;
                let Ok(Some(next_interval)) = this.update_in(cx, |this, window, cx| {
                    let preview = this.preview.as_mut()?;
                    let visible = window.is_visible();
                    preview.tick(visible);
                    if preview.diagnostic != this.preview_error {
                        this.preview_error = preview.diagnostic.clone();
                        cx.notify();
                    }
                    Some(if visible { preview.poll_interval() } else { Duration::from_millis(100) })
                }) else {
                    break;
                };
                interval = next_interval;
            }
        });
        let entity = cx.entity().downgrade();
        window.on_window_should_close(cx, move |window, cx| entity.update(cx, |this, cx| this.request_close(window, cx)).unwrap_or(true));
        let row_focus = model.visuals.iter().map(|_| cx.focus_handle()).collect();
        let paused = cx.reduce_motion();
        let effects_ui = EffectsUi::new(&model, window, cx);
        let shuffle_ui = ShuffleUi::new(&model, window, cx);
        let clock_ui = ClockUi::new(&model, window, cx);
        let system_ui = SystemUi::new(&model, window, cx);
        // The clock example shows the current time, so it refreshes each second while it is on screen.
        let clock_task = cx.spawn_in(window, async move |this, cx| {
            loop {
                cx.background_executor().timer(Duration::from_secs(1)).await;
                if this
                    .update_in(cx, |this, _, cx| {
                        if this.tab == Tab::Clock {
                            cx.notify()
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        });
        let mut settings = Self {
            model,
            tab: Tab::Visuals,
            tab_focus: Tab::ALL.iter().map(|_| cx.focus_handle()).collect(),
            effects_ui,
            shuffle_ui,
            clock_ui,
            system_ui,
            search,
            quick_picker,
            random_scope,
            look_name,
            look_confirm_focus: cx.focus_handle(),
            look_action: None,
            look_message: None,
            controls: Vec::new(),
            advanced: false,
            show_locks: false,
            control_error: None,
            preview,
            preview_error,
            paused,
            playback_chosen: false,
            config_save: SaveQueue::default(),
            ui_save: SaveQueue::default(),
            load_warnings,
            ui_warning,
            warning_details: false,
            close_after_save: false,
            filters_focus: cx.focus_handle(),
            row_focus,
            bank_scroll: ScrollHandle::new(),
            inspector_scroll: ScrollHandle::new(),
            undo_focus: cx.focus_handle(),
            pause_focus: cx.focus_handle(),
            save_status_focus: cx.focus_handle(),
            paths,
            save_running: false,
            save_task: None,
            _subscriptions: vec![search_changed, picked, look_enter],
            _preview_task: preview_task,
            _clock_task: clock_task,
        };
        if let Some(preview) = settings.preview.as_mut() {
            preview.set_paused(paused);
            preview.set_clock(settings.model.config.clock.clone());
        }
        settings.rebuild_controls(window, cx);
        settings.update_scene();
        settings
    }

    pub fn select(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        if !self.model.select(index) {
            return;
        }
        self.rebuild_controls(window, cx);
        self.inspector_scroll.set_offset(point(px(0.), px(0.)));
        self.advanced = false;
        self.cancel_look(window, cx);
        self.look_message = None;
        self.quick_picker.update(cx, |state, cx| {
            if state.selected_value() != Some(&index) {
                state.set_selected_value(&index, window, cx);
            }
        });
        self.sync_shader_scheme(window, cx);
        self.update_scene();
        self.config_changed(window, cx);
    }

    pub fn filter(&mut self, favorites: bool, cx: &mut Context<Self>) {
        self.model.favorites_only = favorites;
        self.bank_scroll.set_offset(point(px(0.), px(0.)));
        cx.notify();
    }

    pub fn clear_filters(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.model.query.clear();
        self.filter(false, cx);
        self.search.update(cx, |state, cx| {
            state.set_value("", window, cx);
            state.focus(window, cx);
        });
    }

    pub fn favorite(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.model.toggle_favorite(index);
        if self.model.favorites_only {
            self.filters_focus.focus(window, cx);
        }
        self.ui_save.edit(cx.background_executor().now());
        self.start_saving(window, cx);
        cx.notify();
    }

    pub fn toggle_pause(&mut self, cx: &mut Context<Self>) {
        self.playback_chosen = true;
        self.set_paused(!self.paused, cx);
    }

    pub fn sync_motion_preference(&mut self, reduce_motion: bool, cx: &mut Context<Self>) {
        if !self.playback_chosen {
            self.set_paused(reduce_motion, cx);
        }
    }

    fn set_paused(&mut self, paused: bool, cx: &mut Context<Self>) {
        self.paused = paused;
        if let Some(preview) = &mut self.preview {
            preview.set_paused(self.paused);
        }
        cx.notify();
    }

    fn rebuild_controls(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let values = self.model.effective();
        self.controls =
            self.model.visual().uniforms.iter().map(|def| Control::new(def, Target::Shader, &values[&def.name], window, cx)).collect();
        self.control_error = None;
    }

    pub fn set_uniform(&mut self, name: &str, value: SettingValue, window: &mut Window, cx: &mut Context<Self>) {
        if self.model.set_value(name, value) {
            self.update_scene();
            self.config_changed(window, cx);
        }
    }

    pub fn reset_control(&mut self, name: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.model.reset_control(name) {
            self.sync_controls(window, cx);
            self.focus_control(name, window, cx);
            self.update_scene();
            self.config_changed(window, cx);
        }
    }

    pub fn focus_control(&self, name: &str, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(focus) = self.controls.iter().find(|control| control.def.name == name).and_then(|control| control.focus_handle(cx)) {
            focus.focus(window, cx);
        } else {
            window.focus_next(cx);
        }
    }

    pub fn finish_bulk_edit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.sync_controls(window, cx);
        self.update_scene();
        self.config_changed(window, cx);
    }

    pub fn undo(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.model.undo() {
            self.finish_bulk_edit(window, cx);
            self.pause_focus.focus(window, cx);
        }
    }

    pub fn sync_controls(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let effective = self.model.effective();
        for control in &self.controls {
            control.sync(&effective[&control.def.name], window, cx);
        }
        self.control_error = None;
    }

    pub fn update_scene(&mut self) {
        if let Some(preview) = self.preview.as_mut() {
            match self.model.scene() {
                Ok(scene) => preview.set_scene(scene),
                Err(error) => preview.diagnostic = Some(error.to_string()),
            }
        }
    }

    pub fn start_look_action(&mut self, action: LookAction, window: &mut Window, cx: &mut Context<Self>) {
        if let LookAction::Rename(old) = &action {
            self.look_name.update(cx, |state, cx| {
                state.set_value(old.clone(), window, cx);
                state.focus(window, cx);
                state.select_all(window, cx);
            });
        } else {
            self.look_confirm_focus.focus(window, cx);
        }
        self.look_action = Some(action);
        self.look_message = None;
        cx.notify();
    }

    pub fn cancel_look(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.look_name.update(cx, |state, cx| state.set_value("", window, cx));
        self.look_action = None;
        self.look_message = None;
        cx.notify();
    }

    pub fn submit_look(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let draft = self.look_name.read(cx).value();
        let draft = draft.trim();
        if self.look_action.is_none() && self.model.looks().any(|name| name == draft) {
            self.start_look_action(LookAction::Overwrite(draft.into()), window, cx);
            return;
        }
        let result = match &self.look_action {
            Some(LookAction::Delete(name)) => {
                self.model.delete_look(name);
                Ok(format!("Deleted “{name}”."))
            }
            Some(LookAction::Rename(old)) => self.model.rename_look(old, draft).map(|()| format!("Renamed to “{draft}”.")),
            Some(LookAction::Overwrite(name)) => self.model.save_look(name, true).map(|()| format!("Updated “{name}”.")),
            None => self.model.save_look(draft, false).map(|()| format!("Saved “{draft}”.")),
        };
        match result {
            Ok(message) => {
                self.cancel_look(window, cx);
                self.look_message = Some(message);
                self.config_changed(window, cx);
            }
            Err(error) => self.look_message = Some(error.into()),
        }
        self.look_name.update(cx, |state, cx| state.focus(window, cx));
        cx.notify();
    }

    /// Show another tab. Entering Settings reads Noctalia the first time.
    pub fn show_tab(&mut self, tab: Tab, window: &mut Window, cx: &mut Context<Self>) {
        if self.tab != tab {
            self.tab = tab;
            self.inspector_scroll.set_offset(point(px(0.), px(0.)));
        }
        if tab == Tab::Settings && self.system_ui.idle.state == crate::idle::Idle::Unchecked {
            self.refresh_idle(window, cx);
        }
        cx.notify();
    }

    /// Move along the tab row (Left, Right, Home, End), activate that tab and focus it.
    pub fn step_tab(&mut self, tab: Tab, window: &mut Window, cx: &mut Context<Self>) {
        self.show_tab(tab, window, cx);
        self.tab_focus[tab as usize].focus(window, cx);
    }

    pub fn config_changed(&mut self, window: &Window, cx: &mut Context<Self>) {
        self.shuffle_ui.grow(&self.model, cx);
        self.config_save.edit(cx.background_executor().now());
        self.start_saving(window, cx);
        cx.notify();
    }

    pub fn retry(&mut self, window: &Window, cx: &mut Context<Self>) {
        let now = cx.background_executor().now();
        self.config_save.retry(now);
        self.ui_save.retry(now);
        self.start_saving(window, cx);
        cx.notify();
    }

    fn request_close(&mut self, window: &Window, cx: &mut Context<Self>) -> bool {
        let dirty =
            self.config_save.pending() || self.ui_save.pending() || self.config_save.error.is_some() || self.ui_save.error.is_some();
        if dirty {
            self.close_after_save = true;
            self.retry(window, cx);
        }
        !dirty
    }

    fn start_saving(&mut self, window: &Window, cx: &mut Context<Self>) {
        if self.save_running {
            return;
        }
        self.save_running = true;
        self.save_task = Some(cx.spawn_in(window, async move |this, cx| {
            loop {
                let Ok(work) = this.update_in(cx, |this, window, cx| {
                    let now = cx.background_executor().now();
                    let config = this.config_save.take(now).map(|rev| (rev, this.model.config.clone(), this.paths.config.clone()));
                    let ui = this.ui_save.take(now).map(|rev| (rev, this.model.ui.clone(), this.paths.ui.clone()));
                    if config.is_some() || ui.is_some() {
                        return SaveWork::Write { config: config.map(Box::new), ui };
                    }
                    if let Some(due) = this.config_save.due().into_iter().chain(this.ui_save.due()).min() {
                        return SaveWork::Wait(due.saturating_duration_since(now));
                    }
                    this.save_running = false;
                    if this.close_after_save && this.config_save.error.is_none() && this.ui_save.error.is_none() {
                        window.remove_window();
                    }
                    cx.notify();
                    SaveWork::Done
                }) else {
                    break;
                };
                match work {
                    SaveWork::Done => break,
                    SaveWork::Wait(duration) => cx.background_executor().timer(duration).await,
                    SaveWork::Write { config, ui } => {
                        let (config, ui) = cx
                            .background_executor()
                            .spawn(async move {
                                (
                                    config.map(|snapshot| {
                                        let (revision, config, path) = *snapshot;
                                        (revision, persistence::save_config(&config, path.as_deref()))
                                    }),
                                    ui.map(|(revision, ui, path)| (revision, persistence::save_ui(&ui, path.as_deref()))),
                                )
                            })
                            .await;
                        if this
                            .update_in(cx, |this, _, cx| {
                                if let Some((rev, result)) = config {
                                    this.config_save.finish(rev, result);
                                }
                                if let Some((rev, result)) = ui {
                                    if result.is_ok() {
                                        this.ui_warning = None;
                                    }
                                    this.ui_save.finish(rev, result);
                                }
                                cx.notify();
                            })
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        }));
    }
}

type Snapshot<T> = (u64, T, Option<std::path::PathBuf>);

enum SaveWork {
    Write { config: Option<Box<Snapshot<scrnsvr_core::config::Config>>>, ui: Option<Snapshot<persistence::UiState>> },
    Wait(Duration),
    Done,
}

#[cfg(test)]
mod tests {
    use gpui_kit::{AppContext as _, TestAppContext, WindowOptions};
    use scrnsvr_core::catalog::SettingValue;

    use super::Settings;
    use crate::persistence::Paths;

    fn open(cx: &mut TestAppContext, paths: Paths) -> (gpui_kit::AnyWindowHandle, gpui_kit::Entity<Settings>) {
        cx.update(|cx| {
            gpui_kit::init(cx);
            crate::view::init_theme(cx);
            gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| cx.new(|cx| Settings::open(paths, window, cx))).unwrap()
        })
    }

    #[gpui::test]
    fn edits_save_after_the_debounce_and_failures_keep_edits_for_retry(cx: &mut TestAppContext) {
        use std::os::unix::fs::PermissionsExt;
        use std::time::Duration;

        use scrnsvr_core::config::Config;

        let temp = tempfile::tempdir().unwrap();
        let directory = temp.path().join("config");
        std::fs::create_dir(&directory).unwrap();
        let (config, ui) = (directory.join("config.toml"), temp.path().join("state/ui.toml"));
        let (window, settings) = open(cx, Paths { config: Some(config.clone()), ui: Some(ui.clone()), ..Paths::default() });
        let edit = |cx: &mut TestAppContext, value: f64| {
            cx.update_window(window, |_, window, cx| {
                settings.update(cx, |settings, cx| settings.set_uniform("speed", SettingValue::Number(value), window, cx));
            })
            .unwrap();
        };

        edit(cx, 0.6);
        edit(cx, 0.7);
        cx.executor().advance_clock(Duration::from_millis(100));
        cx.run_until_parked();
        assert!(!config.exists(), "an edit waits for the debounce");
        cx.read(|cx| assert!(settings.read(cx).config_save.pending()));
        cx.executor().advance_clock(Duration::from_millis(400));
        cx.run_until_parked();
        assert_eq!(Config::load(&config).config.shaders["flow-field"]["speed"], SettingValue::Number(0.7));
        cx.read(|cx| assert!(!settings.read(cx).config_save.pending() && settings.read(cx).config_save.error.is_none()));
        assert!(!ui.exists(), "shader edits do not touch UI state");

        cx.update_window(window, |_, window, cx| settings.update(cx, |settings, cx| settings.favorite(3, window, cx))).unwrap();
        cx.executor().advance_clock(Duration::from_millis(400));
        cx.run_until_parked();
        let favorite = cx.read(|cx| settings.read(cx).model.visuals[3].id.clone());
        assert!(std::fs::read_to_string(&ui).unwrap().contains(&favorite));

        let writable = std::fs::File::create(directory.join("probe")).is_ok();
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o500)).unwrap();
        edit(cx, 0.9);
        cx.executor().advance_clock(Duration::from_millis(400));
        cx.run_until_parked();
        // A root test runner bypasses chmod, so only assert the failure where it applies.
        let failed = cx.read(|cx| settings.read(cx).config_save.error.is_some());
        assert_eq!(failed, !writable || std::fs::File::create(directory.join("probe2")).is_err());
        cx.read(|cx| {
            assert_eq!(settings.read(cx).model.stored().unwrap()["speed"], SettingValue::Number(0.9), "edits survive a failed save")
        });
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        cx.update_window(window, |_, window, cx| settings.update(cx, |settings, cx| settings.retry(window, cx))).unwrap();
        cx.executor().advance_clock(Duration::from_millis(400));
        cx.run_until_parked();
        cx.read(|cx| assert!(settings.read(cx).config_save.error.is_none()));
        assert_eq!(Config::load(&config).config.shaders["flow-field"]["speed"], SettingValue::Number(0.9));
    }

    #[gpui::test]
    fn every_visual_gets_a_widget_per_manifest_control_and_draws(cx: &mut TestAppContext) {
        let temp = tempfile::tempdir().unwrap();
        let (window, settings) =
            open(cx, Paths { config: Some(temp.path().join("config.toml")), ui: Some(temp.path().join("ui.toml")), ..Paths::default() });
        let count = cx.read(|cx| settings.read(cx).model.visuals.len());
        let mut kinds = std::collections::BTreeSet::new();
        for index in 0..count {
            cx.update_window(window, |_, window, cx| {
                settings.update(cx, |settings, cx| {
                    settings.select(index, window, cx);
                    settings.advanced = true;
                    settings.show_locks = true;
                });
                window.draw(cx).clear(cx);
            })
            .unwrap();
            cx.read(|cx| {
                let settings = settings.read(cx);
                let uniforms = &settings.model.visual().uniforms;
                assert_eq!(settings.controls.len(), uniforms.len(), "{}", settings.model.visual().id);
                kinds.extend(uniforms.iter().map(|def| format!("{:?} slider={}", def.kind, def.is_slider())));
            });
        }
        // Float and Int sliders and precise-only numbers, colors, selects and toggles all appear.
        assert!(kinds.len() >= 5, "{kinds:?}");
    }

    #[gpui::test]
    fn search_and_precise_controls_respond_to_keyboard(cx: &mut TestAppContext) {
        let temp = tempfile::tempdir().unwrap();
        let paths =
            Paths { config: Some(temp.path().join("config.toml")), ui: Some(temp.path().join("state/ui.toml")), ..Paths::default() };
        let (window, settings) = open(cx, paths);
        cx.update_window(window, |_, window, cx| {
            let search = settings.read(cx).search.clone();
            search.update(cx, |input, cx| input.focus(window, cx));
            window.draw(cx).clear(cx);
        })
        .unwrap();
        cx.simulate_keystrokes(window, "p l a s m a");
        cx.read(|cx| {
            let model = &settings.read(cx).model;
            assert_eq!(model.query, "plasma");
            assert_eq!(model.visual().id, "flow-field");
            assert_eq!(model.matches().iter().map(|(_, rows)| rows.len()).sum::<usize>(), 1);
        });
        cx.simulate_keystrokes(window, "enter");
        cx.update_window(window, |_, window, cx| {
            let settings = settings.read(cx);
            assert_eq!(settings.model.visual().id, "plasma");
            assert!(settings.row_focus[settings.model.selected].is_focused(window));
            let control = settings.controls.iter().find(|control| control.def.name == "speed").unwrap();
            control.text_input().unwrap().clone().update(cx, |input, cx| {
                input.set_value("0.", window, cx);
                input.focus(window, cx);
                input.select_all(window, cx);
            });
            window.draw(cx).clear(cx);
        })
        .unwrap();
        cx.simulate_keystrokes(window, "0 . 2 3");
        cx.read(|cx| assert!(settings.read(cx).model.stored().is_none(), "draft input must not change the preview"));
        cx.simulate_keystrokes(window, "enter");
        cx.read(|cx| assert_eq!(settings.read(cx).model.stored().unwrap()["speed"], SettingValue::Number(0.23)));
        cx.update(|cx| {
            settings.update(cx, |settings, cx| {
                settings.sync_motion_preference(true, cx);
                assert!(settings.paused);
                settings.toggle_pause(cx);
                settings.sync_motion_preference(true, cx);
                assert!(!settings.paused, "explicit playback takes precedence");
            });
        });
    }
}

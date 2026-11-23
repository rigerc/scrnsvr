//! scrnsvr-settings: milestone 1 spike for the native settings UI.
//!
//! A GPUI Kit window with a shader picker, manifest-driven sliders for the
//! selected shader's numeric controls, and a live GLES preview presented inline
//! through a Wayland subsurface (see `preview.rs`). Nothing is persisted; the
//! Electron settings remain the product until milestone 5.
//!
//! `SCRNSVR_SETTINGS_SMOKE=SECONDS` closes the window after that many seconds
//! and prints preview statistics, for unattended checks.
//! `SCRNSVR_SETTINGS_SMOKE=steps` instead runs a scripted sequence with in-app
//! synthetic clicks (no compositor input): drag a slider, open the shader menu
//! over the preview, switch shaders and pause, printing each step's state.

mod catalog;
mod preview;

use std::time::Duration;

use gpui_kit::component::searchable_list::SearchableVec;
use gpui_kit::component::select::{Select, SelectEvent, SelectState};
use gpui_kit::component::slider::{Slider, SliderEvent, SliderState};
use gpui_kit::component::{ActiveTheme, IndexPath, Theme, ThemeMode, h_flex, v_flex};
use gpui_kit::*;
use raw_window_handle::{HasDisplayHandle, HasWindowHandle};
use scrnsvr_core::UniformValue;

use crate::catalog::{Shader, UniformDef};
use crate::preview::{Placement, PreviewSurface};

const SIDEBAR_WIDTH: f32 = 320.;

struct Control {
    def: UniformDef,
    state: Entity<SliderState>,
    value: f64,
    _subscription: Subscription,
}

struct Settings {
    shaders: Vec<Shader>,
    selected: usize,
    picker: Entity<SelectState<SearchableVec<SharedString>>>,
    controls: Vec<Control>,
    preview: Option<PreviewSurface>,
    preview_error: Option<String>,
    sidebar_width: f32,
    _subscriptions: Vec<Subscription>,
    _ticker: Task<()>,
}

impl Settings {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let shaders = catalog::load();
        let selected = shaders.iter().position(|shader| shader.id == "aurora-veil").unwrap_or(0);
        let titles: Vec<SharedString> = shaders.iter().map(|shader| SharedString::from(shader.title.clone())).collect();
        let picker = cx.new(|cx| SelectState::new(SearchableVec::new(titles), Some(IndexPath::new(selected)), window, cx));
        let picked = cx.subscribe_in(&picker, window, |this, _, event: &SelectEvent<SearchableVec<SharedString>>, window, cx| {
            let SelectEvent::Confirm(Some(title)) = event else { return };
            if let Some(index) = this.shaders.iter().position(|shader| shader.title == title.as_ref()) {
                this.select(index, window, cx);
            }
        });
        let (preview, preview_error) = match (window.display_handle(), window.window_handle()) {
            (Ok(display), Ok(handle)) => match PreviewSurface::attach(display.as_raw(), handle.as_raw()) {
                Ok(preview) => (Some(preview), None),
                Err(error) => (None, Some(error.to_string())),
            },
            _ => (None, Some("The window has no native handle".into())),
        };
        if let Some(error) = &preview_error {
            eprintln!("scrnsvr preview unavailable: {error}");
        }
        // The preview paces itself from compositor frame callbacks; this timer only asks whether one arrived.
        let ticker = cx.spawn_in(window, async move |this, cx| {
            loop {
                cx.background_executor().timer(Duration::from_millis(4)).await;
                if this.update(cx, |this, _| this.preview.as_mut().map(PreviewSurface::tick)).is_err() {
                    break;
                }
            }
        });
        let mut settings = Self {
            shaders,
            selected,
            picker,
            controls: Vec::new(),
            preview,
            preview_error,
            sidebar_width: SIDEBAR_WIDTH,
            _subscriptions: vec![picked],
            _ticker: ticker,
        };
        settings.select(selected, window, cx);
        settings
    }

    /// Show a shader: rebuild its manifest controls and hand its plan to the preview.
    fn select(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.selected = index;
        let shader = &self.shaders[index];
        if let Some(preview) = self.preview.as_mut() {
            preview.set_scene(shader.plan.clone());
        }
        let plan = shader.plan.clone();
        self.controls = shader
            .uniforms
            .iter()
            .filter(|def| def.is_slider() && !def.advanced)
            .map(|def| {
                let value = plan
                    .uniforms
                    .iter()
                    .find_map(|(name, value)| match value {
                        UniformValue::Scalar(value) if *name == def.name => Some(*value),
                        _ => None,
                    })
                    .unwrap_or_default();
                let integer = def.kind == "int";
                let step = def.step.unwrap_or(if integer { 1.0 } else { 0.01 });
                let state = cx.new(|_| {
                    SliderState::new()
                        .min(def.min.unwrap_or(0.0) as f32)
                        .max(def.max.unwrap_or(1.0) as f32)
                        .step(step as f32)
                        .default_value(value as f32)
                });
                let name = def.name.clone();
                let subscription = cx.subscribe_in(&state, window, move |this, _, event: &SliderEvent, _, cx| {
                    let (SliderEvent::Change(value) | SliderEvent::Release(value)) = event;
                    let mut value = f64::from(value.start());
                    if integer {
                        value = value.round();
                    }
                    if let Some(control) = this.controls.iter_mut().find(|control| control.def.name == name) {
                        control.value = value;
                    }
                    if let Some(preview) = this.preview.as_mut() {
                        preview.set_uniform(&name, UniformValue::Scalar(value));
                    }
                    cx.notify();
                });
                Control { def: def.clone(), state, value, _subscription: subscription }
            })
            .collect();
        cx.notify();
    }

    fn toggle_pause(&mut self, cx: &mut Context<Self>) {
        if let Some(preview) = self.preview.as_mut() {
            let paused = !preview.paused();
            preview.set_paused(paused);
        }
        cx.notify();
    }
}

impl Render for Settings {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let (background, foreground, muted, border) = (theme.background, theme.foreground, theme.muted_foreground, theme.border);
        let paused = self.preview.as_ref().is_some_and(PreviewSurface::paused);
        let sidebar = v_flex()
            .w(px(self.sidebar_width))
            .h_full()
            .flex_none()
            .gap_4()
            .p_5()
            .bg(background)
            .border_r_1()
            .border_color(border)
            .child(div().flex_none().text_lg().child("Shader"))
            // Select grows to fill a flex column; keep it to its own height.
            // The menu is wider than the sidebar so it opens over the preview (stacking check).
            .child(div().flex_none().child(Select::new(&self.picker).menu_width(px(520.)).menu_max_h(px(360.))))
            .child(v_flex().id("controls").flex_1().min_h_0().gap_5().pt_2().overflow_y_scroll().children(self.controls.iter().map(
                |control| {
                    let value =
                        if control.def.kind == "int" { format!("{}", control.value as i64) } else { format!("{:.2}", control.value) };
                    v_flex()
                        .gap_2()
                        .child(h_flex().justify_between().child(control.def.title().to_owned()).child(div().text_color(muted).child(value)))
                        .child(Slider::new(&control.state).accessibility_label(control.def.title().to_owned()))
                },
            )))
            .child(
                div()
                    .id("pause")
                    .flex_none()
                    .px_3()
                    .py_2()
                    .rounded_md()
                    .border_1()
                    .border_color(border)
                    .cursor_pointer()
                    .child(if paused { "Resume preview" } else { "Pause preview" })
                    .on_click(cx.listener(|this, _, _, cx| this.toggle_pause(cx))),
            );
        let entity = cx.entity().downgrade();
        // The preview rectangle is left unpainted: the GLES subsurface below the window shows through.
        let hole = canvas(
            |_, _, _| {},
            move |bounds, _, window, cx| {
                let scale = window.scale_factor();
                let viewport = window.viewport_size();
                let left = bounds.origin.x.max(px(0.));
                let top = bounds.origin.y.max(px(0.));
                let right = (bounds.origin.x + bounds.size.width).min(viewport.width);
                let bottom = (bounds.origin.y + bounds.size.height).min(viewport.height);
                let placement = Placement {
                    x: f32::from(left).round() as i32,
                    y: f32::from(top).round() as i32,
                    width: f32::from(right - left).max(0.).round() as i32,
                    height: f32::from(bottom - top).max(0.).round() as i32,
                    scale: scale.ceil().max(1.) as i32,
                };
                let _ = entity.update(cx, |this: &mut Settings, _| {
                    if let Some(preview) = this.preview.as_mut() {
                        preview.place(placement);
                    }
                });
            },
        )
        .size_full();
        let stage =
            div().flex_1().h_full().relative().child(hole).children(self.preview_error.clone().map(|error| {
                div().absolute().inset_0().flex().items_center().justify_center().bg(background).text_color(muted).child(error)
            }));
        h_flex().size_full().text_color(foreground).child(sidebar).child(stage)
    }
}

/// Click inside the window through GPUI's own input dispatch.
fn click(window: AnyWindowHandle, at: Point<Pixels>, cx: &mut AsyncApp) {
    let _ = window.update(cx, |_, window, cx| {
        window.dispatch_event(PlatformInput::MouseMove(MouseMoveEvent { position: at, ..Default::default() }), cx);
        window.dispatch_event(
            PlatformInput::MouseDown(MouseDownEvent { button: MouseButton::Left, position: at, click_count: 1, ..Default::default() }),
            cx,
        );
        window.dispatch_event(
            PlatformInput::MouseUp(MouseUpEvent { button: MouseButton::Left, position: at, click_count: 1, ..Default::default() }),
            cx,
        );
    });
}

fn report(view: &Entity<Settings>, step: &str, cx: &mut AsyncApp) {
    cx.update(|cx| {
        let settings = view.read(cx);
        let frames = settings.preview.as_ref().map_or(0, |preview| preview.frames);
        let placement = settings.preview.as_ref().map(PreviewSurface::placement).unwrap_or_default();
        let values: Vec<String> = settings.controls.iter().map(|control| format!("{}={:.2}", control.def.name, control.value)).collect();
        // Wall-clock time lets unattended checks line up steps with screen captures.
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs_f64();
        println!(
            "step {step}: at={at:.3} shader={} frames={frames} preview={}x{}+{}+{}@{} {}",
            settings.shaders[settings.selected].id,
            placement.width,
            placement.height,
            placement.x,
            placement.y,
            placement.scale,
            values.join(" ")
        );
        let _ = std::io::Write::flush(&mut std::io::stdout());
    });
}

async fn smoke_steps(view: Entity<Settings>, window: AnyWindowHandle, cx: &mut AsyncApp) {
    let wait = async |cx: &mut AsyncApp, seconds: f64| cx.background_executor().timer(Duration::from_secs_f64(seconds)).await;
    wait(cx, 3.0).await;
    report(&view, "start", cx);
    // The fourth slider (Brightness) near its right end; layout positions match the sidebar's fixed metrics.
    click(window, point(px(SIDEBAR_WIDTH - 26.), px(400.)), cx);
    wait(cx, 0.5).await;
    report(&view, "slider", cx);
    wait(cx, 1.5).await;
    click(window, point(px(150.), px(80.)), cx);
    wait(cx, 0.5).await;
    report(&view, "menu-open", cx);
    wait(cx, 1.5).await;
    let _ = window.update(cx, |_, window, cx| {
        view.update(cx, |this, cx| {
            let plasma = this.shaders.iter().position(|shader| shader.id == "plasma").unwrap_or(0);
            this.picker.update(cx, |picker, cx| picker.set_selected_index(Some(IndexPath::new(plasma)), window, cx));
            this.select(plasma, window, cx);
        });
    });
    // Clicking the stage, outside the menu, dismisses it.
    click(window, point(px(1000.), px(650.)), cx);
    wait(cx, 1.0).await;
    report(&view, "switched", cx);
    // Relayout: the stage moves right and shrinks, so the subsurface must follow and resize.
    cx.update(|cx| {
        view.update(cx, |this, cx| {
            this.sidebar_width = 640.;
            cx.notify();
        })
    });
    wait(cx, 1.0).await;
    report(&view, "relayout", cx);
    wait(cx, 1.0).await;
    cx.update(|cx| view.update(cx, |this, cx| this.toggle_pause(cx)));
    wait(cx, 0.2).await;
    report(&view, "paused", cx);
    wait(cx, 1.5).await;
    report(&view, "still-paused", cx);
    cx.update(|cx| cx.quit());
}

/// Let the preview subsurface below the window show through.
///
/// Kit's window plugin paints `tokens.background` over the whole surface. Root applies its own
/// style after the plugin's, so a transparent Root background wins while the token, which
/// dialogs, sheets and tabs also use, stays opaque. Panels paint `theme.background` themselves.
/// `tests::root_background_overrides_the_window_plugin` fails if a Kit upgrade changes that order.
fn clear_window_background(window: &mut Window, cx: &mut App) {
    gpui_kit::base::Root::update(window, cx, |root, _, cx| {
        root.style().background = Some(transparent_black().into());
        cx.notify();
    });
}

fn main() {
    let smoke = std::env::var("SCRNSVR_SETTINGS_SMOKE").ok();
    gpui_kit::application().run(move |cx| {
        gpui_kit::init(cx);
        Theme::change(ThemeMode::Dark, None, cx);
        let options = WindowOptions {
            // Transparent so the preview subsurface below the window shows through the unpainted stage.
            window_background: WindowBackgroundAppearance::Transparent,
            app_id: Some("scrnsvr-settings".into()),
            window_bounds: Some(WindowBounds::centered(size(px(1180.), px(720.)), cx)),
            ..WindowOptions::default()
        };
        let (window, view) = gpui_kit::open_window(options, cx, |window, cx| cx.new(|cx| Settings::new(window, cx)))
            .expect("failed to open the settings window");
        let _ = window.update(cx, |_, window, cx| clear_window_background(window, cx));
        match smoke.as_deref() {
            Some("steps") => cx.spawn(async move |cx| smoke_steps(view, window, cx).await).detach(),
            Some(seconds) => {
                let seconds = seconds.parse::<f64>().unwrap_or(5.0);
                cx.spawn(async move |cx| {
                    cx.background_executor().timer(Duration::from_secs_f64(seconds)).await;
                    report(&view, "end", cx);
                    cx.update(|cx| cx.quit());
                })
                .detach();
            }
            None => {}
        }
    });
}

#[cfg(test)]
mod tests {
    // Explicit imports: the gpui_kit glob also exports GPUI's `test` macro, which would shadow
    // the built-in `#[test]` that `#[gpui::test]` expands to.
    use gpui_kit::{
        AppContext as _, Bounds, Context, IntoElement, Point, Render, Styled as _, TestAppContext, Window, WindowBounds, WindowOptions,
        div, px, size,
    };

    use super::clear_window_background;

    struct Blank;

    impl Render for Blank {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full()
        }
    }

    /// Opaque quads that cover the whole window in the last drawn frame.
    fn covering_quads(cx: &mut TestAppContext, clear: bool) -> usize {
        let window = cx.update(|cx| {
            let bounds = Bounds { origin: Point::default(), size: size(px(800.), px(600.)) };
            let options = WindowOptions { window_bounds: Some(WindowBounds::Windowed(bounds)), ..WindowOptions::default() };
            gpui_kit::open_window(options, cx, |_, cx| cx.new(|_| Blank)).expect("open test window").0
        });
        cx.update_window(window, |_, window, cx| {
            if clear {
                clear_window_background(window, cx);
            }
            window.draw(cx).clear(cx);
            let scale = window.scale_factor();
            let viewport = window.viewport_size();
            let (width, height) = (f32::from(viewport.width) * scale, f32::from(viewport.height) * scale);
            window
                .painted_quads()
                .iter()
                .filter(|quad| {
                    let bounds = quad.bounds;
                    !quad.background.is_transparent()
                        && bounds.origin.x.as_f32() <= 0.
                        && bounds.origin.y.as_f32() <= 0.
                        && (bounds.origin.x + bounds.size.width).as_f32() >= width
                        && (bounds.origin.y + bounds.size.height).as_f32() >= height
                })
                .count()
        })
        .expect("draw test window")
    }

    #[gpui::test]
    fn root_background_overrides_the_window_plugin(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        // Control: without the override Kit paints an opaque background over the whole window.
        assert!(covering_quads(cx, false) > 0, "Kit no longer paints a window background; revisit clear_window_background");
        assert_eq!(covering_quads(cx, true), 0, "an opaque quad covers the window and would hide the preview");
    }
}

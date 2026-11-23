//! Native settings and inline preview for scrnsvr.

mod app;
mod catalog;
mod clock_tab;
mod controls;
mod custom_ui;
#[cfg(test)]
mod editor_tests;
mod effects_tab;
mod fullscreen;
mod gallery;
mod idle;
mod idle_ui;
mod looks_tab;
mod model;
mod persistence;
mod preview;
mod smoke;
mod system_tab;
#[cfg(test)]
mod tab_tests;
#[cfg(test)]
mod testing;
mod thumbnails;
mod validation;
mod view;

use std::time::Duration;

use app::Settings;
use gpui_kit::*;
use persistence::Paths;

/// GPUI Kit exposes a motion preference but does not read Linux desktop settings.
fn reduce_motion() -> Option<bool> {
    std::process::Command::new("gsettings")
        .args(["get", "org.gnome.desktop.interface", "enable-animations"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| match output.stdout.trim_ascii() {
            b"false" => Some(true),
            b"true" => Some(false),
            _ => None,
        })
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
    // The scripted path makes real edits. Use throwaway files unless the smoke runner
    // explicitly provides isolated XDG directories to inspect after the process exits.
    let smoke_temp = (smoke.as_deref() == Some("steps") && std::env::var_os("SCRNSVR_SETTINGS_SMOKE_USE_XDG").is_none())
        .then(|| tempfile::tempdir().expect("create the settings smoke directory"));
    let mut paths = smoke_temp.as_ref().map_or_else(Paths::native, |directory| Paths {
        config: Some(directory.path().join("config.toml")),
        ui: Some(directory.path().join("ui.toml")),
        cache: Some(directory.path().join("cache")),
        ..Paths::default()
    });
    // The walkthrough only writes to Noctalia when it is pointed at a stand-in program.
    if let Some(program) = std::env::var_os("SCRNSVR_SETTINGS_SMOKE_NOCTALIA") {
        paths.idle.noctalia = scrnsvr_core::noctalia::Noctalia::with_program(program);
    }
    gpui_kit::application().with_assets(gpui_kit::assets::Assets).run(move |cx| {
        gpui_kit::init(cx);
        let motion = reduce_motion();
        cx.set_reduce_motion(motion.unwrap_or_default());
        view::init_theme(cx);
        let options = WindowOptions {
            // Transparent so the preview subsurface below the window shows through the unpainted stage.
            window_background: WindowBackgroundAppearance::Transparent,
            app_id: Some("scrnsvr-settings".into()),
            titlebar: Some(TitlebarOptions { title: Some("scrnsvr".into()), ..TitlebarOptions::default() }),
            window_min_size: Some(size(px(420.), px(420.))),
            window_bounds: Some(WindowBounds::centered(size(px(1180.), px(720.)), cx)),
            ..WindowOptions::default()
        };
        let (window, view) = gpui_kit::open_window(options, cx, |window, cx| cx.new(|cx| Settings::open(paths, window, cx)))
            .expect("failed to open the settings window");
        let _ = window.update(cx, |_, window, cx| clear_window_background(window, cx));
        if motion.is_some() {
            let settings = view.downgrade();
            cx.spawn(async move |cx| {
                loop {
                    cx.background_executor().timer(Duration::from_secs(2)).await;
                    if settings.upgrade().is_none() {
                        break;
                    }
                    let preference = cx.background_executor().spawn(async { reduce_motion() }).await;
                    if let Some(reduced) = preference {
                        cx.update(|cx| {
                            if cx.reduce_motion() != reduced {
                                cx.set_reduce_motion(reduced);
                                let _ = settings.update(cx, |this, cx| this.sync_motion_preference(reduced, cx));
                            }
                        });
                    }
                }
            })
            .detach();
        }
        match smoke.as_deref() {
            Some("steps") => cx.spawn(async move |cx| smoke::steps(view, window, cx).await).detach(),
            Some(seconds) => {
                let duration = seconds
                    .parse::<f64>()
                    .ok()
                    .and_then(|seconds| Duration::try_from_secs_f64(seconds).ok())
                    .unwrap_or(Duration::from_secs(5));
                cx.spawn(async move |cx| {
                    cx.background_executor().timer(duration).await;
                    smoke::report(&view, "end", cx);
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

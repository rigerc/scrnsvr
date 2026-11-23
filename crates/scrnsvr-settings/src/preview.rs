//! Inline GLES preview for the GPUI settings window, presented as a Wayland subsurface.
//!
//! Stock GPUI cannot import an external GL texture on Linux (see
//! `docs/research/rust-rewrite-evaluation.md`). Instead of copying frames
//! through the CPU, the preview owns a `wl_subsurface` of GPUI's window surface
//! with its own EGL window and GLES2 context, and the compositor composites it:
//!
//! - **Ownership:** the subsurface, EGL surface, context and renderer belong to
//!   this adapter. GPUI's `wl_surface` is borrowed through its raw window handle
//!   and is never destroyed here. Dropping the adapter releases all GPU objects.
//! - **Stacking:** the subsurface sits *below* the window surface. The window
//!   is transparent and the settings UI leaves the preview rectangle unpainted,
//!   so popovers and menus GPUI draws over that rectangle stay on top.
//! - **Synchronization:** the subsurface is desynchronized, so preview frames
//!   commit independently of GPUI. Its position is double-buffered parent state
//!   and moves with GPUI's next commit, keeping layout changes in step.
//! - **Pacing:** frames render on a timer only after the previous frame
//!   callback returned, so a hidden or minimized window costs no rendering.
//! - **Input:** the subsurface has an empty input region; GPUI receives all input.
//!
//! Wayland only. X11 needs a child-window adapter.

use std::ffi::c_void;
use std::sync::Arc;
use std::time::{Duration, Instant};

use raw_window_handle::{RawDisplayHandle, RawWindowHandle};
use scrnsvr_core::clock::ClockConfig;
use scrnsvr_core::{ClockSpec, SceneSpec};
use scrnsvr_platform::{Egl, khronos_egl as egl};
use scrnsvr_render::{Renderer, render_clock};
use wayland_client::backend::{Backend, ObjectId};
use wayland_client::globals::{GlobalListContents, registry_queue_init};
use wayland_client::protocol::{wl_callback, wl_compositor, wl_region, wl_registry, wl_subcompositor, wl_subsurface, wl_surface};
use wayland_client::{Connection, Dispatch, EventQueue, Proxy, QueueHandle, delegate_noop};
use wayland_egl::WlEglSurface;

#[derive(Debug)]
pub struct PreviewError(pub String);

impl std::fmt::Display for PreviewError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn error(message: impl Into<String>) -> PreviewError {
    PreviewError(message.into())
}

#[derive(Default)]
struct State {
    frame_pending: bool,
}

/// Window-relative placement in logical pixels, already clipped to the window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Placement {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    /// Integer buffer scale (fractional scales round up and the compositor downsamples).
    pub scale: i32,
}

pub struct PreviewSurface {
    connection: Connection,
    queue: EventQueue<State>,
    handle: QueueHandle<State>,
    state: State,
    surface: wl_surface::WlSurface,
    subsurface: wl_subsurface::WlSubsurface,
    window: Option<WlEglSurface>,
    egl_surface: Option<egl::Surface>,
    context: egl::Context,
    renderer: Option<Renderer>,
    scene: Option<Arc<SceneSpec>>,
    next_scene: Option<Arc<SceneSpec>>,
    clock: ClockConfig,
    clock_spec: Option<ClockSpec>,
    next_clock_check: Option<Instant>,
    dirty: bool,
    pub diagnostic: Option<String>,
    placement: Placement,
    last_frame: Option<Instant>,
    paused: bool,
    pub frames: u64,
    // Declared last: dropped after the context and surfaces above are destroyed in `Drop`.
    egl: Egl,
}

impl PreviewSurface {
    /// Attach a preview subsurface to a GPUI window.
    pub fn attach(display: RawDisplayHandle, window: RawWindowHandle) -> Result<Self, PreviewError> {
        let (RawDisplayHandle::Wayland(display), RawWindowHandle::Wayland(window)) = (display, window) else {
            return Err(error("The inline preview requires a Wayland window"));
        };
        // SAFETY: GPUI owns the wl_display for the application's lifetime, which outlives this adapter.
        let backend = unsafe { Backend::from_foreign_display(display.display.as_ptr().cast()) };
        let connection = Connection::from_backend(backend);
        let (globals, mut queue) = registry_queue_init::<State>(&connection).map_err(|e| error(format!("Wayland registry: {e}")))?;
        let handle = queue.handle();
        let compositor: wl_compositor::WlCompositor = globals.bind(&handle, 4..=6, ()).map_err(|e| error(format!("wl_compositor: {e}")))?;
        let subcompositor: wl_subcompositor::WlSubcompositor =
            globals.bind(&handle, 1..=1, ()).map_err(|e| error(format!("wl_subcompositor: {e}")))?;
        // SAFETY: the pointer is GPUI's live wl_surface proxy on this display; the proxy we create never destroys it.
        let parent_id = unsafe { ObjectId::from_ptr(wl_surface::WlSurface::interface(), window.surface.as_ptr().cast()) }
            .map_err(|_| error("GPUI's window surface is not a wl_surface"))?;
        let parent = wl_surface::WlSurface::from_id(&connection, parent_id).map_err(|_| error("GPUI's window surface is gone"))?;
        let surface = compositor.create_surface(&handle, ());
        let subsurface = subcompositor.get_subsurface(&surface, &parent, &handle, ());
        subsurface.set_desync();
        subsurface.place_below(&parent);
        let region = compositor.create_region(&handle, ());
        surface.set_input_region(Some(&region));
        region.destroy();
        surface.commit();
        let mut state = State::default();
        queue.roundtrip(&mut state).map_err(|e| error(format!("Wayland roundtrip: {e}")))?;
        // SAFETY: as above, the display outlives this adapter and `Drop` releases EGL first.
        let egl = unsafe { Egl::for_wayland(display.display.as_ptr()) }.map_err(|e| error(e.to_string()))?;
        let context = egl.create_context().map_err(|e| error(e.to_string()))?;
        Ok(Self {
            connection,
            queue,
            handle,
            state,
            surface,
            subsurface,
            window: None,
            egl_surface: None,
            context,
            renderer: None,
            scene: None,
            next_scene: None,
            clock: ClockConfig::default(),
            clock_spec: None,
            next_clock_check: None,
            dirty: true,
            diagnostic: None,
            placement: Placement::default(),
            last_frame: None,
            paused: false,
            frames: 0,
            egl,
        })
    }

    pub fn set_scene(&mut self, scene: SceneSpec) {
        self.next_scene = Some(Arc::new(scene));
        self.dirty = true;
    }

    pub fn set_clock(&mut self, clock: ClockConfig) {
        if self.clock != clock {
            self.clock = clock;
            self.clock_spec = None;
            self.next_clock_check = None;
            self.dirty = true;
        }
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
        self.last_frame = None;
        self.next_clock_check = None;
        self.dirty = true;
    }

    pub fn poll_interval(&self) -> Duration {
        if self.paused && !self.dirty { Duration::from_millis(40) } else { Duration::from_millis(4) }
    }

    pub fn placement(&self) -> Placement {
        self.placement
    }

    /// Follow the preview element's layout. Called from GPUI paint.
    pub fn place(&mut self, placement: Placement) {
        if placement == self.placement {
            return;
        }
        let moved = (placement.x, placement.y) != (self.placement.x, self.placement.y);
        let resized =
            (placement.width, placement.height, placement.scale) != (self.placement.width, self.placement.height, self.placement.scale);
        self.placement = placement;
        if moved {
            self.subsurface.set_position(placement.x, placement.y);
        }
        if resized && placement.width > 0 && placement.height > 0 {
            self.dirty = true;
            self.clock_spec = None;
            self.next_clock_check = None;
            let (width, height) = (placement.width.max(1) * placement.scale, placement.height.max(1) * placement.scale);
            self.surface.set_buffer_scale(placement.scale);
            match &self.window {
                Some(window) => window.resize(width, height, 0, 0),
                None => {
                    if let Ok(window) = WlEglSurface::new(self.surface.id(), width, height) {
                        // SAFETY: the EGL window lives in `self.window` until after the EGL surface is destroyed.
                        match unsafe { self.egl.create_window_surface(window.ptr() as *mut c_void) } {
                            Ok(surface) => {
                                self.egl_surface = Some(surface);
                                self.window = Some(window);
                                if self.make_current() {
                                    self.egl.disable_vsync();
                                }
                            }
                            Err(e) => eprintln!("scrnsvr preview: {e}"),
                        }
                    }
                }
            }
        }
        let _ = self.connection.flush();
    }

    fn make_current(&self) -> bool {
        self.egl_surface.is_some_and(|surface| self.egl.make_current(surface, self.context).is_ok())
    }

    /// Render one frame when both the scene and compositor are ready.
    pub fn tick(&mut self, visible: bool) {
        let _ = self.queue.dispatch_pending(&mut self.state);
        if !visible || self.placement.width <= 0 || self.placement.height <= 0 {
            self.last_frame = None;
            return;
        }
        if self.state.frame_pending || (self.paused && !self.dirty) || !self.make_current() {
            return;
        }
        if self.renderer.is_none() {
            // SAFETY: this adapter's context is current.
            let gl = unsafe { glow::Context::from_loader_function(|name| self.egl.proc_address(name)) };
            match Renderer::new(gl) {
                Ok(renderer) => self.renderer = Some(renderer),
                Err(error) => {
                    self.diagnostic = Some(format!("Preview unavailable: {error}"));
                    self.dirty = false;
                    self.paused = true;
                    return;
                }
            }
        }
        let renderer = self.renderer.as_mut().expect("created above");
        if let Some(scene) = self.next_scene.take() {
            let same_program = self
                .scene
                .as_ref()
                .is_some_and(|current| current.key == scene.key && current.source == scene.source && current.effects == scene.effects);
            if same_program {
                let current = self.scene.as_ref().expect("matched a scene");
                for (name, value) in &scene.uniforms {
                    if !current.uniforms.iter().any(|(old_name, old)| old_name == name && old == value) {
                        renderer.set_uniform(name, value.clone());
                    }
                }
                self.scene = Some(scene);
                self.diagnostic = None;
            } else {
                match renderer.set_scene(&scene) {
                    Ok(()) => {
                        self.scene = Some(scene);
                        self.diagnostic = None;
                        self.last_frame = None;
                    }
                    Err(error) => self.diagnostic = Some(format!("Could not show {}: {error}", scene.key)),
                }
            }
        }
        self.dirty = false;
        if !renderer.has_scene() {
            return;
        }
        let now = Instant::now();
        let Placement { width, height, scale, .. } = self.placement;
        let (width, height) = (width * scale, height * scale);
        if self.next_clock_check.is_none_or(|next| now >= next) {
            self.next_clock_check = Some(now + Duration::from_millis(250));
            let clock = self.clock.resolve(&chrono::Local::now());
            if self.clock_spec.as_ref() != Some(&clock) {
                match render_clock(&clock, width, height) {
                    Ok(image) => renderer.set_clock(image.as_ref()),
                    Err(error) => {
                        renderer.set_clock(None);
                        self.diagnostic = Some(format!("Could not draw the clock: {error}"));
                    }
                }
                self.clock_spec = Some(clock);
            }
        }
        let delta = if self.paused { 0.0 } else { self.last_frame.map_or(0.0, |last| now.duration_since(last).as_secs_f64() * 1000.0) };
        self.last_frame = Some(now);
        renderer.render(width, height, delta, &[0.0; 4], 0.0, 1.0);
        self.surface.frame(&self.handle, ());
        self.state.frame_pending = true;
        if self.egl_surface.is_some_and(|surface| self.egl.swap_buffers(surface).is_ok()) {
            self.frames += 1;
        } else {
            self.diagnostic = Some("Could not present the preview frame.".into());
        }
    }
}

impl Drop for PreviewSurface {
    fn drop(&mut self) {
        // GL objects die with their own context current.
        if self.make_current() {
            self.renderer = None;
        } else if let Some(renderer) = self.renderer.take() {
            std::mem::forget(renderer);
        }
        self.egl.release_current();
        if let Some(surface) = self.egl_surface.take() {
            self.egl.destroy_surface(surface);
        }
        self.egl.destroy_context(self.context);
        self.window = None;
        self.subsurface.destroy();
        self.surface.destroy();
        let _ = self.connection.flush();
    }
}

impl Dispatch<wl_registry::WlRegistry, GlobalListContents> for State {
    fn event(
        _: &mut Self,
        _: &wl_registry::WlRegistry,
        _: wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<wl_callback::WlCallback, ()> for State {
    fn event(state: &mut Self, _: &wl_callback::WlCallback, event: wl_callback::Event, _: &(), _: &Connection, _: &QueueHandle<Self>) {
        if let wl_callback::Event::Done { .. } = event {
            state.frame_pending = false;
        }
    }
}

delegate_noop!(State: wl_compositor::WlCompositor);
delegate_noop!(State: wl_subcompositor::WlSubcompositor);
delegate_noop!(State: wl_subsurface::WlSubsurface);
delegate_noop!(State: wl_region::WlRegion);
delegate_noop!(State: ignore wl_surface::WlSurface);

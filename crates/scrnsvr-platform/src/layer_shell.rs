//! wlr-layer-shell overlay surfaces with one EGL window and GLES2 context per output.
//!
//! Ported from the Wayland half of `native/renderer/main.cc`; output/seat
//! binding uses smithay-client-toolkit. The session only exposes mechanism:
//! which outputs exist, whether each may draw (frame callback received), input
//! that asks for dismissal, and topology changes that end the screensaver.
//! Pacing, fades and scene policy live in the application.

mod preview;

use std::ffi::c_void;
use std::os::fd::{AsFd, AsRawFd, BorrowedFd};

use khronos_egl as egl;
use scrnsvr_core::{OutputHint, PointerDismissal, Selection};
use smithay_client_toolkit::compositor::{CompositorHandler, CompositorState, Region};
use smithay_client_toolkit::dispatch2::Dispatch2;
use smithay_client_toolkit::output::{OutputHandler, OutputState};
use smithay_client_toolkit::registry::{ProvidesRegistryState, RegistryState};
use smithay_client_toolkit::seat::{Capability, SeatHandler, SeatState};
use smithay_client_toolkit::shell::WaylandSurface;
use smithay_client_toolkit::shell::wlr_layer::{
    Anchor, KeyboardInteractivity, Layer, LayerShell, LayerShellHandler, LayerSurface, LayerSurfaceConfigure,
};
use smithay_client_toolkit::{delegate_dispatch2, delegate_registry, registry_handlers};
use wayland_client::backend::ReadEventsGuard;
use wayland_client::globals::registry_queue_init;
use wayland_client::protocol::{wl_callback, wl_keyboard, wl_output, wl_pointer, wl_seat, wl_surface, wl_touch};
use wayland_client::{Connection, EventQueue, Proxy, QueueHandle, WEnum};
use wayland_egl::WlEglSurface;

use crate::PlatformError;
use crate::egl::Egl;

/// One Wayland output and, once selected and configured, its overlay surface.
pub struct OutputSurface {
    pub global: u32,
    wl_output: wl_output::WlOutput,
    pub name: String,
    pub description: String,
    pub location: (i32, i32),
    /// Integer buffer scale.
    pub scale: i32,
    pub selected: bool,
    layer: Option<LayerSurface>,
    window: Option<WlEglSurface>,
    egl_surface: Option<egl::Surface>,
    context: Option<egl::Context>,
    /// Logical size from the last configure.
    pub width: i32,
    pub height: i32,
    /// The compositor delivered the previous frame callback (or none was requested yet).
    pub frame_ready: bool,
    /// Set when the buffer size changed; cleared by the application.
    pub resized: bool,
    opaque: bool,
}

impl OutputSurface {
    /// True once EGL resources exist and the output can render.
    pub fn is_open(&self) -> bool {
        self.context.is_some() && self.egl_surface.is_some()
    }

    pub fn buffer_size(&self) -> (i32, i32) {
        (self.width * self.scale, self.height * self.scale)
    }

    fn hint(&self) -> OutputHint {
        OutputHint { global: self.global, name: self.name.clone(), description: self.description.clone(), location: self.location }
    }
}

struct State {
    registry_state: RegistryState,
    output_state: OutputState,
    seat_state: SeatState,
    compositor: CompositorState,
    layer_shell: Option<LayerShell>,
    preview: Option<preview::Preview>,
    egl: Option<Egl>,
    outputs: Vec<OutputSurface>,
    initializing: bool,
    surfaces_open: bool,
    dismiss: bool,
    closed: bool,
    fatal: Option<PlatformError>,
    pointer: Option<wl_pointer::WlPointer>,
    keyboard: Option<wl_keyboard::WlKeyboard>,
    touch: Option<wl_touch::WlTouch>,
    pointer_dismissal: PointerDismissal,
}

/// Input devices' user data.
struct InputData;
/// Frame callback user data: index into `State::outputs`.
struct FrameData(usize);

pub struct LayerShellSession {
    connection: Connection,
    queue: EventQueue<State>,
    handle: QueueHandle<State>,
    state: State,
}

fn failed(message: impl Into<String>) -> PlatformError {
    PlatformError::Failed(message.into())
}

impl LayerShellSession {
    /// Connect, bind globals and learn about outputs (two roundtrips).
    pub fn connect() -> Result<Self, PlatformError> {
        Self::connect_with_role(false)
    }

    fn connect_with_role(preview: bool) -> Result<Self, PlatformError> {
        let connection = Connection::connect_to_env().map_err(|_| PlatformError::Unavailable("Cannot connect to Wayland".into()))?;
        let (globals, mut queue) =
            registry_queue_init::<State>(&connection).map_err(|_| PlatformError::Unavailable("Cannot connect to Wayland".into()))?;
        let handle = queue.handle();
        let compositor = CompositorState::bind(&globals, &handle)
            .map_err(|_| PlatformError::Unavailable("Compositor does not provide wl_compositor".into()))?;
        let mut state = State {
            registry_state: RegistryState::new(&globals),
            output_state: OutputState::new(&globals, &handle),
            seat_state: SeatState::new(&globals, &handle),
            layer_shell: if preview { None } else { LayerShell::bind(&globals, &handle).ok() },
            preview: if preview { Some(preview::Preview::bind(&globals, &handle)?) } else { None },
            compositor,
            egl: None,
            outputs: Vec::new(),
            initializing: true,
            surfaces_open: false,
            dismiss: false,
            closed: false,
            fatal: None,
            pointer: None,
            keyboard: None,
            touch: None,
            pointer_dismissal: PointerDismissal::default(),
        };
        for _ in 0..2 {
            queue.roundtrip(&mut state).map_err(|_| PlatformError::Unavailable("Cannot connect to Wayland".into()))?;
        }
        state.initializing = false;
        Ok(Self { connection, queue, handle, state })
    }

    /// The `wl_display*` for EGL.
    pub fn display_ptr(&self) -> *mut c_void {
        self.connection.backend().display_ptr().cast()
    }

    pub fn has_layer_shell(&self) -> bool {
        self.state.layer_shell.is_some()
    }

    pub fn output_hints(&self) -> Vec<OutputHint> {
        self.state.outputs.iter().map(OutputSurface::hint).collect()
    }

    pub fn outputs(&self) -> &[OutputSurface] {
        &self.state.outputs
    }

    pub fn output_mut(&mut self, index: usize) -> &mut OutputSurface {
        &mut self.state.outputs[index]
    }

    pub fn select(&mut self, selection: &Selection) {
        for output in &mut self.state.outputs {
            output.selected = match selection {
                Selection::All => true,
                Selection::One { global, .. } => output.global == *global,
                Selection::None => false,
            };
        }
    }

    pub fn init_egl(&mut self) -> Result<(), PlatformError> {
        // SAFETY: the connection (and its wl_display) lives as long as `self`, and `Drop` destroys EGL first.
        self.state.egl = Some(unsafe { Egl::for_wayland(self.display_ptr()) }?);
        Ok(())
    }

    pub fn egl(&self) -> Option<&Egl> {
        self.state.egl.as_ref()
    }

    pub fn surfaces_open(&self) -> bool {
        self.state.surfaces_open
    }

    /// Create a fullscreen overlay layer surface on each selected output.
    pub fn open_surfaces(&mut self) -> Result<(), PlatformError> {
        let layer_shell = self
            .state
            .layer_shell
            .as_ref()
            .ok_or_else(|| PlatformError::Unavailable("Compositor does not provide wlr-layer-shell".into()))?;
        for output in self.state.outputs.iter_mut().filter(|output| output.selected) {
            let surface = self.state.compositor.create_surface(&self.handle);
            surface.set_buffer_scale(output.scale);
            let layer = layer_shell.create_layer_surface(&self.handle, surface, Layer::Overlay, Some("scrnsvr"), Some(&output.wl_output));
            layer.set_anchor(Anchor::all());
            layer.set_size(0, 0);
            layer.set_exclusive_zone(-1);
            layer.set_keyboard_interactivity(KeyboardInteractivity::Exclusive);
            layer.commit();
            output.layer = Some(layer);
        }
        self.state.surfaces_open = true;
        Ok(())
    }

    /// Dispatch queued events; reports a disconnect or a failure raised inside a handler.
    pub fn dispatch_pending(&mut self) -> Result<(), PlatformError> {
        self.queue.dispatch_pending(&mut self.state).map_err(|_| failed("Wayland compositor disconnected or rejected the surface"))?;
        match self.state.fatal.take() {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    /// Prepare to read; `None` when events are already queued and must be dispatched first.
    pub fn prepare_read(&self) -> Option<ReadEventsGuard> {
        self.queue.prepare_read()
    }

    pub fn flush(&self) -> Result<(), PlatformError> {
        match self.connection.flush() {
            Ok(()) => Ok(()),
            Err(wayland_client::backend::WaylandError::Io(error)) if error.kind() == std::io::ErrorKind::WouldBlock => Ok(()),
            Err(_) => Err(failed("Could not flush the Wayland connection")),
        }
    }

    pub fn connection_fd(&self) -> BorrowedFd<'_> {
        self.connection.as_fd()
    }

    pub fn raw_fd(&self) -> i32 {
        self.connection.as_fd().as_raw_fd()
    }

    /// Input asked to dismiss since the last call.
    pub fn take_dismiss(&mut self) -> bool {
        std::mem::take(&mut self.state.dismiss)
    }

    /// The compositor closed a surface, or the output topology changed.
    pub fn closed(&self) -> bool {
        self.state.closed
    }

    pub fn make_current(&self, index: usize) -> Result<(), PlatformError> {
        let output = &self.state.outputs[index];
        let (Some(egl), Some(surface), Some(context)) = (&self.state.egl, output.egl_surface, output.context) else {
            return Err(failed("Output has no EGL surface"));
        };
        egl.make_current(surface, context).map_err(|_| failed("Could not activate the EGL context"))
    }

    /// Update the opaque region, request the next frame callback and swap.
    pub fn present(&mut self, index: usize, opaque: bool) -> Result<(), PlatformError> {
        let surface = self.state.surface(index).cloned().ok_or_else(|| failed("Output has no surface"))?;
        let output = &mut self.state.outputs[index];
        // An opaque region lets the compositor skip what is underneath once the fade completes.
        if opaque && !output.opaque {
            if let Ok(region) = Region::new(&self.state.compositor) {
                region.add(0, 0, output.width, output.height);
                surface.set_opaque_region(Some(region.wl_region()));
                output.opaque = true;
            }
        } else if !opaque && output.opaque {
            surface.set_opaque_region(None);
            output.opaque = false;
        }
        surface.frame(&self.handle, FrameData(index));
        output.frame_ready = false;
        let (Some(egl), Some(egl_surface)) = (&self.state.egl, output.egl_surface) else { return Err(failed("Output has no EGL surface")) };
        egl.swap_buffers(egl_surface).map_err(|_| failed("eglSwapBuffers failed"))
    }
}

impl Drop for LayerShellSession {
    fn drop(&mut self) {
        let state = &mut self.state;
        if let Some(egl) = &state.egl {
            egl.release_current();
            for output in &mut state.outputs {
                if let Some(context) = output.context.take() {
                    egl.destroy_context(context);
                }
                if let Some(surface) = output.egl_surface.take() {
                    egl.destroy_surface(surface);
                }
            }
        }
        for output in &mut state.outputs {
            output.window = None;
            output.layer = None;
        }
        state.preview = None;
        state.egl = None;
        let _ = self.connection.flush();
    }
}

impl State {
    fn surface(&self, index: usize) -> Option<&wl_surface::WlSurface> {
        self.outputs[index]
            .layer
            .as_ref()
            .map(WaylandSurface::wl_surface)
            .or_else(|| self.preview.as_ref().filter(|_| self.outputs[index].selected)?.surface())
    }

    fn index_of(&self, output: &wl_output::WlOutput) -> Option<usize> {
        self.outputs.iter().position(|entry| &entry.wl_output == output)
    }

    fn refresh(&mut self, output: &wl_output::WlOutput) {
        let Some(info) = self.output_state.info(output) else { return };
        let entry = match self.index_of(output) {
            Some(index) => &mut self.outputs[index],
            None => {
                self.outputs.push(OutputSurface {
                    global: info.id,
                    wl_output: output.clone(),
                    name: String::new(),
                    description: String::new(),
                    location: (0, 0),
                    scale: 1,
                    selected: false,
                    layer: None,
                    window: None,
                    egl_surface: None,
                    context: None,
                    width: 0,
                    height: 0,
                    frame_ready: false,
                    resized: false,
                    opaque: false,
                });
                self.outputs.last_mut().expect("just pushed")
            }
        };
        entry.name = info.name.unwrap_or_default();
        entry.description = info.description.unwrap_or_default();
        entry.location = info.logical_position.unwrap_or(info.location);
        entry.scale = info.scale_factor.max(1);
    }

    fn create_surface_resources(&mut self, index: usize) -> Result<(), PlatformError> {
        let egl = self.egl.as_ref().ok_or_else(|| PlatformError::Unavailable("EGL is not initialized".into()))?;
        let surface = self.surface(index).ok_or_else(|| failed("Output has no surface"))?.id();
        let output = &mut self.outputs[index];
        let (width, height) = output.buffer_size();
        let window = WlEglSurface::new(surface, width, height)
            .map_err(|_| PlatformError::Unavailable("Could not create a Wayland EGL window".into()))?;
        // SAFETY: `window` is stored next to the surface and destroyed after it.
        let surface = unsafe { egl.create_window_surface(window.ptr() as *mut c_void) }?;
        output.window = Some(window);
        output.egl_surface = Some(surface);
        let context = egl.create_context()?;
        output.context = Some(context);
        egl.make_current(surface, context).map_err(|_| PlatformError::Unavailable("Could not activate the EGL context".into()))?;
        egl.disable_vsync();
        Ok(())
    }

    fn configure_size(&mut self, index: usize, width: i32, height: i32) -> Result<(), PlatformError> {
        let output = &mut self.outputs[index];
        let resized = width != output.width || height != output.height;
        output.width = width;
        output.height = height;
        if output.window.is_none() {
            self.create_surface_resources(index)?;
            let output = &mut self.outputs[index];
            output.frame_ready = true;
            output.resized = true;
        } else if resized {
            let (buffer_width, buffer_height) = output.buffer_size();
            if let Some(window) = &output.window {
                window.resize(buffer_width, buffer_height, 0, 0);
            }
            output.resized = true;
            if std::mem::take(&mut output.opaque)
                && let Some(surface) = self.surface(index)
            {
                surface.set_opaque_region(None);
            }
        }
        Ok(())
    }
}

impl CompositorHandler for State {
    fn scale_factor_changed(&mut self, _: &Connection, _: &QueueHandle<Self>, surface: &wl_surface::WlSurface, scale: i32) {
        let Some(preview) = &self.preview else { return };
        if preview.surface() != Some(surface) {
            return;
        }
        let Some(output) = self.outputs.iter_mut().find(|output| output.selected) else { return };
        let scale = scale.max(1);
        if output.scale != scale {
            surface.set_buffer_scale(scale);
            output.scale = scale;
            if let Some(window) = &output.window {
                let (width, height) = output.buffer_size();
                window.resize(width, height, 0, 0);
            }
            output.resized = true;
        }
    }
    fn transform_changed(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &wl_surface::WlSurface, _: wl_output::Transform) {}
    fn frame(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &wl_surface::WlSurface, _: u32) {}
    fn surface_enter(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &wl_surface::WlSurface, _: &wl_output::WlOutput) {}
    fn surface_leave(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &wl_surface::WlSurface, _: &wl_output::WlOutput) {}
}

impl Dispatch2<wl_callback::WlCallback, State> for FrameData {
    fn event(&self, state: &mut State, _: &wl_callback::WlCallback, event: wl_callback::Event, _: &Connection, _: &QueueHandle<State>) {
        if let wl_callback::Event::Done { .. } = event
            && let Some(output) = state.outputs.get_mut(self.0)
        {
            output.frame_ready = true;
        }
    }
}

impl OutputHandler for State {
    fn output_state(&mut self) -> &mut OutputState {
        &mut self.output_state
    }

    fn new_output(&mut self, _: &Connection, _: &QueueHandle<Self>, output: wl_output::WlOutput) {
        self.refresh(&output);
        // A new output ends the current screensaver. The next launch selects outputs afresh.
        if self.preview.is_none() && !self.initializing && self.surfaces_open {
            self.closed = true;
        }
    }

    fn update_output(&mut self, _: &Connection, _: &QueueHandle<Self>, output: wl_output::WlOutput) {
        let index = self.index_of(&output);
        self.refresh(&output);
        if let Some(index) = index {
            let entry = &self.outputs[index];
            if self.preview.is_none() && !self.initializing && self.surfaces_open && entry.selected && entry.window.is_some() {
                self.closed = true;
            }
        }
    }

    fn output_destroyed(&mut self, _: &Connection, _: &QueueHandle<Self>, output: wl_output::WlOutput) {
        if self.index_of(&output).is_some_and(|index| self.outputs[index].selected) {
            self.closed = true;
        }
    }
}

impl LayerShellHandler for State {
    fn closed(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &LayerSurface) {
        self.closed = true;
    }

    fn configure(&mut self, _: &Connection, _: &QueueHandle<Self>, layer: &LayerSurface, configure: LayerSurfaceConfigure, _: u32) {
        if self.fatal.is_some() {
            return;
        }
        let Some(index) =
            self.outputs.iter().position(|output| output.layer.as_ref().is_some_and(|own| own.wl_surface() == layer.wl_surface()))
        else {
            return;
        };
        let (width, height) = configure.new_size;
        if width == 0 || height == 0 {
            self.fatal = Some(failed("Invalid layer-shell output size"));
            return;
        }
        self.fatal = self.configure_size(index, width as i32, height as i32).err();
    }
}

impl SeatHandler for State {
    fn seat_state(&mut self) -> &mut SeatState {
        &mut self.seat_state
    }

    fn new_seat(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat) {}

    fn new_capability(&mut self, _: &Connection, qh: &QueueHandle<Self>, seat: wl_seat::WlSeat, capability: Capability) {
        match capability {
            Capability::Pointer if self.pointer.is_none() => self.pointer = Some(seat.get_pointer(qh, InputData)),
            Capability::Keyboard if self.keyboard.is_none() => self.keyboard = Some(seat.get_keyboard(qh, InputData)),
            Capability::Touch if self.touch.is_none() => self.touch = Some(seat.get_touch(qh, InputData)),
            _ => {}
        }
    }

    fn remove_capability(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat, capability: Capability) {
        match capability {
            Capability::Pointer => {
                if let Some(pointer) = self.pointer.take()
                    && pointer.version() >= 3
                {
                    pointer.release();
                }
            }
            Capability::Keyboard => {
                if let Some(keyboard) = self.keyboard.take()
                    && keyboard.version() >= 3
                {
                    keyboard.release();
                }
            }
            Capability::Touch => {
                if let Some(touch) = self.touch.take()
                    && touch.version() >= 3
                {
                    touch.release();
                }
            }
            _ => {}
        }
    }

    fn remove_seat(&mut self, _: &Connection, _: &QueueHandle<Self>, _: wl_seat::WlSeat) {}
}

impl Dispatch2<wl_pointer::WlPointer, State> for InputData {
    fn event(&self, state: &mut State, pointer: &wl_pointer::WlPointer, event: wl_pointer::Event, _: &Connection, _: &QueueHandle<State>) {
        match event {
            wl_pointer::Event::Enter { serial, surface_x, surface_y, .. } => {
                if state.preview.is_none() {
                    // Hide the cursor over the screensaver.
                    pointer.set_cursor(serial, None, 0, 0);
                }
                state.pointer_dismissal.enter(surface_x, surface_y);
            }
            wl_pointer::Event::Leave { .. } => state.pointer_dismissal.leave(),
            wl_pointer::Event::Motion { surface_x, surface_y, .. } => {
                if state.pointer_dismissal.motion(surface_x, surface_y) {
                    state.dismiss = true;
                }
            }
            wl_pointer::Event::Button { state: WEnum::Value(wl_pointer::ButtonState::Pressed), .. } | wl_pointer::Event::Axis { .. } => {
                state.dismiss = true
            }
            _ => {}
        }
    }
}

impl Dispatch2<wl_keyboard::WlKeyboard, State> for InputData {
    fn event(&self, state: &mut State, _: &wl_keyboard::WlKeyboard, event: wl_keyboard::Event, _: &Connection, _: &QueueHandle<State>) {
        // The keymap file descriptor is closed when the event is dropped.
        if let wl_keyboard::Event::Key { state: WEnum::Value(wl_keyboard::KeyState::Pressed), .. } = event {
            state.dismiss = true;
        }
    }
}

impl Dispatch2<wl_touch::WlTouch, State> for InputData {
    fn event(&self, state: &mut State, _: &wl_touch::WlTouch, event: wl_touch::Event, _: &Connection, _: &QueueHandle<State>) {
        if let wl_touch::Event::Down { .. } = event {
            state.dismiss = true;
        }
    }
}

impl ProvidesRegistryState for State {
    fn registry(&mut self) -> &mut RegistryState {
        &mut self.registry_state
    }
    registry_handlers![OutputState, SeatState];
}

delegate_registry!(State);
delegate_dispatch2!(State);

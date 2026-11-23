//! A resizable xdg-shell toplevel that shares the layer-shell EGL and input loop.

use std::time::Duration;

use smithay_client_toolkit::shell::xdg::window::{Window, WindowConfigure, WindowDecorations, WindowHandler};
use smithay_client_toolkit::shell::xdg::{XdgShell, XdgSurface};
use wayland_client::globals::GlobalList;

use super::{LayerShellSession, PlatformError, State, failed};
use smithay_client_toolkit::shell::WaylandSurface;
use wayland_client::protocol::wl_surface;
use wayland_client::{Connection, QueueHandle};

pub(super) struct Preview {
    shell: XdgShell,
    window: Option<Window>,
}

impl Preview {
    pub(super) fn bind(globals: &GlobalList, handle: &QueueHandle<State>) -> Result<Self, PlatformError> {
        let shell =
            XdgShell::bind(globals, handle).map_err(|_| PlatformError::Unavailable("Compositor does not provide xdg-shell".into()))?;
        Ok(Self { shell, window: None })
    }

    pub(super) fn surface(&self) -> Option<&wl_surface::WlSurface> {
        self.window.as_ref().map(WaylandSurface::wl_surface)
    }
}

impl LayerShellSession {
    pub fn connect_preview() -> Result<Self, PlatformError> {
        Self::connect_with_role(true)
    }

    pub fn open_preview(&mut self, global: u32) -> Result<usize, PlatformError> {
        let preview = self.state.preview.as_mut().ok_or_else(|| failed("Connected without xdg-shell"))?;
        let (index, output) = self
            .state
            .outputs
            .iter_mut()
            .enumerate()
            .find(|(_, output)| output.global == global)
            .ok_or_else(|| failed("Preview output disappeared"))?;
        output.selected = true;
        let surface = self.state.compositor.create_surface(&self.handle);
        surface.set_buffer_scale(output.scale);
        let window = preview.shell.create_window(surface, WindowDecorations::None, &self.handle);
        window.set_app_id("scrnsvr-preview");
        window.set_title("Scrnsvr Preview");
        window.commit();
        preview.window = Some(window);
        Ok(index)
    }

    pub fn wait(&mut self, timeout: Duration) -> Result<(), PlatformError> {
        if let Some(guard) = self.prepare_read() {
            crate::wait_for_events(&self.connection, guard, timeout)?;
        }
        self.dispatch_pending()
    }

    pub fn sync_preview(&mut self) -> Result<(), PlatformError> {
        self.queue.roundtrip(&mut self.state).map_err(|err| failed(format!("Could not map the preview window: {err}")))?;
        Ok(())
    }
}

impl WindowHandler for State {
    fn request_close(&mut self, _: &Connection, _: &QueueHandle<Self>, _: &Window) {
        self.dismiss = true;
    }

    fn configure(&mut self, _: &Connection, _: &QueueHandle<Self>, window: &Window, configure: WindowConfigure, _: u32) {
        if self.fatal.is_some() {
            return;
        }
        let Some(index) = self.outputs.iter().position(|output| output.selected) else { return };
        let output = &self.outputs[index];
        let (width, height) = configure.new_size;
        let width = width.map_or_else(|| if output.width == 0 { 960 } else { output.width }, |n| n.get() as i32);
        let height = height.map_or_else(|| if output.height == 0 { 540 } else { output.height }, |n| n.get() as i32);
        window.xdg_surface().set_window_geometry(0, 0, width, height);
        self.fatal = self.configure_size(index, width, height).err();
    }
}

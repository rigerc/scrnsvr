//! EGL display, config and context ownership for the GLES2 shader path.
//!
//! libEGL is loaded at runtime, so the binary starts and can report
//! "unavailable" (exit 2) on machines without it. Contexts request
//! OpenGL ES 2 to preserve the GLSL ES 1.00 shader ABI.

use std::ffi::c_void;
use std::sync::Arc;

use khronos_egl as egl;

use crate::PlatformError;

pub type EglInstance = egl::DynamicInstance<egl::EGL1_4>;

/// An initialized EGL display and the config chosen for it. Terminates the
/// display when dropped; destroy contexts and surfaces first.
///
/// EGL displays are per-process singletons per native display: keep one
/// `Egl` per native display, since terminating it invalidates every user.
pub struct Egl {
    instance: Arc<EglInstance>,
    display: egl::Display,
    config: egl::Config,
}

/// A headless context with a small pbuffer, for compile checks and capture.
pub struct Headless {
    pub egl: Egl,
    pub context: egl::Context,
    pub surface: egl::Surface,
}

impl Drop for Headless {
    fn drop(&mut self) {
        let instance = &self.egl.instance;
        let _ = instance.make_current(self.egl.display, None, None, None);
        let _ = instance.destroy_surface(self.egl.display, self.surface);
        let _ = instance.destroy_context(self.egl.display, self.context);
    }
}

fn unavailable(message: impl Into<String>) -> PlatformError {
    PlatformError::Unavailable(message.into())
}

impl Egl {
    /// Initialize EGL on a native display (a `wl_display*`, or
    /// [`egl::DEFAULT_DISPLAY`]) with an RGBA8 GLES2 config for `surface_type`.
    ///
    /// # Safety
    /// `native_display` must be a valid native display for as long as this value lives.
    pub unsafe fn new(native_display: *mut c_void, surface_type: egl::Int) -> Result<Self, PlatformError> {
        // SAFETY: loading the system libEGL; its initializers are trusted like any system library.
        let instance =
            unsafe { EglInstance::load_required() }.map_err(|error| unavailable(format!("libEGL could not be loaded: {error}")))?;
        // SAFETY: guaranteed by the caller.
        let display = unsafe { instance.get_display(native_display) }.ok_or_else(|| unavailable("EGL is unavailable on this display"))?;
        instance.initialize(display).map_err(|_| unavailable("EGL is unavailable on this display"))?;
        let result = (|| {
            instance.bind_api(egl::OPENGL_ES_API).map_err(|_| unavailable("OpenGL ES is unavailable"))?;
            // RGBA8 for windows (premultiplied alpha over the desktop) and for capture precision.
            let attributes = [
                egl::SURFACE_TYPE,
                surface_type,
                egl::RENDERABLE_TYPE,
                egl::OPENGL_ES2_BIT,
                egl::RED_SIZE,
                8,
                egl::GREEN_SIZE,
                8,
                egl::BLUE_SIZE,
                8,
                egl::ALPHA_SIZE,
                8,
                egl::NONE,
            ];
            instance
                .choose_first_config(display, &attributes)
                .ok()
                .flatten()
                .ok_or_else(|| unavailable("No RGBA8 EGL config for OpenGL ES 2"))
        })();
        match result {
            Ok(config) => Ok(Self { instance: Arc::new(instance), display, config }),
            Err(error) => {
                let _ = instance.terminate(display);
                Err(error)
            }
        }
    }

    /// Window-surface EGL for a Wayland connection.
    ///
    /// # Safety
    /// `wl_display` must outlive the returned value.
    pub unsafe fn for_wayland(wl_display: *mut c_void) -> Result<Self, PlatformError> {
        // SAFETY: forwarded from the caller.
        unsafe { Self::new(wl_display, egl::WINDOW_BIT) }
    }

    /// A current headless GLES2 context. Uses `native_display` when given
    /// (the Wayland connection), otherwise EGL's default display.
    ///
    /// # Safety
    /// `native_display` must be null or valid for the returned value's lifetime.
    pub unsafe fn headless(native_display: *mut c_void, width: i32, height: i32) -> Result<Headless, PlatformError> {
        let display = if native_display.is_null() { egl::DEFAULT_DISPLAY } else { native_display };
        // SAFETY: forwarded from the caller.
        let egl = unsafe { Self::new(display, egl::PBUFFER_BIT) }?;
        let context = egl.create_context()?;
        let surface =
            match egl.instance.create_pbuffer_surface(egl.display, egl.config, &[egl::WIDTH, width, egl::HEIGHT, height, egl::NONE]) {
                Ok(surface) => surface,
                Err(_) => {
                    egl.destroy_context(context);
                    return Err(unavailable("Could not create a headless EGL surface"));
                }
            };
        let headless = Headless { egl, context, surface };
        headless.egl.make_current(headless.surface, headless.context).map_err(|_| unavailable("Could not activate a headless context"))?;
        Ok(headless)
    }

    pub fn create_context(&self) -> Result<egl::Context, PlatformError> {
        self.instance
            .create_context(self.display, self.config, None, &[egl::CONTEXT_CLIENT_VERSION, 2, egl::NONE])
            .map_err(|_| unavailable("Could not create an OpenGL ES 2 context"))
    }

    /// # Safety
    /// `window` must be a live native window (e.g. `wl_egl_window*`) that
    /// outlives the surface.
    pub unsafe fn create_window_surface(&self, window: *mut c_void) -> Result<egl::Surface, PlatformError> {
        // SAFETY: forwarded from the caller.
        unsafe { self.instance.create_window_surface(self.display, self.config, window, None) }
            .map_err(|_| unavailable("Could not create an EGL window surface"))
    }

    pub fn make_current(&self, surface: egl::Surface, context: egl::Context) -> Result<(), egl::Error> {
        self.instance.make_current(self.display, Some(surface), Some(surface), Some(context))
    }

    pub fn release_current(&self) {
        let _ = self.instance.make_current(self.display, None, None, None);
    }

    /// Frame callbacks pace rendering; swaps must never block the event loop.
    pub fn disable_vsync(&self) {
        let _ = self.instance.swap_interval(self.display, 0);
    }

    pub fn swap_buffers(&self, surface: egl::Surface) -> Result<(), egl::Error> {
        self.instance.swap_buffers(self.display, surface)
    }

    pub fn destroy_surface(&self, surface: egl::Surface) {
        let _ = self.instance.destroy_surface(self.display, surface);
    }

    pub fn destroy_context(&self, context: egl::Context) {
        let _ = self.instance.destroy_context(self.display, context);
    }

    /// GL function lookup for `glow::Context::from_loader_function`.
    pub fn proc_address(&self, name: &str) -> *const c_void {
        self.instance.get_proc_address(name).map_or(std::ptr::null(), |function| function as *const c_void)
    }
}

impl Drop for Egl {
    fn drop(&mut self) {
        let _ = self.instance.terminate(self.display);
    }
}

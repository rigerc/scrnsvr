//! Shared, windowing-free scrnsvr logic.
//!
//! This crate owns the renderer's JSON-lines protocol (the boundary with the
//! Electron main process, see `src/main/native-renderer.ts`), the presentation
//! timeline (activation/dismissal fades and rotation through black), animation
//! clocks, and renderer command-line options. Nothing here touches Wayland, EGL
//! or GL, so it is unit-testable and reusable by the saver, previews and
//! thumbnail capture.

pub mod animation;
pub mod input;
pub mod options;
pub mod outputs;
pub mod presentation;
pub mod protocol;
pub mod source;

pub use animation::{AnimationClock, AudioSmoother};
pub use input::PointerDismissal;
pub use options::{CaptureOptions, OptionsError, RendererOptions};
pub use outputs::{OutputHint, Selection, select_outputs};
pub use presentation::{OutputFade, Phase, Presentation};
pub use protocol::{ClockSpec, EffectSpec, Message, ProtocolError, SceneSpec, UniformValue};

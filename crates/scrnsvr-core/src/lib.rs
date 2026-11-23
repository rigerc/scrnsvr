//! Shared, windowing-free scrnsvr logic.
//!
//! Owns native configuration, the asset catalog and scene resolution, the
//! renderer's JSON-lines protocol, and animation and presentation timing.

pub mod animation;
pub mod catalog;
pub mod clock;
pub mod config;
pub mod input;
pub mod options;
pub mod outputs;
pub mod presentation;
pub mod protocol;
pub mod scene;
pub mod source;

pub use animation::{AnimationClock, AudioSmoother};
pub use input::PointerDismissal;
pub use options::{CaptureOptions, OptionsError, RendererOptions};
pub use outputs::{OutputHint, Selection, select_outputs};
pub use presentation::{OutputFade, Phase, Presentation};
pub use protocol::{ClockSpec, EffectSpec, Message, ProtocolError, SceneSpec, UniformValue};

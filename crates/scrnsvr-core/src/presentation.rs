//! Activation and dismissal fades, and scene rotation through black.
//!
//! Times are monotonic milliseconds. The timeline is shared by every output;
//! each output keeps its own [`OutputFade`] because outputs present their first
//! frame at slightly different times.
//!
//! - Activation: the first frame is fully transparent and alpha rises over
//!   `fade_ms`, so the desktop crossfades straight into the scene.
//! - Rotation: a black overlay rises over half the fade, the pending scene is
//!   swapped in at black, then the overlay falls. Picks arriving during the
//!   fade-out are coalesced; only the latest is mounted.
//! - Dismissal: each output fades from its current alpha back to the desktop.

use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Idle,
    /// Overlay rising to black before a swap.
    Out,
    /// Overlay falling after a swap.
    In,
}

fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

/// Per-output fade state.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct OutputFade {
    /// When this output presented its first frame.
    pub first_frame: Option<f64>,
    /// Alpha at the moment of dismissal; the exit fade starts here.
    pub exit_from: f64,
}

#[derive(Debug)]
pub struct Presentation<S> {
    fade_ms: f64,
    scene: Option<Arc<S>>,
    scene_version: u64,
    pending: Option<Arc<S>>,
    phase: Phase,
    phase_start: f64,
    overlay_from: f64,
    exiting: bool,
    exit_start: f64,
}

impl<S> Presentation<S> {
    pub fn new(fade_ms: f64) -> Self {
        Self {
            fade_ms: fade_ms.max(0.0),
            scene: None,
            scene_version: 0,
            pending: None,
            phase: Phase::Idle,
            phase_start: 0.0,
            overlay_from: 0.0,
            exiting: false,
            exit_start: 0.0,
        }
    }

    pub fn fade_ms(&self) -> f64 {
        self.fade_ms
    }

    /// The rotation's half-fade, never shorter than one 60 Hz frame.
    pub fn half(&self) -> f64 {
        (self.fade_ms / 2.0).max(1000.0 / 60.0)
    }

    pub fn scene(&self) -> Option<&Arc<S>> {
        self.scene.as_ref()
    }

    /// Increments each time the mounted scene changes; outputs compare it to
    /// decide when to compile.
    pub fn scene_version(&self) -> u64 {
        self.scene_version
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn exiting(&self) -> bool {
        self.exiting
    }

    pub fn exit_start(&self) -> f64 {
        self.exit_start
    }

    /// Mount immediately when nothing is showing; otherwise rotate through black.
    pub fn set_scene(&mut self, next: Arc<S>, now: f64) {
        if self.exiting {
            return;
        }
        if self.scene.is_none() || self.fade_ms <= 0.0 {
            self.scene = Some(next);
            self.scene_version += 1;
            return;
        }
        if self.phase != Phase::Out {
            self.overlay_from = self.overlay(now);
            self.phase = Phase::Out;
            self.phase_start = now;
        }
        self.pending = Some(next);
    }

    /// Black overlay strength for the rotation transition.
    pub fn overlay(&self, now: f64) -> f64 {
        match self.phase {
            Phase::Out => self.overlay_from + (1.0 - self.overlay_from) * clamp01((now - self.phase_start) / self.half()),
            Phase::In => 1.0 - clamp01((now - self.phase_start) / self.half()),
            Phase::Idle => 0.0,
        }
    }

    /// Swap the pending scene at black and finish the fade back in.
    pub fn advance(&mut self, now: f64) {
        if self.phase == Phase::Out && self.overlay(now) >= 1.0 {
            if let Some(pending) = self.pending.take() {
                self.scene = Some(pending);
                self.scene_version += 1;
            }
            self.phase = Phase::In;
            self.phase_start = now;
        } else if self.phase == Phase::In && now - self.phase_start >= self.half() {
            self.phase = Phase::Idle;
        }
    }

    /// Begin the exit fade. Returns false when already exiting. Call
    /// [`Presentation::freeze_exit`] for each output afterwards.
    pub fn dismiss(&mut self, now: f64) -> bool {
        if self.exiting {
            return false;
        }
        self.exiting = true;
        self.exit_start = now;
        self.pending = None;
        true
    }

    /// Record where an output's exit fade begins.
    pub fn freeze_exit(&self, fade: &mut OutputFade) {
        fade.exit_from = self.entry_alpha(fade, self.exit_start);
    }

    pub fn entry_alpha(&self, fade: &OutputFade, now: f64) -> f64 {
        match fade.first_frame {
            None => 0.0,
            Some(_) if self.fade_ms <= 0.0 => 1.0,
            Some(first) => clamp01((now - first) / self.fade_ms),
        }
    }

    /// Scene alpha over the desktop for one output.
    pub fn alpha(&self, fade: &OutputFade, now: f64) -> f64 {
        if !self.exiting {
            return self.entry_alpha(fade, now);
        }
        if self.fade_ms <= 0.0 {
            return 0.0;
        }
        fade.exit_from * (1.0 - clamp01((now - self.exit_start) / self.fade_ms))
    }

    /// Hard deadline after dismissal, for outputs that stopped presenting.
    pub fn exit_deadline(&self) -> f64 {
        self.exit_start + self.fade_ms + 1500.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shown(fade: f64) -> (Presentation<&'static str>, OutputFade) {
        let mut presentation = Presentation::new(fade);
        presentation.set_scene(Arc::new("a"), 0.0);
        (presentation, OutputFade { first_frame: Some(0.0), exit_from: 0.0 })
    }

    #[test]
    fn mounts_the_first_scene_immediately_and_fades_in_from_transparent() {
        let (presentation, fade) = shown(1000.0);
        assert_eq!(presentation.scene().map(|s| **s), Some("a"));
        assert_eq!(presentation.scene_version(), 1);
        assert_eq!(presentation.alpha(&OutputFade::default(), 10.0), 0.0, "before the first frame");
        assert_eq!(presentation.alpha(&fade, 0.0), 0.0);
        assert_eq!(presentation.alpha(&fade, 500.0), 0.5);
        assert_eq!(presentation.alpha(&fade, 2000.0), 1.0);
    }

    #[test]
    fn rotates_through_black_and_coalesces_picks() {
        let (mut presentation, _) = shown(1000.0);
        presentation.set_scene(Arc::new("b"), 2000.0);
        presentation.set_scene(Arc::new("c"), 2100.0);
        assert_eq!(presentation.phase(), Phase::Out);
        assert!((presentation.overlay(2250.0) - 0.5).abs() < 1e-9, "the overlay keeps its original start");
        presentation.advance(2400.0);
        assert_eq!(presentation.scene().map(|s| **s), Some("a"), "not yet black");
        presentation.advance(2500.0);
        assert_eq!(presentation.scene().map(|s| **s), Some("c"), "only the latest pick is mounted");
        assert_eq!(presentation.scene_version(), 2);
        assert_eq!(presentation.phase(), Phase::In);
        assert!((presentation.overlay(2750.0) - 0.5).abs() < 1e-9);
        presentation.advance(3000.0);
        assert_eq!(presentation.phase(), Phase::Idle);
        assert_eq!(presentation.overlay(3000.0), 0.0);
    }

    #[test]
    fn a_pick_during_the_fade_in_starts_from_the_current_overlay() {
        let (mut presentation, _) = shown(1000.0);
        presentation.set_scene(Arc::new("b"), 0.0);
        presentation.advance(500.0);
        presentation.set_scene(Arc::new("c"), 750.0);
        assert!((presentation.overlay(750.0) - 0.5).abs() < 1e-9);
        assert!((presentation.overlay(1000.0) - 0.75).abs() < 1e-9);
    }

    #[test]
    fn swaps_instantly_without_a_fade() {
        let (mut presentation, fade) = shown(0.0);
        presentation.set_scene(Arc::new("b"), 10.0);
        assert_eq!(presentation.scene().map(|s| **s), Some("b"));
        assert_eq!(presentation.phase(), Phase::Idle);
        assert_eq!(presentation.alpha(&fade, 0.0), 1.0);
        assert!(presentation.dismiss(20.0));
        assert_eq!(presentation.alpha(&fade, 20.0), 0.0);
    }

    #[test]
    fn dismissal_fades_from_the_current_alpha_and_drops_pending_scenes() {
        let (mut presentation, mut fade) = shown(1000.0);
        presentation.set_scene(Arc::new("b"), 100.0);
        assert!(presentation.dismiss(500.0));
        assert!(!presentation.dismiss(600.0), "dismissal happens once");
        presentation.freeze_exit(&mut fade);
        assert_eq!(fade.exit_from, 0.5);
        assert_eq!(presentation.alpha(&fade, 1000.0), 0.25);
        assert_eq!(presentation.alpha(&fade, 1500.0), 0.0);
        presentation.set_scene(Arc::new("c"), 700.0);
        presentation.advance(2000.0);
        assert_eq!(presentation.scene().map(|s| **s), Some("a"), "no scene is mounted while exiting");
        assert_eq!(presentation.exit_deadline(), 3000.0);
    }
}

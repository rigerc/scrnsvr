//! Input dismissal policy: a key press, click, scroll or touch dismisses
//! immediately; pointer motion must travel beyond 12 logical pixels first.

/// Squared logical-pixel distance pointer motion must exceed to dismiss.
pub const POINTER_DISMISS_DISTANCE_SQUARED: f64 = 144.0;

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct PointerDismissal {
    origin: Option<(f64, f64)>,
}

impl PointerDismissal {
    /// The pointer entered a surface at this position.
    pub fn enter(&mut self, x: f64, y: f64) {
        self.origin = Some((x, y));
    }

    pub fn leave(&mut self) {
        self.origin = None;
    }

    /// Returns true when this motion should dismiss the screensaver.
    pub fn motion(&mut self, x: f64, y: f64) -> bool {
        match self.origin {
            Some((ox, oy)) => {
                let (dx, dy) = (x - ox, y - oy);
                dx * dx + dy * dy > POINTER_DISMISS_DISTANCE_SQUARED
            }
            None => {
                self.origin = Some((x, y));
                false
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dismisses_only_after_twelve_pixels_of_travel() {
        let mut pointer = PointerDismissal::default();
        assert!(!pointer.motion(100.0, 100.0), "the first motion without enter sets the origin");
        assert!(!pointer.motion(112.0, 100.0), "exactly twelve pixels does not dismiss");
        assert!(pointer.motion(109.0, 109.0));
        pointer.leave();
        pointer.enter(0.0, 0.0);
        assert!(!pointer.motion(5.0, 5.0));
        assert!(pointer.motion(0.0, 13.0));
    }
}

//! Animation time and audio smoothing, matching `src/renderer/core/animation-clock.ts`
//! and the C++ renderer.

/// Gaps longer than this (seconds) are treated as suspension and skipped.
pub const SUSPEND_GAP_SECONDS: f64 = 1.05;

/// Artistic phase skips long suspension gaps; elapsed time keeps wall-clock deltas.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct AnimationClock {
    pub elapsed: f64,
    pub phase: f64,
}

impl AnimationClock {
    /// Advance by a frame delta; returns the active (non-suspended) seconds.
    pub fn advance(&mut self, milliseconds: f64, speed: f64) -> f64 {
        let seconds = if milliseconds > 0.0 { milliseconds / 1000.0 } else { 0.0 };
        self.elapsed += seconds;
        let active = if seconds > SUSPEND_GAP_SECONDS { 0.0 } else { seconds };
        self.phase += active * speed;
        active
    }
}

/// Follows musical accents promptly, then lets the material relax without flashing.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct AudioSmoother {
    pub value: [f32; 4],
}

impl AudioSmoother {
    pub const ATTACK_SECONDS: f64 = 0.16;
    pub const RELEASE_SECONDS: f64 = 0.65;

    pub fn step(&mut self, target: &[f32; 4], active_seconds: f64) {
        for (current, target) in self.value.iter_mut().zip(target) {
            let target = target.clamp(0.0, 1.0);
            let duration = if target > *current { Self::ATTACK_SECONDS } else { Self::RELEASE_SECONDS };
            let mix = -(-active_seconds.max(0.0) / duration).exp_m1();
            *current += ((f64::from(target) - f64::from(*current)) * mix) as f32;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integrates_speed_and_skips_suspension_gaps() {
        let mut clock = AnimationClock::default();
        assert_eq!(clock.advance(500.0, 2.0), 0.5);
        assert_eq!(clock.phase, 1.0);
        assert_eq!(clock.advance(5000.0, 2.0), 0.0, "a suspension gap is not animated");
        assert_eq!(clock.phase, 1.0);
        assert_eq!(clock.elapsed, 5.5, "elapsed time still counts the gap");
        assert_eq!(clock.advance(-10.0, 1.0), 0.0);
    }

    #[test]
    fn audio_attacks_faster_than_it_releases() {
        let mut audio = AudioSmoother::default();
        audio.step(&[1.0, 2.0, -1.0, 0.0], 0.16);
        let attack = audio.value[0];
        assert!((attack - (1.0 - (-1.0f32).exp())).abs() < 1e-5);
        assert_eq!(audio.value[1], attack, "targets are clamped to one");
        assert_eq!(audio.value[2], 0.0, "and to zero");
        audio.value = [1.0; 4];
        audio.step(&[0.0; 4], 0.16);
        assert!(audio.value[0] > 1.0 - attack, "release is slower");
        let before = audio.value;
        audio.step(&[0.0; 4], 0.0);
        assert_eq!(audio.value, before, "no time, no change");
    }
}

//! Renderer command-line options, as passed by `scrnsvr` to `scrnsvr-renderer`. Parsed by hand to keep exactly the
//! accepted forms of the C++ renderer the 0.x releases shipped (no abbreviations, `--flag=value`, or help output).

use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum OptionsError {
    #[error("{0} requires a value")]
    MissingValue(String),
    #[error("Unknown option {0}")]
    Unknown(String),
    #[error("Invalid value for {0}: {1}")]
    Invalid(String, String),
}

/// Deterministic headless capture (`--capture PATH`), for parity checks and
/// thumbnails: messages are read until stdin closes, then `frames` frames are
/// rendered `delta_ms` apart (the first with zero delta) and the last one is
/// written as a PAM (`P7`, RGB_ALPHA) image.
#[derive(Debug, Clone, PartialEq)]
pub struct CaptureOptions {
    pub path: String,
    pub width: i32,
    pub height: i32,
    pub frames: u32,
    pub delta_ms: f64,
}

/// `WxH` with positive dimensions up to 16384.
pub fn parse_size(text: &str) -> Option<(i32, i32)> {
    let (width, height) = text.split_once('x')?;
    let dimension = |part: &str| part.parse::<i32>().ok().filter(|value| (1..=16384).contains(value));
    Some((dimension(width)?, dimension(height)?))
}

#[derive(Debug, Clone, PartialEq)]
pub struct RendererOptions {
    pub fps: f64,
    pub fade_ms: f64,
    pub all_outputs: bool,
    /// Connector name or monitor description.
    pub output_name: Option<String>,
    /// Logical position, used when the name does not match.
    pub output_at: Option<(i32, i32)>,
    pub compile_check: bool,
    pub capture: Option<CaptureOptions>,
}

impl Default for RendererOptions {
    fn default() -> Self {
        Self { fps: 60.0, fade_ms: 1000.0, all_outputs: false, output_name: None, output_at: None, compile_check: false, capture: None }
    }
}

/// `atof`-style leading-number parse: junk reads as zero.
fn leading_number(text: &str) -> f64 {
    let text = text.trim_start();
    let mut end = 0;
    let bytes = text.as_bytes();
    let mut seen_digit = false;
    let mut seen_dot = false;
    let mut seen_exp = false;
    while end < bytes.len() {
        let byte = bytes[end];
        let sign_ok = end == 0 || (seen_exp && matches!(bytes[end - 1], b'e' | b'E'));
        match byte {
            b'+' | b'-' if sign_ok => {}
            b'0'..=b'9' => seen_digit = true,
            b'.' if !seen_dot && !seen_exp => seen_dot = true,
            b'e' | b'E' if seen_digit && !seen_exp => seen_exp = true,
            _ => break,
        }
        end += 1;
    }
    // Back off an incomplete exponent such as "1e" or "1e-".
    let mut candidate = &text[..end];
    while !candidate.is_empty() {
        if let Ok(value) = candidate.parse::<f64>() {
            return value;
        }
        candidate = &candidate[..candidate.len() - 1];
    }
    0.0
}

/// `x,y` with optional signs.
pub fn parse_position(text: &str) -> Option<(i32, i32)> {
    let (x, y) = text.split_once(',')?;
    let integer = |part: &str| -> Option<i32> {
        let digits = part.strip_prefix(['-', '+']).unwrap_or(part);
        if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        let value: i64 = digits.parse().ok()?;
        let value = value.min(1_000_000) as i32;
        Some(if part.starts_with('-') { -value } else { value })
    };
    Some((integer(x)?, integer(y)?))
}

impl RendererOptions {
    pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Result<Self, OptionsError> {
        let mut options = Self::default();
        let mut capture_path = None;
        let (mut size, mut frames, mut delta) = ((256, 144), 1u32, 1000.0 / 60.0);
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            let mut value = || args.next().ok_or_else(|| OptionsError::MissingValue(arg.clone()));
            match arg.as_str() {
                "--fps" => options.fps = leading_number(&value()?).max(1.0),
                "--fade" => options.fade_ms = (leading_number(&value()?) * 1000.0).max(0.0),
                "--all-outputs" => options.all_outputs = true,
                "--output" => options.output_name = Some(value()?),
                "--output-at" => options.output_at = parse_position(&value()?),
                "--compile-check" => options.compile_check = true,
                "--capture" => capture_path = Some(value()?),
                "--size" => {
                    let text = value()?;
                    size = parse_size(&text).ok_or_else(|| OptionsError::Invalid(arg.clone(), text))?;
                }
                "--frames" => frames = (leading_number(&value()?) as u32).max(1),
                "--delta" => delta = leading_number(&value()?).max(0.0),
                _ => return Err(OptionsError::Unknown(arg)),
            }
        }
        options.capture = capture_path.map(|path| CaptureOptions { path, width: size.0, height: size.1, frames, delta_ms: delta });
        Ok(options)
    }

    /// Minimum milliseconds between frames.
    pub fn interval_ms(&self) -> f64 {
        1000.0 / if self.fps > 0.0 { self.fps } else { 60.0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<RendererOptions, OptionsError> {
        RendererOptions::parse(args.iter().map(|arg| arg.to_string()))
    }

    #[test]
    fn parses_the_main_process_arguments() {
        let options = parse(&["--fps", "30", "--fade", "1.5", "--output", "DP-1", "--output-at", "1920,0"]).unwrap();
        assert_eq!(options.fps, 30.0);
        assert_eq!(options.fade_ms, 1500.0);
        assert_eq!(options.output_name.as_deref(), Some("DP-1"));
        assert_eq!(options.output_at, Some((1920, 0)));
        assert!(!options.all_outputs && !options.compile_check);
        assert!(parse(&["--all-outputs", "--compile-check"]).unwrap().all_outputs);
        assert_eq!(parse(&[]).unwrap(), RendererOptions::default());
    }

    #[test]
    fn clamps_numbers_like_atof() {
        assert_eq!(parse(&["--fps", "0"]).unwrap().fps, 1.0);
        assert_eq!(parse(&["--fps", "junk"]).unwrap().fps, 1.0);
        assert_eq!(parse(&["--fps", "24fps"]).unwrap().fps, 24.0);
        assert_eq!(parse(&["--fade", "-2"]).unwrap().fade_ms, 0.0);
        assert_eq!(parse(&["--fade", "2e-1x"]).unwrap().fade_ms, 200.0);
        assert_eq!(parse(&["--fade", "1e"]).unwrap().fade_ms, 1000.0);
    }

    #[test]
    fn reports_errors() {
        assert_eq!(parse(&["--fps"]), Err(OptionsError::MissingValue("--fps".into())));
        assert_eq!(parse(&["--bogus"]), Err(OptionsError::Unknown("--bogus".into())));
        assert_eq!(OptionsError::Unknown("--x".into()).to_string(), "Unknown option --x");
    }

    #[test]
    fn parses_capture_options() {
        let options = parse(&["--capture", "/tmp/a.pam", "--size", "320x180", "--frames", "30", "--delta", "20"]).unwrap();
        assert_eq!(
            options.capture,
            Some(CaptureOptions { path: "/tmp/a.pam".into(), width: 320, height: 180, frames: 30, delta_ms: 20.0 })
        );
        assert_eq!(parse(&["--frames", "0", "--capture", "x"]).unwrap().capture.unwrap().frames, 1);
        assert_eq!(parse(&["--size", "320"]), Err(OptionsError::Invalid("--size".into(), "320".into())));
        assert_eq!(parse(&["--size", "0x10"]), Err(OptionsError::Invalid("--size".into(), "0x10".into())));
        assert_eq!(parse(&["--size", "8x8"]).unwrap().capture, None, "size alone does not capture");
    }

    #[test]
    fn parses_signed_positions() {
        assert_eq!(parse_position("-1920,+0"), Some((-1920, 0)));
        assert_eq!(parse_position("1,2,3"), None);
        assert_eq!(parse_position("1,"), None);
        assert_eq!(parse_position("a,b"), None);
        assert_eq!(parse_position("99999999,0"), Some((1_000_000, 0)));
    }
}

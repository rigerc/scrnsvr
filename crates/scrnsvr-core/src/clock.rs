//! Resolve a clock message from settings and a caller-supplied time zone.

use chrono::{DateTime, TimeZone};
use serde::{Deserialize, Serialize};
use std::fmt::Write;

use crate::ClockSpec;
use crate::catalog::rgb;
use crate::source::js_whitespace;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClockPosition {
    TopLeft,
    TopCenter,
    TopRight,
    CenterLeft,
    #[default]
    Center,
    CenterRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

impl ClockPosition {
    fn as_str(self) -> &'static str {
        match self {
            Self::TopLeft => "top-left",
            Self::TopCenter => "top-center",
            Self::TopRight => "top-right",
            Self::CenterLeft => "center-left",
            Self::Center => "center",
            Self::CenterRight => "center-right",
            Self::BottomLeft => "bottom-left",
            Self::BottomCenter => "bottom-center",
            Self::BottomRight => "bottom-right",
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClockFont {
    #[default]
    System,
    Serif,
    Monospace,
    Rounded,
    Custom,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClockFormat {
    #[default]
    #[serde(rename = "24h")]
    Hour24,
    #[serde(rename = "12h")]
    Hour12,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ClockConfig {
    pub enabled: bool,
    pub position: ClockPosition,
    pub font: ClockFont,
    pub custom_font: String,
    pub size: f64,
    pub weight: i32,
    pub color: String,
    pub opacity: f64,
    pub margin: f64,
    pub format: ClockFormat,
    pub show_seconds: bool,
    pub show_date: bool,
    pub shadow: bool,
    /// Overrides the time line including period/seconds. The date line still follows show_date.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
}

impl Default for ClockConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            position: ClockPosition::Center,
            font: ClockFont::System,
            custom_font: String::new(),
            size: 12.0,
            weight: 300,
            color: "#ffffff".into(),
            opacity: 0.95,
            margin: 5.0,
            format: ClockFormat::Hour24,
            show_seconds: false,
            show_date: true,
            shadow: true,
            pattern: None,
        }
    }
}

pub(crate) fn valid_pattern(pattern: &str) -> bool {
    format_pattern(pattern, &DateTime::UNIX_EPOCH).is_some()
}

fn format_pattern<Tz: TimeZone>(pattern: &str, now: &DateTime<Tz>) -> Option<String>
where
    Tz::Offset: std::fmt::Display,
{
    if pattern.is_empty() {
        return None;
    }
    let mut text = String::new();
    write!(text, "{}", now.format(pattern)).ok()?;
    Some(text)
}

impl ClockConfig {
    pub fn resolve<Tz: TimeZone>(&self, now: &DateTime<Tz>) -> ClockSpec
    where
        Tz::Offset: std::fmt::Display,
    {
        let (time, period) = match self.pattern.as_deref().and_then(|pattern| format_pattern(pattern, now)) {
            Some(time) => (time, String::new()),
            None => {
                let format = match (self.format, self.show_seconds) {
                    (ClockFormat::Hour24, false) => "%H:%M",
                    (ClockFormat::Hour24, true) => "%H:%M:%S",
                    (ClockFormat::Hour12, false) => "%-I:%M",
                    (ClockFormat::Hour12, true) => "%-I:%M:%S",
                };
                let period = if self.format == ClockFormat::Hour12 { now.format("%p").to_string() } else { String::new() };
                (now.format(format).to_string(), period)
            }
        };
        let custom = self.custom_font.trim_matches(js_whitespace);
        let family = match self.font {
            ClockFont::System => "sans-serif".into(),
            ClockFont::Serif => "Georgia, Liberation Serif, serif".into(),
            ClockFont::Monospace => "DejaVu Sans Mono, Liberation Mono, monospace".into(),
            ClockFont::Rounded => "Nunito, Quicksand, sans-serif".into(),
            ClockFont::Custom if custom.is_empty() => "sans-serif".into(),
            ClockFont::Custom => format!("{}, sans-serif", custom.replace([',', ';'], " ")),
        };
        ClockSpec {
            enabled: self.enabled,
            position: self.position.as_str().into(),
            family,
            weight: self.weight,
            color: rgb(&self.color),
            opacity: self.opacity,
            size: self.size,
            margin: self.margin,
            shadow: self.shadow,
            time,
            period,
            date: if self.show_date { now.format("%A, %B %-d").to_string() } else { String::new() },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pattern_formats_the_given_time_zone_and_keeps_the_date_option() {
        let now = DateTime::parse_from_rfc3339("2026-11-24T00:08:07+01:00").unwrap();
        let mut clock =
            ClockConfig { pattern: Some("%A %F at %I:%M:%S %p (%:z) %%".into()), format: ClockFormat::Hour12, ..ClockConfig::default() };
        let spec = clock.resolve(&now);
        assert_eq!(spec.time, "Tuesday 2026-11-24 at 12:08:07 AM (+01:00) %");
        assert!(spec.period.is_empty());
        assert_eq!(spec.date, "Tuesday, November 24");
        clock.show_date = false;
        let utc = clock.resolve(&now.to_utc());
        assert_eq!(utc.time, "Monday 2026-11-23 at 11:08:07 PM (+00:00) %");
        assert!(utc.date.is_empty());
    }

    #[test]
    fn invalid_or_parse_only_pattern_uses_default_format() {
        let now = DateTime::parse_from_rfc3339("2026-11-24T00:08:07+01:00").unwrap();
        for pattern in ["", "%", "%Q", "%#z"] {
            assert!(!valid_pattern(pattern));
            let clock = ClockConfig { pattern: Some(pattern.into()), ..ClockConfig::default() };
            assert_eq!(clock.resolve(&now).time, "00:08");
        }
        assert!(valid_pattern("%%#z"));
    }
}

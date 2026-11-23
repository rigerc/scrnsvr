//! Clock and global-setting values, exposed as control definitions so the same widgets that edit
//! manifest uniforms (slider, number, color, select, switch) edit them.

use std::sync::OnceLock;

use chrono::{DateTime, TimeZone};
use scrnsvr_core::catalog::{SettingValue, UniformDef, UniformKind};
use scrnsvr_core::clock::{ClockFont, ClockFormat, ClockPosition, valid_pattern};
use scrnsvr_core::config::Monitors;

use super::{Model, snap};

pub const POSITIONS: [(ClockPosition, &str, &str); 9] = [
    (ClockPosition::TopLeft, "Top left", "↖"),
    (ClockPosition::TopCenter, "Top center", "↑"),
    (ClockPosition::TopRight, "Top right", "↗"),
    (ClockPosition::CenterLeft, "Center left", "←"),
    (ClockPosition::Center, "Center", "●"),
    (ClockPosition::CenterRight, "Center right", "→"),
    (ClockPosition::BottomLeft, "Bottom left", "↙"),
    (ClockPosition::BottomCenter, "Bottom center", "↓"),
    (ClockPosition::BottomRight, "Bottom right", "↘"),
];
const FONTS: [(ClockFont, &str); 5] = [
    (ClockFont::System, "System sans"),
    (ClockFont::Serif, "Serif"),
    (ClockFont::Monospace, "Monospace"),
    (ClockFont::Rounded, "Rounded"),
    (ClockFont::Custom, "Custom installed font"),
];
const WEIGHTS: [(i32, &str); 9] = [
    (100, "Thin"),
    (200, "Extra light"),
    (300, "Light"),
    (400, "Regular"),
    (500, "Medium"),
    (600, "Semibold"),
    (700, "Bold"),
    (800, "Extra bold"),
    (900, "Black"),
];
const FORMATS: [(ClockFormat, &str); 2] = [(ClockFormat::Hour24, "24-hour"), (ClockFormat::Hour12, "12-hour (AM/PM)")];
const MONITORS: [(Monitors, &str); 2] = [(Monitors::Primary, "Primary monitor"), (Monitors::All, "All monitors")];

fn def(name: &str, label: &str, kind: UniformKind, default: SettingValue) -> UniformDef {
    UniformDef {
        name: name.into(),
        kind,
        default,
        label: Some(label.into()),
        description: None,
        group: None,
        advanced: false,
        min: None,
        max: None,
        step: None,
        unit: None,
        color_role: None,
        options: Vec::new(),
        visible_when: None,
        random: None,
    }
}

fn number(name: &str, label: &str, kind: UniformKind, default: f64, (min, max, step): (f64, f64, f64), unit: &str) -> UniformDef {
    UniformDef {
        min: Some(min),
        max: Some(max),
        step: Some(step),
        unit: (!unit.is_empty()).then(|| unit.into()),
        ..def(name, label, kind, SettingValue::Number(default))
    }
}

fn select(name: &str, label: &str, labels: impl IntoIterator<Item = &'static str>) -> UniformDef {
    let options: Vec<String> = labels.into_iter().map(Into::into).collect();
    UniformDef { options: options.clone(), ..def(name, label, UniformKind::Select, SettingValue::Text(options[0].clone())) }
}

fn toggle(name: &str, label: &str, default: bool) -> UniformDef {
    def(name, label, UniformKind::Bool, SettingValue::Bool(default))
}

/// The clock controls (the placement grid, custom font name and pattern have their own widgets).
pub fn clock_defs() -> &'static [UniformDef] {
    static DEFS: OnceLock<Vec<UniformDef>> = OnceLock::new();
    DEFS.get_or_init(|| {
        let mut size = number("size", "Size", UniformKind::Int, 12.0, (2.0, 30.0, 1.0), "%");
        size.description = Some("Size and edge spacing scale with your display.".into());
        vec![
            toggle("enabled", "Show clock", true),
            select("font", "Font", FONTS.map(|(_, label)| label)),
            UniformDef { default: SettingValue::Text("Light".into()), ..select("weight", "Weight", WEIGHTS.map(|(_, label)| label)) },
            size,
            def("color", "Color", UniformKind::Color, SettingValue::Text("#ffffff".into())),
            number("opacity", "Opacity", UniformKind::Float, 0.95, (0.1, 1.0, 0.05), ""),
            number("margin", "Edge spacing", UniformKind::Int, 5.0, (0.0, 20.0, 1.0), "%"),
            select("format", "Time format", FORMATS.map(|(_, label)| label)),
            toggle("show_seconds", "Show seconds", false),
            toggle("show_date", "Show date", true),
            toggle("shadow", "Text shadow", true),
        ]
    })
}

/// The global controls: frame rate, fade and monitor scope.
pub fn global_defs() -> &'static [UniformDef] {
    static DEFS: OnceLock<Vec<UniformDef>> = OnceLock::new();
    DEFS.get_or_init(|| {
        vec![
            number("fps", "Frame rate", UniformKind::Int, 60.0, (1.0, 240.0, 1.0), "fps"),
            number("fade_seconds", "Fade in and out", UniformKind::Float, 1.0, (0.0, 5.0, 0.1), "s"),
            select("monitors", "Monitors", MONITORS.map(|(_, label)| label)),
        ]
    })
}

fn label<T: PartialEq + Copy>(table: &[(T, &'static str)], value: T) -> SettingValue {
    SettingValue::Text(table.iter().find(|(candidate, _)| *candidate == value).map_or(table[0].1, |(_, label)| label).into())
}

fn lookup<T: Copy>(table: &[(T, &'static str)], value: &SettingValue) -> Option<T> {
    let SettingValue::Text(text) = value else { return None };
    table.iter().find(|(_, label)| label == text).map(|(item, _)| *item)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatternState {
    /// No pattern: the clock uses its fixed format.
    Default,
    Valid,
    /// Not a pattern chrono can format. The clock falls back to its fixed format.
    Invalid,
}

impl Model {
    pub fn clock_value(&self, name: &str) -> SettingValue {
        let clock = &self.config.clock;
        match name {
            "enabled" => SettingValue::Bool(clock.enabled),
            "font" => label(&FONTS, clock.font),
            "weight" => {
                SettingValue::Text(WEIGHTS.iter().find(|(weight, _)| *weight == clock.weight).map_or("Light", |(_, label)| label).into())
            }
            "size" => SettingValue::Number(clock.size),
            "color" => SettingValue::Text(clock.color.clone()),
            "opacity" => SettingValue::Number(clock.opacity),
            "margin" => SettingValue::Number(clock.margin),
            "format" => label(&FORMATS, clock.format),
            "show_seconds" => SettingValue::Bool(clock.show_seconds),
            "show_date" => SettingValue::Bool(clock.show_date),
            "shadow" => SettingValue::Bool(clock.shadow),
            _ => unreachable!("unknown clock control {name}"),
        }
    }

    /// Store one clock control. Returns whether the clock changed.
    pub fn set_clock_value(&mut self, name: &str, value: SettingValue) -> bool {
        let defs = clock_defs();
        let def = defs.iter().find(|def| def.name == name).expect("known clock control");
        let value = match value {
            SettingValue::Number(n) if def.is_slider() => SettingValue::Number(snap(def, n)),
            value => def.resolve_shader_value(Some(&value)),
        };
        let before = self.config.clock.clone();
        let clock = &mut self.config.clock;
        match (name, &value) {
            ("enabled", SettingValue::Bool(on)) => clock.enabled = *on,
            ("font", _) => clock.font = lookup(&FONTS, &value).unwrap_or(clock.font),
            ("weight", SettingValue::Text(text)) => {
                clock.weight = WEIGHTS.iter().find(|(_, label)| label == text).map_or(clock.weight, |(weight, _)| *weight)
            }
            ("size", SettingValue::Number(n)) => clock.size = *n,
            ("color", SettingValue::Text(hex)) => clock.color = hex.to_lowercase(),
            ("opacity", SettingValue::Number(n)) => clock.opacity = *n,
            ("margin", SettingValue::Number(n)) => clock.margin = *n,
            ("format", _) => clock.format = lookup(&FORMATS, &value).unwrap_or(clock.format),
            ("show_seconds", SettingValue::Bool(on)) => clock.show_seconds = *on,
            ("show_date", SettingValue::Bool(on)) => clock.show_date = *on,
            ("shadow", SettingValue::Bool(on)) => clock.shadow = *on,
            _ => {}
        }
        self.config.clock != before
    }

    pub fn set_clock_position(&mut self, position: ClockPosition) -> bool {
        let changed = self.config.clock.position != position;
        self.config.clock.position = position;
        changed
    }

    /// The installed font family used when the font is Custom (at most 100 UTF-16 units).
    pub fn set_custom_font(&mut self, name: &str) -> bool {
        let name: String = name
            .chars()
            .scan(0, |units, c| {
                *units += c.len_utf16();
                (*units <= 100).then_some(c)
            })
            .collect();
        let changed = self.config.clock.custom_font != name;
        self.config.clock.custom_font = name;
        changed
    }

    /// Check a typed pattern. A valid one is kept. An empty or invalid one clears the saved
    /// pattern, so the saver and the preview use the fixed format instead.
    pub fn set_clock_pattern(&mut self, text: &str) -> (PatternState, bool) {
        let (state, pattern) = if text.is_empty() {
            (PatternState::Default, None)
        } else if valid_pattern(text) {
            (PatternState::Valid, Some(text.to_owned()))
        } else {
            (PatternState::Invalid, None)
        };
        let changed = self.config.clock.pattern != pattern;
        self.config.clock.pattern = pattern;
        (state, changed)
    }

    /// The text the clock shows at `now`: the time line, then the date line when it is on.
    pub fn clock_example<Tz: TimeZone>(&self, now: &DateTime<Tz>) -> (String, String)
    where
        Tz::Offset: std::fmt::Display,
    {
        let spec = self.config.clock.resolve(now);
        (format!("{}{}{}", spec.time, if spec.period.is_empty() { "" } else { " " }, spec.period), spec.date)
    }

    pub fn global_value(&self, name: &str) -> SettingValue {
        let global = &self.config.global;
        match name {
            "fps" => SettingValue::Number(f64::from(global.fps)),
            "fade_seconds" => SettingValue::Number(global.fade_seconds),
            "monitors" => label(&MONITORS, global.monitors),
            _ => unreachable!("unknown global control {name}"),
        }
    }

    pub fn set_global_value(&mut self, name: &str, value: SettingValue) -> bool {
        let def = global_defs().iter().find(|def| def.name == name).expect("known global control");
        let value = match value {
            SettingValue::Number(n) if def.is_slider() => SettingValue::Number(snap(def, n)),
            value => def.resolve_shader_value(Some(&value)),
        };
        let before = self.config.global.clone();
        let global = &mut self.config.global;
        match (name, &value) {
            ("fps", SettingValue::Number(n)) => global.fps = *n as u32,
            ("fade_seconds", SettingValue::Number(n)) => global.fade_seconds = *n,
            ("monitors", _) => global.monitors = lookup(&MONITORS, &value).unwrap_or(global.monitors),
            _ => {}
        }
        self.config.global != before
    }
}

#[cfg(test)]
mod tests {
    use chrono::DateTime;
    use scrnsvr_core::catalog::SettingValue;
    use scrnsvr_core::clock::{ClockFont, ClockFormat, ClockPosition};
    use scrnsvr_core::config::Monitors;

    use super::{PatternState, clock_defs, global_defs};
    use crate::model::Model;
    use crate::persistence::UiState;

    fn model() -> Model {
        Model::new(Default::default(), UiState::default())
    }

    fn text(value: &str) -> SettingValue {
        SettingValue::Text(value.into())
    }

    #[test]
    fn defaults_in_the_control_definitions_match_the_configuration_defaults() {
        let model = model();
        for def in clock_defs() {
            assert_eq!(model.clock_value(&def.name), def.default, "clock {}", def.name);
        }
        for def in global_defs() {
            assert_eq!(model.global_value(&def.name), def.default, "global {}", def.name);
        }
    }

    #[test]
    fn every_clock_control_edits_its_field_and_clamps_to_the_configured_range() {
        let mut model = model();
        assert!(model.set_clock_value("enabled", SettingValue::Bool(false)));
        assert!(model.set_clock_value("font", text("Serif")));
        assert!(model.set_clock_value("weight", text("Bold")));
        assert!(model.set_clock_value("size", SettingValue::Number(99.0)));
        assert!(model.set_clock_value("color", text("#AABBCC")));
        assert!(model.set_clock_value("opacity", SettingValue::Number(0.0)));
        assert!(model.set_clock_value("margin", SettingValue::Number(7.4)));
        assert!(model.set_clock_value("format", text("12-hour (AM/PM)")));
        assert!(model.set_clock_value("show_seconds", SettingValue::Bool(true)));
        assert!(model.set_clock_value("show_date", SettingValue::Bool(false)));
        assert!(model.set_clock_value("shadow", SettingValue::Bool(false)));
        assert!(model.set_clock_position(ClockPosition::BottomRight));
        assert!(!model.set_clock_position(ClockPosition::BottomRight));
        let clock = &model.config.clock;
        assert!(!clock.enabled && clock.font == ClockFont::Serif && clock.weight == 700 && clock.size == 30.0);
        assert_eq!((clock.color.as_str(), clock.opacity, clock.margin), ("#aabbcc", 0.1, 7.0));
        assert!(clock.format == ClockFormat::Hour12 && clock.show_seconds && !clock.show_date && !clock.shadow);
        assert_eq!(model.clock_value("weight"), text("Bold"));
        assert_eq!(model.clock_value("format"), text("12-hour (AM/PM)"));
        assert!(!model.set_clock_value("size", SettingValue::Number(30.0)), "unchanged");

        // The edited clock is the one the saver and preview resolve.
        let now = DateTime::parse_from_rfc3339("2026-11-23T15:04:05+00:00").unwrap();
        let (time, date) = model.clock_example(&now);
        assert_eq!(time, "3:04:05 PM");
        assert_eq!(date, "");
    }

    #[test]
    fn the_custom_font_name_is_limited_like_the_configuration() {
        let mut model = model();
        assert!(model.set_custom_font("JetBrains Mono"));
        assert!(!model.set_custom_font("JetBrains Mono"));
        model.set_custom_font(&"a".repeat(150));
        assert_eq!(model.config.clock.custom_font.len(), 100);
        model.set_custom_font(&"😀".repeat(80));
        assert_eq!(model.config.clock.custom_font.encode_utf16().count(), 100);
    }

    #[test]
    fn patterns_validate_live_and_fall_back_to_the_default_format_when_invalid() {
        let mut model = model();
        let now = DateTime::parse_from_rfc3339("2026-11-24T00:08:07+01:00").unwrap();
        assert_eq!(model.clock_example(&now), ("00:08".into(), "Tuesday, November 24".into()));
        assert_eq!(model.set_clock_pattern("%A %H:%M:%S"), (PatternState::Valid, true));
        assert_eq!(model.config.clock.pattern.as_deref(), Some("%A %H:%M:%S"));
        assert_eq!(model.clock_example(&now).0, "Tuesday 00:08:07");
        assert_eq!(model.set_clock_pattern("%A %H:%M:%S"), (PatternState::Valid, false));
        for invalid in ["%", "%Q", "%#z"] {
            assert_eq!(model.set_clock_pattern(invalid), (PatternState::Invalid, true), "{invalid}");
            assert_eq!(model.config.clock.pattern, None, "an invalid pattern is not kept: {invalid}");
            assert_eq!(model.clock_example(&now).0, "00:08", "falls back to the default format");
            model.set_clock_pattern("%H");
        }
        assert_eq!(model.set_clock_pattern(""), (PatternState::Default, true));
        assert_eq!(model.config.clock.pattern, None);
    }

    #[test]
    fn global_values_clamp_and_scope_monitors() {
        let mut model = model();
        assert!(model.set_global_value("fps", SettingValue::Number(1000.0)));
        assert_eq!(model.config.global.fps, 240);
        assert!(model.set_global_value("fps", SettingValue::Number(0.2)));
        assert_eq!(model.config.global.fps, 1);
        assert!(model.set_global_value("fade_seconds", SettingValue::Number(7.0)));
        assert_eq!(model.config.global.fade_seconds, 5.0);
        assert!(model.set_global_value("fade_seconds", SettingValue::Number(0.34)));
        assert_eq!(model.config.global.fade_seconds, 0.3);
        assert!(model.set_global_value("monitors", text("All monitors")));
        assert_eq!(model.config.global.monitors, Monitors::All);
        assert_eq!(model.global_value("monitors"), text("All monitors"));
        assert_eq!(model.config.global.idle_threshold_seconds, 300.0, "the unused idle threshold is left alone");
    }
}

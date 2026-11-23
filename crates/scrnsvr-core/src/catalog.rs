//! Built-in shader and effect metadata, GLSL sources and palettes.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::UniformValue;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SettingValue {
    Number(f64),
    Bool(bool),
    Text(String),
}

pub type ShaderValues = BTreeMap<String, SettingValue>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UniformKind {
    Float,
    Int,
    Bool,
    Color,
    Select,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UniformDef {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: UniformKind,
    pub default: SettingValue,
    pub label: Option<String>,
    pub description: Option<String>,
    pub group: Option<String>,
    #[serde(default)]
    pub advanced: bool,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub unit: Option<String>,
    pub color_role: Option<ColorRole>,
    #[serde(default)]
    pub options: Vec<String>,
    pub visible_when: Option<UniformCondition>,
    pub random: Option<RandomRule>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UniformCondition {
    pub name: String,
    pub value: SettingValue,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum RandomRule {
    Enabled(bool),
    Range { min: f64, max: f64 },
}

impl UniformDef {
    pub fn is_slider(&self) -> bool {
        matches!(self.kind, UniformKind::Float | UniformKind::Int) && self.min.is_some() && self.max.is_some()
    }

    pub fn title(&self) -> &str {
        self.label.as_deref().unwrap_or(&self.name)
    }

    /// Resolve an override or inherited value using the shader's binding rules.
    pub fn resolve_shader_value(&self, value: Option<&SettingValue>) -> SettingValue {
        self.normalize(value, false)
    }

    /// Resolve a stored effect-layer value. Unlike shader values, numeric text is not accepted.
    pub fn resolve_effect_value(&self, value: Option<&SettingValue>) -> SettingValue {
        self.normalize(value, true)
    }

    pub(crate) fn normalize(&self, value: Option<&SettingValue>, effect: bool) -> SettingValue {
        use SettingValue::{Bool, Number, Text};
        match (self.kind, value) {
            (UniformKind::Float | UniformKind::Int, Some(value)) => {
                let number = match value {
                    Number(number) => Some(*number),
                    Text(text) if !effect => parse_number(text),
                    _ => None,
                };
                let number = number.filter(|n| n.is_finite()).unwrap_or_else(|| match self.default {
                    Number(number) => number,
                    _ => unreachable!("numeric manifest default"),
                });
                let number = if self.kind == UniformKind::Int { round(number) } else { number };
                Number(number.clamp(self.min.unwrap_or(f64::NEG_INFINITY), self.max.unwrap_or(f64::INFINITY)))
            }
            (UniformKind::Color, Some(Text(text))) if hex_color(text).is_some() => Text(text.clone()),
            (UniformKind::Bool, Some(Bool(flag))) => Bool(*flag),
            (UniformKind::Select, Some(Text(text))) if self.options.contains(text) => Text(text.clone()),
            (UniformKind::Select, Some(value)) if !effect => {
                let text = match value {
                    Number(n) => n.to_string(),
                    Bool(b) => b.to_string(),
                    Text(_) => return self.default.clone(),
                };
                if self.options.contains(&text) { Text(text) } else { self.default.clone() }
            }
            _ => self.default.clone(),
        }
    }

    pub(crate) fn repair_value(&self, value: &mut SettingValue, effect: bool) -> bool {
        let resolved = self.normalize(Some(value), effect);
        if *value == resolved {
            return false;
        }
        // Shader numeric strings are accepted by the TS shader binder. Keep valid stored edits.
        if !effect
            && let (SettingValue::Text(text), SettingValue::Number(number)) = (&*value, &resolved)
            && parse_number(text) == Some(*number)
        {
            return false;
        }
        *value = resolved;
        true
    }

    pub(crate) fn native_value(&self, value: &SettingValue) -> UniformValue {
        match value {
            SettingValue::Number(number) => UniformValue::Scalar(if self.kind == UniformKind::Int { round(*number) } else { *number }),
            SettingValue::Bool(flag) => UniformValue::Scalar(f64::from(u8::from(*flag))),
            SettingValue::Text(text) if self.kind == UniformKind::Color => UniformValue::Vector(rgb(text).to_vec()),
            SettingValue::Text(text) => {
                UniformValue::Scalar(self.options.iter().position(|option| option == text).unwrap_or_default() as f64)
            }
        }
    }
}

fn round(number: f64) -> f64 {
    // JavaScript rounds ties toward positive infinity.
    let floor = number.floor();
    if number - floor >= 0.5 { floor + 1.0 } else { floor }
}

fn parse_number(text: &str) -> Option<f64> {
    let text = text.trim_matches(crate::source::js_whitespace);
    let prefix = text.as_bytes().get(..2);
    let radix = match prefix {
        Some(b"0x" | b"0X") => 16,
        Some(b"0o" | b"0O") => 8,
        Some(b"0b" | b"0B") => 2,
        _ => return text.parse().ok(),
    };
    let digits = &text[2..];
    if digits.is_empty() {
        return None;
    }
    digits.chars().try_fold(0.0, |number, digit| Some(number * f64::from(radix) + f64::from(digit.to_digit(radix)?)))
}

pub(crate) fn hex_color(text: &str) -> Option<u32> {
    let digits = text.strip_prefix('#')?;
    (digits.len() == 6 && digits.bytes().all(|byte| byte.is_ascii_hexdigit())).then(|| u32::from_str_radix(digits, 16).unwrap())
}

pub(crate) fn rgb(text: &str) -> [f64; 3] {
    let color = hex_color(text).unwrap_or(0xffffff);
    [16, 8, 0].map(|shift| f64::from((color >> shift) & 255) / 255.0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShaderDef {
    pub id: String,
    pub title: String,
    pub category: Option<String>,
    pub description: Option<String>,
    pub fragment: String,
    pub scheme_palette: Option<String>,
    pub uniforms: Vec<UniformDef>,
    pub source: String,
    pub animation_time: AnimationTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnimationTime {
    Integrated,
}

#[derive(Debug, Deserialize)]
pub struct EffectDef {
    pub id: String,
    pub title: String,
    pub description: String,
    pub uniforms: Vec<UniformDef>,
    pub source: String,
    #[serde(default)]
    pub passes: Vec<String>,
    #[serde(default)]
    pub history: bool,
}

#[derive(Debug, Deserialize)]
pub struct Palette {
    pub id: String,
    pub name: String,
    pub variant: String,
    pub background: String,
    pub foreground: String,
    pub cursor: Option<String>,
    pub ansi: Vec<String>,
    pub roles: ColorRoles,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColorRole {
    Primary,
    Secondary,
    Tertiary,
    Surface,
    OnSurface,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorRoles {
    pub primary: String,
    pub secondary: String,
    pub tertiary: String,
    pub surface: String,
    pub on_surface: String,
}

impl ColorRoles {
    pub fn get(&self, role: ColorRole) -> &str {
        match role {
            ColorRole::Primary => &self.primary,
            ColorRole::Secondary => &self.secondary,
            ColorRole::Tertiary => &self.tertiary,
            ColorRole::Surface => &self.surface,
            ColorRole::OnSurface => &self.on_surface,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ColorFamily {
    pub name: String,
    pub colors: [String; 3],
}

/// The catalog `build.rs` assembles from `data/` (shader, effect and palette sources) at compile time.
#[doc(hidden)]
pub const BUILTIN_CATALOG_JSON: &str = include_str!(concat!(env!("OUT_DIR"), "/catalog.json"));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub shaders: Vec<ShaderDef>,
    pub effects: Vec<EffectDef>,
    pub palettes: Vec<Palette>,
    pub color_families: Vec<ColorFamily>,
}

impl Catalog {
    pub fn builtin() -> &'static Self {
        static CATALOG: OnceLock<Catalog> = OnceLock::new();
        CATALOG.get_or_init(|| serde_json::from_str(BUILTIN_CATALOG_JSON).expect("bundled scrnsvr catalog is valid"))
    }

    pub fn shader(&self, id: &str) -> Option<&ShaderDef> {
        self.shaders.iter().find(|shader| shader.id == id)
    }

    pub fn effect(&self, id: &str) -> Option<&EffectDef> {
        self.effects.iter().find(|effect| effect.id == id)
    }

    pub fn palette(&self, id: &str) -> Option<&Palette> {
        self.palettes.iter().find(|palette| palette.id == id)
    }
}

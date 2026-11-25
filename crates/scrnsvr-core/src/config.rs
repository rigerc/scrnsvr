//! Native TOML configuration and field-by-field recovery.

use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Serialize, de::DeserializeOwned};
use thiserror::Error;
use toml::{Table, Value};

use crate::catalog::{Catalog, SettingValue, ShaderValues, UniformDef, hex_color};
use crate::clock::{ClockConfig, valid_pattern};
use crate::source::{MAX_CUSTOM_SOURCE_CHARS, MAX_CUSTOM_TITLE_CHARS, custom_fragment_source, js_whitespace};

pub const DEFAULT_SHADER: &str = "flow-field";
pub const MAX_EFFECT_LAYERS: usize = 8;
pub const MAX_CUSTOM_SHADERS: usize = 100;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Config {
    pub shader: String,
    pub global: GlobalConfig,
    pub clock: ClockConfig,
    pub rotation: RotationConfig,
    pub colors: ColorConfig,
    pub custom_shaders: Vec<CustomShader>,
    pub shaders: BTreeMap<String, ShaderValues>,
    pub presets: BTreeMap<String, BTreeMap<String, ShaderValues>>,
    /// The effect stack of each visual's current edits, by visual ID: `[effects.<visual>]`.
    #[serde(serialize_with = "serialize_stacks")]
    pub effects: BTreeMap<String, EffectsConfig>,
    /// The effect stack saved with each look, by visual ID and look name:
    /// `[look_effects.<visual>.<look>]`.
    #[serde(serialize_with = "serialize_look_stacks")]
    pub look_effects: BTreeMap<String, BTreeMap<String, EffectsConfig>>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            shader: DEFAULT_SHADER.into(),
            global: GlobalConfig::default(),
            clock: ClockConfig::default(),
            rotation: RotationConfig::default(),
            colors: ColorConfig::default(),
            custom_shaders: Vec::new(),
            shaders: BTreeMap::new(),
            presets: BTreeMap::new(),
            effects: BTreeMap::new(),
            look_effects: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Monitors {
    All,
    #[default]
    Primary,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GlobalConfig {
    pub idle_threshold_seconds: f64,
    pub fps: u32,
    pub fade_seconds: f64,
    pub monitors: Monitors,
}

impl Default for GlobalConfig {
    fn default() -> Self {
        Self { idle_threshold_seconds: 300.0, fps: 60, fade_seconds: 1.0, monitors: Monitors::Primary }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ColorConfig {
    pub scheme: String,
    pub overrides: BTreeMap<String, String>,
}

impl Default for ColorConfig {
    fn default() -> Self {
        Self { scheme: "none".into(), overrides: BTreeMap::new() }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CustomShader {
    pub id: String,
    pub title: String,
    pub source: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct RotationConfig {
    pub enabled: bool,
    pub entries: Vec<RotationEntry>,
    pub interval_minutes: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RotationEntry {
    pub shader: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EffectsConfig {
    pub enabled: bool,
    pub layers: Vec<EffectLayer>,
}

impl Default for EffectsConfig {
    fn default() -> Self {
        Self::EMPTY
    }
}

impl EffectsConfig {
    /// No layers, switched on: what a look without saved effects has.
    pub const EMPTY: Self = Self { enabled: true, layers: Vec::new() };

    pub fn is_empty(&self) -> bool {
        self.enabled && self.layers.is_empty()
    }
}

static NO_EFFECTS: EffectsConfig = EffectsConfig::EMPTY;

/// Stacks equal to [`EffectsConfig::EMPTY`] are left out of the file.
fn serialize_stacks<S: serde::Serializer>(stacks: &BTreeMap<String, EffectsConfig>, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.collect_map(stacks.iter().filter(|(_, stack)| !stack.is_empty()))
}

fn serialize_look_stacks<S: serde::Serializer>(
    stacks: &BTreeMap<String, BTreeMap<String, EffectsConfig>>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let kept: BTreeMap<&String, BTreeMap<&String, &EffectsConfig>> = stacks
        .iter()
        .map(|(shader, looks)| (shader, looks.iter().filter(|(_, stack)| !stack.is_empty()).collect::<BTreeMap<_, _>>()))
        .filter(|(_, looks)| !looks.is_empty())
        .collect();
    serializer.collect_map(kept)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EffectLayer {
    pub id: String,
    pub effect_id: String,
    pub enabled: bool,
    pub values: ShaderValues,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("read configuration at {path}: {source}")]
    Read { path: PathBuf, source: io::Error },
    #[error("parse TOML configuration at {path}: {source}")]
    Parse { path: PathBuf, source: toml::de::Error },
    #[error("serialize configuration for {path}: {source}")]
    Serialize { path: PathBuf, source: toml::ser::Error },
    #[error("{action} at {path}: {source}")]
    Write { action: &'static str, path: PathBuf, source: io::Error },
}

#[derive(Debug)]
pub struct ConfigLoad {
    pub config: Config,
    pub warnings: Vec<String>,
    pub error: Option<ConfigError>,
}

pub fn config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|base| base.join("scrnsvr/config.toml"))
}

impl Config {
    pub fn load(path: &Path) -> ConfigLoad {
        let load = || match fs::read_to_string(path) {
            Ok(text) => text.parse::<Table>().map(Self::from_table).map_err(|source| ConfigError::Parse { path: path.into(), source }),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Self::from_table(Table::new())),
            Err(source) => Err(ConfigError::Read { path: path.into(), source }),
        };
        match load() {
            Ok(result) => result,
            Err(error) => ConfigLoad { config: Self::default(), warnings: Vec::new(), error: Some(error) },
        }
    }

    /// Validate each section and entry without losing valid siblings.
    pub fn from_table(table: Table) -> ConfigLoad {
        let mut warnings = Vec::new();
        let mut fields = Fields { table, path: String::new(), warnings: &mut warnings };
        let defaults = Self::default();
        let mut custom_ids = HashSet::new();
        let mut config = Self {
            shader: fields.read("shader", defaults.shader),
            global: fields.section("global", global),
            clock: fields.section("clock", clock),
            rotation: fields.section("rotation", rotation),
            colors: fields.section("colors", colors),
            custom_shaders: fields.items("custom_shaders", MAX_CUSTOM_SHADERS, |_, fields| {
                let shader = custom_shader(fields)?;
                if custom_ids.insert(shader.id.clone()) {
                    Some(shader)
                } else {
                    fields.warn("id", "duplicate custom shader ID; ignored entry");
                    None
                }
            }),
            shaders: fields.record("shaders", settings),
            presets: fields.record("presets", |value, fields| Some(fields.child(value)?.record_entries(settings))),
            effects: BTreeMap::new(),
            look_effects: fields.record("look_effects", |value, fields| Some(fields.child(value)?.record_entries(effect_stack))),
        };
        // Before 1.2 one stack applied to every visual. It now belongs to the current edits of the
        // visual that was last chosen, and every other visual and look starts without effects.
        let mut legacy = None;
        config.effects = fields.section("effects", |fields| {
            let legacy_shape = fields.table.contains_key("layers") || fields.table.get("enabled").is_some_and(|value| !value.is_table());
            if legacy_shape {
                legacy = Some(effects(fields));
                BTreeMap::new()
            } else {
                fields.record_entries(effect_stack)
            }
        });
        fields.finish();
        config.validate(&mut warnings);
        if let Some(mut stack) = legacy.filter(|stack| !stack.is_empty()) {
            if config.effects.contains_key(&config.shader) {
                warnings.push("effects: the old shared effect stack was ignored because this visual already has its own".into());
            } else {
                repair_stack(&mut stack, "effects", &mut warnings);
                warnings.push(format!(
                    "effects: effects are now kept per look; the shared stack moved to the current edits of {:?}",
                    config.shader
                ));
                config.effects.insert(config.shader.clone(), stack);
            }
        }
        ConfigLoad { config, warnings, error: None }
    }

    /// The effects shown with a visual: a look's own stack, or the visual's current edits.
    pub fn effect_stack(&self, shader: &str, look: Option<&str>) -> &EffectsConfig {
        let stack = match look.filter(|name| !name.is_empty()) {
            Some(name) => self.look_effects.get(shader).and_then(|looks| looks.get(name)),
            None => self.effects.get(shader),
        };
        stack.unwrap_or(&NO_EFFECTS)
    }

    fn validate(&mut self, warnings: &mut Vec<String>) {
        let catalog = Catalog::builtin();
        let mut custom_ids = HashSet::new();
        for (index, shader) in self.custom_shaders.iter().enumerate() {
            match custom_fragment_source(&shader.source) {
                Ok(_) => {
                    custom_ids.insert(shader.id.as_str());
                }
                Err(error) => warnings.push(format!("custom_shaders[{index}].source: {error} Shader excluded from scene selection")),
            }
        }
        let available = |id: &str| catalog.shader(id).is_some() || custom_ids.contains(id);
        if !available(&self.shader) {
            warnings.push(format!("shader: unavailable shader {:?}; using {DEFAULT_SHADER}", self.shader));
            self.shader = DEFAULT_SHADER.into();
        }
        for (index, entry) in self.rotation.entries.iter().enumerate() {
            if !available(&entry.shader) {
                warnings.push(format!("rotation.entries[{index}].shader: unavailable shader {:?}; skipped during rotation", entry.shader));
            } else if let Some(preset) = &entry.preset
                && !self.presets.get(&entry.shader).is_some_and(|presets| presets.contains_key(preset))
            {
                warnings.push(format!("rotation.entries[{index}].preset: unavailable preset {preset:?}; skipped during rotation"));
            }
        }
        for (id, values) in &mut self.shaders {
            if let Some(shader) = catalog.shader(id) {
                repair_uniforms(&shader.uniforms, values, &format!("shaders.{id}"), false, warnings);
            }
        }
        for (id, presets) in &mut self.presets {
            if let Some(shader) = catalog.shader(id) {
                for (name, values) in presets {
                    repair_uniforms(&shader.uniforms, values, &format!("presets.{id}.{name}"), false, warnings);
                }
            }
        }
        for (id, stack) in &mut self.effects {
            repair_stack(stack, &format!("effects.{id}"), warnings);
        }
        for (id, looks) in &mut self.look_effects {
            for (name, stack) in looks {
                repair_stack(stack, &format!("look_effects.{id}.{name}"), warnings);
            }
        }
    }

    /// Save by atomic replacement. The caller retains this snapshot even on error.
    pub fn save(&self, path: &Path) -> Result<(), ConfigError> {
        let encoded = toml::to_string_pretty(self).map_err(|source| ConfigError::Serialize { path: path.into(), source })?;
        let dir = path.parent().filter(|parent| !parent.as_os_str().is_empty()).unwrap_or(Path::new("."));
        let error = |action, path: &Path, source| ConfigError::Write { action, path: path.into(), source };

        fs::create_dir_all(dir).map_err(|source| error("create configuration directory", dir, source))?;
        let directory = File::open(dir).map_err(|source| error("open configuration directory", dir, source))?;
        let mut temp = tempfile::NamedTempFile::new_in(dir).map_err(|source| error("create temporary configuration", dir, source))?;
        temp.write_all(encoded.as_bytes()).map_err(|source| error("write temporary configuration", temp.path(), source))?;
        temp.as_file().sync_all().map_err(|source| error("sync temporary configuration", temp.path(), source))?;
        temp.persist(path).map_err(|failure| error("replace configuration", path, failure.error))?;
        directory.sync_all().map_err(|source| error("sync directory after replacing configuration", dir, source))
    }
}

struct Fields<'a> {
    table: Table,
    path: String,
    warnings: &'a mut Vec<String>,
}

impl Fields<'_> {
    fn field_path(&self, field: &str) -> String {
        if self.path.is_empty() { field.into() } else { format!("{}.{field}", self.path) }
    }

    fn warn(&mut self, field: &str, message: &str) {
        self.warnings.push(format!("{}: {message}", self.field_path(field)));
    }

    fn read<T: DeserializeOwned>(&mut self, field: &str, default: T) -> T {
        self.optional(field, |_| true).unwrap_or(default)
    }

    fn bounded<T: DeserializeOwned>(&mut self, field: &str, default: T, valid: impl FnOnce(&T) -> bool) -> T {
        self.optional(field, valid).unwrap_or(default)
    }

    fn optional<T: DeserializeOwned>(&mut self, field: &str, valid: impl FnOnce(&T) -> bool) -> Option<T> {
        let value = self.table.remove(field)?;
        match value.try_into::<T>() {
            Ok(typed) if valid(&typed) => Some(typed),
            _ => {
                self.warn(field, "invalid value; using default");
                None
            }
        }
    }

    fn section<T>(&mut self, field: &str, parse: impl FnOnce(&mut Fields<'_>) -> T) -> T {
        let table = self.read(field, Table::new());
        let mut child = Fields { table, path: self.field_path(field), warnings: self.warnings };
        let result = parse(&mut child);
        child.finish();
        result
    }

    fn finish(&mut self) {
        for field in std::mem::take(&mut self.table).keys() {
            self.warn(field, "unknown setting; ignored");
        }
    }

    fn child(&mut self, value: Value) -> Option<Fields<'_>> {
        match value {
            Value::Table(table) => Some(Fields { table, path: self.path.clone(), warnings: self.warnings }),
            _ => {
                self.warnings.push(format!("{}: expected a table; ignored", self.path));
                None
            }
        }
    }

    fn record<T>(&mut self, field: &str, parse: impl FnMut(Value, &mut Fields<'_>) -> Option<T>) -> BTreeMap<String, T> {
        self.section(field, |fields| fields.record_entries(parse))
    }

    fn record_entries<T>(&mut self, mut parse: impl FnMut(Value, &mut Fields<'_>) -> Option<T>) -> BTreeMap<String, T> {
        let entries = std::mem::take(&mut self.table);
        entries
            .into_iter()
            .filter_map(|(key, value)| {
                let mut entry = Fields { table: Table::new(), path: self.field_path(&key), warnings: self.warnings };
                parse(value, &mut entry).map(|parsed| (key, parsed))
            })
            .collect()
    }

    fn items<T>(&mut self, field: &str, max: usize, mut parse: impl FnMut(usize, &mut Fields<'_>) -> Option<T>) -> Vec<T> {
        let values = self.read::<Vec<Value>>(field, Vec::new());
        let mut result = Vec::new();
        for (index, value) in values.into_iter().enumerate() {
            if result.len() == max {
                self.warn(field, &format!("limit of {max} entries reached; ignored remaining entries"));
                break;
            }
            let path = format!("{}[{index}]", self.field_path(field));
            if let Value::Table(table) = value {
                let mut child = Fields { table, path, warnings: self.warnings };
                result.extend(parse(index, &mut child));
                child.finish();
            } else {
                self.warnings.push(format!("{path}: expected a table; ignored"));
            }
        }
        result
    }

    fn required<T: DeserializeOwned>(&mut self, field: &str, valid: impl FnOnce(&T) -> bool) -> Option<T> {
        if !self.table.contains_key(field) {
            self.warn(field, "missing required value; ignored entry");
            return None;
        }
        self.optional(field, valid)
    }
}

fn global(fields: &mut Fields<'_>) -> GlobalConfig {
    let d = GlobalConfig::default();
    GlobalConfig {
        idle_threshold_seconds: fields.bounded("idle_threshold_seconds", d.idle_threshold_seconds, |n| n.is_finite() && *n >= 0.0),
        fps: fields.bounded("fps", d.fps, |n| (1..=240).contains(n)),
        fade_seconds: fields.bounded("fade_seconds", d.fade_seconds, |n| (0.0..=5.0).contains(n)),
        monitors: fields.read("monitors", d.monitors),
    }
}

fn clock(fields: &mut Fields<'_>) -> ClockConfig {
    let d = ClockConfig::default();
    ClockConfig {
        enabled: fields.read("enabled", d.enabled),
        position: fields.read("position", d.position),
        font: fields.read("font", d.font),
        custom_font: fields.bounded("custom_font", d.custom_font, |s| s.encode_utf16().count() <= 100),
        size: fields.bounded("size", d.size, |n| (2.0..=30.0).contains(n)),
        weight: fields.bounded("weight", d.weight, |n| (100..=900).contains(n)),
        color: fields.bounded("color", d.color, |s| hex_color(s).is_some()),
        opacity: fields.bounded("opacity", d.opacity, |n| (0.1..=1.0).contains(n)),
        margin: fields.bounded("margin", d.margin, |n| (0.0..=20.0).contains(n)),
        format: fields.read("format", d.format),
        show_seconds: fields.read("show_seconds", d.show_seconds),
        show_date: fields.read("show_date", d.show_date),
        shadow: fields.read("shadow", d.shadow),
        pattern: fields.optional("pattern", |s: &String| valid_pattern(s)),
    }
}

fn colors(fields: &mut Fields<'_>) -> ColorConfig {
    let known = |s: &str| s == "none" || Catalog::builtin().palette(s).is_some();
    ColorConfig {
        scheme: fields.bounded("scheme", "none".to_string(), |s| s.is_empty() || known(s)),
        overrides: fields.record("overrides", |value, child| match value {
            Value::String(s) if s.is_empty() || known(&s) => Some(s),
            _ => {
                // In TS an unknown explicit scheme opts out of the global scheme.
                child.warnings.push(format!("{}: invalid scheme; using none", child.path));
                Some("none".into())
            }
        }),
    }
}

fn rotation(fields: &mut Fields<'_>) -> RotationConfig {
    RotationConfig {
        enabled: fields.read("enabled", false),
        entries: fields.items("entries", usize::MAX, |_, entry| {
            let shader = entry.required("shader", |s: &String| !s.is_empty());
            let preset = entry.optional("preset", |s: &String| !s.is_empty());
            shader.map(|shader| RotationEntry { shader, preset })
        }),
        interval_minutes: fields.bounded("interval_minutes", 0.0, |n| (0.0..=180.0).contains(n)),
    }
}

fn custom_shader(fields: &mut Fields<'_>) -> Option<CustomShader> {
    let id = fields.required("id", |id: &String| {
        id.strip_prefix("custom-").is_some_and(|suffix| {
            (1..=80).contains(&suffix.len()) && suffix.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
    });
    let text = |fields: &mut Fields<'_>, field, max| {
        fields
            .required(field, |s: &String| (1..=max).contains(&s.trim_matches(js_whitespace).encode_utf16().count()))
            .map(|s| s.trim_matches(js_whitespace).to_owned())
    };
    let title = text(fields, "title", MAX_CUSTOM_TITLE_CHARS);
    let source = text(fields, "source", MAX_CUSTOM_SOURCE_CHARS);
    Some(CustomShader { id: id?, title: title?, source: source? })
}

fn effects(fields: &mut Fields<'_>) -> EffectsConfig {
    let mut used = HashSet::new();
    EffectsConfig {
        enabled: fields.read("enabled", true),
        layers: fields.items("layers", MAX_EFFECT_LAYERS, |index, layer| {
            let identifier = |s: &String| (1..=100).contains(&s.encode_utf16().count());
            let effect_id = layer.required("effect_id", identifier);
            let base = format!("effect-{}", index + 1);
            let mut id = layer.bounded("id", base.clone(), identifier);
            let enabled = layer.read("enabled", true);
            let values = layer.record("values", setting);
            let effect_id = effect_id?;
            if used.contains(&id) {
                layer.warn("id", "duplicate instance ID; assigned a unique ID");
                id = base.clone();
                for suffix in 2.. {
                    if !used.contains(&id) {
                        break;
                    }
                    id = format!("{base}-{suffix}");
                }
            }
            used.insert(id.clone());
            Some(EffectLayer { id, effect_id, enabled, values })
        }),
    }
}

fn effect_stack(value: Value, fields: &mut Fields<'_>) -> Option<EffectsConfig> {
    let mut child = fields.child(value)?;
    let stack = effects(&mut child);
    child.finish();
    Some(stack)
}

fn repair_stack(stack: &mut EffectsConfig, path: &str, warnings: &mut Vec<String>) {
    let catalog = Catalog::builtin();
    for (index, layer) in stack.layers.iter_mut().enumerate() {
        let path = format!("{path}.layers[{index}]");
        if let Some(effect) = catalog.effect(&layer.effect_id) {
            repair_uniforms(&effect.uniforms, &mut layer.values, &format!("{path}.values"), true, warnings);
        } else {
            warnings.push(format!("{path}.effect_id: unavailable effect {:?}; skipped during rendering", layer.effect_id));
        }
    }
}

fn settings(value: Value, fields: &mut Fields<'_>) -> Option<ShaderValues> {
    Some(fields.child(value)?.record_entries(setting))
}

fn setting(value: Value, fields: &mut Fields<'_>) -> Option<SettingValue> {
    match value.try_into::<SettingValue>() {
        Ok(SettingValue::Number(n)) if !n.is_finite() => (),
        Ok(typed) => return Some(typed),
        Err(_) => (),
    }
    fields.warnings.push(format!("{}: expected a finite number, boolean, or string; ignored", fields.path));
    None
}

fn repair_uniforms(definitions: &[UniformDef], values: &mut ShaderValues, path: &str, effect: bool, warnings: &mut Vec<String>) {
    for def in definitions {
        if let Some(value) = values.get_mut(&def.name)
            && def.repair_value(value, effect)
        {
            warnings.push(format!("{path}.{}: invalid value; replaced with {value:?}", def.name));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::{ClockFormat, ClockPosition};

    #[test]
    fn toml_round_trips_a_complete_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("scrnsvr/config.toml");
        let table = r##"
shader = "custom-red"
[[custom_shaders]]
id = "custom-red"
title = "Red"
source = "void main(){gl_FragColor=vec4(1.,0.,0.,1.);}"

[global]
idle_threshold_seconds = 10.5
fps = 240
fade_seconds = 0
monitors = "all"

[clock]
position = "bottom-left"
format = "12h"
pattern = "%H:%M %z"

[colors]
scheme = "dracula"
overrides = { plasma = "", "flow-field" = "none" }

[rotation]
enabled = true
interval_minutes = 3.5
[[rotation.entries]]
shader = "plasma"
preset = "Blue Sky"
[[rotation.entries]]
shader = "custom-red"

[shaders.plasma]
speed = "0.25"
palette = "custom"
color1 = "#0077ff"
[shaders.flow-field]
trail = false
[presets.plasma."Blue Sky"]
speed = 0.75
color3 = "#123abc"
[presets.plasma.Empty]

[[effects.plasma.layers]]
id = "blur"
effect_id = "bloom"
values = { intensity = 0.5 }
[[effects.plasma.layers]]
id = "film"
effect_id = "vignette"
enabled = false
[effects.flow-field]
enabled = false
[[look_effects.plasma."Blue Sky".layers]]
id = "effect-1"
effect_id = "vignette"
values = { intensity = 0.3 }
"##
        .parse()
        .unwrap();
        let original = Config::from_table(table);
        assert!(original.warnings.is_empty(), "{:?}", original.warnings);
        assert_eq!(original.config.global.fade_seconds, 0.0);
        assert_eq!(original.config.clock.pattern.as_deref(), Some("%H:%M %z"));
        assert_eq!(original.config.shaders["plasma"]["speed"], SettingValue::Text("0.25".into()));
        assert_eq!(original.config.effect_stack("plasma", None).layers.len(), 2);
        assert_eq!(original.config.effect_stack("plasma", Some("Blue Sky")).layers[0].effect_id, "vignette");
        assert!(!original.config.effect_stack("flow-field", None).enabled);
        assert!(original.config.effect_stack("plasma", Some("Empty")).is_empty(), "a look without a stack has no effects");
        original.config.save(&path).unwrap();
        let reloaded = Config::load(&path);
        assert!(reloaded.error.is_none() && reloaded.warnings.is_empty(), "{reloaded:?}");
        assert_eq!(reloaded.config, original.config);

        let mut changed = original.config;
        changed.global.fps = 100;
        changed.save(&path).unwrap();
        assert_eq!(Config::load(&path).config, changed);
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn repairs_fields_and_preserves_valid_siblings() {
        let loaded = Config::from_table(
            r##"
shader = "removed"
fps = 144
monitor = "all"
audio = { enabled = true }
settings = "wrong type"
[global]
idle_threshold_seconds = inf
fps = 241
fade_seconds = 0.5
monitors = "all"
unknown = true
[clock]
format = "12h"
position = "unknown"
size = "large"
shadow = false
weight = 99
color = "#fff"
margin = -1
pattern = "%#z"
[colors]
scheme = "nord"
overrides = { plasma = "unavailable", "flow-field" = "" }
[rotation]
enabled = true
interval_minutes = 181
entries = [false, {}, { shader = "plasma", preset = "" }, { shader = "gone" }]
[shaders.plasma]
speed = -3
color1 = "#ZzzzZz"
brightness = 1.5
scale = [1, 2]
[shaders.flow-field]
trail = false
[presets.plasma.Faulty]
color1 = { wrong = true }
color2 = "#abcdef"

[[custom_shaders]]
id = "invalid ID"
title = "Skipped"
source = "void main(){}"
[[custom_shaders]]
id = "custom-good"
title = " Trim me "
source = " void main(){} "
[[custom_shaders]]
id = "custom-good"
title = "Duplicate"
source = "void main(){}"

[[effects.layers]]
effect_id = "bloom"
id = "same"
values = { intensity = "2" }
[[effects.layers]]
effect_id = "vignette"
id = "same"
[[effects.layers]]
effect_id = "gone"
id = "unavailable"
values = { intensity = 0.2 }
"##
            .parse()
            .unwrap(),
        );
        assert!(loaded.error.is_none());
        let config = &loaded.config;
        assert_eq!(config.shader, DEFAULT_SHADER);
        assert_eq!(config.global, GlobalConfig { fade_seconds: 0.5, monitors: Monitors::All, ..GlobalConfig::default() });
        assert_eq!(
            config.clock,
            ClockConfig { format: ClockFormat::Hour12, position: ClockPosition::Center, shadow: false, ..ClockConfig::default() }
        );
        assert_eq!(config.rotation.interval_minutes, 0.0);
        assert_eq!(config.rotation.entries.len(), 2);
        assert_eq!(config.rotation.entries[0].shader, "plasma");
        assert_eq!(config.rotation.entries[0].preset, None);
        assert_eq!(config.colors.overrides["plasma"], "none");
        assert_eq!(config.colors.overrides["flow-field"], "");
        assert_eq!(config.shaders["plasma"]["speed"], SettingValue::Number(0.0));
        assert_eq!(config.shaders["plasma"]["brightness"], SettingValue::Number(1.5));
        assert!(!config.shaders["plasma"].contains_key("scale"));
        assert_eq!(config.shaders["flow-field"]["trail"], SettingValue::Bool(false));
        assert_eq!(config.presets["plasma"]["Faulty"].len(), 1);
        assert_eq!(config.custom_shaders.len(), 1);
        assert_eq!(config.custom_shaders[0].title, "Trim me");
        // The old shared stack moves to the current edits of the visual in use (here the default).
        let moved = &config.effects[DEFAULT_SHADER];
        assert_eq!(moved.layers[1].id, "effect-2");
        assert_eq!(moved.layers[2].values["intensity"], SettingValue::Number(0.2));
        assert!(config.effect_stack("plasma", None).is_empty());
        assert!(loaded.warnings.iter().any(|warning| warning.contains("effects are now kept per look")));
        for field in [
            "shader",
            "fps",
            "monitor",
            "audio",
            "global.fps",
            "global.unknown",
            "clock.position",
            "clock.pattern",
            "shaders.plasma.scale",
            "effects.layers[2].effect_id",
            "rotation.entries[1].shader",
        ] {
            assert!(loaded.warnings.iter().any(|warning| warning.starts_with(&format!("{field}:"))), "{field}: {:?}", loaded.warnings);
        }
    }

    #[test]
    fn the_scene_takes_the_effects_of_the_look_it_shows() {
        use crate::scene::SceneTarget;
        let table = r##"
shader = "plasma"
[presets.plasma.Calm]
speed = 0.2
[[effects.plasma.layers]]
id = "edits"
effect_id = "bloom"
[[look_effects.plasma.Calm.layers]]
id = "calm"
effect_id = "vignette"
"##
        .parse()
        .unwrap();
        let config = Config::from_table(table).config;
        let catalog = Catalog::builtin();
        let ids = |preset: Option<&str>| -> Vec<String> {
            let target = SceneTarget { shader: "plasma".into(), preset: preset.map(Into::into) };
            catalog.build_scene(&config, &target).unwrap().effects.into_iter().map(|effect| effect.id).collect()
        };
        assert_eq!(ids(None), ["edits"]);
        assert_eq!(ids(Some("Calm")), ["calm"]);
        let other = SceneTarget { shader: "flow-field".into(), preset: None };
        assert!(catalog.build_scene(&config, &other).unwrap().effects.is_empty(), "other visuals have no effects");
    }

    #[test]
    fn missing_and_malformed_toml_use_defaults() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("config.json"), r#"{"shader":"plasma","fps":144}"#).unwrap();
        let path = dir.path().join("config.toml");
        let missing = Config::load(&path);
        assert_eq!(missing.config, Config::default());
        assert!(missing.warnings.is_empty() && missing.error.is_none());
        fs::write(&path, "[clock\nenabled = true").unwrap();
        let malformed = Config::load(&path);
        assert_eq!(malformed.config, Config::default());
        assert!(matches!(malformed.error, Some(ConfigError::Parse { path: error_path, .. }) if error_path == path));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn unwritable_directory_keeps_edits_available_for_retry() {
        // procfs rejects temporary file creation even for privileged test runs.
        let original = Config { shader: "plasma".into(), ..Config::default() };
        let error = original.save(Path::new("/proc/self/scrnsvr-config-test.toml")).unwrap_err();
        assert!(matches!(error, ConfigError::Write { action: "create temporary configuration", .. }));
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        original.save(&path).unwrap();
        assert_eq!(Config::load(&path).config.shader, "plasma");
    }

    #[test]
    fn failure_to_replace_a_file_leaves_existing_contents_and_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        fs::create_dir(&path).unwrap();
        let existing = path.join("keep");
        fs::write(&existing, "keep this").unwrap();
        let error = Config::default().save(&path).unwrap_err();
        assert!(matches!(error, ConfigError::Write { action: "replace configuration", .. }));
        assert_eq!(fs::read_to_string(existing).unwrap(), "keep this");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}

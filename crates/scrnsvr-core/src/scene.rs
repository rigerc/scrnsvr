//! Resolve native scene plans from the shared catalog and saved settings.

use thiserror::Error;

use crate::catalog::{AnimationTime, Catalog, ColorRole, ColorRoles, SettingValue, ShaderDef, ShaderValues, UniformKind};
use crate::config::{Config, MAX_EFFECT_LAYERS};
use crate::source::{compiled_fragment_source, custom_fragment_source};
use crate::{EffectSpec, SceneSpec};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SceneTarget {
    pub shader: String,
    pub preset: Option<String>,
}

impl SceneTarget {
    pub fn shader(id: impl Into<String>) -> Self {
        Self { shader: id.into(), preset: None }
    }

    pub fn key(&self) -> String {
        match self.preset.as_deref().filter(|name| !name.is_empty()) {
            Some(preset) => format!("{}/{preset}", self.shader),
            None => self.shader.clone(),
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
#[error("Unknown shader {0}")]
pub struct UnknownShader(pub String);

impl Catalog {
    pub fn has_shader(&self, config: &Config, id: &str) -> bool {
        self.shader(id).is_some() || custom_source(config, id).is_some()
    }

    /// Choose the initial scene. A CLI override suppresses rotation even if unavailable.
    /// `random` is a caller-provided uniform sample in [0, 1).
    pub fn select_target(&self, config: &Config, override_id: Option<&str>, preview: bool, random: f64) -> SceneTarget {
        if let Some(id) = override_id.filter(|id| !id.is_empty()) {
            return SceneTarget::shader(if self.has_shader(config, id) { id } else { &config.shader });
        }
        if !preview && let Some(target) = self.pick_rotation(config, random, None) {
            return target;
        }
        SceneTarget::shader(&config.shader)
    }

    /// Select from still-available shader/preset pairs, avoiding the current key if possible.
    pub fn pick_rotation(&self, config: &Config, random: f64, exclude_key: Option<&str>) -> Option<SceneTarget> {
        if !config.rotation.enabled {
            return None;
        }
        let candidates: Vec<_> = config
            .rotation
            .entries
            .iter()
            .filter(|entry| {
                self.has_shader(config, &entry.shader)
                    && entry.preset.as_deref().is_none_or(|name| name.is_empty() || preset(config, &entry.shader, name).is_some())
            })
            .map(|entry| SceneTarget { shader: entry.shader.clone(), preset: entry.preset.clone() })
            .collect();
        let rest: Vec<_> = candidates.iter().filter(|target| exclude_key.is_none_or(|key| key != target.key())).collect();
        let len = if rest.is_empty() { candidates.len() } else { rest.len() };
        if len == 0 {
            return None;
        }
        let index = ((random * len as f64).floor() as usize) % len;
        Some(if rest.is_empty() { candidates[index].clone() } else { rest[index].clone() })
    }

    pub fn build_scene(&self, config: &Config, target: &SceneTarget) -> Result<SceneSpec, UnknownShader> {
        let (source, uniforms, integrated) = if let Some(shader) = self.shader(&target.shader) {
            let stored = target
                .preset
                .as_deref()
                .filter(|name| !name.is_empty())
                .and_then(|name| preset(config, &target.shader, name))
                .or_else(|| config.shaders.get(&target.shader));
            let scheme = config.colors.overrides.get(&target.shader).filter(|value| !value.is_empty()).unwrap_or(&config.colors.scheme);
            let inherited = self.palette(scheme).map_or_else(ShaderValues::new, |palette| shader_color_values(shader, &palette.roles));
            let uniforms = shader
                .uniforms
                .iter()
                .map(|def| {
                    let value = stored.and_then(|values| values.get(&def.name)).or_else(|| inherited.get(&def.name));
                    (def.name.clone(), def.native_value(&def.normalize(value, false)))
                })
                .collect();
            (compiled_fragment_source(&shader.source), uniforms, shader.animation_time == AnimationTime::Integrated)
        } else {
            let source = custom_source(config, &target.shader).ok_or_else(|| UnknownShader(target.shader.clone()))?;
            (source, Vec::new(), false)
        };
        // Each look carries its own stack; without a look, the visual's current edits do.
        let stack = config.effect_stack(&target.shader, target.preset.as_deref());
        let effects = if stack.enabled {
            stack
                .layers
                .iter()
                .take(MAX_EFFECT_LAYERS)
                .filter(|layer| layer.enabled)
                .filter_map(|layer| {
                    let def = self.effect(&layer.effect_id)?;
                    let mut uniforms = Vec::with_capacity(def.uniforms.len());
                    for uniform in &def.uniforms {
                        let value = uniform.normalize(layer.values.get(&uniform.name), true);
                        if uniform.name == "intensity" && value == SettingValue::Number(0.0) {
                            return None;
                        }
                        uniforms.push((uniform.name.clone(), uniform.native_value(&value)));
                    }
                    let mut passes = def.passes.clone();
                    passes.push(def.source.clone());
                    Some(EffectSpec { id: layer.id.clone(), passes, history: def.history, uniforms })
                })
                .collect()
        } else {
            Vec::new()
        };
        Ok(SceneSpec { key: target.key(), source, uniforms, integrated, audio: false, effects })
    }
}

fn preset<'a>(config: &'a Config, shader: &str, name: &str) -> Option<&'a ShaderValues> {
    config.presets.get(shader)?.get(name)
}

fn custom_source(config: &Config, id: &str) -> Option<String> {
    config.custom_shaders.iter().find(|shader| shader.id == id).and_then(|shader| custom_fragment_source(&shader.source).ok())
}

/// Apply color-scheme or desktop palette roles to a shader's color controls.
pub fn shader_color_values(shader: &ShaderDef, roles: &ColorRoles) -> ShaderValues {
    use ColorRole::{OnSurface, Primary, Secondary, Surface, Tertiary};
    let mut values: ShaderValues = shader
        .uniforms
        .iter()
        .filter(|def| def.kind == UniformKind::Color)
        .enumerate()
        .map(|(index, def)| {
            let role = def.color_role.unwrap_or_else(|| match def.name.as_str() {
                "color" | "color1" | "midtone" => Primary,
                "color2" => Secondary,
                "color3" => Tertiary,
                "color4" | "highlight" => OnSurface,
                "background" | "backgroundTop" | "shadow" => Surface,
                _ => [Primary, Secondary, Tertiary][index % 3],
            });
            (def.name.clone(), SettingValue::Text(roles.get(role).into()))
        })
        .collect();
    let palette = match shader.scheme_palette.as_ref() {
        Some(mode) if shader.uniforms.iter().any(|def| def.name == "palette" && def.options.contains(mode)) => Some(mode.as_str()),
        _ if shader.id == "flow-field" && values.contains_key("color") => Some("aurora"),
        _ if shader.id == "plasma" && values.contains_key("color1") => Some("custom"),
        _ => None,
    };
    if let Some(palette) = palette {
        values.insert("palette".into(), SettingValue::Text(palette.into()));
    }
    values
}

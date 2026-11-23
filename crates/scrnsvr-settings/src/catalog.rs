//! Shader manifests and default scene plans exported from the TypeScript registry
//! (`node scripts/export-rust-fixtures.cjs`). Milestone 3 replaces this with shared
//! language-neutral manifests and Rust scene resolution.

use std::sync::Arc;

use scrnsvr_core::{Message, SceneSpec};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct UniformDef {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub label: Option<String>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    #[serde(default)]
    pub advanced: bool,
}

impl UniformDef {
    /// Numeric controls map to sliders; colors, selects and toggles are later work.
    pub fn is_slider(&self) -> bool {
        matches!(self.kind.as_str(), "float" | "int") && self.min.is_some() && self.max.is_some()
    }

    pub fn title(&self) -> &str {
        self.label.as_deref().unwrap_or(&self.name)
    }
}

#[derive(Debug, Clone)]
pub struct Shader {
    pub id: String,
    pub title: String,
    pub uniforms: Vec<UniformDef>,
    pub plan: Arc<SceneSpec>,
}

#[derive(Deserialize)]
struct Entry {
    id: String,
    title: String,
    uniforms: Vec<UniformDef>,
    plan: serde_json::Value,
}

pub fn load() -> Vec<Shader> {
    let entries: Vec<Entry> = serde_json::from_str(include_str!("../data/shaders.json")).expect("bundled shader catalog is valid");
    entries
        .into_iter()
        .filter_map(|entry| match Message::parse(&entry.plan.to_string()) {
            Ok(Message::Scene(plan)) => Some(Shader { id: entry.id, title: entry.title, uniforms: entry.uniforms, plan: Arc::new(plan) }),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn loads_every_shader_with_slider_controls() {
        let shaders = super::load();
        assert_eq!(shaders.len(), 41);
        assert!(shaders.iter().all(|shader| shader.uniforms.iter().any(super::UniformDef::is_slider)));
        let plasma = shaders.iter().find(|shader| shader.id == "plasma").unwrap();
        assert!(plasma.plan.uniforms.iter().any(|(name, _)| name == "speed"));
    }
}

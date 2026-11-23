//! Browser metadata and grouping for the native shader bank.

use scrnsvr_core::catalog::{Catalog, UniformDef};
use scrnsvr_core::config::Config;

const FEATURED: [&str; 6] = ["aurora-veil", "plasma", "tidal-caustics", "silk-ribbons", "mesh-gradient", "flow-field"];

#[derive(Clone)]
pub struct Visual {
    pub id: String,
    pub title: String,
    pub description: String,
    pub category: &'static str,
    pub uniforms: Vec<UniformDef>,
}

pub fn visuals(config: &Config) -> Vec<Visual> {
    let mut visuals: Vec<_> = Catalog::builtin()
        .shaders
        .iter()
        .map(|shader| {
            let quiet = shader.category.as_deref() == Some("Reactive");
            let description = match shader.id.as_str() {
                "reactive-bass-bloom" => "A softly lit volume of smoky plum and copper folds through darkness.",
                "reactive-pulse-rings" => "Defocused ivory and amber light drifts over charcoal.",
                _ => shader.description.as_deref().unwrap_or_default(),
            };
            let uniforms = shader
                .uniforms
                .iter()
                .filter(|def| !quiet || !matches!(def.name.as_str(), "sensitivity" | "audioLight" | "audioShape"))
                .cloned()
                .map(|mut def| {
                    if quiet {
                        match def.name.as_str() {
                            "speed" => def.description = Some("Slow ambient drift.".into()),
                            "shapeDetail" => def.description = Some("Adjust the structure of the composition.".into()),
                            _ => {}
                        }
                    }
                    def
                })
                .collect();
            Visual {
                id: shader.id.clone(),
                title: shader.title.clone(),
                description: description.into(),
                category: if shader.category.as_deref() == Some("Geometric") { "Geometric" } else { "Ambient" },
                uniforms,
            }
        })
        .collect();
    visuals.extend(config.custom_shaders.iter().map(|shader| Visual {
        id: shader.id.clone(),
        title: shader.title.clone(),
        description: "Your saved shader.".into(),
        category: "Custom",
        uniforms: Vec::new(),
    }));
    visuals.sort_by_key(|visual| visual.title.to_lowercase());
    visuals
}

pub fn featured(visuals: &[Visual], initial_shader: &str) -> Vec<usize> {
    let mut results = Vec::new();
    for index in std::iter::once(initial_shader)
        .chain(FEATURED)
        .filter_map(|id| visuals.iter().position(|visual| visual.id == id))
        .chain(0..visuals.len())
    {
        if !results.contains(&index) {
            results.push(index);
        }
        if results.len() == FEATURED.len() {
            break;
        }
    }
    results
}

//! Browser metadata for the library: each visual with its collection.

use scrnsvr_core::catalog::{Catalog, UniformDef};
use scrnsvr_core::config::Config;

/// The collection custom shaders are listed under, after the built-in collections.
pub const CUSTOM: &str = "Your shaders";

#[derive(Clone)]
pub struct Visual {
    pub id: String,
    pub title: String,
    pub description: String,
    /// The library collection, from the shader manifest (or [`CUSTOM`]).
    pub collection: String,
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
                collection: shader.collection.clone().unwrap_or_else(|| "Light".into()),
                uniforms,
            }
        })
        .collect();
    visuals.extend(config.custom_shaders.iter().map(|shader| Visual {
        id: shader.id.clone(),
        title: shader.title.clone(),
        description: "Your saved shader.".into(),
        collection: CUSTOM.into(),
        uniforms: Vec::new(),
    }));
    visuals.sort_by_key(|visual| visual.title.to_lowercase());
    visuals
}

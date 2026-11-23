//! Default preview scenes for the settings spike, resolved by core.

use std::sync::Arc;

use scrnsvr_core::SceneSpec;
use scrnsvr_core::catalog::Catalog;
pub use scrnsvr_core::catalog::UniformDef;
use scrnsvr_core::config::Config;
use scrnsvr_core::scene::SceneTarget;

#[derive(Debug, Clone)]
pub struct Shader {
    pub id: String,
    pub title: String,
    pub uniforms: Vec<UniformDef>,
    pub plan: Arc<SceneSpec>,
}

pub fn load() -> Vec<Shader> {
    let catalog = Catalog::builtin();
    let config = Config::default();
    catalog
        .shaders
        .iter()
        .map(|def| Shader {
            id: def.id.clone(),
            title: def.title.clone(),
            uniforms: def.uniforms.clone(),
            plan: Arc::new(catalog.build_scene(&config, &SceneTarget::shader(&def.id)).expect("built-in shader exists")),
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

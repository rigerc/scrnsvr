//! Color schemes: the global scheme, per-visual overrides and imported desktop colors.
//!
//! `colors.scheme` applies to every visual. `colors.overrides[visual]` replaces it for one:
//! absent or empty inherits, `none` opts out to the visual's built-in colors, and a scheme ID
//! uses that scheme. A scheme shows through only where a visual has no stored color edits, so
//! choosing one clears those edits, as the Electron app did.

use scrnsvr_core::catalog::{Catalog, ColorRoles, UniformKind};
use scrnsvr_core::scene::shader_color_values;

use super::Model;

pub const NONE: &str = "none";

/// Every selectable scheme as `(id, name)`.
pub fn schemes() -> Vec<(String, String)> {
    Catalog::builtin().palettes.iter().map(|palette| (palette.id.clone(), palette.name.clone())).collect()
}

fn scheme_name(id: &str) -> Option<&'static str> {
    Catalog::builtin().palette(id).map(|palette| palette.name.as_str())
}

impl Model {
    pub fn has_color_controls(&self) -> bool {
        self.visual().uniforms.iter().any(|def| def.kind == UniformKind::Color)
    }

    /// The saved choice for the selected visual: `None` inherits the global scheme.
    pub fn shader_scheme(&self) -> Option<&str> {
        self.config.colors.overrides.get(&self.visual().id).map(String::as_str).filter(|id| !id.is_empty())
    }

    /// Drop stored color choices, and the dependent palette select, so a scheme shows through.
    fn clear_color_edits(&mut self, shader_id: &str) {
        let Some(shader) = Catalog::builtin().shader(shader_id) else { return };
        if !shader.uniforms.iter().any(|def| def.kind == UniformKind::Color) {
            return;
        }
        let Some(values) = self.config.shaders.get_mut(shader_id) else { return };
        for def in &shader.uniforms {
            if def.kind == UniformKind::Color || (def.kind == UniformKind::Select && def.name == "palette") {
                values.remove(&def.name);
            }
        }
        if values.is_empty() {
            self.config.shaders.remove(shader_id);
        }
    }

    pub fn set_global_scheme(&mut self, id: &str) -> bool {
        let changed = self.config.colors.scheme != id;
        self.config.colors.scheme = id.into();
        let ids: Vec<_> = self.config.shaders.keys().cloned().collect();
        for id in ids {
            self.clear_color_edits(&id);
        }
        self.undo.clear();
        changed
    }

    /// `None` inherits the global scheme.
    pub fn set_shader_scheme(&mut self, id: Option<&str>) -> bool {
        let shader = self.visual().id.clone();
        let before = self.config.colors.overrides.get(&shader).cloned();
        match id {
            Some(id) => self.config.colors.overrides.insert(shader.clone(), id.into()),
            None => self.config.colors.overrides.remove(&shader),
        };
        self.clear_color_edits(&shader);
        self.undo.clear();
        before.as_deref() != id
    }

    /// What colors the selected visual follows, and how many it overrides.
    pub fn color_hint(&self) -> String {
        if !self.has_color_controls() {
            return "This visual uses a built-in palette.".into();
        }
        let shader_override = self.shader_scheme();
        let id = shader_override.unwrap_or(&self.config.colors.scheme);
        let custom = self.stored().map_or(0, |values| {
            self.visual().uniforms.iter().filter(|def| def.kind == UniformKind::Color && values.contains_key(&def.name)).count()
        });
        let mut hint = match scheme_name(id) {
            Some(name) => format!("Applying {name}{}.", if shader_override.is_some() { " (override)" } else { "" }),
            None => "Using built-in visual colors.".into(),
        };
        if custom > 0 {
            hint.push_str(&format!(" {custom} custom {}.", if custom == 1 { "color" } else { "colors" }));
        }
        hint
    }

    /// Write desktop colors into a visual's stored color controls (explicit colors beat schemes).
    /// Returns whether anything changed.
    pub fn import_colors(&mut self, shader_id: &str, roles: &ColorRoles) -> bool {
        let Some(shader) = Catalog::builtin().shader(shader_id) else { return false };
        let imported = shader_color_values(shader, roles);
        if imported.is_empty() {
            return false;
        }
        let values = self.config.shaders.entry(shader_id.into()).or_default();
        let before = values.clone();
        values.extend(imported);
        let changed = *values != before;
        self.undo.clear();
        changed
    }
}

#[cfg(test)]
mod tests {
    use scrnsvr_core::catalog::{Catalog, SettingValue};
    use scrnsvr_core::noctalia::parse_colors;

    use super::{NONE, schemes};
    use crate::model::Model;
    use crate::persistence::UiState;

    fn model() -> Model {
        Model::new(Default::default(), UiState::default())
    }

    fn select(model: &mut Model, id: &str) {
        let index = model.visual_index(id).unwrap();
        model.select(index);
    }

    #[test]
    fn schemes_list_the_catalog_palettes() {
        assert_eq!(schemes().len(), 30);
        assert!(schemes().iter().any(|(id, _)| id == "dracula"));
    }

    #[test]
    fn global_and_shader_schemes_replace_stored_color_edits_but_not_other_edits() {
        let mut model = model();
        model.set_value("speed", SettingValue::Number(0.4));
        model.set_value("color", SettingValue::Text("#112233".into()));
        model.set_value("palette", SettingValue::Text("duotone".into()));
        assert_eq!(model.color_hint(), "Using built-in visual colors. 1 custom color.");
        assert!(model.set_global_scheme("dracula"));
        let edits = model.stored().unwrap();
        assert_eq!(edits.len(), 1, "{edits:?}");
        assert!(edits.contains_key("speed"));
        assert_eq!(model.color_hint(), "Applying Dracula.");
        assert_eq!(model.config.colors.scheme, "dracula");

        // Per-visual override, opt-out and inherit.
        assert!(model.set_shader_scheme(Some("nord")));
        assert_eq!(model.shader_scheme(), Some("nord"));
        assert_eq!(model.color_hint(), "Applying Nord (override).");
        assert!(model.set_shader_scheme(Some(NONE)));
        assert_eq!(model.color_hint(), "Using built-in visual colors.");
        assert!(!model.set_shader_scheme(Some(NONE)), "unchanged");
        assert!(model.set_shader_scheme(None));
        assert_eq!(model.shader_scheme(), None);
        assert_eq!(model.color_hint(), "Applying Dracula.");
        assert!(model.config.colors.overrides.is_empty());
    }

    #[test]
    fn a_scheme_reaches_the_effective_values_and_scene_unless_the_visual_opts_out() {
        let mut model = model();
        let before = model.effective()["color"].clone();
        model.set_global_scheme("dracula");
        let themed = model.effective()["color"].clone();
        assert_ne!(themed, before);
        model.set_shader_scheme(Some(NONE));
        assert_eq!(model.effective()["color"], before);
        model.set_shader_scheme(None);
        assert_eq!(model.effective()["color"], themed);
    }

    #[test]
    fn a_visual_without_color_controls_reports_its_built_in_palette_and_is_not_imported_into() {
        let mut model = model();
        let colorless = Catalog::builtin()
            .shaders
            .iter()
            .find(|shader| !shader.uniforms.iter().any(|def| def.name.starts_with("color")))
            .map(|s| s.id.clone());
        if let Some(id) = colorless {
            select(&mut model, &id);
            assert!(!model.has_color_controls() || !model.color_hint().is_empty());
        }
        let json = serde_json::json!({"mPrimary":"#111111","mSecondary":"#222222","mTertiary":"#333333","mSurface":"#444444","mOnSurface":"#555555"});
        let roles = parse_colors(&json).unwrap();
        assert!(!model.import_colors("not-a-shader", &roles));
    }

    #[test]
    fn imported_desktop_colors_become_explicit_edits_that_a_scheme_beats_only_when_chosen_later() {
        let mut model = model();
        model.set_global_scheme("dracula");
        let json = serde_json::json!({"mPrimary":"#ebbcba","mSecondary":"#9ccfd8","mTertiary":"#31748f","mSurface":"#191724","mOnSurface":"#e0def4"});
        let roles = parse_colors(&json).unwrap();
        model.set_value("speed", SettingValue::Number(0.3));
        assert!(model.import_colors("flow-field", &roles));
        let edits = model.stored().unwrap();
        assert_eq!(edits["color"], SettingValue::Text("#ebbcba".into()));
        assert_eq!(edits["speed"], SettingValue::Number(0.3), "other edits stay");
        assert_eq!(model.effective()["color"], SettingValue::Text("#ebbcba".into()), "stored colors win over the scheme");
        assert!(!model.import_colors("flow-field", &roles), "importing twice changes nothing");
        assert!(
            model.color_hint().starts_with("Applying Dracula. ") && model.color_hint().ends_with(" custom colors."),
            "{}",
            model.color_hint()
        );
        model.set_global_scheme("nord");
        assert_ne!(model.effective()["color"], SettingValue::Text("#ebbcba".into()), "a later scheme replaces the import");
    }

    #[test]
    fn importing_into_a_shader_other_than_the_selected_one_leaves_the_selection_alone() {
        let mut model = model();
        let json = serde_json::json!({"mPrimary":"#111111","mSecondary":"#222222","mTertiary":"#333333","mSurface":"#444444","mOnSurface":"#555555"});
        let roles = parse_colors(&json).unwrap();
        assert!(model.import_colors("plasma", &roles));
        assert!(model.stored().is_none(), "the selected flow-field is untouched");
        assert!(model.config.shaders.contains_key("plasma"));
    }
}

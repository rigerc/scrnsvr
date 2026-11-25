//! Custom shaders: the list in `config.custom_shaders` and how the browser follows it.
//!
//! IDs are `custom-<slug>-<8 hex>`: readable in `config.toml` and on the command line, and
//! unique without a registry. A shader keeps its ID when it is renamed or edited, so shuffle
//! entries, favorites and `scrnsvr --open --shader <id>` keep working.

use scrnsvr_core::config::{CustomShader, MAX_CUSTOM_SHADERS};
use scrnsvr_core::source::{CUSTOM_TEMPLATE, MAX_CUSTOM_SOURCE_CHARS, MAX_CUSTOM_TITLE_CHARS, js_trim};

use super::Model;
use crate::catalog;

pub const DEFAULT_TITLE: &str = "My shader";
pub const FALLBACK_SHADER: &str = "flow-field";

pub fn template() -> &'static str {
    CUSTOM_TEMPLATE
}

fn slug(title: &str) -> String {
    let mut slug = String::new();
    for ch in title.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    slug.truncate(40);
    slug.trim_matches('-').to_owned()
}

/// A title the configuration accepts, trimmed.
pub fn checked_title(title: &str) -> Result<&str, &'static str> {
    let title = js_trim(title);
    match title.encode_utf16().count() {
        0 => Err("Enter a name for this shader."),
        count if count > MAX_CUSTOM_TITLE_CHARS => Err("Shader names can have at most 100 characters."),
        _ => Ok(title),
    }
}

/// A source the configuration accepts (the GLSL policy and GPU checks happen separately).
pub fn checked_source(source: &str) -> Result<&str, &'static str> {
    let source = js_trim(source);
    match source.encode_utf16().count() {
        0 => Err("Add a mainImage or main function."),
        count if count > MAX_CUSTOM_SOURCE_CHARS => Err("Shader source can have at most 100,000 characters."),
        _ => Ok(source),
    }
}

impl Model {
    pub fn is_custom(&self) -> bool {
        self.visual().collection == catalog::CUSTOM
    }

    pub fn custom(&self, id: &str) -> Option<&CustomShader> {
        self.config.custom_shaders.iter().find(|shader| shader.id == id)
    }

    /// Recompute the browser's list from the configuration, keeping the selection by ID.
    fn rebuild_visuals(&mut self) {
        self.visuals = catalog::visuals(&self.config);
        self.selected = self
            .visuals
            .iter()
            .position(|visual| visual.id == self.config.shader)
            .or_else(|| self.visuals.iter().position(|visual| visual.id == FALLBACK_SHADER))
            .unwrap_or(0);
        self.config.shader = self.visual().id.clone();
    }

    fn unique_id(&self, title: &str, random: u32) -> String {
        let slug = slug(title);
        let mut random = random;
        loop {
            let id = if slug.is_empty() { format!("custom-{random:08x}") } else { format!("custom-{slug}-{random:08x}") };
            if self.custom(&id).is_none() {
                return id;
            }
            random = random.wrapping_add(1);
        }
    }

    /// Add a shader and select it. `random` makes the ID unique; tests pass a fixed one.
    pub fn add_custom(&mut self, title: &str, source: &str, random: u32) -> Result<String, &'static str> {
        if self.config.custom_shaders.len() >= MAX_CUSTOM_SHADERS {
            return Err("You can keep at most 100 custom shaders.");
        }
        let (title, source) = (checked_title(title)?, checked_source(source)?);
        let id = self.unique_id(title, random);
        self.config.custom_shaders.push(CustomShader { id: id.clone(), title: title.into(), source: source.into() });
        self.config.shader = id.clone();
        self.rebuild_visuals();
        Ok(id)
    }

    pub fn rename_custom(&mut self, id: &str, title: &str) -> Result<bool, &'static str> {
        let title = checked_title(title)?;
        let shader = self.config.custom_shaders.iter_mut().find(|shader| shader.id == id).ok_or("This shader no longer exists.")?;
        if shader.title == title {
            return Ok(false);
        }
        shader.title = title.into();
        self.rebuild_visuals();
        Ok(true)
    }

    /// Store a new source. The caller has already validated it.
    pub fn set_custom_source(&mut self, id: &str, source: &str) -> Result<bool, &'static str> {
        let source = checked_source(source)?;
        let shader = self.config.custom_shaders.iter_mut().find(|shader| shader.id == id).ok_or("This shader no longer exists.")?;
        if shader.source == source {
            return Ok(false);
        }
        shader.source = source.into();
        Ok(true)
    }

    /// Remove a shader and everything that referred to it. The selection falls back to Flow Field.
    pub fn delete_custom(&mut self, id: &str) -> bool {
        let before = self.config.custom_shaders.len();
        self.config.custom_shaders.retain(|shader| shader.id != id);
        if self.config.custom_shaders.len() == before {
            return false;
        }
        self.ui.favorites.remove(id);
        self.locks.remove(id);
        self.undo.remove(id);
        self.config.shaders.remove(id);
        self.config.presets.remove(id);
        self.config.effects.remove(id);
        self.config.look_effects.remove(id);
        self.config.colors.overrides.remove(id);
        self.config.rotation.entries.retain(|entry| entry.shader != id);
        if self.config.rotation.entries.is_empty() {
            self.config.rotation.enabled = false;
        }
        if self.config.shader == id {
            self.config.shader = FALLBACK_SHADER.into();
        }
        self.rebuild_visuals();
        true
    }

    /// Custom shaders whose source the configuration holds but that fail the GLSL policy
    /// (hand-edited files). They stay listed so they can be fixed, but cannot be shown.
    pub fn broken_custom(&self) -> Vec<&str> {
        self.config
            .custom_shaders
            .iter()
            .filter(|shader| scrnsvr_core::source::custom_fragment_source(&shader.source).is_err())
            .map(|shader| shader.id.as_str())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use scrnsvr_core::config::{Config, RotationEntry};

    use super::*;
    use crate::persistence::UiState;

    fn model() -> Model {
        Model::new(Config::default(), UiState::default())
    }

    #[test]
    fn add_rename_edit_and_delete_keep_the_list_the_selection_and_the_references_consistent() {
        let mut model = model();
        let id = model.add_custom("  Neon Rain!  ", template(), 0xab).unwrap();
        assert_eq!(id, "custom-neon-rain-000000ab");
        assert!(model.is_custom() && model.visual().id == id && model.config.shader == id);
        assert_eq!(model.visual().collection, catalog::CUSTOM);
        assert!(model.matches().iter().any(|(group, rows)| group == catalog::CUSTOM && rows.len() == 1));
        // The same title again gets another ID instead of replacing the first.
        let second = model.add_custom("Neon Rain!", template(), 0xab).unwrap();
        assert_ne!(second, id);
        assert_eq!(model.config.custom_shaders.len(), 2);

        assert_eq!(model.rename_custom(&id, " Aurora "), Ok(true));
        assert_eq!(model.rename_custom(&id, "Aurora"), Ok(false));
        assert_eq!(model.custom(&id).unwrap().title, "Aurora");
        assert_eq!(model.visual().id, second, "the selection follows the ID, not the list position");
        assert!(model.rename_custom(&id, "   ").is_err());
        assert!(model.rename_custom(&id, &"x".repeat(101)).is_err());
        assert!(model.rename_custom("custom-none", "x").is_err());

        assert_eq!(model.set_custom_source(&id, "void main(){gl_FragColor=vec4(1.0);}\n\n"), Ok(true));
        assert_eq!(model.custom(&id).unwrap().source, "void main(){gl_FragColor=vec4(1.0);}", "the source is trimmed like the config does");
        assert_eq!(model.set_custom_source(&id, "void main(){gl_FragColor=vec4(1.0);}"), Ok(false));
        assert!(model.set_custom_source(&id, "  \n ").is_err());
        assert!(model.set_custom_source(&id, &"a".repeat(100_001)).is_err());

        // References disappear with the shader.
        let index = model.visual_index(&id).unwrap();
        model.toggle_favorite(index);
        model.config.rotation.enabled = true;
        model.config.rotation.entries = vec![RotationEntry { shader: id.clone(), preset: None }];
        model.config.shaders.insert(id.clone(), Default::default());
        model.select(index);
        assert!(model.delete_custom(&id));
        assert!(!model.delete_custom(&id));
        assert_eq!(model.visual().id, "flow-field");
        assert!(model.ui.favorites.is_empty());
        assert!(model.config.rotation.entries.is_empty() && !model.config.rotation.enabled);
        assert!(!model.config.shaders.contains_key(&id));
        assert!(model.visual_index(&id).is_none());
        assert_eq!(model.config.custom_shaders.len(), 1);
    }

    #[test]
    fn deleting_an_unselected_shader_keeps_the_current_selection() {
        let mut model = model();
        model.select(model.visual_index("plasma").unwrap());
        let id = model.add_custom("Spare", template(), 1).unwrap();
        model.select(model.visual_index("plasma").unwrap());
        assert!(model.delete_custom(&id));
        assert_eq!(model.visual().id, "plasma");
    }

    #[test]
    fn the_shader_limit_and_odd_titles_are_handled() {
        let mut model = model();
        assert_eq!(model.add_custom("日本語", template(), 7).unwrap(), "custom-00000007");
        assert!(model.add_custom("", template(), 7).is_err());
        assert!(model.add_custom("x", "", 7).is_err());
        for n in 0..99 {
            model.add_custom(&format!("S{n}"), template(), n).unwrap();
        }
        assert_eq!(model.add_custom("One more", template(), 1000), Err("You can keep at most 100 custom shaders."));
    }

    #[test]
    fn hand_edited_sources_that_break_the_policy_are_flagged_but_listed() {
        let config = Config {
            custom_shaders: vec![CustomShader {
                id: "custom-bad".into(),
                title: "Bad".into(),
                source: "uniform float x;\nvoid main(){}".into(),
            }],
            ..Config::default()
        };
        let model = Model::new(config, UiState::default());
        assert_eq!(model.broken_custom(), ["custom-bad"]);
        assert!(model.visual_index("custom-bad").is_some());
    }
}

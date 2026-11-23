//! The global ordered effect stack.

use scrnsvr_core::catalog::{Catalog, EffectDef, SettingValue, ShaderValues};
use scrnsvr_core::config::{EffectLayer, MAX_EFFECT_LAYERS};

use super::{Model, snap};

#[derive(Debug, PartialEq, Eq)]
pub enum EffectError {
    Full,
    Unknown,
}

impl EffectError {
    pub fn message(&self) -> &'static str {
        match self {
            Self::Full => "Eight-layer limit reached. Remove a layer to add another.",
            Self::Unknown => "That effect is unavailable.",
        }
    }
}

/// The effects a layer can pick, in catalog order.
pub fn catalog() -> &'static [EffectDef] {
    &Catalog::builtin().effects
}

impl Model {
    pub fn effect_def(&self, layer: &EffectLayer) -> Option<&'static EffectDef> {
        Catalog::builtin().effect(&layer.effect_id)
    }

    pub fn effect_index(&self, id: &str) -> Option<usize> {
        self.config.effects.layers.iter().position(|layer| layer.id == id)
    }

    /// `Bloom, layer 2`: how a layer is named in labels and messages.
    pub fn effect_label(&self, index: usize) -> String {
        let layer = &self.config.effects.layers[index];
        let title = self.effect_def(layer).map_or(layer.effect_id.as_str(), |def| def.title.as_str());
        format!("{title}, layer {}", index + 1)
    }

    pub fn effect_title(&self, index: usize) -> String {
        let layer = &self.config.effects.layers[index];
        self.effect_def(layer).map_or_else(|| layer.effect_id.clone(), |def| def.title.clone())
    }

    pub fn effects_full(&self) -> bool {
        self.config.effects.layers.len() >= MAX_EFFECT_LAYERS
    }

    pub fn set_effects_enabled(&mut self, enabled: bool) -> bool {
        let changed = self.config.effects.enabled != enabled;
        self.config.effects.enabled = enabled;
        changed
    }

    fn next_layer_id(&self) -> String {
        (1..).map(|n| format!("effect-{n}")).find(|id| self.effect_index(id).is_none()).expect("an unused layer id")
    }

    /// Append a layer with default values. Returns its index.
    pub fn add_effect(&mut self, effect_id: &str) -> Result<usize, EffectError> {
        if self.effects_full() {
            return Err(EffectError::Full);
        }
        if Catalog::builtin().effect(effect_id).is_none() {
            return Err(EffectError::Unknown);
        }
        let layer = EffectLayer { id: self.next_layer_id(), effect_id: effect_id.into(), enabled: true, values: ShaderValues::new() };
        self.config.effects.layers.push(layer);
        Ok(self.config.effects.layers.len() - 1)
    }

    pub fn remove_effect(&mut self, index: usize) -> Option<EffectLayer> {
        (index < self.config.effects.layers.len()).then(|| self.config.effects.layers.remove(index))
    }

    /// Swap a layer with its neighbor. Returns its new index, or `None` at either end.
    pub fn move_effect(&mut self, index: usize, up: bool) -> Option<usize> {
        let target = if up { index.checked_sub(1)? } else { index + 1 };
        if index >= self.config.effects.layers.len() || target >= self.config.effects.layers.len() {
            return None;
        }
        self.config.effects.layers.swap(index, target);
        Some(target)
    }

    pub fn set_effect_enabled(&mut self, index: usize, enabled: bool) -> bool {
        let Some(layer) = self.config.effects.layers.get_mut(index) else { return false };
        let changed = layer.enabled != enabled;
        layer.enabled = enabled;
        changed
    }

    /// Every control value of a layer with defaults resolved, keyed by uniform name.
    pub fn effective_effect(&self, layer_id: &str) -> ShaderValues {
        let Some(layer) = self.effect_index(layer_id).map(|index| &self.config.effects.layers[index]) else { return ShaderValues::new() };
        let Some(def) = self.effect_def(layer) else { return ShaderValues::new() };
        def.uniforms.iter().map(|uniform| (uniform.name.clone(), uniform.resolve_effect_value(layer.values.get(&uniform.name)))).collect()
    }

    pub fn set_effect_value(&mut self, layer_id: &str, name: &str, value: SettingValue) -> bool {
        let Some(index) = self.effect_index(layer_id) else { return false };
        let layer = &self.config.effects.layers[index];
        let Some(def) = self.effect_def(layer).and_then(|def| def.uniforms.iter().find(|uniform| uniform.name == name)) else {
            return false;
        };
        let value = match value {
            SettingValue::Number(n) if def.is_slider() => SettingValue::Number(snap(def, n)),
            value => def.resolve_effect_value(Some(&value)),
        };
        let layer = &mut self.config.effects.layers[index];
        if layer.values.get(name) == Some(&value) {
            return false;
        }
        layer.values.insert(name.into(), value);
        true
    }

    /// Return a layer's controls to their defaults. Order and the enable switch stay as they are.
    pub fn reset_effect(&mut self, layer_id: &str) -> bool {
        let Some(index) = self.effect_index(layer_id) else { return false };
        let layer = &mut self.config.effects.layers[index];
        let changed = !layer.values.is_empty();
        layer.values.clear();
        changed
    }

    pub fn effect_edited(&self, layer_id: &str) -> bool {
        self.effect_index(layer_id).is_some_and(|index| !self.config.effects.layers[index].values.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use scrnsvr_core::catalog::SettingValue;

    use super::{EffectError, catalog};
    use crate::model::Model;
    use crate::persistence::UiState;

    fn model() -> Model {
        Model::new(Default::default(), UiState::default())
    }

    fn ids(model: &Model) -> Vec<&str> {
        model.config.effects.layers.iter().map(|layer| layer.id.as_str()).collect()
    }

    #[test]
    fn layers_add_with_stable_unique_ids_up_to_the_limit_and_repeat_effects() {
        let mut model = model();
        assert!(model.config.effects.enabled && model.config.effects.layers.is_empty());
        let bloom = catalog().iter().find(|def| def.id == "bloom").expect("bloom").id.clone();
        for expected in 0..8 {
            assert_eq!(model.add_effect(&bloom), Ok(expected));
        }
        assert_eq!(model.add_effect(&bloom), Err(EffectError::Full));
        assert_eq!(ids(&model), ["effect-1", "effect-2", "effect-3", "effect-4", "effect-5", "effect-6", "effect-7", "effect-8"]);
        assert_eq!(model.effect_label(1), "Bloom, layer 2");

        model.remove_effect(2).unwrap();
        assert!(!model.effects_full());
        assert_eq!(model.add_effect("nope"), Err(EffectError::Unknown));
        assert_eq!(model.add_effect(&bloom), Ok(7));
        assert_eq!(model.config.effects.layers[7].id, "effect-3", "the first unused id is reused only after its layer is gone");
        assert!(model.remove_effect(99).is_none());
    }

    #[test]
    fn reordering_keeps_identity_and_stops_at_the_ends() {
        let mut model = model();
        for effect in catalog().iter().take(3) {
            model.add_effect(&effect.id).unwrap();
        }
        assert_eq!(model.move_effect(0, true), None);
        assert_eq!(model.move_effect(2, false), None);
        assert_eq!(model.move_effect(0, false), Some(1));
        assert_eq!(ids(&model), ["effect-2", "effect-1", "effect-3"]);
        assert_eq!(model.move_effect(2, true), Some(1));
        assert_eq!(ids(&model), ["effect-2", "effect-3", "effect-1"]);
        assert_eq!(model.effect_label(2), format!("{}, layer 3", model.effect_title(2)));
    }

    #[test]
    fn values_snap_clamp_and_reset_without_touching_order_or_enable() {
        let mut model = model();
        let def = catalog().iter().find(|def| def.uniforms.iter().any(|u| u.name == "intensity" && u.is_slider())).unwrap();
        let uniform = def.uniforms.iter().find(|u| u.name == "intensity").unwrap();
        let index = model.add_effect(&def.id).unwrap();
        let id = model.config.effects.layers[index].id.clone();
        assert!(!model.effect_edited(&id));
        assert!(model.set_effect_value(&id, "intensity", SettingValue::Number(500.0)));
        let SettingValue::Number(top) = model.effective_effect(&id)["intensity"] else { panic!("numeric") };
        assert_eq!(Some(top), uniform.max);
        assert!(!model.set_effect_value(&id, "intensity", SettingValue::Number(500.0)), "unchanged");
        assert!(!model.set_effect_value(&id, "unknown", SettingValue::Number(1.0)));
        assert!(!model.set_effect_value("effect-99", "intensity", SettingValue::Number(1.0)));
        model.set_effect_enabled(index, false);
        assert!(model.effect_edited(&id));
        assert!(model.reset_effect(&id));
        assert!(!model.reset_effect(&id));
        assert!(!model.config.effects.layers[index].enabled, "reset keeps the layer disabled");
        assert_eq!(model.effective_effect(&id)["intensity"], uniform.default);
        assert!(model.set_effects_enabled(false) && !model.set_effects_enabled(false));
        assert_eq!(model.config.effects.layers.len(), 1, "a global bypass keeps the stack");
    }

    #[test]
    fn effect_edits_reach_the_scene_in_order_and_bypass_hides_them() {
        let mut model = model();
        let (first, second) = (&catalog()[0], &catalog()[1]);
        model.add_effect(&first.id).unwrap();
        model.add_effect(&second.id).unwrap();
        let scene = model.scene().unwrap();
        assert_eq!(scene.effects.iter().map(|effect| effect.id.as_str()).collect::<Vec<_>>(), ["effect-1", "effect-2"]);
        model.move_effect(1, true);
        model.set_effect_enabled(1, false);
        assert_eq!(model.scene().unwrap().effects.iter().map(|effect| effect.id.as_str()).collect::<Vec<_>>(), ["effect-2"]);
        model.set_effects_enabled(false);
        assert!(model.scene().unwrap().effects.is_empty());
        // The stack is global: choosing another visual keeps it.
        let other = model.visuals.iter().position(|visual| visual.id == "plasma").unwrap();
        model.select(other);
        assert_eq!(model.config.effects.layers.len(), 2);
    }
}

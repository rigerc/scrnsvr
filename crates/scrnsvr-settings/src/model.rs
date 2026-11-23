//! Shader edits and discovery, independent of GPUI.

use std::collections::{BTreeMap, BTreeSet};

use scrnsvr_core::SceneSpec;
use scrnsvr_core::catalog::{Catalog, ColorRole, RandomRule, SettingValue, ShaderValues, UniformDef, UniformKind};
use scrnsvr_core::config::Config;
use scrnsvr_core::scene::{SceneTarget, UnknownShader, shader_color_values};

use crate::catalog::{self, Visual};
use crate::persistence::UiState;

pub struct Model {
    pub config: Config,
    pub ui: UiState,
    pub visuals: Vec<Visual>,
    pub selected: usize,
    pub favorites_only: bool,
    pub query: String,
    featured: Vec<usize>,
    locks: BTreeMap<String, BTreeSet<String>>,
    undo: BTreeMap<String, (&'static str, ShaderValues)>,
}

impl Model {
    pub fn new(config: Config, ui: UiState) -> Self {
        let visuals = catalog::visuals(&config);
        let selected = visuals.iter().position(|visual| visual.id == config.shader).unwrap_or(0);
        let featured = catalog::featured(&visuals, &visuals[selected].id);
        Self {
            config,
            ui,
            visuals,
            selected,
            favorites_only: false,
            query: String::new(),
            featured,
            locks: BTreeMap::new(),
            undo: BTreeMap::new(),
        }
    }

    pub fn visual(&self) -> &Visual {
        &self.visuals[self.selected]
    }

    pub fn select(&mut self, index: usize) -> bool {
        if index == self.selected {
            return false;
        }
        self.selected = index;
        self.config.shader = self.visual().id.clone();
        true
    }

    pub fn matches(&self) -> Vec<(&'static str, Vec<usize>)> {
        let query = self.query.trim().to_lowercase();
        let matches = |index: &usize| {
            let visual = &self.visuals[*index];
            (!self.favorites_only || self.ui.favorites.contains(&visual.id))
                && (query.is_empty()
                    || format!("{} {} {}", visual.title, visual.description, visual.category).to_lowercase().contains(&query))
        };
        let mut groups = vec![("Featured", self.featured.iter().copied().filter(matches).collect::<Vec<_>>())];
        for category in ["Ambient", "Geometric", "Custom"] {
            let rows = (0..self.visuals.len())
                .filter(|index| self.visuals[*index].category == category && !self.featured.contains(index))
                .filter(matches)
                .collect();
            groups.push((category, rows));
        }
        groups.retain(|(_, rows)| !rows.is_empty());
        groups
    }

    pub fn toggle_favorite(&mut self, index: usize) {
        let id = &self.visuals[index].id;
        if !self.ui.favorites.remove(id) {
            self.ui.favorites.insert(id.clone());
        }
    }

    pub fn scene(&self) -> Result<SceneSpec, UnknownShader> {
        Catalog::builtin().build_scene(&self.config, &SceneTarget::shader(&self.visual().id))
    }

    pub fn stored(&self) -> Option<&ShaderValues> {
        self.config.shaders.get(&self.visual().id)
    }

    fn inherited(&self) -> ShaderValues {
        let catalog = Catalog::builtin();
        let id = &self.visual().id;
        let scheme = self.config.colors.overrides.get(id).filter(|scheme| !scheme.is_empty()).unwrap_or(&self.config.colors.scheme);
        match (catalog.shader(id), catalog.palette(scheme)) {
            (Some(def), Some(palette)) => shader_color_values(def, &palette.roles),
            _ => ShaderValues::new(),
        }
    }

    pub fn effective(&self) -> ShaderValues {
        let inherited = self.inherited();
        let stored = self.stored();
        self.visual()
            .uniforms
            .iter()
            .map(|def| {
                let value = stored.and_then(|edits| edits.get(&def.name)).or_else(|| inherited.get(&def.name));
                (def.name.clone(), def.resolve_shader_value(value))
            })
            .collect()
    }

    pub fn set_value(&mut self, name: &str, value: SettingValue) -> bool {
        let def = self.visual().uniforms.iter().find(|def| def.name == name).expect("known control");
        let value = match value {
            SettingValue::Number(n) if def.is_slider() => SettingValue::Number(snap(def, n)),
            value => def.resolve_shader_value(Some(&value)),
        };
        let id = self.visual().id.clone();
        let values = self.config.shaders.entry(id.clone()).or_default();
        if values.get(name) == Some(&value) {
            return false;
        }
        values.insert(name.into(), value);
        self.undo.remove(&id);
        true
    }

    pub fn reset_control(&mut self, name: &str) -> bool {
        let id = self.visual().id.clone();
        let Some(values) = self.config.shaders.get_mut(&id) else { return false };
        if values.remove(name).is_none() {
            return false;
        }
        if values.is_empty() {
            self.config.shaders.remove(&id);
        }
        self.undo.remove(&id);
        true
    }

    fn replace(&mut self, values: ShaderValues, label: &'static str) -> bool {
        let old = self.stored().cloned().unwrap_or_default();
        if values == old {
            return false;
        }
        self.undo.insert(self.visual().id.clone(), (label, old));
        self.write_values(values);
        true
    }

    fn write_values(&mut self, values: ShaderValues) {
        let id = self.visual().id.clone();
        if values.is_empty() {
            self.config.shaders.remove(&id);
        } else {
            self.config.shaders.insert(id, values);
        }
    }

    pub fn reset_shader(&mut self) -> bool {
        self.replace(ShaderValues::new(), "Undo reset")
    }

    pub fn undo_label(&self) -> Option<&'static str> {
        self.undo.get(&self.visual().id).map(|(label, _)| *label)
    }

    pub fn undo(&mut self) -> bool {
        let Some((_, values)) = self.undo.remove(&self.visuals[self.selected].id) else { return false };
        self.write_values(values);
        true
    }

    pub fn locked(&self, name: &str) -> bool {
        self.locks.get(&self.visual().id).is_some_and(|locks| locks.contains(name))
    }

    pub fn toggle_lock(&mut self, name: &str) {
        let locks = self.locks.entry(self.visual().id.clone()).or_default();
        if !locks.remove(name) {
            locks.insert(name.into());
        }
    }

    pub fn randomize(&mut self, scope: RandomScope, mut random: impl FnMut() -> f64) -> bool {
        let mut next = self.stored().cloned().unwrap_or_default();
        let mut effective = self.effective();
        let mut defs: Vec<_> = self.visual().uniforms.iter().collect();
        defs.sort_by_key(|def| def.visible_when.is_some());
        let eligible =
            |def: &UniformDef| !self.locked(&def.name) && scope.includes(def) && !matches!(def.random, Some(RandomRule::Enabled(false)));
        for def in defs.iter().copied().filter(|def| def.kind != UniformKind::Color && eligible(def)) {
            if visible(def, &effective) {
                let value = match def.kind {
                    UniformKind::Float | UniformKind::Int => random_number(def, random()),
                    UniformKind::Bool => SettingValue::Bool(random() >= 0.5),
                    UniformKind::Select => def
                        .options
                        .get(sample(def.options.len(), random()))
                        .map_or_else(|| def.default.clone(), |s| SettingValue::Text(s.clone())),
                    UniformKind::Color => unreachable!(),
                };
                effective.insert(def.name.clone(), value.clone());
                next.insert(def.name.clone(), value);
            }
        }
        let colors = defs
            .iter()
            .copied()
            .filter(|def| def.kind == UniformKind::Color && !is_background(def) && eligible(def) && visible(def, &effective));
        let families = &Catalog::builtin().color_families;
        let mut family = None;
        for (index, def) in colors.enumerate() {
            let family = family.get_or_insert_with(|| &families[sample(families.len(), random())]);
            let offset = match def.color_role {
                Some(ColorRole::Primary | ColorRole::Surface) => 0,
                Some(ColorRole::Secondary) => 1,
                Some(ColorRole::Tertiary | ColorRole::OnSurface) => 2,
                None => index % 3,
            };
            if let SettingValue::Text(authored) = &def.default {
                next.insert(def.name.clone(), SettingValue::Text(match_lightness(&family.colors[offset], authored)));
            }
        }
        self.replace(next, "Undo randomize")
    }

    pub fn looks(&self) -> impl Iterator<Item = &String> {
        self.config.presets.get(&self.visual().id).into_iter().flat_map(|looks| looks.keys())
    }

    pub fn save_look(&mut self, name: &str, overwrite: bool) -> Result<(), &'static str> {
        let name = checked_name(name)?;
        if !overwrite && self.looks().any(|old| old == name) {
            return Err("A look already uses that name.");
        }
        let edits = self.stored().cloned().unwrap_or_default();
        self.config.presets.entry(self.visual().id.clone()).or_default().insert(name.into(), edits);
        Ok(())
    }

    pub fn apply_look(&mut self, name: &str) -> bool {
        let Some(values) = self.config.presets.get(&self.visual().id).and_then(|looks| looks.get(name)).cloned() else { return false };
        self.replace(values, "Undo apply look")
    }

    pub fn rename_look(&mut self, old: &str, name: &str) -> Result<(), &'static str> {
        let name = checked_name(name)?;
        let id = self.visual().id.clone();
        let looks = self.config.presets.get_mut(&id).ok_or("This look is unavailable.")?;
        if old == name {
            return Ok(());
        }
        if looks.contains_key(name) {
            return Err("A look already uses that name.");
        }
        let values = looks.remove(old).ok_or("This look is unavailable.")?;
        looks.insert(name.into(), values);
        for entry in &mut self.config.rotation.entries {
            if entry.shader == id && entry.preset.as_deref() == Some(old) {
                entry.preset = Some(name.into());
            }
        }
        Ok(())
    }

    pub fn delete_look(&mut self, name: &str) -> bool {
        let id = self.visual().id.clone();
        let Some(looks) = self.config.presets.get_mut(&id) else { return false };
        if looks.remove(name).is_none() {
            return false;
        }
        if looks.is_empty() {
            self.config.presets.remove(&id);
        }
        self.config.rotation.entries.retain(|entry| entry.shader != id || entry.preset.as_deref() != Some(name));
        if self.config.rotation.entries.is_empty() {
            self.config.rotation.enabled = false;
        }
        true
    }
}

fn checked_name(name: &str) -> Result<&str, &'static str> {
    let name = name.trim();
    if name.is_empty() { Err("Enter a name for this look.") } else { Ok(name) }
}

pub fn visible(def: &UniformDef, values: &ShaderValues) -> bool {
    def.visible_when.as_ref().is_none_or(|condition| values.get(&condition.name) == Some(&condition.value))
}

pub fn step(def: &UniformDef) -> f64 {
    def.step.unwrap_or(if def.kind == UniformKind::Int { 1.0 } else { 0.01 })
}

pub fn snap(def: &UniformDef, value: f64) -> f64 {
    let (origin, step) = (def.min.unwrap_or(0.0), step(def));
    let SettingValue::Number(value) = def.resolve_shader_value(Some(&SettingValue::Number(value))) else { unreachable!() };
    let snapped = origin + (((value - origin) / step) + 0.5).floor() * step;
    let clean = (snapped * 1_000_000.0).round() / 1_000_000.0;
    clean.clamp(def.min.unwrap_or(f64::NEG_INFINITY), def.max.unwrap_or(f64::INFINITY))
}

#[derive(Clone, Copy)]
pub enum RandomScope {
    Structure,
    Motion,
    Shape,
    Colors,
    All,
}

impl RandomScope {
    pub const OPTIONS: [(&str, Self); 5] = [
        ("Motion & Shape", Self::Structure),
        ("Motion", Self::Motion),
        ("Shape", Self::Shape),
        ("Colors", Self::Colors),
        ("All", Self::All),
    ];

    fn includes(self, def: &UniformDef) -> bool {
        let group = group(def);
        match self {
            Self::Structure => group != "Color",
            Self::Motion => group == "Motion",
            Self::Shape => group == "Shape",
            Self::Colors => group == "Color",
            Self::All => true,
        }
    }
}

pub fn group(def: &UniformDef) -> &str {
    if def.kind == UniformKind::Color || (def.kind == UniformKind::Select && def.name == "palette") {
        "Color"
    } else {
        def.group.as_deref().unwrap_or("Shape")
    }
}

fn is_background(def: &UniformDef) -> bool {
    matches!(def.color_role, Some(ColorRole::Surface)) || def.name.to_lowercase().contains("background")
}

fn random_number(def: &UniformDef, random: f64) -> SettingValue {
    let (origin, step) = (def.min.unwrap_or(0.0), step(def));
    let (mut min, mut max) = (origin, def.max.unwrap_or(1.0));
    if let Some(RandomRule::Range { min: low, max: high }) = def.random {
        min = min.max(low);
        max = max.min(high);
    }
    let first = ((min - origin) / step - 1e-8).ceil();
    let last = ((max - origin) / step + 1e-8).floor();
    if last < first {
        return def.default.clone();
    }
    SettingValue::Number(snap(def, origin + (first + sample((last - first + 1.0) as usize, random) as f64) * step))
}

fn sample(count: usize, random: f64) -> usize {
    ((random * count as f64) as usize).min(count.saturating_sub(1))
}

fn match_lightness(color: &str, authored: &str) -> String {
    let rgb = |hex: &str| {
        let packed = u32::from_str_radix(&hex[1..], 16).expect("catalog color");
        [16, 8, 0].map(|shift| f64::from((packed >> shift) & 255) / 255.0)
    };
    let lightness =
        |channels: [f64; 3]| (channels.into_iter().reduce(f64::min).unwrap() + channels.into_iter().reduce(f64::max).unwrap()) / 2.0;
    let channels = rgb(color);
    let current = lightness(channels);
    let target = lightness(rgb(authored)).clamp(0.06, 0.94);
    let [r, g, b] = channels.map(|channel| {
        let adjusted = if target < current {
            channel * target / current.max(0.001)
        } else {
            1.0 - (1.0 - channel) * (1.0 - target) / (1.0 - current).max(0.001)
        };
        (adjusted.clamp(0.0, 1.0) * 255.0).round() as u8
    });
    format!("#{r:02x}{g:02x}{b:02x}")
}

#[cfg(test)]
mod tests {
    use scrnsvr_core::UniformValue;
    use scrnsvr_core::catalog::{Catalog, SettingValue, UniformKind};
    use scrnsvr_core::config::{Config, EffectLayer, RotationEntry};

    use super::{Model, RandomScope, snap, step};
    use crate::persistence::UiState;

    fn model() -> Model {
        Model::new(Config::default(), UiState::default())
    }

    fn filter_ids(model: &Model) -> Vec<&str> {
        model.matches().into_iter().flat_map(|(_, rows)| rows).map(|index| model.visuals[index].id.as_str()).collect()
    }

    #[test]
    fn grouping_has_no_duplicates_and_search_composes_with_favorites() {
        let mut model = model();
        assert_eq!(model.visuals.len(), 41);
        assert_eq!(model.matches()[0].1.len(), 6);
        assert_eq!(filter_ids(&model).into_iter().collect::<std::collections::BTreeSet<_>>().len(), 41);
        for (category, rows) in model.matches().into_iter().skip(1) {
            assert!(rows.windows(2).all(|pair| model.visuals[pair[0]].title.to_lowercase() <= model.visuals[pair[1]].title.to_lowercase()));
            assert!(rows.iter().all(|index| model.visuals[*index].category == category));
        }
        let quiet: Vec<_> = model.visuals.iter().filter(|visual| visual.id.starts_with("reactive-")).collect();
        assert_eq!(quiet.len(), 3);
        assert!(
            quiet.iter().all(|visual| visual.category == "Ambient" && visual.uniforms.iter().all(|def| !def.name.starts_with("audio")))
        );

        model.query = "  luminous COLOR ".into();
        assert!(filter_ids(&model).contains(&"flow-field"));
        model.query = "VELVET CLOUD".into();
        assert_eq!(filter_ids(&model), ["reactive-bass-bloom"]);
        let selected = model.selected;
        model.favorites_only = true;
        assert!(filter_ids(&model).is_empty());
        let favorite = model.visuals.iter().position(|visual| visual.id == "reactive-bass-bloom").unwrap();
        model.toggle_favorite(favorite);
        assert_eq!(filter_ids(&model), ["reactive-bass-bloom"]);
        model.query = "geometric".into();
        assert!(filter_ids(&model).is_empty());
        model.favorites_only = false;
        assert!(!filter_ids(&model).is_empty());
        assert_eq!(model.selected, selected);
    }

    #[test]
    fn randomize_respects_locks_ranges_steps_visibility_and_background() {
        let mut model = model();
        model.toggle_lock("speed");
        model.set_value("background", SettingValue::Text("#332211".into()));
        model.set_value("glowStrength", SettingValue::Number(0.1));
        let before = model.stored().unwrap().clone();

        assert!(model.randomize(RandomScope::All, || 0.41));
        let after = model.stored().unwrap();
        assert_eq!(after.get("speed"), None, "a locked inherited value stays sparse");
        assert_eq!(after["background"], before["background"]);
        assert_eq!(after["trail"], SettingValue::Bool(false));
        assert_eq!(after["glowStrength"], before["glowStrength"], "hidden overrides are retained");
        assert!(!after.contains_key("glowWidth"));
        assert!(!after.contains_key("highlightRolloff"));
        assert_ne!(after["color"], model.visual().uniforms.iter().find(|def| def.name == "color").unwrap().default);
        for def in model.visual().uniforms.iter().filter(|def| def.is_slider()) {
            if let Some(SettingValue::Number(value)) = after.get(&def.name) {
                let n = (value - def.min.unwrap()) / step(def);
                assert!((n - n.round()).abs() < 1e-8, "{}: {value}", def.name);
            }
        }
        let SettingValue::Number(scale) = after["scale"] else { panic!("randomized numeric scale") };
        assert!((0.1..=2.98).contains(&scale));
        assert_eq!(model.undo_label(), Some("Undo randomize"));
        assert!(model.undo());
        assert_eq!(model.stored().unwrap(), &before);
        assert!(!model.undo());
    }

    #[test]
    fn randomize_select_before_dependent_colors_and_limit_scope() {
        let mut model = model();
        assert!(model.randomize(RandomScope::Colors, || 0.95));
        let edits = model.stored().unwrap();
        assert_eq!(edits["palette"], SettingValue::Text("duotone".into()));
        assert!(edits.contains_key("color2"));
        assert!(!edits.contains_key("scale"));
        assert!(!edits.contains_key("background"));
    }

    #[test]
    fn numeric_step_uses_manifest_origin_and_respects_bounds() {
        let mut def = model().visual().uniforms.iter().find(|def| def.name == "glowWidth").unwrap().clone();
        def.min = Some(0.033);
        assert_eq!(snap(&def, 0.039), 0.038);
        assert_eq!(snap(&def, -500.0), 0.033);
        assert_eq!(snap(&def, 500.0), 0.248);
    }

    #[test]
    fn undo_is_per_shader_and_direct_edit_invalidates_it() {
        let mut model = model();
        let first = model.selected;
        model.set_value("speed", SettingValue::Number(1.0));
        assert!(model.reset_shader());
        assert!(model.stored().is_none());
        assert_eq!(model.undo_label(), Some("Undo reset"));
        model.select(model.visuals.iter().position(|visual| visual.id == "plasma").unwrap());
        assert!(model.undo_label().is_none());
        model.select(first);
        assert!(model.undo());
        assert_eq!(model.stored().unwrap()["speed"], SettingValue::Number(1.0));
        model.reset_shader();
        model.set_value("speed", SettingValue::Number(0.4));
        assert!(model.reset_control("speed"), "reset clears a default-valued override");
        assert!(model.stored().is_none());
        assert!(!model.undo());
    }

    #[test]
    fn looks_keep_snapshots_and_maintain_shuffle_references() {
        let mut model = model();
        model.set_value("speed", SettingValue::Number(0.8));
        model.save_look("  Night  ", false).unwrap();
        assert!(model.save_look("Night", false).is_err());
        assert!(model.save_look("  ", false).is_err());
        model.set_value("speed", SettingValue::Number(0.2));
        assert!(model.apply_look("Night"));
        assert_eq!(model.undo_label(), Some("Undo apply look"));
        assert_eq!(model.stored().unwrap()["speed"], SettingValue::Number(0.8));
        model.set_value("speed", SettingValue::Number(0.3));
        assert_eq!(model.config.presets["flow-field"]["Night"]["speed"], SettingValue::Number(0.8));

        model.save_look("Dawn", false).unwrap();
        assert!(model.rename_look("Night", "Dawn").is_err());
        model.config.rotation.enabled = true;
        model.config.rotation.entries.push(RotationEntry { shader: "flow-field".into(), preset: Some("Night".into()) });
        model.rename_look("Night", "Dusk").unwrap();
        assert_eq!(model.config.rotation.entries[0].preset.as_deref(), Some("Dusk"));
        assert!(model.delete_look("Dusk"));
        assert_eq!(model.looks().map(String::as_str).collect::<Vec<_>>(), ["Dawn"]);
        assert!(model.config.rotation.entries.is_empty());
        assert!(!model.config.rotation.enabled);
    }

    #[test]
    fn shader_scene_uses_normalized_edits_and_saved_effects() {
        let mut model = model();
        let def = &Catalog::builtin().effects[0];
        model.config.effects.layers.push(EffectLayer {
            id: "test".into(),
            effect_id: def.id.clone(),
            enabled: true,
            values: Default::default(),
        });
        let values = model.effective();
        model.set_value("speed", SettingValue::Number(2.01));
        assert!(model.visual().uniforms.iter().any(|def| def.kind == UniformKind::Color && values.contains_key(&def.name)));
        let scene = model.scene().unwrap();
        assert_eq!(scene.speed(), 2.01);
        assert_eq!(scene.effects[0].id, "test");
        assert!(!scene.audio);
        assert!(scene.uniforms.iter().any(|(name, value)| name == "trail" && *value == UniformValue::Scalar(1.0)));
    }
}

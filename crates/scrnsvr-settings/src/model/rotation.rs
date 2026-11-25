//! The shuffle list and its timing, with the semantics of `RotationConfig`.
//!
//! `enabled` shuffles when the saver starts. A positive `interval_minutes` also changes the
//! visual while it runs. Entries name a visual and optionally one of its saved looks; without a
//! look they mean that visual's current edits.

use scrnsvr_core::config::RotationEntry;

use super::Model;

pub const DEFAULT_INTERVAL_MINUTES: f64 = 10.0;
pub const MIN_INTERVAL_MINUTES: f64 = 1.0;
pub const MAX_INTERVAL_MINUTES: f64 = 180.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryStatus {
    Playable,
    /// The look was deleted outside this app. The saver skips the entry.
    MissingLook,
    /// The visual is no longer available. The saver skips the entry.
    UnknownVisual,
}

impl Model {
    pub fn visual_index(&self, id: &str) -> Option<usize> {
        self.visuals.iter().position(|visual| visual.id == id)
    }

    pub fn rotation_has(&self, shader: &str, preset: Option<&str>) -> bool {
        self.config.rotation.entries.iter().any(|entry| entry.shader == shader && entry.preset.as_deref() == preset)
    }

    /// Add or remove an entry. Removing the last entry also turns shuffle off. Returns whether
    /// the entry is in the list afterwards.
    pub fn rotation_toggle(&mut self, shader: &str, preset: Option<&str>) -> bool {
        let entries = &mut self.config.rotation.entries;
        match entries.iter().position(|entry| entry.shader == shader && entry.preset.as_deref() == preset) {
            Some(index) => {
                entries.remove(index);
                if entries.is_empty() {
                    self.config.rotation.enabled = false;
                }
                false
            }
            None => {
                entries.push(RotationEntry { shader: shader.into(), preset: preset.map(Into::into) });
                true
            }
        }
    }

    /// Whether any entry, current edits or a look, names this visual.
    pub fn rotation_includes_visual(&self, shader: &str) -> bool {
        self.config.rotation.entries.iter().any(|entry| entry.shader == shader)
    }

    /// The visuals named by the shuffle set, each once, in the order they were added.
    pub fn rotation_visuals(&self) -> Vec<String> {
        let mut visuals: Vec<String> = Vec::new();
        for entry in &self.config.rotation.entries {
            if !visuals.contains(&entry.shader) {
                visuals.push(entry.shader.clone());
            }
        }
        visuals
    }

    /// Remove every entry for one visual. An empty set also turns shuffle off, as in
    /// [`Self::rotation_remove`]. Returns how many entries were removed.
    pub fn rotation_remove_visual(&mut self, shader: &str) -> usize {
        let entries = &mut self.config.rotation.entries;
        let before = entries.len();
        entries.retain(|entry| entry.shader != shader);
        let removed = before - entries.len();
        if removed > 0 && entries.is_empty() {
            self.config.rotation.enabled = false;
        }
        removed
    }

    /// Empty the set and turn shuffle off.
    pub fn rotation_clear(&mut self) -> bool {
        let changed = !self.config.rotation.entries.is_empty() || self.config.rotation.enabled;
        self.config.rotation.entries.clear();
        self.config.rotation.enabled = false;
        changed
    }

    pub fn rotation_remove(&mut self, index: usize) -> Option<RotationEntry> {
        let entries = &mut self.config.rotation.entries;
        let removed = (index < entries.len()).then(|| entries.remove(index))?;
        if entries.is_empty() {
            self.config.rotation.enabled = false;
        }
        Some(removed)
    }

    /// Swap an entry with its neighbor. Returns the new index, or `None` at either end.
    pub fn rotation_move(&mut self, index: usize, up: bool) -> Option<usize> {
        let entries = &mut self.config.rotation.entries;
        let target = if up { index.checked_sub(1)? } else { index + 1 };
        if index >= entries.len() || target >= entries.len() {
            return None;
        }
        entries.swap(index, target);
        Some(target)
    }

    pub fn entry_status(&self, entry: &RotationEntry) -> EntryStatus {
        if self.visual_index(&entry.shader).is_none() {
            EntryStatus::UnknownVisual
        } else if entry
            .preset
            .as_ref()
            .is_some_and(|name| !self.config.presets.get(&entry.shader).is_some_and(|looks| looks.contains_key(name)))
        {
            EntryStatus::MissingLook
        } else {
            EntryStatus::Playable
        }
    }

    pub fn entry_title(&self, entry: &RotationEntry) -> String {
        self.visual_index(&entry.shader).map_or_else(|| entry.shader.clone(), |index| self.visuals[index].title.clone())
    }

    /// `Current edits`, the look's name, or the look's name with its problem.
    pub fn entry_detail(&self, entry: &RotationEntry) -> String {
        match (&entry.preset, self.entry_status(entry)) {
            (_, EntryStatus::UnknownVisual) => "Visual unavailable".into(),
            (Some(name), EntryStatus::MissingLook) => format!("{name} · missing look"),
            (Some(name), _) => name.clone(),
            (None, _) => "Current edits".into(),
        }
    }

    pub fn set_rotation_enabled(&mut self, enabled: bool) -> bool {
        let changed = self.config.rotation.enabled != enabled;
        self.config.rotation.enabled = enabled;
        changed
    }

    pub fn cycling(&self) -> bool {
        self.config.rotation.interval_minutes > 0.0
    }

    /// The interval to restore when cycling is switched back on during this session.
    pub fn remembered_interval(&self) -> f64 {
        self.last_interval
    }

    pub fn set_cycling(&mut self, cycling: bool) -> bool {
        let minutes = if cycling { self.last_interval } else { 0.0 };
        let changed = self.config.rotation.interval_minutes != minutes;
        self.config.rotation.interval_minutes = minutes;
        changed
    }

    /// Clamp to whole minutes in 1–180, remember it and switch cycling on. Returns the value used.
    pub fn set_interval(&mut self, minutes: f64) -> f64 {
        let minutes = if minutes.is_finite() { minutes.round() } else { DEFAULT_INTERVAL_MINUTES };
        let minutes = minutes.clamp(MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);
        self.last_interval = minutes;
        self.config.rotation.interval_minutes = minutes;
        minutes
    }

    pub fn rotation_summary(&self) -> String {
        let count = self.config.rotation.entries.len();
        let looks = if count == 1 { "look" } else { "looks" };
        let rotation = &self.config.rotation;
        if count == 0 {
            "Add a look to start shuffling.".into()
        } else if !rotation.enabled {
            format!("{count} {looks} {} ready. Shuffle is off.", if count == 1 { "is" } else { "are" })
        } else if rotation.interval_minutes > 0.0 {
            let minutes = rotation.interval_minutes;
            format!("Shuffling {count} {looks} on start and every {minutes} {}.", if minutes == 1.0 { "minute" } else { "minutes" })
        } else {
            format!("Shuffling {count} {looks} when the screensaver starts.")
        }
    }
}

#[cfg(test)]
mod tests {
    use scrnsvr_core::catalog::SettingValue;
    use scrnsvr_core::config::RotationEntry;

    use super::EntryStatus;
    use crate::model::Model;
    use crate::persistence::UiState;

    fn model() -> Model {
        Model::new(Default::default(), UiState::default())
    }

    #[test]
    fn current_edits_and_each_look_are_separate_entries_that_toggle_independently() {
        let mut model = model();
        model.set_value("speed", SettingValue::Number(0.8));
        model.save_look("Night", false).unwrap();
        assert!(model.rotation_toggle("flow-field", None));
        assert!(model.rotation_toggle("flow-field", Some("Night")));
        assert!(model.rotation_has("flow-field", None) && model.rotation_has("flow-field", Some("Night")));
        assert!(!model.rotation_toggle("flow-field", Some("Night")));
        assert!(model.rotation_has("flow-field", None), "removing a look from shuffle keeps the other entry");
        assert!(model.looks().any(|name| name == "Night"), "and does not delete the look");
    }

    #[test]
    fn the_set_groups_entries_by_visual_and_removing_a_visual_takes_all_its_entries() {
        let mut model = model();
        model.set_value("speed", SettingValue::Number(0.8));
        model.save_look("Night", false).unwrap();
        model.rotation_toggle("flow-field", Some("Night"));
        model.rotation_toggle("plasma", None);
        model.rotation_toggle("flow-field", None);
        model.set_rotation_enabled(true);
        assert_eq!(model.rotation_visuals(), ["flow-field", "plasma"]);
        assert!(model.rotation_includes_visual("flow-field") && !model.rotation_includes_visual("aurora-veil"));
        assert_eq!(model.rotation_remove_visual("flow-field"), 2);
        assert_eq!(model.rotation_visuals(), ["plasma"]);
        assert!(model.config.rotation.enabled);
        assert_eq!(model.rotation_remove_visual("plasma"), 1);
        assert!(!model.config.rotation.enabled, "an empty set cannot shuffle");
        model.rotation_toggle("plasma", None);
        model.set_rotation_enabled(true);
        assert!(model.rotation_clear());
        assert!(model.config.rotation.entries.is_empty() && !model.config.rotation.enabled);
        assert!(!model.rotation_clear());
    }

    #[test]
    fn removing_the_last_entry_turns_shuffle_off_and_reordering_moves_neighbors() {
        let mut model = model();
        for shader in ["flow-field", "plasma", "aurora-veil"] {
            model.rotation_toggle(shader, None);
        }
        model.set_rotation_enabled(true);
        assert_eq!(model.rotation_move(0, true), None);
        assert_eq!(model.rotation_move(2, false), None);
        assert_eq!(model.rotation_move(0, false), Some(1));
        let order: Vec<_> = model.config.rotation.entries.iter().map(|entry| entry.shader.as_str()).collect();
        assert_eq!(order, ["plasma", "flow-field", "aurora-veil"]);
        model.rotation_remove(0).unwrap();
        model.rotation_remove(0).unwrap();
        assert!(model.config.rotation.enabled);
        assert_eq!(model.rotation_remove(0).unwrap().shader, "aurora-veil");
        assert!(!model.config.rotation.enabled, "an empty list cannot shuffle");
        assert!(model.rotation_remove(0).is_none());
    }

    #[test]
    fn interval_clamps_remembers_and_restores_when_cycling_returns() {
        let mut model = model();
        assert!(!model.cycling());
        assert_eq!(model.remembered_interval(), 10.0);
        assert!(model.set_cycling(true));
        assert_eq!(model.config.rotation.interval_minutes, 10.0);
        assert_eq!(model.set_interval(0.2), 1.0);
        assert_eq!(model.set_interval(1000.0), 180.0);
        assert_eq!(model.set_interval(f64::NAN), 10.0);
        assert_eq!(model.set_interval(24.6), 25.0);
        assert!(model.set_cycling(false));
        assert!(!model.cycling());
        assert!(model.set_cycling(true));
        assert_eq!(model.config.rotation.interval_minutes, 25.0, "the previous interval returns");
    }

    #[test]
    fn summaries_and_entry_status_describe_what_the_saver_will_do() {
        let mut model = model();
        assert_eq!(model.rotation_summary(), "Add a look to start shuffling.");
        model.rotation_toggle("plasma", None);
        assert_eq!(model.rotation_summary(), "1 look is ready. Shuffle is off.");
        model.set_rotation_enabled(true);
        assert_eq!(model.rotation_summary(), "Shuffling 1 look when the screensaver starts.");
        model.rotation_toggle("flow-field", None);
        model.set_interval(1.0);
        assert_eq!(model.rotation_summary(), "Shuffling 2 looks on start and every 1 minute.");
        model.set_interval(30.0);
        assert_eq!(model.rotation_summary(), "Shuffling 2 looks on start and every 30 minutes.");

        model.config.rotation.entries.push(RotationEntry { shader: "plasma".into(), preset: Some("Gone".into()) });
        model.config.rotation.entries.push(RotationEntry { shader: "retired".into(), preset: None });
        let statuses: Vec<_> = model.config.rotation.entries.iter().map(|entry| model.entry_status(entry)).collect();
        assert_eq!(statuses, [EntryStatus::Playable, EntryStatus::Playable, EntryStatus::MissingLook, EntryStatus::UnknownVisual]);
        assert_eq!(model.entry_detail(&model.config.rotation.entries[2]), "Gone · missing look");
        assert_eq!(model.entry_title(&model.config.rotation.entries[3]), "retired");
    }
}

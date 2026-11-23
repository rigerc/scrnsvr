//! Output selection for `--output`/`--output-at`/`--all-outputs`.

use crate::RendererOptions;

/// What the platform knows about one output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputHint {
    /// Registry global name; lower values were announced first.
    pub global: u32,
    pub name: String,
    pub description: String,
    pub location: (i32, i32),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selection {
    All,
    /// One output by global name. `fallback` is true when neither the name
    /// nor the position matched and the first announced output was used.
    One {
        global: u32,
        fallback: bool,
    },
    None,
}

/// The main process's label may be the connector name or the monitor
/// description; the logical position is a second hint. Otherwise the first
/// announced output is used, and the caller reports that it guessed.
pub fn select_outputs(outputs: &[OutputHint], options: &RendererOptions) -> Selection {
    let Some(first) = outputs.iter().min_by_key(|output| output.global) else { return Selection::None };
    if options.all_outputs {
        return Selection::All;
    }
    let mut ordered: Vec<&OutputHint> = outputs.iter().collect();
    ordered.sort_by_key(|output| output.global);
    let by_name = options
        .output_name
        .as_deref()
        .filter(|name| !name.is_empty())
        .and_then(|name| ordered.iter().find(|output| output.name == name || output.description == name));
    let by_position = || options.output_at.and_then(|at| ordered.iter().find(|output| output.location == at));
    match by_name.or_else(by_position) {
        Some(output) => Selection::One { global: output.global, fallback: false },
        None => Selection::One { global: first.global, fallback: true },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outputs() -> Vec<OutputHint> {
        vec![
            OutputHint { global: 9, name: "HDMI-A-1".into(), description: "Dell U2720Q".into(), location: (2560, 0) },
            OutputHint { global: 4, name: "DP-1".into(), description: "LG 27GL850".into(), location: (0, 0) },
        ]
    }

    fn options(name: Option<&str>, at: Option<(i32, i32)>) -> RendererOptions {
        RendererOptions { output_name: name.map(Into::into), output_at: at, ..RendererOptions::default() }
    }

    #[test]
    fn matches_names_descriptions_then_positions() {
        assert_eq!(select_outputs(&outputs(), &options(Some("HDMI-A-1"), None)), Selection::One { global: 9, fallback: false });
        assert_eq!(select_outputs(&outputs(), &options(Some("Dell U2720Q"), Some((0, 0)))), Selection::One { global: 9, fallback: false });
        assert_eq!(select_outputs(&outputs(), &options(Some("Unknown"), Some((2560, 0)))), Selection::One { global: 9, fallback: false });
    }

    #[test]
    fn falls_back_to_the_first_announced_output() {
        assert_eq!(select_outputs(&outputs(), &options(Some("Unknown"), Some((1, 1)))), Selection::One { global: 4, fallback: true });
        assert_eq!(select_outputs(&outputs(), &options(None, None)), Selection::One { global: 4, fallback: true });
        assert_eq!(select_outputs(&[], &options(None, None)), Selection::None);
        let all = RendererOptions { all_outputs: true, ..RendererOptions::default() };
        assert_eq!(select_outputs(&outputs(), &all), Selection::All);
    }
}

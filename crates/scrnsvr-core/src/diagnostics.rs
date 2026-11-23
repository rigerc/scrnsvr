//! GLSL compiler diagnostics, mapped back to a custom shader's own source lines.
//!
//! The driver reports line numbers in the wrapped fragment source that the renderer actually
//! compiles. [`crate::source::custom_fragment_source_mapped`] records where every wrapped line
//! came from, so no `#line` directive is needed and the compiled text stays identical to what the
//! saver and previews use.

use std::sync::LazyLock;

use regex::Regex;

use crate::source::{CustomSourceDiagnostic, CustomSourceError, MappedSource};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
}

/// One message about a custom shader, with the 1-based line of the user's source when known.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub line: Option<u32>,
    pub severity: Severity,
    pub message: String,
}

impl Diagnostic {
    pub fn error(line: Option<u32>, message: impl Into<String>) -> Self {
        Self { line, severity: Severity::Error, message: message.into() }
    }

    /// `Line 3: message`, or just the message when the driver gave no line.
    pub fn display(&self) -> String {
        match self.line {
            Some(line) => format!("Line {line}: {}", self.message),
            None => self.message.clone(),
        }
    }
}

/// A line of a driver's info log: the 1-based line in the compiled text, when it has one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriverMessage {
    pub line: Option<u32>,
    pub severity: Severity,
    pub message: String,
}

fn severity(text: &str) -> Severity {
    if text.trim_start().to_ascii_lowercase().starts_with("warning") { Severity::Warning } else { Severity::Error }
}

/// Split a compile or link log into messages. Understands the three common shapes:
/// NVIDIA `0(12) : error C1008: ...`, Mesa `0:12(5): error: ...` and ANGLE/Android
/// `ERROR: 0:12: '...' : ...`. Other non-empty lines are kept as messages without a line.
pub fn parse_driver_log(log: &str) -> Vec<DriverMessage> {
    static NVIDIA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*\d+\((\d+)(?::\d+)?\)\s*:\s*(.*)$").unwrap());
    static MESA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*\d+:(\d+)(?:\(\d+\))?:\s*(.*)$").unwrap());
    static ANGLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$").unwrap());
    log.lines()
        .map(|line| line.trim_end_matches('\0').trim())
        .filter(|line| !line.is_empty())
        .map(|line| {
            if let Some(found) = ANGLE.captures(line) {
                let level = if &found[1] == "WARNING" { Severity::Warning } else { Severity::Error };
                return DriverMessage { line: found[2].parse().ok(), severity: level, message: found[3].trim().to_owned() };
            }
            for pattern in [&NVIDIA, &MESA] {
                if let Some(found) = pattern.captures(line) {
                    let rest = found[2].trim();
                    return DriverMessage { line: found[1].parse().ok(), severity: severity(rest), message: clean(rest) };
                }
            }
            DriverMessage { line: None, severity: severity(line), message: clean(line) }
        })
        .collect()
}

/// Drop the `error C1008:` / `error:` label, which the editor shows as an error already.
fn clean(message: &str) -> String {
    static LABEL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(?:error|warning)(?:\s+[A-Z]\d+)?\s*:\s*").unwrap());
    LABEL.replace(message, "").trim().to_owned()
}

/// The text of a renderer or driver compile failure without its `Shader compile failed:` heading.
pub fn log_body(error: &str) -> &str {
    ["Shader compile failed:", "Shader link failed:"].into_iter().find_map(|prefix| error.strip_prefix(prefix)).unwrap_or(error).trim()
}

/// Turn a driver failure for `mapped.source` into diagnostics on the user's lines.
/// Warnings are dropped (a failing compile is described by its errors), and repeats collapse.
pub fn map_driver_log(mapped: &MappedSource, log: &str) -> Vec<Diagnostic> {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    for message in parse_driver_log(log_body(log)) {
        if message.severity == Severity::Warning {
            continue;
        }
        let line = message.line.and_then(|line| mapped.user_line(line));
        let diagnostic = Diagnostic::error(line, message.message);
        if !diagnostics.contains(&diagnostic) {
            diagnostics.push(diagnostic);
        }
    }
    if diagnostics.is_empty() {
        diagnostics.push(Diagnostic::error(None, "The shader did not compile."));
    }
    diagnostics
}

/// A rejected custom source as a diagnostic on its line.
pub fn policy_diagnostic(rejected: &CustomSourceDiagnostic) -> Diagnostic {
    let message = match rejected.error {
        CustomSourceError::Version => "Remove the #version directive. Custom shaders use GLSL ES 1.00.".to_owned(),
        CustomSourceError::Texture => "Textures, samplers, iChannel inputs and multipass shaders are not supported.".to_owned(),
        CustomSourceError::Uniform => {
            "Only the supplied uniforms are available: uTime, uResolution, iTime, iResolution, iMouse, iDate, uAudio.".to_owned()
        }
        CustomSourceError::MissingEntry => "Add a mainImage(out vec4 color, in vec2 fragCoord) or main() function.".to_owned(),
    };
    Diagnostic::error(rejected.line, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::custom_fragment_source_mapped;

    #[test]
    fn parses_nvidia_mesa_and_angle_logs() {
        let nvidia = parse_driver_log("0(12) : error C1008: undefined variable \"foo\"\n0(13) : warning C7022: unrecognized\n\n");
        assert_eq!(nvidia.len(), 2);
        assert_eq!((nvidia[0].line, nvidia[0].severity), (Some(12), Severity::Error));
        assert_eq!(nvidia[0].message, "undefined variable \"foo\"");
        assert_eq!(nvidia[1].severity, Severity::Warning);

        let mesa = parse_driver_log("0:7(3): error: 'foo' undeclared\n");
        assert_eq!((mesa[0].line, mesa[0].message.as_str()), (Some(7), "'foo' undeclared"));
        let angle = parse_driver_log("ERROR: 0:9: 'foo' : undeclared identifier\nERROR: 1 compilation errors.  No code generated.\n");
        assert_eq!((angle[0].line, angle[0].message.as_str()), (Some(9), "'foo' : undeclared identifier"));
        assert_eq!(angle[1].line, None);
        let link = parse_driver_log("error: unresolved external symbol main\n");
        assert_eq!((link[0].line, link[0].message.as_str()), (None, "unresolved external symbol main"));
    }

    #[test]
    fn maps_driver_lines_through_comments_and_the_prelude() {
        // Line 3 is where the error is, after a two-line block comment collapsed into line 1.
        let source = "/* a\nb */ float helper() { return 1.0; }\nvoid mainImage(out vec4 c, in vec2 p) {\n  c = vec4(oops);\n}";
        let mapped = custom_fragment_source_mapped(source).unwrap();
        let line = mapped.source.lines().position(|line| line.contains("oops")).unwrap() as u32 + 1;
        assert_eq!(mapped.user_line(line), Some(4));
        let helper = mapped.source.lines().position(|line| line.contains("helper")).unwrap() as u32 + 1;
        assert_eq!(mapped.user_line(helper), Some(2), "a line after a multi-line comment keeps its own number");
        assert_eq!(mapped.user_line(1), Some(3), "wrapper lines point at the entry point");
        let diagnostics = map_driver_log(&mapped, &format!("Shader compile failed: 0({line}) : error C1008: undefined variable \"oops\""));
        assert_eq!(diagnostics, [Diagnostic::error(Some(4), "undefined variable \"oops\"")]);
        assert_eq!(diagnostics[0].display(), "Line 4: undefined variable \"oops\"");
    }

    #[test]
    fn policy_errors_point_at_the_offending_line() {
        let rejected = |source: &str| custom_fragment_source_mapped(source).unwrap_err();
        assert_eq!(rejected("\n\n// c\n#version 300 es\nvoid main(){}").line, Some(4));
        assert_eq!(rejected("void main(){\n  /* x\n y */ iChannel0;\n}").line, Some(3));
        assert_eq!(rejected("float a;\nuniform float exposure;\nvoid main(){}").line, Some(2));
        assert_eq!(rejected("// no entry").error, CustomSourceError::MissingEntry);
        assert!(policy_diagnostic(&rejected("uniform float x;\nvoid main(){}")).display().starts_with("Line 1: "));
    }

    #[test]
    fn an_unparseable_failure_still_reports_something() {
        let mapped = custom_fragment_source_mapped("void main(){}").unwrap();
        assert_eq!(map_driver_log(&mapped, "Shader link failed: \n"), [Diagnostic::error(None, "The shader did not compile.")]);
    }
}

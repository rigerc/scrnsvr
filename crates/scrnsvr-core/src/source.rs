//! The canonical built-in shader ABI, ported from `src/shared/shader-source.ts`.
//!
//! Built-ins are Shadertoy-style `mainImage(out vec4, in vec2)` sources. scrnsvr
//! adds the GLSL ES 1.00 `main()` entry point and defines `SCRNSVR` so the
//! shader's uniform block is used instead of its manifest-default constants.
//! Legacy `void main` sources are passed through unchanged.

use std::sync::LazyLock;

use regex::Regex;
use thiserror::Error;

fn has_function(source: &str, name: &str) -> bool {
    // Equivalent to /\bvoid\s+NAME\s*\(/.
    let bytes = source.as_bytes();
    let word = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'_';
    let mut start = 0;
    while let Some(found) = source[start..].find("void") {
        let at = start + found;
        start = at + 4;
        if at > 0 && word(bytes[at - 1]) {
            continue;
        }
        let rest = &source[at + 4..];
        let trimmed = rest.trim_start_matches(js_whitespace);
        if trimmed.len() == rest.len() {
            continue;
        }
        let Some(after) = trimmed.strip_prefix(name) else { continue };
        if after.trim_start_matches(js_whitespace).starts_with('(') {
            return true;
        }
    }
    false
}

pub fn is_canonical_shader_source(source: &str) -> bool {
    has_function(source, "mainImage") && !has_function(source, "main")
}

pub fn builtin_fragment_source(source: &str) -> String {
    format!(
        "#define SCRNSVR 1\n{}\nvoid main() {{\n  vec4 color = vec4(0.0);\n  mainImage(color, gl_FragCoord.xy);\n  gl_FragColor = vec4(color.rgb, 1.0);\n}}\n",
        source.trim_end_matches(js_whitespace)
    )
}

pub fn compiled_fragment_source(source: &str) -> String {
    if is_canonical_shader_source(source) { builtin_fragment_source(source) } else { source.to_owned() }
}

#[derive(Debug, Clone, Copy, Error, PartialEq, Eq)]
pub enum CustomSourceError {
    #[error("Use GLSL ES 1.00 without a #version directive.")]
    Version,
    #[error("Texture and multipass shaders are not supported.")]
    Texture,
    #[error("Supported uniforms: uTime, uResolution, iTime, iResolution, iMouse, iDate, uAudio (vec4).")]
    Uniform,
    #[error("Add a mainImage(out vec4 color, in vec2 fragCoord) or main() function.")]
    MissingEntry,
}

/// A custom shader's limits, shared with configuration validation and the editor.
pub const MAX_CUSTOM_SOURCE_CHARS: usize = 100_000;
pub const MAX_CUSTOM_TITLE_CHARS: usize = 100;

/// The starter source for a new custom shader.
pub const CUSTOM_TEMPLATE: &str = "void mainImage(out vec4 color, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  color = vec4(0.5 + 0.5 * cos(iTime + uv.xyx * 6.0 + vec3(0, 2, 4)), 1.0);
}";

/// A wrapped custom fragment shader and where each of its lines came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MappedSource {
    /// Exactly what the renderer compiles.
    pub source: String,
    /// For each line of `source` (0-based), the 1-based line of the user's source it came from,
    /// or 0 for the wrapper's own lines.
    pub lines: Vec<u32>,
    /// The 1-based line of the user's entry point (`mainImage` or `main`), when found.
    pub entry_line: Option<u32>,
}

impl MappedSource {
    /// Translate a 1-based line reported by the driver for `source` into the user's source.
    ///
    /// Lines of the wrapper (the prelude and the generated `main`) report the entry point's
    /// line instead, since a wrong signature surfaces in the generated call.
    pub fn user_line(&self, driver_line: u32) -> Option<u32> {
        let origin = self.lines.get((driver_line as usize).checked_sub(1)?).copied()?;
        if origin > 0 { Some(origin) } else { self.entry_line }
    }
}

/// Why a custom source was rejected, and the line of the user's source it points at, when known.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomSourceDiagnostic {
    pub error: CustomSourceError,
    pub line: Option<u32>,
}

/// Source text with the 1-based user line of every byte, kept through each rewrite.
struct Tracked {
    text: String,
    origin: Vec<u32>,
}

impl Tracked {
    fn new(source: &str, first_line: u32) -> Self {
        let mut line = first_line;
        let origin = source
            .bytes()
            .map(|byte| {
                let current = line;
                line += u32::from(byte == b'\n');
                current
            })
            .collect();
        Self { text: source.to_owned(), origin }
    }

    /// Replace the first (or every) match with `replacement`, which takes the line of the match start.
    fn replace(&mut self, pattern: &Regex, replacement: &str, all: bool) {
        let mut text = String::with_capacity(self.text.len());
        let mut origin = Vec::with_capacity(self.origin.len());
        let mut last = 0;
        for found in pattern.find_iter(&self.text) {
            text.push_str(&self.text[last..found.start()]);
            origin.extend_from_slice(&self.origin[last..found.start()]);
            let line = self.origin[found.start()];
            text.push_str(replacement);
            origin.extend(std::iter::repeat_n(line, replacement.len()));
            last = found.end();
            if !all {
                break;
            }
        }
        text.push_str(&self.text[last..]);
        origin.extend_from_slice(&self.origin[last..]);
        self.text = text;
        self.origin = origin;
    }

    fn line_of(&self, found: regex::Match<'_>) -> u32 {
        self.origin[found.start()]
    }
}

/// Wrap a single-pass GLSL ES 1.00 custom shader using the Electron ABI.
pub fn custom_fragment_source(source: &str) -> Result<String, CustomSourceError> {
    custom_fragment_source_mapped(source).map(|mapped| mapped.source).map_err(|diagnostic| diagnostic.error)
}

/// [`custom_fragment_source`] plus a line map for translating compiler diagnostics back to the
/// user's source. The wrapped text is identical; nothing is compiled differently to get lines.
pub fn custom_fragment_source_mapped(source: &str) -> Result<MappedSource, CustomSourceDiagnostic> {
    static BLOCK_COMMENTS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s:/\*.*?\*/)").unwrap());
    static LINE_COMMENTS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"//[^\n]*").unwrap());
    static TEXTURES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?-u:\b(?:sampler\w*|iChannel\d)\b)").unwrap());
    static ALLOWED_UNIFORMS: LazyLock<Regex> = LazyLock::new(|| {
        js_regex(
            r"(?-u:\b)uniform\s+(?:(?:lowp|mediump|highp)\s+)?(?:float|vec2|vec3|vec4)\s+(?:uTime|uResolution|iTime|iResolution|iMouse|iDate)\s*;",
        )
    });
    static AUDIO_DECLARATION: LazyLock<Regex> =
        LazyLock::new(|| js_regex(r"(?-u:\b)uniform\s+(?:(?:lowp|mediump|highp)\s+)?vec4\s+uAudio\s*;"));
    static AUDIO_REFERENCE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?-u:\buAudio\b)").unwrap());
    static UNIFORM: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?-u:\buniform\b)").unwrap());
    static PRECISION: LazyLock<Regex> = LazyLock::new(|| js_regex(r"(?-u:\b)precision\s+(?-u:\w+)\s+float\s*;"));
    static MAIN: LazyLock<Regex> = LazyLock::new(|| js_regex(r"(?-u:\b)void\s+main\s*\("));
    static MAIN_IMAGE: LazyLock<Regex> = LazyLock::new(|| js_regex(r"(?-u:\b)void\s+mainImage\s*\("));

    // Count lines only by `\n`, as the driver does. Leading blank lines are trimmed off the text,
    // so the first kept line may be later than 1.
    let trimmed = source.trim_matches(js_whitespace);
    let skipped = source.len() - source.trim_start_matches(js_whitespace).len();
    let first_line = 1 + source[..skipped].bytes().filter(|byte| *byte == b'\n').count() as u32;
    let mut text = Tracked::new(trimmed, first_line);
    text.replace(&BLOCK_COMMENTS, "", true);
    text.replace(&LINE_COMMENTS, "", true);
    let reject = |error, line| Err(CustomSourceDiagnostic { error, line });
    let base = text.text.as_ptr() as usize;
    for line in text.text.split(['\n', '\r', '\u{2028}', '\u{2029}']) {
        let rest = line.trim_start_matches(js_whitespace);
        if rest.starts_with("#version") {
            return reject(CustomSourceError::Version, Some(text.origin[rest.as_ptr() as usize - base]));
        }
    }
    if let Some(found) = TEXTURES.find(&text.text) {
        return reject(CustomSourceError::Texture, Some(text.line_of(found)));
    }
    text.replace(&ALLOWED_UNIFORMS, "", true);
    text.replace(&AUDIO_DECLARATION, "", true);
    if let Some(found) = UNIFORM.find(&text.text) {
        return reject(CustomSourceError::Uniform, Some(text.line_of(found)));
    }
    text.replace(&PRECISION, "", true);
    let raw = MAIN.is_match(&text.text);
    if !raw && !has_function(&text.text, "mainImage") {
        return reject(CustomSourceError::MissingEntry, None);
    }
    let entry_line = if raw { MAIN.find(&text.text) } else { MAIN_IMAGE.find(&text.text) }.map(|found| text.line_of(found));
    let entry = if raw {
        text.replace(&MAIN, "void customMain(", false);
        "customMain();"
    } else {
        "vec4 color = vec4(0.0); mainImage(color, gl_FragCoord.xy); gl_FragColor = color;"
    };
    // Preserve the original wrapper for shaders that do not use the optional ABI.
    let audio = if AUDIO_REFERENCE.is_match(&text.text) { "\nuniform vec4 uAudio;" } else { "" };
    let prelude = format!(
        "precision highp float;
uniform float uTime;
uniform vec2 uResolution;
uniform vec4 uDate;{audio}
#define iTime uTime
#define iResolution vec3(uResolution, 1.0)
#define iMouse vec4(0.0)
#define iDate vec4(uDate.xyz, uDate.w + uTime)
"
    );
    let wrapped = format!(
        "{prelude}{source}
void main() {{
  {entry}
  gl_FragColor.a = 1.0;
}}",
        source = text.text
    );
    // Each line takes the user line of its first byte; the prelude and the generated main are 0.
    let prelude_lines = prelude.bytes().filter(|byte| *byte == b'\n').count();
    let mut lines = vec![0; prelude_lines];
    let mut start = 0;
    for line in text.text.split('\n') {
        lines.push(text.origin.get(start).copied().unwrap_or_else(|| text.origin.last().copied().unwrap_or(0)));
        start += line.len() + 1;
    }
    let total = wrapped.bytes().filter(|byte| *byte == b'\n').count() + 1;
    lines.resize(total, 0);
    Ok(MappedSource { source: wrapped, lines, entry_line })
}

fn js_regex(pattern: &str) -> Regex {
    Regex::new(&pattern.replace(r"\s", r"[\x09-\x0d \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}]"))
        .unwrap()
}

/// `String.prototype.trim`, which the configuration applies to custom titles and sources.
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(js_whitespace)
}

/// ECMAScript whitespace, shared by the ported shader and number handling.
pub(crate) fn js_whitespace(ch: char) -> bool {
    matches!(ch, '\u{9}'..='\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_main_image_sources_and_keeps_legacy_ones() {
        let canonical = "precision highp float;\nvoid mainImage(out vec4 c, in vec2 p){c=vec4(1.0);}\n\n";
        let wrapped = compiled_fragment_source(canonical);
        assert!(wrapped.starts_with("#define SCRNSVR 1\nprecision highp float;\n"));
        assert!(wrapped.ends_with("gl_FragColor = vec4(color.rgb, 1.0);\n}\n"));
        assert!(wrapped.contains("c=vec4(1.0);}\nvoid main() {"), "trailing whitespace is trimmed");
        let legacy = "void main(){gl_FragColor=vec4(1.0);}";
        assert_eq!(compiled_fragment_source(legacy), legacy);
        let both = "void mainImage(out vec4 c, in vec2 p){}\nvoid main(){}";
        assert_eq!(compiled_fragment_source(both), both);
    }

    #[test]
    fn matches_whole_words_only() {
        assert!(!is_canonical_shader_source("voidmainImage(){}"));
        assert!(!is_canonical_shader_source("xvoid mainImage(){}"));
        assert!(is_canonical_shader_source("void\tmainImage\n(out vec4 c, in vec2 p){}"));
        assert!(!is_canonical_shader_source("void mainImageX(){}"));
        assert!(is_canonical_shader_source("void mainImage(out vec4 c, in vec2 p){} void mainly(){}"));
    }
    #[test]
    fn the_line_map_covers_every_wrapped_line_and_leaves_the_wrapped_text_alone() {
        let sources = [
            "void mainImage(out vec4 c, in vec2 p){c=vec4(1.0);}",
            "\n\n  /* a\n b */ precision mediump float;\nuniform float iTime;\nvoid main(){ // end\n gl_FragColor = vec4(uAudio.x); }\n\n",
            "uniform\nvec4\nuAudio;\nvoid main(){gl_FragColor=uAudio;}",
        ];
        for source in sources {
            let mapped = custom_fragment_source_mapped(source).unwrap();
            assert_eq!(mapped.lines.len(), mapped.source.split('\n').count(), "{source:?}");
            assert_eq!(custom_fragment_source(source).as_deref(), Ok(mapped.source.as_str()));
            assert!(mapped.lines.iter().any(|line| *line > 0));
            assert_eq!(mapped.lines[0], 0, "the first line is the wrapper's precision statement");
            let last = mapped.lines.len() - 1;
            assert_eq!((mapped.lines[last], mapped.lines[last - 1]), (0, 0), "the generated main is the wrapper's");
        }
        // The first user line follows the 8-line prelude (9 with the audio uniform).
        let plain = custom_fragment_source_mapped("void main(){}").unwrap();
        assert_eq!(plain.lines.iter().position(|line| *line == 1), Some(8));
        let audio = custom_fragment_source_mapped("void main(){gl_FragColor=uAudio;}").unwrap();
        assert_eq!(audio.lines.iter().position(|line| *line == 1), Some(9));
    }

    #[test]
    fn rejects_unsupported_custom_sources() {
        for (source, error) in [
            ("#version 300 es\nvoid main(){}", CustomSourceError::Version),
            ("void main(){ iChannel0; }", CustomSourceError::Texture),
            ("uniform float exposure;\nvoid main(){}", CustomSourceError::Uniform),
            ("// void main(){}", CustomSourceError::MissingEntry),
        ] {
            assert_eq!(custom_fragment_source(source), Err(error));
        }
    }
}

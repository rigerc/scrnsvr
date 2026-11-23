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

#[derive(Debug, Error, PartialEq, Eq)]
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

/// Wrap a single-pass GLSL ES 1.00 custom shader using the Electron ABI.
pub fn custom_fragment_source(source: &str) -> Result<String, CustomSourceError> {
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

    let source = BLOCK_COMMENTS.replace_all(source.trim_matches(js_whitespace), "");
    let source = LINE_COMMENTS.replace_all(&source, "");
    if source.split(['\n', '\r', '\u{2028}', '\u{2029}']).any(|line| line.trim_start_matches(js_whitespace).starts_with("#version")) {
        return Err(CustomSourceError::Version);
    }
    if TEXTURES.is_match(&source) {
        return Err(CustomSourceError::Texture);
    }
    let source = ALLOWED_UNIFORMS.replace_all(&source, "");
    let source = AUDIO_DECLARATION.replace_all(&source, "");
    if UNIFORM.is_match(&source) {
        return Err(CustomSourceError::Uniform);
    }
    let source = PRECISION.replace_all(&source, "");
    let raw = MAIN.is_match(&source);
    if !raw && !has_function(&source, "mainImage") {
        return Err(CustomSourceError::MissingEntry);
    }
    let (source, entry) = if raw {
        (MAIN.replace(&source, "void customMain("), "customMain();")
    } else {
        (source, "vec4 color = vec4(0.0); mainImage(color, gl_FragCoord.xy); gl_FragColor = color;")
    };
    // Preserve the original wrapper for shaders that do not use the optional ABI.
    let audio = if AUDIO_REFERENCE.is_match(&source) { "\nuniform vec4 uAudio;" } else { "" };
    Ok(format!(
        "precision highp float;
uniform float uTime;
uniform vec2 uResolution;
uniform vec4 uDate;{audio}
#define iTime uTime
#define iResolution vec3(uResolution, 1.0)
#define iMouse vec4(0.0)
#define iDate vec4(uDate.xyz, uDate.w + uTime)
{source}
void main() {{
  {entry}
  gl_FragColor.a = 1.0;
}}"
    ))
}

fn js_regex(pattern: &str) -> Regex {
    Regex::new(&pattern.replace(r"\s", r"[\x09-\x0d \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}]"))
        .unwrap()
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

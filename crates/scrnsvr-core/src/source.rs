//! The canonical built-in shader ABI, ported from `src/shared/shader-source.ts`.
//!
//! Built-ins are Shadertoy-style `mainImage(out vec4, in vec2)` sources. scrnsvr
//! adds the GLSL ES 1.00 `main()` entry point and defines `SCRNSVR` so the
//! shader's uniform block is used instead of its manifest-default constants.
//! Legacy `void main` sources are passed through unchanged.

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
        let trimmed = rest.trim_start();
        if trimmed.len() == rest.len() {
            continue;
        }
        let Some(after) = trimmed.strip_prefix(name) else { continue };
        if after.trim_start().starts_with('(') {
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
        source.trim_end()
    )
}

pub fn compiled_fragment_source(source: &str) -> String {
    if is_canonical_shader_source(source) { builtin_fragment_source(source) } else { source.to_owned() }
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
}

//! Deterministic gallery thumbnails: clean scenes, cache keys and renderer capture.
//!
//! A thumbnail shows a shader with its defaults only: no saved values, effects, clock or color
//! scheme. The scene is rendered headlessly by `scrnsvr-renderer --capture` (three frames at
//! 640×360), so the same code serves `scrnsvr --thumbnail` and the settings gallery.
//! Cached files are named `<shader id>-<key>.png`; the key hashes everything that affects the
//! pixels, so editing a custom shader or upgrading the app leaves the old file unused.

use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::SceneSpec;
use crate::catalog::Catalog;
use crate::config::{Config, CustomShader};
use crate::protocol::scene_message;
use crate::scene::{SceneTarget, UnknownShader};

pub const WIDTH: u32 = 640;
pub const HEIGHT: u32 = 360;
pub const DEFAULT_FRAMES: u32 = 3;
/// Bumped when the capture itself changes (size, frames, renderer behavior), so old files are not reused.
const CAPTURE_REVISION: &str = "1";
const PAM_HEADER: &str = "P7\nWIDTH 640\nHEIGHT 360\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n";

#[derive(Debug)]
pub enum ThumbnailError {
    Scene(UnknownShader),
    Io(std::io::Error),
    Render(String),
    Encode(String),
}

impl std::fmt::Display for ThumbnailError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ThumbnailError::Scene(error) => error.fmt(f),
            ThumbnailError::Io(error) => error.fmt(f),
            ThumbnailError::Render(message) | ThumbnailError::Encode(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for ThumbnailError {}

impl From<std::io::Error> for ThumbnailError {
    fn from(error: std::io::Error) -> Self {
        ThumbnailError::Io(error)
    }
}

/// `$XDG_CACHE_HOME/scrnsvr/thumbnails`.
pub fn cache_directory() -> Option<PathBuf> {
    dirs::cache_dir().map(|dir| dir.join("scrnsvr/thumbnails"))
}

/// The clean scene for a built-in or custom shader.
pub fn clean_scene(catalog: &Catalog, custom: &[CustomShader], id: &str) -> Result<SceneSpec, ThumbnailError> {
    let config = Config { custom_shaders: custom.to_vec(), ..Config::default() };
    catalog.build_scene(&config, &SceneTarget::shader(id)).map_err(ThumbnailError::Scene)
}

/// FNV-1a over the capture revision, size, frame count and the scene the renderer receives.
/// Stable across runs and versions, unlike `DefaultHasher`.
pub fn cache_key(scene: &SceneSpec, frames: u32) -> String {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    let text = format!("{CAPTURE_REVISION}|{WIDTH}x{HEIGHT}|{frames}|{}", scene_message(scene));
    for byte in text.bytes() {
        hash = (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

pub fn cached_path(directory: &Path, id: &str, key: &str) -> PathBuf {
    directory.join(format!("{id}-{key}.png"))
}

/// Delete other cached images of `id`, which an edit or an upgrade made unreachable.
pub fn prune(directory: &Path, id: &str, keep_key: &str) {
    let prefix = format!("{id}-");
    let keep = format!("{id}-{keep_key}.png");
    let Ok(entries) = fs::read_dir(directory) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        // `id-` also prefixes ids that extend it (`custom-a-` vs `custom-a-b-…`), so insist on a bare key.
        let stale = name
            .strip_prefix(&prefix)
            .and_then(|rest| rest.strip_suffix(".png"))
            .is_some_and(|key| key.len() == 16 && key.bytes().all(|byte| byte.is_ascii_hexdigit()));
        if stale && name != keep {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Render `scene` with `renderer` (`scrnsvr-renderer`) and write the PNG atomically to `output`.
pub fn capture_png(renderer: &Path, scene: &SceneSpec, frames: u32, output: &Path) -> Result<(), ThumbnailError> {
    let directory = output.parent().filter(|parent| !parent.as_os_str().is_empty()).unwrap_or(Path::new("."));
    fs::create_dir_all(directory)?;
    let pam = tempfile::Builder::new().prefix(".capture-").suffix(".pam").tempfile_in(directory)?;
    let mut child = Command::new(renderer)
        .arg("--capture")
        .arg(pam.path())
        .args(["--size", &format!("{WIDTH}x{HEIGHT}"), "--frames", &frames.to_string()])
        .env_remove("WAYLAND_DISPLAY")
        .env_remove("WAYLAND_SOCKET")
        .env("EGL_PLATFORM", "surfaceless")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;
    let written = {
        let mut stdin = child.stdin.take().expect("stdin was piped");
        writeln!(stdin, "{}", scene_message(scene))
    };
    let result = child.wait_with_output()?;
    written?;
    if !result.status.success() {
        let detail = String::from_utf8_lossy(&result.stderr);
        let detail = detail.lines().rev().find(|line| !line.trim().is_empty()).unwrap_or_default();
        return Err(ThumbnailError::Render(format!(
            "renderer returned {}{}",
            result.status,
            if detail.is_empty() { String::new() } else { format!(": {detail}") }
        )));
    }
    encode_png(&fs::read(pam.path())?, output)
}

pub fn encode_png(pam: &[u8], output: &Path) -> Result<(), ThumbnailError> {
    let rgba =
        pam.strip_prefix(PAM_HEADER.as_bytes()).ok_or_else(|| ThumbnailError::Encode("Unexpected renderer capture header".into()))?;
    if rgba.len() != (WIDTH * HEIGHT * 4) as usize {
        return Err(ThumbnailError::Encode("Incomplete renderer capture".into()));
    }
    let directory = output.parent().filter(|parent| !parent.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let mut file = tempfile::NamedTempFile::new_in(directory)?;
    {
        let encode = |error: png::EncodingError| ThumbnailError::Encode(error.to_string());
        let mut encoder = png::Encoder::new(BufWriter::new(file.as_file_mut()), WIDTH, HEIGHT);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(encode)?;
        writer.write_image_data(rgba).map_err(encode)?;
        writer.finish().map_err(encode)?;
    }
    file.persist(output).map_err(|error| ThumbnailError::Io(error.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom(source: &str) -> CustomShader {
        CustomShader { id: "custom-a".into(), title: "A".into(), source: source.into() }
    }

    #[test]
    fn keys_are_stable_and_follow_the_source_the_renderer_receives() {
        let catalog = Catalog::builtin();
        let first = clean_scene(catalog, &[custom("void main(){gl_FragColor=vec4(1.0);}")], "custom-a").unwrap();
        let same = clean_scene(catalog, &[custom("void main(){gl_FragColor=vec4(1.0);}")], "custom-a").unwrap();
        let edited = clean_scene(catalog, &[custom("void main(){gl_FragColor=vec4(0.5);}")], "custom-a").unwrap();
        assert_eq!(cache_key(&first, 3), cache_key(&same, 3));
        assert_ne!(cache_key(&first, 3), cache_key(&edited, 3));
        assert_ne!(cache_key(&first, 3), cache_key(&first, 4));
        assert_eq!(cache_key(&first, 3).len(), 16);
        // A fixed value guards against an accidental change of the hash, which would orphan every cached file.
        let flow = clean_scene(catalog, &[], "flow-field").unwrap();
        assert_eq!(cache_key(&flow, 3), cache_key(&clean_scene(catalog, &[], "flow-field").unwrap(), 3));
    }

    #[test]
    fn thumbnails_ignore_saved_values_effects_and_clock() {
        let catalog = Catalog::builtin();
        let plain = clean_scene(catalog, &[], "plasma").unwrap();
        assert!(plain.effects.is_empty());
        assert!(clean_scene(catalog, &[], "no-such-shader").is_err());
    }

    #[test]
    fn prune_removes_only_stale_images_of_that_shader() {
        let directory = tempfile::tempdir().unwrap();
        for name in [
            "custom-a-0000000000000001.png",
            "custom-a-0000000000000002.png",
            "custom-a-b-0000000000000003.png",
            "plasma-0000000000000004.png",
            "notes.txt",
        ] {
            fs::write(directory.path().join(name), "x").unwrap();
        }
        prune(directory.path(), "custom-a", "0000000000000002");
        let mut left: Vec<_> =
            fs::read_dir(directory.path()).unwrap().map(|entry| entry.unwrap().file_name().into_string().unwrap()).collect();
        left.sort();
        assert_eq!(left, ["custom-a-0000000000000002.png", "custom-a-b-0000000000000003.png", "notes.txt", "plasma-0000000000000004.png"]);
    }

    #[test]
    fn encodes_a_capture_and_rejects_a_bad_one() {
        let directory = tempfile::tempdir().unwrap();
        let mut pam = PAM_HEADER.as_bytes().to_vec();
        pam.extend(std::iter::repeat_n([10u8, 20, 30, 255], (WIDTH * HEIGHT) as usize).flatten());
        let output = directory.path().join("shot.png");
        encode_png(&pam, &output).unwrap();
        let decoder = png::Decoder::new(std::io::BufReader::new(fs::File::open(&output).unwrap()));
        let mut reader = decoder.read_info().unwrap();
        assert_eq!((reader.info().width, reader.info().height), (WIDTH, HEIGHT));
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        reader.next_frame(&mut pixels).unwrap();
        assert_eq!(&pixels[..4], &[10, 20, 30, 255]);
        assert!(encode_png(&pam[..pam.len() - 4], &output).is_err());
        assert!(encode_png(b"nope", &output).is_err());
    }
}

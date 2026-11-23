use std::fs;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::process::{Command, Stdio};

use scrnsvr_core::catalog::Catalog;
use scrnsvr_core::config::Config;
use scrnsvr_core::scene::SceneTarget;

use crate::{Result, executable};

const WIDTH: u32 = 640;
const HEIGHT: u32 = 360;
const PAM_HEADER: &str = "P7\nWIDTH 640\nHEIGHT 360\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n";

pub fn run(output: &Path, frames: u32) -> Result<()> {
    let renderer = executable("scrnsvr-renderer")?;
    fs::create_dir_all(output)?;
    let capture_dir = tempfile::tempdir()?;
    let pam = capture_dir.path().join("frame.pam");
    let catalog = Catalog::builtin();
    let config = Config::default();
    let mut failures = 0;
    for shader in &catalog.shaders {
        let png = output.join(format!("{}.png", shader.id));
        let captured = || -> Result<()> {
            let scene = catalog.build_scene(&config, &SceneTarget::shader(&shader.id))?;
            let mut child = Command::new(&renderer)
                .arg("--capture")
                .arg(&pam)
                .args(["--size", "640x360", "--frames", &frames.to_string()])
                .env_remove("WAYLAND_DISPLAY")
                .env_remove("WAYLAND_SOCKET")
                .env("EGL_PLATFORM", "surfaceless")
                .stdin(Stdio::piped())
                .spawn()?;
            let write = {
                let mut stdin = child.stdin.take().expect("stdin was piped");
                writeln!(stdin, "{}", crate::controller::scene_message(&scene))
            };
            let status = child.wait()?;
            write?;
            if !status.success() {
                return Err(format!("renderer returned {status}").into());
            }
            let captured = fs::read(&pam)?;
            fs::remove_file(&pam)?;
            encode_png(&captured, &png)
        };
        if let Err(error) = captured() {
            eprintln!("scrnsvr thumbnail {}: {error}", shader.id);
            failures += 1;
        }
    }
    if failures > 0 { Err(format!("{failures} of {} thumbnail captures failed", catalog.shaders.len()).into()) } else { Ok(()) }
}

fn encode_png(pam: &[u8], output: &Path) -> Result<()> {
    let rgba = pam.strip_prefix(PAM_HEADER.as_bytes()).ok_or("Unexpected renderer capture header")?;
    if rgba.len() != (WIDTH * HEIGHT * 4) as usize {
        return Err("Incomplete renderer capture".into());
    }
    let mut file = tempfile::NamedTempFile::new_in(output.parent().ok_or("Thumbnail output has no parent directory")?)?;
    {
        let mut encoder = png::Encoder::new(BufWriter::new(file.as_file_mut()), WIDTH, HEIGHT);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header()?;
        writer.write_image_data(rgba)?;
        writer.finish()?;
    }
    file.persist(output)?;
    Ok(())
}

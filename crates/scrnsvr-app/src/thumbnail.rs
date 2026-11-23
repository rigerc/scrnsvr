use std::fs;
use std::path::Path;

use scrnsvr_core::catalog::Catalog;
use scrnsvr_core::thumbnail::{capture_png, clean_scene};

use crate::{Result, executable};

pub fn run(output: &Path, frames: u32) -> Result<()> {
    let renderer = executable("scrnsvr-renderer")?;
    fs::create_dir_all(output)?;
    let catalog = Catalog::builtin();
    let mut failures = 0;
    for shader in &catalog.shaders {
        let captured = || -> Result<()> {
            let scene = clean_scene(catalog, &[], &shader.id)?;
            capture_png(&renderer, &scene, frames, &output.join(format!("{}.png", shader.id)))?;
            Ok(())
        };
        if let Err(error) = captured() {
            eprintln!("scrnsvr thumbnail {}: {error}", shader.id);
            failures += 1;
        }
    }
    if failures > 0 { Err(format!("{failures} of {} thumbnail captures failed", catalog.shaders.len()).into()) } else { Ok(()) }
}

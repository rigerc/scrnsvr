//! Assembles the built-in catalog from the editable sources under `data/`.
//!
//! `data/shaders/<id>/{manifest.json,shader.glsl}`, `data/effects/<id>/{manifest.json,*.glsl}` (ordered by
//! `data/effects/order.json`), `data/palettes.json` and `data/color-families.json` become one JSON document in
//! `$OUT_DIR/catalog.json`, which `catalog.rs` embeds and deserializes. Manifests name their GLSL files
//! (`fragment` for shaders, `source` and `passes` for effects); this script replaces those names with the file text.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value, json};

fn main() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"));
    let data = manifest_dir.join("../../data");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={}", data.display());

    let catalog = json!({
        "shaders": shaders(&data.join("shaders")),
        "effects": effects(&data.join("effects")),
        "palettes": read_json(&data.join("palettes.json")),
        "colorFamilies": read_json(&data.join("color-families.json")),
        "collections": read_json(&data.join("collections.json")),
    });
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("cargo sets OUT_DIR")).join("catalog.json");
    fs::write(&out, serde_json::to_string(&catalog).expect("catalog serializes"))
        .unwrap_or_else(|e| panic!("write {}: {e}", out.display()));
}

fn read_text(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

fn read_json(path: &Path) -> Value {
    serde_json::from_str(&read_text(path)).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

fn manifest(dir: &Path) -> Map<String, Value> {
    match read_json(&dir.join("manifest.json")) {
        Value::Object(map) => map,
        _ => panic!("{}/manifest.json must be a JSON object", dir.display()),
    }
}

fn file_name<'a>(dir: &Path, manifest: &'a Map<String, Value>, key: &str) -> &'a str {
    manifest.get(key).and_then(Value::as_str).unwrap_or_else(|| panic!("{}/manifest.json needs a string \"{key}\"", dir.display()))
}

fn check_id(dir: &Path, manifest: &Map<String, Value>) {
    let id = manifest.get("id").and_then(Value::as_str);
    let name = dir.file_name().and_then(|name| name.to_str());
    assert_eq!(id, name, "{}: manifest id must match the directory name", dir.display());
}

fn subdirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(root)
        .unwrap_or_else(|e| panic!("read {}: {e}", root.display()))
        .map(|entry| entry.expect("directory entry").path())
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort();
    dirs
}

fn shaders(root: &Path) -> Vec<Value> {
    subdirs(root)
        .into_iter()
        .map(|dir| {
            let mut manifest = manifest(&dir);
            check_id(&dir, &manifest);
            let source = read_text(&dir.join(file_name(&dir, &manifest, "fragment")));
            manifest.insert("source".into(), Value::String(source));
            Value::Object(manifest)
        })
        .collect()
}

fn effects(root: &Path) -> Vec<Value> {
    let order: Vec<String> = serde_json::from_value(read_json(&root.join("order.json"))).expect("effects/order.json is a list of ids");
    let mut on_disk: Vec<String> = subdirs(root).iter().map(|dir| dir.file_name().unwrap().to_string_lossy().into_owned()).collect();
    let mut listed = order.clone();
    on_disk.sort();
    listed.sort();
    assert_eq!(on_disk, listed, "data/effects/order.json must list every effect directory exactly once");
    order
        .iter()
        .map(|id| {
            let dir = root.join(id);
            let mut manifest = manifest(&dir);
            check_id(&dir, &manifest);
            let source = read_text(&dir.join(file_name(&dir, &manifest, "source")));
            manifest.insert("source".into(), Value::String(source));
            if let Some(passes) = manifest.get("passes") {
                let passes: Vec<String> =
                    serde_json::from_value(passes.clone()).unwrap_or_else(|_| panic!("{id}: passes is a list of file names"));
                let sources = passes.iter().map(|name| Value::String(read_text(&dir.join(name)))).collect();
                manifest.insert("passes".into(), Value::Array(sources));
            }
            Value::Object(manifest)
        })
        .collect()
}

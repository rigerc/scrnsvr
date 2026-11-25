//! The catalog assembled from `data/` by `build.rs` matches the frozen catalog the last TypeScript
//! release (v0.10.0) generated, so editing manifests and GLSL under `data/` is the only way to change it.

use scrnsvr_core::catalog::{BUILTIN_CATALOG_JSON, Catalog};
use serde_json::Value;

const FROZEN_CATALOG: &str = include_str!("fixtures/catalog.json");

fn section<'a>(catalog: &'a Value, key: &str) -> &'a Vec<Value> {
    catalog[key].as_array().unwrap_or_else(|| panic!("catalog.{key} is a list"))
}

#[test]
fn assembled_catalog_equals_the_frozen_v0_10_0_catalog() {
    let assembled: Value = serde_json::from_str(BUILTIN_CATALOG_JSON).unwrap();
    let frozen: Value = serde_json::from_str(FROZEN_CATALOG).unwrap();
    for key in ["shaders", "effects", "palettes", "colorFamilies"] {
        let (assembled, frozen) = (section(&assembled, key), section(&frozen, key));
        assert_eq!(assembled.len(), frozen.len(), "{key}: entry count");
        for (assembled, frozen) in assembled.iter().zip(frozen) {
            let id = frozen.get("id").or_else(|| frozen.get("name")).and_then(Value::as_str).unwrap_or("?");
            assert_eq!(assembled, frozen, "{key}/{id} differs from the frozen catalog");
        }
    }
}

#[test]
fn builtin_catalog_has_the_expected_content() {
    let catalog = Catalog::builtin();
    assert_eq!(catalog.shaders.len(), 54);
    assert_eq!(catalog.effects.len(), 17);
    assert_eq!(catalog.palettes.len(), 30);
    assert_eq!(catalog.color_families.len(), 5);
    assert_eq!(catalog.effect("bloom").map(|effect| effect.passes.len()), Some(3));
    assert!(catalog.effect("datamosh-trails").is_some_and(|effect| effect.history));
    assert!(catalog.shaders.iter().all(|shader| shader.source.contains("mainImage")), "built-ins use the mainImage ABI");
}

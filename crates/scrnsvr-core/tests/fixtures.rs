//! Every message the TypeScript main process currently produces parses as the C++ renderer read it.
//! Regenerate with `node scripts/export-rust-fixtures.cjs`.

use scrnsvr_core::{Message, UniformValue};

#[test]
fn parses_every_exported_scene_plan_and_clock_message() {
    let messages: Vec<Message> = include_str!("fixtures/messages.jsonl").lines().map(|line| Message::parse(line).expect(line)).collect();
    let scenes: Vec<_> =
        messages.iter().filter_map(|message| if let Message::Scene(scene) = message { Some(scene) } else { None }).collect();
    let builtins: Vec<_> = scenes.iter().filter(|scene| scene.effects.is_empty()).collect();
    assert_eq!(builtins.len(), 41, "one plan per built-in shader");
    for scene in &builtins {
        assert!(scene.source.contains("void main"), "{} has an entry point", scene.key);
        assert!(!scene.uniforms.is_empty(), "{} has manifest uniforms", scene.key);
        for (name, value) in &scene.uniforms {
            if let UniformValue::Vector(items) = value {
                assert_eq!(items.len(), 3, "{}.{name}: colors are RGB", scene.key);
            }
        }
    }
    assert!(builtins.iter().any(|scene| scene.audio), "reactive shaders are flagged");
    assert!(builtins.iter().any(|scene| scene.integrated), "integrated-time shaders are flagged");
    let layers: Vec<_> = scenes.iter().flat_map(|scene| &scene.effects).collect();
    assert!(layers.len() >= 17, "every catalog effect is exported: {}", layers.len());
    assert!(layers.iter().any(|layer| layer.history), "temporal effects keep history");
    assert!(layers.iter().any(|layer| layer.passes.len() == 4), "bloom keeps its three intermediate passes and the final pass");
    assert!(layers.iter().all(|layer| layer.uniforms.iter().any(|(name, _)| name == "intensity")));
    let Some(Message::Clock(clock)) = messages.last() else { panic!("the last fixture is a clock message") };
    assert!(clock.enabled && !clock.time.is_empty() && !clock.date.is_empty());
}

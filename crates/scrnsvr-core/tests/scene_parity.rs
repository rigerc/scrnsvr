//! Scene parity: paired settings and the results the TypeScript main process produced for them.
//! `fixtures/scene-parity.jsonl` is a frozen reference exported from the last TypeScript release (v0.10.0); it is not regenerated.

use chrono::DateTime;
use scrnsvr_core::Message;
use scrnsvr_core::catalog::Catalog;
use scrnsvr_core::config::Config;
use scrnsvr_core::scene::SceneTarget;
use serde::Deserialize;

#[derive(Deserialize)]
struct Case {
    name: String,
    settings: serde_json::Value,
    target: Option<Target>,
    launch: Option<Launch>,
    cycle: Option<Cycle>,
    now: Option<String>,
    expected: Option<serde_json::Value>,
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Target {
    shader_id: String,
    preset: Option<String>,
}

#[derive(Deserialize)]
#[serde(default)]
#[derive(Default)]
struct Launch {
    #[serde(rename = "override")]
    override_id: Option<String>,
    preview: bool,
    random: f64,
}

#[derive(Deserialize)]
struct Cycle {
    random: f64,
    exclude: Option<String>,
}

/// The native TOML uses snake_case keys; TypeScript settings use camelCase. Rename only the
/// config's own field names, never map keys such as shader IDs or uniform names.
fn to_native_keys(value: serde_json::Value) -> serde_json::Value {
    const KEYS: [(&str, &str); 8] = [
        ("customFont", "custom_font"),
        ("customShaders", "custom_shaders"),
        ("effectId", "effect_id"),
        ("fadeSeconds", "fade_seconds"),
        ("idleThresholdSeconds", "idle_threshold_seconds"),
        ("intervalMinutes", "interval_minutes"),
        ("showDate", "show_date"),
        ("showSeconds", "show_seconds"),
    ];
    match value {
        serde_json::Value::Object(object) => object
            .into_iter()
            .map(|(key, value)| {
                let key = KEYS.iter().find(|(from, _)| *from == key).map_or(key, |(_, to)| (*to).to_owned());
                (key, to_native_keys(value))
            })
            .collect(),
        serde_json::Value::Array(items) => items.into_iter().map(to_native_keys).collect(),
        other => other,
    }
}

#[test]
fn matches_typescript_scene_and_clock_plans() {
    let catalog = Catalog::builtin();
    let mut count = 0;
    for line in include_str!("fixtures/scene-parity.jsonl").lines() {
        let fixture: Case = serde_json::from_str(line).unwrap();
        let name = &fixture.name;
        let table = toml::Table::try_from(to_native_keys(fixture.settings))
            .unwrap_or_else(|error| panic!("{name}: convert test settings to TOML: {error}"));
        let config = Config::from_table(table).config;
        let resolved = if let Some(now) = fixture.now {
            Ok(Some(Message::Clock(config.clock.resolve(&DateTime::parse_from_rfc3339(&now).unwrap()))))
        } else {
            let target = if let Some(target) = fixture.target {
                Some(SceneTarget { shader: target.shader_id, preset: target.preset })
            } else if let Some(launch) = fixture.launch {
                Some(catalog.select_target(&config, launch.override_id.as_deref(), launch.preview, launch.random))
            } else {
                let cycle = fixture.cycle.expect("every scene specifies its selection");
                catalog.pick_rotation(&config, cycle.random, cycle.exclude.as_deref())
            };
            target.map(|target| catalog.build_scene(&config, &target).map(Message::Scene)).transpose().map_err(|error| error.to_string())
        };
        let expected = match fixture.error {
            Some(error) => Err(error),
            None => Ok(fixture.expected.map(|reference| {
                let mut message = Message::parse(&reference.to_string()).unwrap();
                if let Message::Scene(scene) = &mut message {
                    scene.audio = false;
                }
                message
            })),
        };
        assert_eq!(resolved, expected, "{name}");
        count += 1;
    }
    assert_eq!(count, 151);
}

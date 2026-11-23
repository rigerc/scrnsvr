//! JSON-lines protocol between the main process and the renderer.
//!
//! stdin:  `{"type":"scene",...}` `{"type":"clock",...}` `{"type":"audio","value":[l,b,m,t]}` `{"type":"dismiss"}`
//! stdout: `{"type":"ready"}` once every output has presented a frame.
//!
//! Field handling deliberately matches the C++ renderer's lenient reader
//! (`native/renderer/json.hh`): missing or mistyped fields fall back to
//! defaults, booleans read as numbers and vice versa, and unknown message types
//! are ignored. The main process (`buildScenePlan`, `clockMessage`) is the
//! source of truth for every value, so the renderer never re-validates them.

use serde_json::{Map, Value, json};
use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum ProtocolError {
    #[error("malformed message: {0}")]
    Malformed(String),
    #[error("Scene has no shader source")]
    MissingSource,
}

/// A GL-ready uniform value: a scalar or a short vector, already normalized by
/// the main process (colors are RGB floats, selects are option indices).
#[derive(Debug, Clone, PartialEq)]
pub enum UniformValue {
    Scalar(f64),
    Vector(Vec<f64>),
}

impl UniformValue {
    fn from_json(value: &Value) -> Self {
        match value {
            Value::Array(items) => UniformValue::Vector(items.iter().map(|item| num(item, 0.0)).collect()),
            other => UniformValue::Scalar(num(other, 0.0)),
        }
    }

    /// Up to 16 floats, as the GL upload consumes them.
    pub fn floats(&self) -> Vec<f32> {
        match self {
            UniformValue::Scalar(value) => vec![*value as f32],
            UniformValue::Vector(items) => items.iter().take(16).map(|value| *value as f32).collect(),
        }
    }
}

/// One effect layer: intermediate passes followed by the final pass.
#[derive(Debug, Clone, PartialEq)]
pub struct EffectSpec {
    pub id: String,
    pub passes: Vec<String>,
    pub history: bool,
    pub uniforms: Vec<(String, UniformValue)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SceneSpec {
    /// Rotation entry key (`shader` or `shader/preset`), used in diagnostics.
    pub key: String,
    /// Complete fragment source, already wrapped by the caller.
    pub source: String,
    pub uniforms: Vec<(String, UniformValue)>,
    /// Built-ins read integrated phase as `uTime` with speed fixed at one.
    pub integrated: bool,
    pub audio: bool,
    pub effects: Vec<EffectSpec>,
}

impl SceneSpec {
    /// The scene's `speed` control, which drives integrated animation phase.
    pub fn speed(&self) -> f64 {
        self.uniforms
            .iter()
            .find(|(name, _)| name == "speed")
            .map(|(_, value)| match value {
                UniformValue::Scalar(value) => *value,
                UniformValue::Vector(_) => 1.0,
            })
            .unwrap_or(1.0)
    }
}

/// Clock style and text formatted by the caller.
#[derive(Debug, Clone, PartialEq)]
pub struct ClockSpec {
    pub enabled: bool,
    /// `center`, `top-left`, `bottom-right`, ...
    pub position: String,
    /// Pango family list, e.g. `"Georgia, Liberation Serif, serif"`.
    pub family: String,
    pub weight: i32,
    pub color: [f64; 3],
    pub opacity: f64,
    /// Percentages of the output's shorter side.
    pub size: f64,
    pub margin: f64,
    pub shadow: bool,
    pub time: String,
    pub period: String,
    pub date: String,
}

impl Default for ClockSpec {
    fn default() -> Self {
        Self {
            enabled: false,
            position: "center".into(),
            family: "sans-serif".into(),
            weight: 300,
            color: [1.0, 1.0, 1.0],
            opacity: 0.95,
            size: 12.0,
            margin: 5.0,
            shadow: true,
            time: String::new(),
            period: String::new(),
            date: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Message {
    Scene(SceneSpec),
    Clock(ClockSpec),
    /// Envelope values in order level, bass, mid, treble; at most four.
    Audio(Vec<f32>),
    Dismiss,
    /// Unknown or missing `type`; ignored like the C++ renderer does.
    Other,
}

impl Message {
    pub fn parse(line: &str) -> Result<Message, ProtocolError> {
        let value: Value = serde_json::from_str(line).map_err(|error| ProtocolError::Malformed(error.to_string()))?;
        Ok(match string(&value["type"], "").as_str() {
            "scene" => Message::Scene(parse_scene(&value)?),
            "clock" => Message::Clock(parse_clock(&value)),
            "audio" => Message::Audio(match &value["value"] {
                Value::Array(items) => items.iter().take(4).map(|item| num(item, 0.0) as f32).collect(),
                _ => Vec::new(),
            }),
            "dismiss" => Message::Dismiss,
            _ => Message::Other,
        })
    }
}

/// The renderer's only output message.
pub const READY_LINE: &str = r#"{"type":"ready"}"#;

/// One `--compile-check` input line: `{"id": "...", "source": "..."}`.
pub fn parse_compile_item(line: &str) -> Result<(String, String), ProtocolError> {
    let value: Value = serde_json::from_str(line).map_err(|error| ProtocolError::Malformed(error.to_string()))?;
    Ok((string(&value["id"], ""), string(&value["source"], "")))
}

/// One `--compile-check` result line.
pub fn compile_report(id: &str, error: Option<&str>) -> String {
    let mut report = Map::new();
    report.insert("id".into(), Value::String(id.into()));
    report.insert("ok".into(), Value::Bool(error.is_none()));
    if let Some(error) = error {
        report.insert("error".into(), Value::String(error.into()));
    }
    Value::Object(report).to_string()
}

fn uniforms_json(values: &[(String, UniformValue)]) -> Map<String, Value> {
    values
        .iter()
        .map(|(name, value)| {
            (
                name.clone(),
                match value {
                    UniformValue::Scalar(value) => json!(value),
                    UniformValue::Vector(values) => json!(values),
                },
            )
        })
        .collect()
}

/// The `scene` message that carries `scene` to the renderer.
pub fn scene_message(scene: &SceneSpec) -> Value {
    let effects: Vec<_> = scene
        .effects
        .iter()
        .map(|layer| {
            json!({
                "id": layer.id, "passes": layer.passes, "history": layer.history, "uniforms": uniforms_json(&layer.uniforms)
            })
        })
        .collect();
    json!({
        "type": "scene",
        "key": scene.key,
        "shader": { "source": scene.source, "uniforms": uniforms_json(&scene.uniforms), "integrated": scene.integrated, "audio": scene.audio },
        "effects": effects,
    })
}

fn num(value: &Value, fallback: f64) -> f64 {
    match value {
        Value::Number(number) => number.as_f64().unwrap_or(fallback),
        Value::Bool(flag) => f64::from(u8::from(*flag)),
        _ => fallback,
    }
}

fn flag(value: &Value, fallback: bool) -> bool {
    match value {
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|number| number != 0.0),
        _ => fallback,
    }
}

fn string(value: &Value, fallback: &str) -> String {
    value.as_str().unwrap_or(fallback).to_owned()
}

fn uniforms(value: &Value) -> Vec<(String, UniformValue)> {
    value
        .as_object()
        .map(|members| members.iter().map(|(name, value)| (name.clone(), UniformValue::from_json(value))).collect())
        .unwrap_or_default()
}

fn items(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or(&[])
}

fn parse_scene(message: &Value) -> Result<SceneSpec, ProtocolError> {
    let shader = &message["shader"];
    let source = string(&shader["source"], "");
    if source.is_empty() {
        return Err(ProtocolError::MissingSource);
    }
    let effects = items(&message["effects"])
        .iter()
        .map(|layer| EffectSpec {
            id: string(&layer["id"], ""),
            passes: items(&layer["passes"]).iter().map(|pass| string(pass, "")).collect(),
            history: flag(&layer["history"], false),
            uniforms: uniforms(&layer["uniforms"]),
        })
        .filter(|effect| !effect.passes.is_empty())
        .collect();
    Ok(SceneSpec {
        key: string(&message["key"], ""),
        source,
        uniforms: uniforms(&shader["uniforms"]),
        integrated: flag(&shader["integrated"], false),
        audio: flag(&shader["audio"], false),
        effects,
    })
}

fn parse_clock(message: &Value) -> ClockSpec {
    let defaults = ClockSpec::default();
    let mut color = defaults.color;
    for (slot, item) in color.iter_mut().zip(items(&message["color"])) {
        *slot = num(item, 1.0);
    }
    ClockSpec {
        enabled: flag(&message["enabled"], false),
        position: string(&message["position"], &defaults.position),
        family: string(&message["family"], &defaults.family),
        weight: num(&message["weight"], f64::from(defaults.weight)) as i32,
        color,
        opacity: num(&message["opacity"], defaults.opacity),
        size: num(&message["size"], defaults.size),
        margin: num(&message["margin"], defaults.margin),
        shadow: flag(&message["shadow"], defaults.shadow),
        time: string(&message["time"], ""),
        period: string(&message["period"], ""),
        date: string(&message["date"], ""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_scene_plan_with_effects_in_order() {
        let line = r#"{"type":"scene","key":"waves/Calm","shader":{"source":"void main(){}","uniforms":{"speed":0.5,"count":3,"mirror":1,"color1":[0.2,0.4,0.6]},"integrated":true,"audio":false},
            "effects":[{"id":"a","passes":["p1","p2","final"],"history":false,"uniforms":{"intensity":0.5}},{"id":"empty","passes":[]},{"id":"t","passes":["trails"],"history":true,"uniforms":{}}]}"#;
        let Message::Scene(scene) = Message::parse(line).unwrap() else { panic!("not a scene") };
        assert_eq!(scene.key, "waves/Calm");
        assert!(scene.integrated && !scene.audio);
        assert_eq!(scene.speed(), 0.5);
        let names: Vec<_> = scene.uniforms.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, ["speed", "count", "mirror", "color1"], "declaration order is preserved");
        assert_eq!(scene.uniforms[3].1, UniformValue::Vector(vec![0.2, 0.4, 0.6]));
        assert_eq!(scene.effects.len(), 2, "layers without passes are dropped");
        assert_eq!(scene.effects[0].passes, ["p1", "p2", "final"]);
        assert!(scene.effects[1].history);
    }

    #[test]
    fn rejects_scenes_without_source_and_malformed_lines() {
        assert_eq!(Message::parse(r#"{"type":"scene","shader":{}}"#), Err(ProtocolError::MissingSource));
        assert!(matches!(Message::parse("{not json"), Err(ProtocolError::Malformed(_))));
        assert_eq!(Message::parse(r#"{"type":"unknown"}"#), Ok(Message::Other));
        assert_eq!(Message::parse(r#"{"value":1}"#), Ok(Message::Other));
    }

    #[test]
    fn reads_booleans_and_numbers_interchangeably() {
        let Message::Scene(scene) =
            Message::parse(r#"{"type":"scene","shader":{"source":"x","uniforms":{"on":true},"integrated":1,"audio":0}}"#).unwrap()
        else {
            panic!()
        };
        assert!(scene.integrated && !scene.audio);
        assert_eq!(scene.uniforms[0].1, UniformValue::Scalar(1.0));
        assert_eq!(scene.speed(), 1.0, "speed defaults to one");
    }

    #[test]
    fn parses_clock_messages_with_defaults() {
        let Message::Clock(clock) = Message::parse(r#"{"type":"clock","enabled":true,"time":"12:30","color":[0.5],"weight":500}"#).unwrap()
        else {
            panic!()
        };
        assert!(clock.enabled && clock.shadow);
        assert_eq!(clock.position, "center");
        assert_eq!(clock.color, [0.5, 1.0, 1.0]);
        assert_eq!(clock.weight, 500);
        assert_eq!(clock.time, "12:30");
        assert_eq!(clock.opacity, 0.95);
    }

    #[test]
    fn parses_audio_and_dismiss() {
        assert_eq!(Message::parse(r#"{"type":"audio","value":[0.1,0.2,0.3,0.4,0.5]}"#), Ok(Message::Audio(vec![0.1, 0.2, 0.3, 0.4])));
        assert_eq!(Message::parse(r#"{"type":"audio"}"#), Ok(Message::Audio(vec![])));
        assert_eq!(Message::parse(r#"{"type":"dismiss"}"#), Ok(Message::Dismiss));
    }

    #[test]
    fn parses_compile_items() {
        assert_eq!(
            parse_compile_item(r#"{"id":"effect:a#0","source":"void main(){}"}"#),
            Ok(("effect:a#0".into(), "void main(){}".into()))
        );
        assert!(parse_compile_item("nope").is_err());
    }

    #[test]
    fn formats_compile_reports() {
        assert_eq!(compile_report("shader:a", None), r#"{"id":"shader:a","ok":true}"#);
        assert_eq!(compile_report("b\"", Some("line\n1")), r#"{"id":"b\"","ok":false,"error":"line\n1"}"#);
    }
}

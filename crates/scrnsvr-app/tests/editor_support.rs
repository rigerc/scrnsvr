//! The settings editor's two uses of the real renderer binary: GLES compile checks that map
//! driver errors to the user's lines, and deterministic thumbnail capture. Both skip with a note
//! on a machine without a usable GPU context.

use scrnsvr_core::catalog::Catalog;
use scrnsvr_core::compile_check::{CheckError, CompileChecker};
use scrnsvr_core::config::CustomShader;
use scrnsvr_core::diagnostics::map_driver_log;
use scrnsvr_core::source::custom_fragment_source_mapped;
use scrnsvr_core::thumbnail::{HEIGHT, WIDTH, cache_key, capture_png, clean_scene};

const RENDERER: &str = env!("CARGO_BIN_EXE_scrnsvr-renderer");

#[test]
fn the_renderer_compile_check_maps_a_driver_error_to_the_users_line() {
    let mut checker = CompileChecker::new(RENDERER);
    let broken = "// one\n/* two\n   three */\nvoid mainImage(out vec4 color, in vec2 fragCoord) {\n  color = vec4(missing_value);\n}";
    let mapped = custom_fragment_source_mapped(broken).unwrap();
    let log = match checker.check(&mapped.source) {
        Ok(Some(log)) => log,
        Ok(None) => panic!("a broken shader compiled"),
        Err(CheckError::Unavailable(reason)) => return eprintln!("skipping GPU test: {reason}"),
        Err(error) => panic!("{error}"),
    };
    let diagnostics = map_driver_log(&mapped, &log);
    assert!(diagnostics.iter().any(|diagnostic| diagnostic.line == Some(5)), "{diagnostics:?} from {log}");

    // The same long-lived child answers the next requests, including a good shader.
    let good = custom_fragment_source_mapped("void mainImage(out vec4 c, in vec2 p) { c = vec4(1.0); }").unwrap();
    assert_eq!(checker.check(&good.source), Ok(None));
    let again = checker.check(&mapped.source).unwrap().unwrap();
    assert_eq!(map_driver_log(&mapped, &again), diagnostics);
}

#[test]
fn captured_thumbnails_are_clean_deterministic_pngs_and_follow_the_source() {
    let directory = tempfile::tempdir().unwrap();
    let catalog = Catalog::builtin();
    let scene = clean_scene(catalog, &[], "plasma").unwrap();
    let (first, second) = (directory.path().join("a.png"), directory.path().join("b.png"));
    if let Err(error) = capture_png(RENDERER.as_ref(), &scene, 3, &first) {
        return eprintln!("skipping GPU test: {error}");
    }
    capture_png(RENDERER.as_ref(), &scene, 3, &second).unwrap();
    assert_eq!(std::fs::read(&first).unwrap(), std::fs::read(&second).unwrap(), "the same inputs give the same pixels");
    let decoder = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(&first).unwrap()));
    let reader = decoder.read_info().unwrap();
    assert_eq!((reader.info().width, reader.info().height), (WIDTH, HEIGHT));

    // A custom shader renders its own pixels, and its key changes with its source.
    let red = CustomShader { id: "custom-t".into(), title: "T".into(), source: "void main(){gl_FragColor=vec4(1.0,0.0,0.0,1.0);}".into() };
    let blue = CustomShader { source: "void main(){gl_FragColor=vec4(0.0,0.0,1.0,1.0);}".into(), ..red.clone() };
    let red_scene = clean_scene(catalog, &[red], "custom-t").unwrap();
    let blue_scene = clean_scene(catalog, &[blue], "custom-t").unwrap();
    assert_ne!(cache_key(&red_scene, 3), cache_key(&blue_scene, 3));
    let output = directory.path().join("red.png");
    capture_png(RENDERER.as_ref(), &red_scene, 3, &output).unwrap();
    let mut reader = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(&output).unwrap())).read_info().unwrap();
    let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
    reader.next_frame(&mut pixels).unwrap();
    assert_eq!(&pixels[..4], &[255, 0, 0, 255]);
}

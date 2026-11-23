//! Stand-in programs for headless tests.

use std::fs;
use std::io::Write as _;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

/// Write an executable shell script. Running it once before returning avoids `ETXTBSY`, which a
/// concurrent fork can cause while the freshly written file is still open in a sibling process.
pub fn script(path: &Path, body: &str) -> PathBuf {
    let mut file = fs::File::create(path).unwrap();
    file.write_all(format!("#!/bin/sh\n{body}\n").as_bytes()).unwrap();
    file.sync_all().unwrap();
    drop(file);
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    for _ in 0..50 {
        match Command::new(path).arg("--probe").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status() {
            Err(error) if error.raw_os_error() == Some(26) => std::thread::sleep(Duration::from_millis(20)),
            _ => break,
        }
    }
    path.to_path_buf()
}

/// A `scrnsvr-renderer` that writes a valid 640×360 capture whose pixels are `$FILL` bytes of the
/// scene's own length, so different scenes give different files, and logs every `--capture`.
pub fn renderer(root: &Path) -> PathBuf {
    let log = root.join("captures.log");
    script(
        &root.join("scrnsvr-renderer"),
        &format!(
            r#"[ "$1" = "--capture" ] || exit 0
out="$2"
scene=$(cat)
printf '%s\n' "$$ $scene" | cut -c1-60 >> '{}'
printf 'P7\nWIDTH 640\nHEIGHT 360\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n' > "$out"
head -c 921600 /dev/zero >> "$out""#,
            log.display()
        ),
    )
}

/// A `scrnsvr` that records its arguments and exits at once, or fails with a message.
pub fn scrnsvr(root: &Path, behavior: &str) -> PathBuf {
    script(
        &root.join("scrnsvr"),
        &format!("[ \"$1\" = \"--probe\" ] && exit 0\necho \"$@\" >> '{}'\n{behavior}", root.join("scrnsvr.log").display()),
    )
}

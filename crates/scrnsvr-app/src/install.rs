use std::env;
use std::fs;
use std::io;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

use crate::Result;

pub fn bin_link() -> Result<PathBuf> {
    let bin = env::var_os("XDG_BIN_HOME").filter(|path| !path.is_empty()).map(PathBuf::from);
    let bin = match bin {
        Some(bin) => bin,
        None => PathBuf::from(env::var_os("HOME").ok_or("HOME is unset; set XDG_BIN_HOME to install scrnsvr")?).join(".local/bin"),
    };
    Ok(std::path::absolute(bin)?.join("scrnsvr"))
}

pub fn current_distribution() -> Result<PathBuf> {
    match env::var_os("APPIMAGE").filter(|path| !path.is_empty()) {
        Some(path) => Ok(std::path::absolute(path)?),
        None => Ok(env::current_exe()?),
    }
}

pub fn is_scrnsvr_executable(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str()).is_some_and(|name| {
        let name = name.to_ascii_lowercase();
        name == "scrnsvr" || (name.starts_with("scrnsvr-") && name.ends_with(".appimage"))
    })
}

pub fn install(link: &Path, target: &Path, force: bool) -> Result<bool> {
    let dir = link.parent().ok_or("Cannot determine the install directory")?;
    fs::create_dir_all(dir)?;
    let exists = match fs::symlink_metadata(link) {
        Ok(metadata) => {
            if metadata.is_dir() {
                return Err(format!("{} is a directory", link.display()).into());
            }
            if metadata.is_symlink() {
                let current = fs::read_link(link)?;
                let resolved = dir.join(&current);
                if current == target || matches!((fs::canonicalize(&resolved), fs::canonicalize(target)), (Ok(a), Ok(b)) if a == b) {
                    return Ok(false);
                }
                if !force && !is_scrnsvr_executable(&current) {
                    return Err(format!("{} points to {}; use --force to replace it", link.display(), current.display()).into());
                }
            } else if !force {
                return Err(format!("{} is a regular entry; use --force to replace it", link.display()).into());
            }
            true
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.into()),
    };
    if exists {
        let temporary = tempfile::tempdir_in(dir)?;
        let staging = temporary.path().join("scrnsvr");
        symlink(target, &staging)?;
        fs::rename(staging, link)?;
    } else {
        symlink(target, link)?;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_and_updates_scrnsvr_links_including_dangling_appimages() {
        let tmp = tempfile::tempdir().unwrap();
        let link = tmp.path().join("bin/scrnsvr");
        let old = Path::new("/opt/Scrnsvr-0.5.0.AppImage");
        let new = Path::new("/opt/Scrnsvr-1.0.0.AppImage");
        assert!(install(&link, old, false).unwrap());
        assert!(!install(&link, old, false).unwrap());
        assert!(install(&link, new, false).unwrap());
        assert_eq!(fs::read_link(link).unwrap(), new);
    }

    #[test]
    fn protects_unrelated_links_and_files_unless_forced() {
        let tmp = tempfile::tempdir().unwrap();
        let link = tmp.path().join("scrnsvr");
        let unrelated = Path::new("/usr/bin/other");
        let current = Path::new("/opt/Scrnsvr-1.0.0.AppImage");
        symlink(unrelated, &link).unwrap();
        assert!(install(&link, current, false).unwrap_err().to_string().contains("--force"));
        assert_eq!(fs::read_link(&link).unwrap(), unrelated);
        assert!(install(&link, current, true).unwrap());
        fs::remove_file(&link).unwrap();
        fs::write(&link, b"existing script").unwrap();
        assert!(install(&link, current, false).is_err());
        assert_eq!(fs::read(&link).unwrap(), b"existing script");
        assert!(install(&link, current, true).unwrap());
        assert_eq!(fs::read_link(&link).unwrap(), current);
    }
}

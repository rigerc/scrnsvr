//! Assets compiled into the settings window: the Focus brand artwork and the Lucide icons that
//! Kit's default set leaves out. Everything else is served by Kit's own bundle.

use std::borrow::Cow;

use gpui_kit::{AssetSource, Result, SharedString};

macro_rules! embed {
    ($($path:literal),* $(,)?) => {
        &[$(($path, include_bytes!(concat!("../assets/", $path)) as &[u8])),*]
    };
}

const FILES: &[(&str, &[u8])] = embed![
    "brand/appicon.svg",
    "brand/appicon-small.svg",
    "brand/symbol.svg",
    "brand/wordmark.svg",
    "icons/bookmark.svg",
    "icons/clock.svg",
    "icons/code.svg",
    "icons/dices.svg",
    "icons/file-up.svg",
    "icons/images.svg",
    "icons/layers.svg",
    "icons/lock.svg",
    "icons/lock-open.svg",
    "icons/monitor.svg",
    "icons/pencil.svg",
    "icons/power.svg",
    "icons/rotate-ccw.svg",
    "icons/shuffle.svg",
    "icons/sliders-horizontal.svg",
    "icons/sparkles.svg",
    "icons/trash.svg",
];

pub struct Assets;

impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        match FILES.iter().find(|(name, _)| *name == path) {
            Some((_, bytes)) => Ok(Some(Cow::Borrowed(bytes))),
            None => gpui_kit::assets::Assets.load(path),
        }
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let mut names = gpui_kit::assets::Assets.list(path)?;
        names.extend(FILES.iter().filter(|(name, _)| name.starts_with(path)).map(|(name, _)| SharedString::from(*name)));
        Ok(names)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brand_artwork_and_extra_icons_load_and_kit_icons_still_resolve() {
        for (name, bytes) in FILES {
            assert!(std::str::from_utf8(bytes).is_ok_and(|text| text.contains("<svg")), "{name}");
            assert!(Assets.load(name).unwrap().is_some(), "{name}");
        }
        assert!(Assets.load("icons/search.svg").unwrap().is_some(), "Kit's default icons are still served");
    }
}

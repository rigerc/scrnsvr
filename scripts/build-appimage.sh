#!/usr/bin/env bash
# Build the native scrnsvr AppImage: release/native/Scrnsvr-<version>-x86_64.AppImage
#
#   scripts/build-appimage.sh [--skip-build] [--out <dir>]
#
# The AppImage bundles only scrnsvr, scrnsvr-renderer, scrnsvr-settings, the desktop entry and the
# icon. GPU, Wayland, pango/cairo and glib libraries come from the host (see README, "Building the
# native AppImage"). Packaging uses a pinned appimagetool and a pinned type2 runtime, both cached in
# target/appimage-cache and verified by SHA-256 before use.
#
# Environment:
#   SCRNSVR_MAX_GLIBC   fail if a binary needs a newer glibc symbol version (for example 2.35)
#   SOURCE_DATE_EPOCH   timestamp for the squashfs image (default: the HEAD commit time)
set -euo pipefail

APPIMAGETOOL_VERSION=1.9.1
APPIMAGETOOL_SHA256=ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0
RUNTIME_VERSION=20251108
RUNTIME_SHA256=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

skip_build=0
out_dir="$root/release/native"
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build) skip_build=1 ;;
    --out) out_dir=$(realpath -m "${2:?--out needs a directory}"); shift ;;
    -h | --help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "build-appimage: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done

arch=$(uname -m)
[ "$arch" = x86_64 ] || { echo "build-appimage: only x86_64 is supported (found $arch)" >&2; exit 1; }

version=$(awk '/^\[workspace\.package\]/ { in_pkg = 1; next } /^\[/ { in_pkg = 0 } in_pkg && $1 == "version" { gsub(/"/, "", $3); print $3; exit }' Cargo.toml)
[ -n "$version" ] || { echo "build-appimage: cannot read the workspace version from Cargo.toml" >&2; exit 1; }

if [ "$skip_build" = 0 ]; then
  cargo build --release --locked -p scrnsvr-app -p scrnsvr-settings
fi
bin_dir=${CARGO_TARGET_DIR:-$root/target}/release
for binary in scrnsvr scrnsvr-renderer scrnsvr-settings; do
  [ -x "$bin_dir/$binary" ] || { echo "build-appimage: missing $bin_dir/$binary" >&2; exit 1; }
done

# Report (and optionally enforce) the glibc floor; build in an older distro for a lower floor.
for binary in scrnsvr scrnsvr-renderer scrnsvr-settings; do
  max=$(objdump -T "$bin_dir/$binary" | grep -o 'GLIBC_[0-9.]*' | sed 's/GLIBC_//' | sort -uV | tail -1)
  echo "glibc floor: $binary needs GLIBC_$max"
  if [ -n "${SCRNSVR_MAX_GLIBC:-}" ] && [ "$(printf '%s\n%s\n' "$max" "$SCRNSVR_MAX_GLIBC" | sort -V | tail -1)" != "$SCRNSVR_MAX_GLIBC" ]; then
    echo "build-appimage: $binary needs GLIBC_$max, newer than SCRNSVR_MAX_GLIBC=$SCRNSVR_MAX_GLIBC" >&2
    exit 1
  fi
done

cache="$root/target/appimage-cache"
mkdir -p "$cache"
fetch() { # name url sha256
  local file="$cache/$1"
  if [ ! -f "$file" ] || ! echo "$3  $file" | sha256sum --check --status; then
    echo "Downloading $1"
    curl -fsSL --retry 3 -o "$file.part" "$2"
    echo "$3  $file.part" | sha256sum --check --status || { rm -f "$file.part"; echo "build-appimage: checksum mismatch for $1" >&2; exit 1; }
    mv "$file.part" "$file"
  fi
  chmod +x "$file"
}
tool="appimagetool-$APPIMAGETOOL_VERSION-x86_64.AppImage"
runtime="runtime-$RUNTIME_VERSION-x86_64"
fetch "$tool" "https://github.com/AppImage/appimagetool/releases/download/$APPIMAGETOOL_VERSION/appimagetool-x86_64.AppImage" "$APPIMAGETOOL_SHA256"
fetch "$runtime" "https://github.com/AppImage/type2-runtime/releases/download/$RUNTIME_VERSION/runtime-x86_64" "$RUNTIME_SHA256"

: "${SOURCE_DATE_EPOCH:=$(git log -1 --format=%ct 2>/dev/null || date +%s)}"
export SOURCE_DATE_EPOCH

appdir="$root/target/appimage/Scrnsvr.AppDir"
rm -rf "$appdir"
mkdir -p "$appdir/usr/bin" "$appdir/usr/share/applications" "$appdir/usr/share/icons/hicolor/scalable/apps"
for binary in scrnsvr scrnsvr-renderer scrnsvr-settings; do
  install -m 755 "$bin_dir/$binary" "$appdir/usr/bin/$binary"
done
install -m 644 packaging/native/scrnsvr.desktop "$appdir/scrnsvr.desktop"
install -m 644 packaging/native/scrnsvr.desktop "$appdir/usr/share/applications/scrnsvr.desktop"
install -m 644 assets/icon.svg "$appdir/scrnsvr.svg"
install -m 644 assets/icon.svg "$appdir/usr/share/icons/hicolor/scalable/apps/scrnsvr.svg"
ln -s scrnsvr.svg "$appdir/.DirIcon"
# AppRun is a symlink, so the kernel resolves /proc/self/exe to usr/bin/scrnsvr and the saver and
# settings binaries are found next to it. The runtime exports $APPIMAGE, which --install links to.
ln -s usr/bin/scrnsvr "$appdir/AppRun"
find "$appdir" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +

mkdir -p "$out_dir"
output="$out_dir/Scrnsvr-$version-x86_64.AppImage"
rm -f "$output"
run_tool() { ARCH=x86_64 "$cache/$tool" "$@"; }
# Use FUSE when it works; otherwise unpack the tool and run it directly.
if "$cache/$tool" --version >/dev/null 2>&1; then
  run_tool --no-appstream --runtime-file "$cache/$runtime" "$appdir" "$output"
else
  echo "FUSE is unavailable; running appimagetool with --appimage-extract-and-run"
  run_tool --appimage-extract-and-run --no-appstream --runtime-file "$cache/$runtime" "$appdir" "$output"
fi
chmod +x "$output"

sums="$out_dir/SHA256SUMS-$version-native.txt"
(cd "$out_dir" && sha256sum "$(basename "$output")" >"$sums")
echo "Built $output ($(du -h "$output" | cut -f1))"
cat "$sums"

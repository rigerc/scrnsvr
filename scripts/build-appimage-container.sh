#!/usr/bin/env bash
# Build the native scrnsvr AppImage against an older glibc (Ubuntu 22.04, glibc 2.35), so it starts
# on distributions as old as Ubuntu 22.04 / Debian 12 instead of requiring the build host's glibc.
#
#   scripts/build-appimage-container.sh [--out <dir>] [--rebuild-image] [--engine podman|docker]
#
# What it does:
#   1. builds (once, then reuses) the builder image from packaging/native/Containerfile.builder:
#      ubuntu:22.04 pinned by digest, the -dev packages, and rustup with a pinned rustc
#      (Rust 1.99.1, same as the reference host), rustup-init verified by SHA-256;
#   2. exports the committed HEAD with `git archive` into target/container-src/ (uncommitted
#      working-tree changes are NOT built, so the result is reproducible from a commit);
#   3. runs `cargo build --release --locked -p scrnsvr-app -p scrnsvr-settings` in the container
#      with the cargo registry/git cache in target/container-cargo-home/ and build output in
#      target/container-target/ (both survive between runs, so a rerun is incremental);
#   4. packages the three binaries on the host with
#      `SCRNSVR_MAX_GLIBC=2.35 scripts/build-appimage.sh --bin-dir ...`, writing
#      release/native/Scrnsvr-<version>-x86_64.AppImage and SHA256SUMS-<version>-native.txt.
#
# The AppImage still uses the host's pango/cairo/glib, GPU, Wayland and xkbcommon libraries, so the
# target machine needs the same runtime libraries as before (README, "Building the native AppImage").
#
# Environment:
#   SCRNSVR_MAX_GLIBC   glibc ceiling enforced on the binaries (default 2.35)
#   SCRNSVR_CONTAINER_ENGINE   podman or docker (default: podman if installed, else docker)
#   SCRNSVR_BUILDER_IMAGE      image tag (default localhost/scrnsvr-builder:ubuntu22.04-rust<version>)
#   SCRNSVR_JOBS               cargo -j value (default: all cores)
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

out_dir="$root/release/native"
rebuild_image=0
engine=${SCRNSVR_CONTAINER_ENGINE:-}
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out_dir=$(realpath -m "${2:?--out needs a directory}"); shift ;;
    --rebuild-image) rebuild_image=1 ;;
    --engine) engine=${2:?--engine needs podman or docker}; shift ;;
    -h | --help) sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "build-appimage-container: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -z "$engine" ]; then
  if command -v podman >/dev/null; then engine=podman; elif command -v docker >/dev/null; then engine=docker
  else echo "build-appimage-container: neither podman nor docker is installed" >&2; exit 1; fi
fi
command -v git >/dev/null && command -v objdump >/dev/null || { echo "build-appimage-container: git and objdump (binutils) are required" >&2; exit 1; }
: "${SCRNSVR_MAX_GLIBC:=2.35}"

rust_version=$(sed -n 's/^ARG RUST_VERSION=//p' packaging/native/Containerfile.builder)
image=${SCRNSVR_BUILDER_IMAGE:-localhost/scrnsvr-builder:ubuntu22.04-rust$rust_version}
containerfile="$root/packaging/native/Containerfile.builder"

if [ "$rebuild_image" = 1 ] || ! "$engine" image inspect "$image" >/dev/null 2>&1; then
  echo "== Building builder image $image"
  "$engine" build --pull=missing -t "$image" -f "$containerfile" "$root/packaging/native"
else
  echo "== Reusing builder image $image (--rebuild-image to refresh)"
fi

src="$root/target/container-src"
cargo_home="$root/target/container-cargo-home"
target_dir="$root/target/container-target"
echo "== Exporting $(git rev-parse --short HEAD) to $src"
rm -rf "$src"
mkdir -p "$src" "$cargo_home" "$target_dir"
git archive HEAD | tar -x -C "$src"
if ! git diff --quiet HEAD -- 2>/dev/null; then
  echo "note: the working tree has uncommitted changes; they are not part of this build" >&2
fi

# SOURCE_DATE_EPOCH keeps the AppImage timestamp tied to the commit (build-appimage.sh reads it from git).
echo "== cargo build --release --locked in $image"
start=$SECONDS
user_args=()
[ "$engine" = podman ] && user_args=(--userns=keep-id) || user_args=(--user "$(id -u):$(id -g)")
"$engine" run --rm "${user_args[@]}" \
  -v "$src:/src:Z" -v "$cargo_home:/cargo-home:Z" -v "$target_dir:/target:Z" \
  -e CARGO_HOME=/cargo-home -e CARGO_TARGET_DIR=/target -e HOME=/tmp \
  -e CARGO_TERM_COLOR=never -e CARGO_INCREMENTAL=0 \
  -w /src "$image" \
  bash -euc '
    export PATH=/opt/cargo/bin:$PATH
    cargo build --release --locked ${SCRNSVR_JOBS:+-j "$SCRNSVR_JOBS"} -p scrnsvr-app -p scrnsvr-settings
  '
echo "== container build finished in $((SECONDS - start))s"

echo "== Packaging with glibc ceiling $SCRNSVR_MAX_GLIBC"
SCRNSVR_MAX_GLIBC=$SCRNSVR_MAX_GLIBC bash "$root/scripts/build-appimage.sh" --skip-build --bin-dir "$target_dir/release" --out "$out_dir"

echo "== Dynamic libraries (NEEDED) per binary"
for binary in scrnsvr scrnsvr-renderer scrnsvr-settings; do
  printf '%s:' "$binary"
  readelf -d "$target_dir/release/$binary" | sed -n 's/.*NEEDED.*\[\(.*\)\]/ \1/p' | tr '\n' ','
  echo
done

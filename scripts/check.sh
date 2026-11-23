#!/usr/bin/env bash
# The checks a change must pass: tests, Clippy and formatting for the whole workspace.
#
#   scripts/check.sh
#
# - cargo test --workspace --locked: unit and integration tests, including the headless GPU tests
#   that compile every built-in shader and effect, and the frozen scene-parity fixtures.
#   GPU tests skip with a note when the machine has no usable EGL.
# - cargo clippy --workspace --all-targets --locked -D warnings
# - cargo fmt --all --check
#
# Building the settings crate pulls in GPUI (Vulkan) and takes a while the first time.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

echo "== cargo test"
cargo test --workspace --locked
echo "== cargo clippy"
cargo clippy --workspace --all-targets --locked -- -D warnings
echo "== cargo fmt"
cargo fmt --all --check
echo "All checks passed."

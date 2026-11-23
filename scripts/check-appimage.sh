#!/usr/bin/env bash
# Smoke-check a built native AppImage on a live Hyprland session.
#
#   scripts/check-appimage.sh [path/to/Scrnsvr-<version>-x86_64.AppImage]
#
# Everything the AppImage writes goes to a temporary XDG_CONFIG_HOME, XDG_STATE_HOME,
# XDG_CACHE_HOME, XDG_DATA_HOME, XDG_RUNTIME_DIR and XDG_BIN_HOME; the real Noctalia CLI and
# ~/.local/bin are never touched. The real Wayland socket is passed as an absolute path.
#
# Needs: hyprctl, grim, jq and a running Hyprland session. Artifacts (saver screenshot, logs) are
# kept in target/appimage-check/.
#   SCRNSVR_CHECK_OUTPUT        output for the screenshot (default HDMI-A-2, else the first output)
#   SCRNSVR_CHECK_THUMBNAILS    expected thumbnail count (default 41)
set -uo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
version=$(awk '/^\[workspace\.package\]/ { in_pkg = 1; next } /^\[/ { in_pkg = 0 } in_pkg && $1 == "version" { gsub(/"/, "", $3); print $3; exit }' "$root/Cargo.toml")
appimage=$(realpath "${1:-$root/release/native/Scrnsvr-$version-x86_64.AppImage}")
[ -x "$appimage" ] || { echo "check-appimage: $appimage is missing or not executable; run scripts/build-appimage.sh" >&2; exit 2; }
for tool in hyprctl grim jq; do
  command -v "$tool" >/dev/null || { echo "check-appimage: $tool is required" >&2; exit 2; }
done
[ -n "${WAYLAND_DISPLAY:-}" ] && [ -n "${XDG_RUNTIME_DIR:-}" ] || { echo "check-appimage: run inside a Wayland session" >&2; exit 2; }

real_socket=$WAYLAND_DISPLAY
case $real_socket in /*) ;; *) real_socket=$XDG_RUNTIME_DIR/$real_socket ;; esac
[ -S "$real_socket" ] || { echo "check-appimage: $real_socket is not a socket" >&2; exit 2; }

artifacts="$root/target/appimage-check"
rm -rf "$artifacts"
mkdir -p "$artifacts"
work=$(mktemp -d "$artifacts/work.XXXXXX")
runtime=$(mktemp -d /tmp/scrnsvr-check.XXXXXX) # short path: it holds sockets
[ -n "$runtime" ] && [ -d "$runtime" ] || { echo "check-appimage: could not create a runtime directory" >&2; exit 2; }
chmod 700 "$runtime"
mkdir -p "$work/config" "$work/state" "$work/cache" "$work/data" "$work/bin" "$work/fakebin"

# Run the AppImage with the isolated environment. hyprctl, grim and jq keep the real one.
app() {
  env XDG_CONFIG_HOME="$work/config" XDG_STATE_HOME="$work/state" XDG_CACHE_HOME="$work/cache" \
    XDG_DATA_HOME="$work/data" XDG_RUNTIME_DIR="$runtime" XDG_BIN_HOME="$work/bin" \
    WAYLAND_DISPLAY="$real_socket" "$@"
}
[ -e /dev/fuse ] || export APPIMAGE_EXTRACT_AND_RUN=1

pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null; done
  [ -f "$work/settings.pid" ] && kill "$(cat "$work/settings.pid")" 2>/dev/null
  # Never pkill with an empty pattern: it would match every process.
  [ -n "$runtime" ] && pkill -f "$runtime" 2>/dev/null
  rm -rf "$runtime" "$work"
}
trap cleanup EXIT

failures=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }
check() { # description, then a command; passes when it exits 0
  local description=$1
  shift
  if "$@"; then pass "$description"; else fail "$description"; fi
}
wait_for() { # seconds, command...
  local deadline=$((SECONDS + $1))
  shift
  while ! "$@" 2>/dev/null; do
    [ $SECONDS -lt $deadline ] && sleep 0.2 || return 1
  done
}
layer_present() { hyprctl layers -j | jq -e '[.. | objects | select(.namespace? == "scrnsvr")] | length > 0' >/dev/null; }
exit_code() { # run a command, print only its exit status
  "$@" >/dev/null 2>&1
  echo $?
}

echo "AppImage: $appimage ($(du -h "$appimage" | cut -f1))"

# --help
help_text=$(app "$appimage" --help 2>&1)
check "--help prints usage" grep -q '^Usage: scrnsvr' <<<"$help_text"

# --daemon was removed: exit 2 and a pointer to Noctalia.
daemon_out=$(app "$appimage" --daemon 2>&1)
daemon_rc=$?
check "--daemon exits 2 (got $daemon_rc)" test "$daemon_rc" = 2
check "--daemon points to the Noctalia setup" grep -q 'setup-noctalia' <<<"$daemon_out"

# --open / second --open / --dismiss
app "$appimage" --open >"$artifacts/open.log" 2>&1 &
saver=$!
pids+=("$saver")
check "--open maps the 'scrnsvr' layer surface" wait_for 20 layer_present
sleep 3 # let the fade-in finish
monitor=${SCRNSVR_CHECK_OUTPUT:-HDMI-A-2}
hyprctl monitors -j | jq -e --arg name "$monitor" 'any(.[]; .name == $name)' >/dev/null || monitor=$(hyprctl monitors -j | jq -r '.[0].name')
grim -o "$monitor" "$artifacts/saver.png" 2>"$artifacts/grim.log"
check "screenshot of $monitor written ($artifacts/saver.png)" test -s "$artifacts/saver.png"
second_rc=$(exit_code timeout 20 env XDG_CONFIG_HOME="$work/config" XDG_STATE_HOME="$work/state" XDG_RUNTIME_DIR="$runtime" WAYLAND_DISPLAY="$real_socket" "$appimage" --open)
check "second --open exits 0 (got $second_rc)" test "$second_rc" = 0
check "saver still running after the second --open" kill -0 "$saver"
app "$appimage" --dismiss >"$artifacts/dismiss.log" 2>&1
dismiss_rc=$?
check "--dismiss exits 0 (got $dismiss_rc)" test "$dismiss_rc" = 0
wait_for 15 bash -c "! kill -0 $saver"
wait "$saver"
saver_rc=$?
check "saver exits 0 after --dismiss (got $saver_rc)" test "$saver_rc" = 0
check "layer surface removed" bash -c "! hyprctl layers -j | jq -e '[.. | objects | select(.namespace? == \"scrnsvr\")] | length > 0' >/dev/null"

# --install links the stable path to the AppImage ($APPIMAGE), and is idempotent.
install_out=$(app "$appimage" --install 2>&1)
check "--install links $work/bin/scrnsvr to the AppImage" test "$(readlink "$work/bin/scrnsvr")" = "$appimage"
check "--install again reports an existing link" grep -q 'Already linked' <<<"$(app "$appimage" --install 2>&1)"
check "the linked path runs the AppImage" grep -q '^Usage: scrnsvr' <<<"$(app "$work/bin/scrnsvr" --help 2>&1)"

# --thumbnail
thumbs=${SCRNSVR_CHECK_THUMBNAILS:-41}
mkdir "$work/thumbs"
app "$appimage" --thumbnail --output "$work/thumbs" --frames 1 >"$artifacts/thumbnail.log" 2>&1
check "--thumbnail --frames 1 exits 0" test $? = 0
count=$(find "$work/thumbs" -name '*.png' -size +0 | wc -l)
check "--thumbnail wrote $thumbs PNGs (got $count)" test "$count" = "$thumbs"

# --setup-noctalia (dry run only) against a fake noctalia CLI that rejects every write.
cat >"$work/fakebin/noctalia" <<FAKE
#!/bin/sh
echo "\$@" >>"$work/noctalia.calls"
if [ "\$1 \$2 \$3" = "msg config-get idle" ]; then
  printf 'behavior_order = ["screen-off"]\npre_action_fade_seconds = 2.0\n\n[behavior.screen-off]\naction = "command"\ncommand = "hyprctl dispatch dpms off"\nenabled = true\ntimeout = 900.0\n'
  exit 0
fi
echo "fake noctalia: unexpected call: \$*" >&2
exit 1
FAKE
chmod +x "$work/fakebin/noctalia"
setup_out=$(PATH="$work/fakebin:$PATH" app "$appimage" --setup-noctalia 2>&1)
setup_rc=$?
check "--setup-noctalia dry run exits 0 (got $setup_rc)" test "$setup_rc" = 0
check "dry run proposes idle.behavior.scrnsvr with the installed link" grep -qF "$work/bin/scrnsvr --open" <<<"$setup_out"
check "dry run made no config-set call" bash -c "! grep -q config-set '$work/noctalia.calls'"

# Settings window: launch through Hyprland so it lands on the visible workspace.
cat >"$work/run-settings.sh" <<RUN
#!/bin/sh
echo \$\$ >"$work/settings.pid"
export XDG_CONFIG_HOME="$work/config" XDG_STATE_HOME="$work/state" XDG_CACHE_HOME="$work/cache"
export XDG_DATA_HOME="$work/data" XDG_RUNTIME_DIR="$runtime" XDG_BIN_HOME="$work/bin"
export WAYLAND_DISPLAY="$real_socket"
exec "$appimage" >"$artifacts/settings.log" 2>&1
RUN
chmod +x "$work/run-settings.sh"
hyprctl dispatch "hl.dsp.exec_cmd(\"$work/run-settings.sh\")" >/dev/null
settings_window() {
  hyprctl clients -j | jq -e '[.[] | select(.class == "scrnsvr-settings")] | length > 0' >/dev/null
}
check "settings opens a window with class scrnsvr-settings" wait_for 30 settings_window
settings_pid=$(hyprctl clients -j | jq -r '[.[] | select(.class == "scrnsvr-settings")][0].pid // empty')
sleep 2
[ -n "$settings_pid" ] && grim -o "$monitor" "$artifacts/settings.png" 2>>"$artifacts/grim.log"
[ -n "$settings_pid" ] && kill "$settings_pid" 2>/dev/null
[ -f "$work/settings.pid" ] && kill "$(cat "$work/settings.pid")" 2>/dev/null
check "settings window closes" wait_for 10 bash -c "! hyprctl clients -j | jq -e '[.[] | select(.class == \"scrnsvr-settings\")] | length > 0' >/dev/null"

echo
if [ "$failures" = 0 ]; then
  echo "All checks passed. Artifacts: $artifacts"
else
  echo "$failures check(s) failed. Logs: $artifacts"
fi
exit "$failures"

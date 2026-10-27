#!/bin/sh
# Checks the Mac install routes on a macOS CI runner: sh scripts/mac-install-check.sh <release|built|install|browser|shots>
# release: the current public release, fetched the way a browser and the install command fetch it.
# built: the signature of the app electron-builder just made in release/.
# install: site/install against the built zip, served locally, from a clean state.
# browser: the built disk image and zip with a browser's quarantine flag.
# shots: the download page as a Mac sees it, light and dark.
set -u

root="$(cd "$(dirname "$0")/.." && pwd)"
work="${RUNNER_TEMP:-/tmp}/mac-install"
mkdir -p "$work"
port=8765
latest="${INKLING_RELEASE_URL:-https://github.com/dominikkoenitzer/Inkling/releases/latest/download}"
failed=0

line() { printf '\n== %s\n' "$1"; }

# Runs a command for at most $1 seconds; a Gatekeeper dialog can keep open or hdiutil waiting forever.
bounded() {
  secs="$1"
  shift
  "$@" &
  bpid=$!
  n=0
  while kill -0 "$bpid" 2>/dev/null && [ "$n" -lt "$secs" ]; do sleep 1; n=$((n + 1)); done
  if kill -0 "$bpid" 2>/dev/null; then
    kill "$bpid" 2>/dev/null
    sleep 1
    kill -9 "$bpid" 2>/dev/null
    echo "(still waiting after $secs s, stopped)"
    return 124
  fi
  wait "$bpid"
}

check() {
  what="$1"
  shift
  if "$@"; then echo "pass: $what"; else echo "FAIL: $what"; failed=1; fi
}

# Marks a file the way a browser marks a download.
quarantine() { xattr -w com.apple.quarantine "0083;$(printf %x "$(date +%s)");browser;" "$1"; }

no_quarantine() { ! xattr -r -l "$1" 2>/dev/null | grep -q com.apple.quarantine; }

running() { pgrep -f "Inkling.app/Contents/MacOS/Inkling" | head -1; }

stop_all() {
  for pid in $(pgrep -f "Inkling.app/Contents/MacOS/Inkling"); do kill "$pid" 2>/dev/null; done
  n=0
  while [ -n "$(running)" ] && [ $n -lt 10 ]; do sleep 1; n=$((n + 1)); done
  for pid in $(pgrep -f "Inkling.app/Contents/MacOS/Inkling"); do kill -9 "$pid" 2>/dev/null; done
  pkill -f "Inkling Helper" 2>/dev/null
  pkill -x CoreServicesUIAgent 2>/dev/null
  return 0
}

report() {
  app="$1"
  line "$2"
  echo "runner: $(uname -m), macOS $(sw_vers -productVersion)"
  echo "app: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist"), archs $(lipo -archs "$app/Contents/MacOS/Inkling" 2>&1)"
  echo "quarantine flag on the app: $(xattr -p com.apple.quarantine "$app" 2>/dev/null || echo none)"
  echo "-- codesign -dv --verbose=4"
  codesign -dv --verbose=4 "$app" 2>&1
  echo "-- codesign --verify --deep --strict"
  codesign --verify --deep --strict --verbose=2 "$app" 2>&1
  echo "exit $?"
  echo "-- spctl -a -vvv -t exec"
  spctl -a -vvv -t exec "$app" 2>&1
  echo "exit $?"
  if command -v syspolicy_check >/dev/null 2>&1; then
    echo "-- syspolicy_check distribution"
    bounded 120 syspolicy_check distribution "$app" >"$work/policy.txt" 2>&1
    rc=$?
    head -40 "$work/policy.txt"
    echo "exit $rc"
  fi
}

# Opens the app as a double-click would and records what Gatekeeper did.
try_open() {
  app="$1"
  tag="$2"
  stop_all
  since="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "-- open"
  bounded 15 open "$app" 2>&1
  echo "exit $?"
  sleep 10
  # A launch Gatekeeper holds keeps its main process but never starts the helper processes.
  if [ -n "$(pgrep -f 'Inkling Helper')" ]; then
    echo "result: Inkling opened after 10 s"
  elif [ -n "$(running)" ]; then
    echo "result: Inkling is held at launch and did not open"
  else
    echo "result: Inkling did not start"
  fi
  screencapture -x "$work/screen-$tag.png" 2>/dev/null || echo "no screen capture"
  echo "-- Gatekeeper log"
  bounded 180 log show --start "$since" --style compact \
    --predicate 'process == "syspolicyd" OR process == "CoreServicesUIAgent" OR subsystem == "com.apple.syspolicy"' \
    2>/dev/null >"$work/gk-$tag.txt"
  grep -iE 'gk |gatekeeper|malware|damaged|notar|prompt|evaluat|assess|translocat|reject|adhoc|unsigned' "$work/gk-$tag.txt" | tail -30
  stop_all
}

# Mounts a disk image and copies the app out, as a drag to Applications does.
dmg_route() {
  dmg="$1"
  tag="$2"
  mnt="$work/mnt-$tag"
  dst="$work/$tag"
  rm -rf "$dst"
  mkdir -p "$mnt" "$dst"
  bounded 300 hdiutil attach -nobrowse -readonly -mountpoint "$mnt" "$dmg" >/dev/null || { echo "the disk image did not mount"; return 1; }
  cp -R "$mnt/Inkling.app" "$dst/"
  hdiutil detach "$mnt" >/dev/null || hdiutil detach -force "$mnt" >/dev/null
  if xattr -p com.apple.quarantine "$dst/Inkling.app" >/dev/null 2>&1; then
    echo "the copied app kept the image's quarantine flag"
  else
    quarantine "$dst/Inkling.app"
    echo "the copied app had no flag; set it by hand, as a drag from a flagged image does"
  fi
  report "$dst/Inkling.app" "$3"
  try_open "$dst/Inkling.app" "$tag"
}

# Unpacks a flagged zip the way the system's archive tool does; ditto carries the flag over.
zip_route() {
  dst="$work/$2"
  rm -rf "$dst"
  mkdir -p "$dst"
  ditto -x -k "$1" "$dst"
  if xattr -p com.apple.quarantine "$dst/Inkling.app" >/dev/null 2>&1; then
    echo "the unpacked app kept the zip's quarantine flag"
  else
    quarantine "$dst/Inkling.app"
    echo "the unpacked app had no flag; set it by hand, as the archive tool does"
  fi
  report "$dst/Inkling.app" "$3"
  try_open "$dst/Inkling.app" "$2"
}

run_install() {
  bounded 300 env HOME="$1" INKLING_ZIP_URL="$2" sh "$root/site/install" >"$work/out.txt" 2>"$work/err.txt"
  rc=$?
  sed 's/^/  out: /' "$work/out.txt"
  sed 's/^/  err: /' "$work/err.txt"
  echo "  exit $rc"
  return $rc
}

fails_with_one_line() { ! run_install "$@" && [ "$(wc -l <"$work/err.txt")" -eq 1 ]; }

plain_output() { ! grep -q "$(printf '\033')" "$work/out.txt" "$work/err.txt"; }

alive_for_10s() {
  sleep 10
  [ -n "$(running)" ]
}

launch_with_profile() {
  prof="$work/profile-$1"
  rm -rf "$prof"
  mkdir -p "$prof"
  env -u ELECTRON_RUN_AS_NODE INKLING_USERDATA="$prof" "$2/Contents/MacOS/Inkling" >"$work/app-$1.log" 2>&1 &
  echo $! >"$work/app.pid"
}

starts_and_stays_up() {
  launch_with_profile "$1" "$2"
  pid="$(cat "$work/app.pid")"
  sleep 10
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "  the app exited; its log:"
    sed 's/^/  /' "$work/app-$1.log" | tail -20
    return 1
  fi
  echo "  profile after 10 s: $(ls "$work/profile-$1" | tr '\n' ' ')"
  stop_all
  [ -f "$work/profile-$1/inkling.db" ]
}

stage_release() {
  line "Gatekeeper on this runner"
  spctl --status 2>&1
  if ! spctl --status 2>&1 | grep -q enabled; then
    sudo spctl --global-enable 2>&1 || sudo spctl --master-enable 2>&1
    echo "after enabling: $(spctl --status 2>&1)"
  fi
  d="$work/release"
  rm -rf "$d"
  mkdir -p "$d"
  for f in Inkling-mac.dmg Inkling-mac.zip; do
    curl -fsSL -o "$d/$f" "$latest/$f" || { echo "could not fetch $f"; return 1; }
  done
  ls -l "$d"
  quarantine "$d/Inkling-mac.dmg"
  quarantine "$d/Inkling-mac.zip"
  dmg_route "$d/Inkling-mac.dmg" release-dmg "Current release, disk image from a browser"
  zip_route "$d/Inkling-mac.zip" release-zip "Current release, zip from a browser"

  line "Current release, install command with the public address"
  stop_all
  rm -rf /Applications/Inkling.app
  mkdir -p "$work/home-release"
  run_install "$work/home-release" "$latest/Inkling-mac.zip"
  stop_all

  line "Current release, unpacked without a quarantine flag and started directly"
  plain="$work/release-plain"
  rm -rf "$plain"
  mkdir -p "$plain"
  ditto -x -k --noqtn "$d/Inkling-mac.zip" "$plain"
  if starts_and_stays_up release "$plain/Inkling.app"; then echo "result: it starts"; else echo "result: it does not start"; fi
  rm -rf /Applications/Inkling.app
  return 0
}

stage_built() {
  app="$(find "$root/release" -maxdepth 2 -name Inkling.app -type d | head -1)"
  ls -l "$root/release"
  report "$app" "Built app"
  check "built app is universal" sh -c "lipo -archs '$app/Contents/MacOS/Inkling' | grep -q x86_64 && lipo -archs '$app/Contents/MacOS/Inkling' | grep -q arm64"
  check "built app has an ad-hoc signature" sh -c "codesign -dv '$app' 2>&1 | grep -q 'Signature=adhoc'"
  check "built app passes codesign --verify --deep --strict" codesign --verify --deep --strict "$app"
  return $failed
}

stage_install() {
  serve="$work/serve"
  rm -rf "$serve"
  mkdir -p "$serve"
  ln -s "$root/release/Inkling-mac.zip" "$serve/Inkling-mac.zip"
  head -c 1000000 "$root/release/Inkling-mac.zip" >"$serve/broken.zip"
  (cd "$serve" && exec python3 -m http.server "$port" --bind 127.0.0.1) >/dev/null 2>&1 &
  server=$!
  trap 'kill $server 2>/dev/null' EXIT
  n=0
  until curl -fsI "http://127.0.0.1:$port/Inkling-mac.zip" >/dev/null 2>&1; do
    n=$((n + 1))
    [ $n -gt 20 ] && { echo "the local server did not start"; return 1; }
    sleep 1
  done
  url="http://127.0.0.1:$port/Inkling-mac.zip"
  app=/Applications/Inkling.app
  stop_all
  rm -rf "$app" "$HOME/Applications/Inkling.app"

  line "No write access to /Applications"
  ls -ld /Applications
  mode="$(stat -f %Lp /Applications)"
  sudo chmod 755 /Applications
  if [ -w /Applications ]; then
    echo "skipped: /Applications stays writable for this user"
  else
    mkdir -p "$work/home-a"
    check "installs without sudo" run_install "$work/home-a" "$url"
    check "app is in ~/Applications" test -x "$work/home-a/Applications/Inkling.app/Contents/MacOS/Inkling"
    check "nothing went into /Applications" test ! -e "$app"
    check "the command opened it and it stays up" alive_for_10s
    stop_all
  fi
  sudo chmod "$mode" /Applications

  line "Clean install into /Applications"
  mkdir -p "$work/home-b"
  check "installs" run_install "$work/home-b" "$url"
  check "output is plain text" plain_output
  check "app is in /Applications" test -x "$app/Contents/MacOS/Inkling"
  check "codesign --verify --deep --strict passes" codesign --verify --deep --strict "$app"
  check "no quarantine flag anywhere in the app" no_quarantine "$app"
  check "the command opened it and it stays up" alive_for_10s
  stop_all
  report "$app" "Installed by the command"
  check "starts with a throwaway profile and stays up for 10 s" starts_and_stays_up fresh "$app"

  line "Inkling is open while the command runs"
  launch_with_profile open "$app"
  sleep 10
  check "refuses with one plain sentence" fails_with_one_line "$work/home-b" "$url"
  stop_all

  line "Running it again updates"
  before="$(stat -f %i "$app")"
  check "installs again" run_install "$work/home-b" "$url"
  stop_all
  check "the old copy was replaced" test "$(stat -f %i "$app")" != "$before"
  check "codesign --verify --deep --strict passes" codesign --verify --deep --strict "$app"

  line "A failed download leaves the old copy alone"
  before="$(stat -f %i "$app")"
  check "a missing file fails with one plain sentence" fails_with_one_line "$work/home-b" "http://127.0.0.1:$port/missing.zip"
  check "a broken zip fails with one plain sentence" fails_with_one_line "$work/home-b" "http://127.0.0.1:$port/broken.zip"
  check "the old copy is untouched" test "$(stat -f %i "$app")" = "$before"
  check "no half-made copies are left" test -z "$(find /Applications -maxdepth 1 -name '.inkling-*')"
  return $failed
}

stage_browser() {
  d="$work/built"
  rm -rf "$d"
  mkdir -p "$d"
  cp "$root/release/Inkling-mac.dmg" "$root/release/Inkling-mac.zip" "$d/"
  quarantine "$d/Inkling-mac.dmg"
  quarantine "$d/Inkling-mac.zip"
  dmg_route "$d/Inkling-mac.dmg" built-dmg "This build, disk image from a browser"
  line "Privacy & Security after the blocked launch"
  bounded 20 open "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Security"
  sleep 8
  screencapture -x "$work/screen-settings.png" 2>/dev/null || echo "no screen capture"
  bounded 20 osascript -e 'quit app "System Settings"' >/dev/null 2>&1
  zip_route "$d/Inkling-mac.zip" built-zip "This build, zip from a browser"
  return 0
}

stage_shots() {
  (cd "$root/site" && exec python3 -m http.server 8766 --bind 127.0.0.1) >/dev/null 2>&1 &
  server=$!
  trap 'kill $server 2>/dev/null' EXIT
  sleep 2
  shot="$work/shot"
  mkdir -p "$shot"
  cat >"$shot/main.js" <<'EOF'
const { app, BrowserWindow, nativeTheme } = require('electron')
const [url, out, width, height, theme] = process.argv.slice(-5)
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  nativeTheme.themeSource = theme
  const win = new BrowserWindow({ width: +width, height: +height, useContentSize: true, x: 0, y: 0 })
  await win.loadURL(url)
  await new Promise((r) => setTimeout(r, 1500))
  const fs = require('fs')
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG())
  await win.webContents.executeJavaScript('document.querySelector(".closing").scrollIntoView({ block: "center", behavior: "instant" })')
  await new Promise((r) => setTimeout(r, 500))
  fs.writeFileSync(out.replace('.png', '-end.png'), (await win.webContents.capturePage()).toPNG())
  app.quit()
})
EOF
  echo '{"name":"shot","main":"main.js"}' >"$shot/package.json"
  electron="$root/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
  for spec in "1440 900 light" "1440 900 dark" "1100 800 light" "820 1000 dark" "390 844 light" "360 780 dark"; do
    set -- $spec
    if ! bounded 120 env -u ELECTRON_RUN_AS_NODE "$electron" "$shot" "http://127.0.0.1:8766/" "$work/page-$1-$3.png" "$1" "$2" "$3" >/dev/null 2>&1; then
      # The first launch on a fresh runner can stall once; keep a picture of the screen, then try again.
      screencapture -x "$work/screen-stall-$1-$3.png" 2>/dev/null
      pkill -f "$shot" 2>/dev/null
      bounded 300 env -u ELECTRON_RUN_AS_NODE "$electron" "$shot" "http://127.0.0.1:8766/" "$work/page-$1-$3.png" "$1" "$2" "$3" >/dev/null 2>&1
    fi
    check "page shot $1 $3" test -s "$work/page-$1-$3.png"
    check "page shot $1 $3, closing section" test -s "$work/page-$1-$3-end.png"
  done
  return $failed
}

case "${1:-}" in
  release) stage_release ;;
  built) stage_built ;;
  install) stage_install ;;
  browser) stage_browser ;;
  shots) stage_shots ;;
  *) echo "usage: mac-install-check.sh release|built|install|browser|shots" >&2; exit 2 ;;
esac

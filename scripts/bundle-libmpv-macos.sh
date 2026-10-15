#!/bin/bash
# Copy Homebrew's libmpv and every dylib it needs into
# apps/app/src-tauri/libmpv-macos/, rewritten to find each other beside
# themselves and ad-hoc signed, so the .app runs without Homebrew's mpv:
#
#   scripts/bundle-libmpv-macos.sh
#   cd apps/app && pnpm tauri build --config src-tauri/tauri.macos-bundle.conf.json
#
# The Mac counterpart of scripts/fetch-libmpv.mjs, minus its pinning: this
# bundles whatever mpv Homebrew has, so it is for your own builds. A release
# wants a pinned, hash-checked build, and note that Homebrew's mpv and ffmpeg
# are GPL (what the Windows build ships is too).
set -euo pipefail

out="$(cd "$(dirname "$0")/.." && pwd)/apps/app/src-tauri/libmpv-macos"

command -v brew >/dev/null || { echo "needs Homebrew (https://brew.sh)" >&2; exit 1; }
brew list mpv >/dev/null 2>&1 || brew install mpv
command -v dylibbundler >/dev/null || brew install dylibbundler

prefix="$(brew --prefix)"
rm -rf "$out"
mkdir -p "$out"
cp -L "$(brew --prefix mpv)/lib/libmpv.dylib" "$out/libmpv.dylib"
chmod u+w "$out/libmpv.dylib"

# -b bundle, -of overwrite, -p the prefix each library is told to find the
# others at (beside itself), -s where @rpath libraries are looked for.
dylibbundler -of -b -x "$out/libmpv.dylib" -d "$out" -p @loader_path/ -s "$prefix/lib"
# Rewriting invalidates a signature, and Apple Silicon will not load unsigned code.
codesign --force --sign - "$out"/*.dylib

if otool -L "$out"/*.dylib | grep -q "$prefix"; then
  echo "✗ something in $out still points into Homebrew:" >&2
  otool -L "$out"/*.dylib | grep "$prefix" >&2
  exit 1
fi
echo "✓ $(ls "$out" | wc -l | tr -d ' ') libraries in $out, none pointing into Homebrew"

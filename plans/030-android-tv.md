# Plan 030: BlammyTV on Android TV and Fire TV

**Status: DECIDED** (2026-10-27). The public
roadmap's "Later" item. Research: a read-only survey of the June branch, the
stack options, competitors and distribution (full report kept outside the
repo; the claims that decide anything are below with their sources).

## Decided (Adam, 2026-10-27)

- **Same app, as little drift as possible.** Tauri 2's Android target with
  today's React UI and TypeScript logic. Per platform: only the player layer
  and a remote-friendly (10-foot) layer over the same screens. CI builds the
  Android app on every push, so a change that breaks TV fails at once.

Rejected for that reason: a native Kotlin app (Compose for TV), about 3x the
work and every feature built twice; React Native for TV, about 2.5x and a
second UI (but see the open question).

## Vega OS: not in the first release (Adam, 2026-10-27)

Decided: Fire OS plus Google TV / Android TV is the first TV release. The
newest Vega sticks are left out; reaching them would need a second UI.
Skipped, not shelved for a date: revisit only if people ask for it in the
Discord, or Amazon moves existing Fire OS devices to Vega.

Amazon says all future Fire TV sticks run **Vega OS**, which runs no Android
apps and allows no sideloading: already the Fire TV Stick 4K Select, HD (2026)
and 4K (2026). The 4K Max, the Cube, Fire TV smart TVs and older sticks still
run Fire OS (Android). (Secondary sources: developer.amazon.com was blocked
from the research container.) Vega runs React Native apps.

So the same-app route reaches Google TV / Android TV boxes and Fire OS
devices, not the newest Fire sticks. Reaching Vega means React Native for TV,
a second UI codebase.

## What exists: the June branch

`origin/claude/android-tv` (tip `7470cca2`, 2026-06-27 to 06-30, 186
commits): Tauri 2 Android, the React UI in the system WebView, playback in
Media3 1.4.1 from `MainActivity.kt` behind a raw JS interface, D-pad
navigation (norigin) for the guide, Settings and episode lists, an on-screen
keyboard, and a "set up from your phone" QR flow serving a small page on the
TV (`config_server.rs`). Emulator only, never a real device; it hit an
out-of-memory crash near 192MB of heap. Main has moved 1331 commits since:
2 of its 54 frontend files survive. Kept as reference: the Gradle project,
the art, the Media3 wiring, `config_server.rs`, the rustls-off-Windows TLS
switch, and its list of setup problems.

## The shape

- **Player:** Media3 (ExoPlayer) behind a proper Tauri plugin for v1: plays
  TS, MKV and HLS live, uses the device's own decoders, passes HDR and Dolby
  Vision through, with the FFmpeg add-on for AC-3/E-AC-3/DTS/TrueHD. libmpv on
  Android (`--wid` takes an `android.view.Surface`) is the later option for
  parity with the desktop's mpv; its HDR path under `vo=gpu` drops 10-bit to
  8, per mpv's manual.
- **Rust:** mostly portable already (non-Windows fallbacks, the mobile entry
  point in `lib.rs`). reqwest's `native-tls` means OpenSSL on Android: use
  rustls off Windows, as the June branch did. Tauri's updater and
  window-state plugins don't support Android.
- **Shared unchanged:** `m3u.ts`, `xmltv.ts`, `epg.ts`, `epgWindow.ts`,
  `ending.ts`, `mvGrid.ts`, and every source through `lib/http.ts`.
- **The remote:** `RowScroller`, `tabKeys` (Segmented, Rail), `SourceList`,
  the player's key map and `viewStack` already work with arrow keys. The gap
  is the Guide grid (programme cells take click and hover only), up/down
  between rows, a focus version of everything that only appears on hover,
  text entry (the QR setup instead of 36 inputs), and a TV style layer
  (no glass blur, overscan margins). The manifest needs
  `touchscreen required="false"` and a banner beyond Tauri's template.
- **Distribution:** sideloaded APK (Downloader codes) for Fire OS and Google TV
  boxes; Google's developer verification doesn't cover TV yet and ADB
  installs are exempt. Updates: each APK install needs the user's OK; the
  frontend hot channel may work unchanged (`frontend.rs` is platform-neutral,
  unverified on Android).

## First release

Live TV only: the Guide, favorites, channel up/down, the player, and QR
setup. Not in it: Multi-View, Stream, Sports' theater, Trakt and MyAnimeList.

## Phase 0: measure on a real device first

One day on a Fire TV Stick 4K (2023, Fire OS 8) with a debug build: the
WebView's version (Fire OS 8 tablets ship 124; TV unknown), Guide scroll fps,
memory after a full XMLTV load on a big playlist, and HEVC playback plus how
many videos it decodes at once. Also Stream's shelf hero (plan 031): its glow
blurs a moving layer (32px) and its cards animate their width, so take a
frame trace of a slide there before it ships on TV. Needs the hardware; nothing here measured a
real TV.

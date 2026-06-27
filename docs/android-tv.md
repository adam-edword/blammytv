# Android TV port — plan & status

> Working branch: `claude/android-tv`. This is an R&D effort; the Windows app on
> `main` is unaffected (the player stays `#[cfg(windows)]`).

## The shape of the problem

Tauri 2 targets Android, so the **React frontend and all app logic port for free**
(the `Live TV | Stream | Discover` UI, the EPG guide, AIOStreams/Xtream fetching,
config-building, favorites/recents, settings, profile). The two hard parts do
**not** port:

1. **The player.** `src-tauri/src/comp.rs` is Windows-only — DirectComposition +
   WebView2 + a Win32 child HWND + `libmpv-2.dll`. None of that exists on Android.
   The in-page `<video>` fallback can't play the real streams (IPTV MPEG-TS +
   debrid MKV), which is the whole reason mpv exists. So Android needs its own
   native player.
2. **The remote.** Android TV is driven by a **D-pad**, not a cursor — there is no
   hover and no pointer. Every hover affordance (the hero hover-preview, the
   favorites star that appears on row hover) and every click target has to become
   **focus-based** with spatial navigation and visible focus rings. This is a UX
   redesign, not a config flag.

## Milestones

### Milestone 0 — UI on Android (foundation) ← *in progress*

Goal: get the React app rendering in an Android APK, player stubbed. Proves the
port and gives a base to build on.

Done on this branch (Rust prep so a non-Windows target compiles):

- `mod mpv` and `mod comp` are now both `#[cfg(windows)]`; all `mpv::` usage is
  gated, and `comp_*` Tauri commands are already no-ops off Windows.
- reqwest's TLS backend is pinned per-target: **native-tls (Schannel) on
  Windows** (keeps the Cloudflare/JA3 fix), **rustls on everything else** (pure
  Rust — no OpenSSL — so it cross-compiles to Android cleanly).

You run on your machine (needs the Android toolchain — can't be built/tested in
the cloud sandbox):

```bash
# one-time toolchain
#  - Android Studio + SDK + NDK
#  - Java 17+ (JDK)
#  - rustup target add aarch64-linux-android armv7-linux-androideabi \
#       i686-linux-android x86_64-linux-android
#  - set ANDROID_HOME and NDK_HOME

cd apps/app
pnpm tauri android init      # generates src-tauri/gen/android (commit it)
pnpm tauri android dev       # build + run on a device/emulator (TV or phone)
```

Expected at the end of M0: the app launches on Android, the UI renders on demo
data, AIOStreams/Xtream fetches work — **playback does nothing yet** (the
`comp_*` commands are no-ops). That's success for M0.

### Milestone 1 — the player (the real R&D)

A **Tauri Android plugin (Kotlin)** that adds a `SurfaceView` beneath the
transparent Tauri WebView and drives playback into it — the Android analog of the
DirectComposition trick. Two candidate engines:

- **libmpv** (compiled `.so` for Android, JNI bridge) — closest to parity with
  the Windows player (same demuxers/codecs, HDR, 4K), but more integration work.
- **ExoPlayer / Media3** — native Android, easy `SurfaceView` integration, but
  codec/container coverage (raw TS, some MKV) is weaker and varies by device.

Bridge the same control surface the overlay already speaks (play/pause/seek/
tracks/volume) over the existing message channel, so the React overlay barely
changes. Start by prototyping *just* the player + a hardcoded URL to de-risk
before wiring the UI.

### Milestone 2 — remote / D-pad navigation

- Make every interactive element focusable; add visible focus rings.
- Spatial navigation (arrow-key/D-pad) across the guide grid, rows, tabs, and
  modals — either the browser's experimental spatial nav or a small JS library.
- Replace hover-only affordances: surface the favorite toggle and the
  hero-preview on **focus**, not hover.
- 10-foot UI pass: larger hit targets, type scale, safe-area/overscan margins.

## Known gotchas

- **Distribution / updates.** No GitHub-Releases auto-updater on Android; it's APK
  sideloading (normal for Android TV, but a different flow — likely a "download
  new APK" prompt or an F-Droid-style repo).
- **Performance.** Android TV boxes are often weak; the WebView + any
  `backdrop-filter`/blur needs a hard perf pass (already a known sore spot).
- **TLS fingerprinting.** The Schannel fix is Windows-only; Android's TLS
  fingerprint differs, so a Cloudflare-403 host could need its own treatment
  there (rustls + browser headers may or may not be enough).
- **Window-state plugin** is desktop-only; it'll need gating for the mobile build.

## Why "prototype the player first"

Everything else is known-tractable (port the UI, add focus nav). The player is
the only true unknown — if libmpv-into-a-SurfaceView-under-the-webview feels good,
the project is real; if it's painful, better to learn that on day one than after
porting the whole UI.

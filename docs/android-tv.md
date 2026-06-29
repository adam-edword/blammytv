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

### Milestone 0 — UI on Android (foundation) ← ✅ **done**

Goal: get the React app rendering in an Android APK, player stubbed. Proves the
port and gives a base to build on. **Achieved** — the BlammyTV UI renders on an
Android TV emulator (onboarding/welcome screen), player stubbed, no crash.

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

#### Gotchas hit getting M0 running (and the fixes)

None of these were app-logic — all platform/toolchain glue. Recorded so we never
re-debug them:

- **Vite must bind to `TAURI_DEV_HOST`.** `tauri android dev` serves the frontend
  to the device over the LAN; Vite was on `localhost` only, so the device hung on
  "Waiting for your frontend dev server". Fix: `server.host = process.env
  .TAURI_DEV_HOST || false` + matching HMR host in `vite.config.ts`.
- **pnpm monorepo breaks `pnpm tauri`.** The Android Gradle task
  (`buildSrc/BuildTask.kt`) runs `pnpm tauri android android-studio-script` from
  `apps/app/src-tauri`, which isn't a workspace package — pnpm resolves to the
  repo root, goes recursive, and the `tauri` bin (only in `apps/app/node_modules`)
  isn't found (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`). Fix: add `@tauri-apps/cli` +
  a `"tauri": "tauri"` script to the **root** `package.json`.
- **rustls crypto provider crash on launch (SIGABRT).** Tauri core transitively
  pulls reqwest 0.13, which builds rustls clients with no default crypto provider
  on non-Windows — the first HTTPS client panics ("No rustls crypto provider is
  configured"). Fix: declare `rustls` (0.23, `ring`) for non-Windows and
  `rustls::crypto::ring::default_provider().install_default()` at the top of
  `run()`.
- **No Android Studio needed.** `tauri android init` installs the SDK cmdline
  tools + NDK itself. The emulator + a system image are separate: install via
  `sdkmanager "emulator" "system-images;android-36;android-tv;x86_64"` (pick the
  **x86_64** TV image to match the 64-bit host), create with `avdmanager`, run
  with `emulator -avd <name>`.
- **AVD `image.sysdir.1` path doubling.** Because the SDK lives at the nonstandard
  `...\Android\Sdk`, `avdmanager` wrote `image.sysdir.1=Sdk/system-images/...`, so
  the emulator looked in `...\Android\Sdk\Sdk\...` and failed ("Cannot find AVD
  system path"). Fix: strip the leading `Sdk/` from that line in the AVD's
  `config.ini`, and set `ANDROID_SDK_ROOT`/`ANDROID_HOME`.
- **Accept SDK licenses** (`sdkmanager --licenses --sdk_root=<sdk>`) or Gradle dies
  at `minifyRelease`/build-tools install. For a sideloadable APK use
  `--debug` (release APKs are unsigned and won't install).

### Milestone 1 — the player (the real R&D) ← *core proven*

Engine chosen: **ExoPlayer / Media3** (fast to working, native Android, great for
the debrid MP4/MKV case; swappable behind the plugin interface if live TS fights
back). libmpv stays the fallback for parity if needed.

**The de-risk spike works end to end** — real H.264 video decodes and composites
*under* the React UI on the Android TV emulator. How it's wired today (in
`MainActivity.kt`, throwaway hardcoded-URL form):

- Override `WryActivity.onWebViewCreate(webView)` — the hook called right after
  the WebView is built.
- `webView.setBackgroundColor(Color.TRANSPARENT)` and add the page-transparent
  CSS on Android (`html.is-android body { background: transparent }`).
- Insert a `TextureView` as the **bottom child** of `android.R.id.content`
  (`addView(view, 0, …)`), so it draws behind the WebView. A `TextureView`
  composites in-hierarchy (no SurfaceView z-order dance needed).
- `ExoPlayer.Builder(this).build()` → `setVideoTextureView(textureView)` →
  `setMediaItem(uri)` → `prepare()`. A `Player.Listener` logs under tag
  `BlammyPlayer` (state, video size, first frame, error code).

Spike gotchas hit (all recorded so we don't repeat them):

- **Java version / GraalVM.** Bumping the Android build to Java 11 makes AGP build
  a system-modules JDK image via `jlink`, which fails on the GraalVM JDK Gradle
  runs on. Stay on **Java 8** (Media3 compiles fine there — it's Java, no
  Kotlin-inline boundary), or point the build at a Temurin JDK.
- **Media3 dep** goes in `gen/android/app/build.gradle.kts`
  (`androidx.media3:media3-exoplayer`). That file is NOT regenerated per build, so
  edits persist (CRLF can cause phantom pull conflicts — `git checkout --` it).
- **Test URLs.** Google locked the old `gtv-videos-bucket` (403). A working one:
  `storage.googleapis.com/exoplayer-test-media-0/BigBuckBunny_320x180.mp4`.

Still to do to make it real (the wiring):

1. **Tauri plugin** so JS drives `load(url)/play/pause/seek/tracks/volume` with the
   app's actual stream URLs — the same control surface the overlay already speaks,
   so the React side barely changes. (Replaces the hardcoded URL in MainActivity.)
2. **Only the player region transparent**, not the whole page — position/size the
   TextureView to the in-app player box (preview) or fullscreen (theater), matching
   the Windows `set_rect` behaviour.
3. **HLS/TS for live IPTV** — add `media3-exoplayer-hls` and test on real streams;
   fall back to libmpv only if container coverage is a problem.

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

## Follow-ups / backlog

- **Setup handoff ("configure from another device").** New: instead of typing
  the AIOStreams/Xtream details on the remote, the TV runs a tiny LAN HTTP
  server (`src-tauri/src/config_server.rs`, `tiny_http` + `local-ip-address`)
  and shows a URL + QR (onboarding, `SetupHandoff.tsx`). You open it on a
  phone/laptop on the same WiFi, fill the form, and it's emitted to the WebView
  (`config-received` → `setAioUrl` + `addPlaylist`). A 6-char token gates writes;
  creds never leave the LAN. Needs a Gradle/Cargo rebuild. **Couldn't fully
  compile-verify the Rust here** (host lacks GTK, Android needs the NDK for a C
  TLS dep) — the `tiny_http`/`local-ip-address` calls were checked in isolation
  and the Tauri bits mirror existing commands, but watch the first rebuild.
  Future: extend the form + payload for **M3U** and **Stalker/MAG** portals
  (add a `<fieldset>` in `FORM_HTML` and a branch in `SetupHandoff`); add a
  Settings entry to re-run it (the settings panel internals aren't
  remote-navigable yet — that's its own follow-up).

- **Continue Watching — done.** Progress: the native player reports
  position+duration (`blammy-native-progress`, every 5s + on close), `VodPlayer`
  updates the entry, and the store drops it past 90%. Resume: a CW card click
  re-resolves the title's top source (the saved URL expires) and plays at the
  saved position (`App.resumeWatching` → `playSource(..., {start})` →
  `VodPlayer` `resumeAt` → native `load` seek); with no sources it falls back to
  the title screen. ⚠️ The native bridge signature changed (`load` now takes a
  start arg) — **a stale APK breaks playback**, so this needs a Gradle rebuild.
- **(superseded) Continue Watching — finish the native half.** The web base is in:
  `lib/continueWatching.ts` (localStorage, cap 12, drops past 90% watched), a
  landscape CW row between the hero and the catalog rows (`StreamScreen`), a
  progress bar on the landscape `StreamCard`, and an entry saved on play
  (`App.tsx playSource`). What's missing needs the native player: (1) ExoPlayer
  must report position+duration to JS (periodic + on close) so progress %
  fills in and entries drop at 90% — add a `blammy-native-progress` window event
  from `MainActivity` and a `tauri.onNativeProgress` listener that updates the
  entry; (2) **resume** — `load` must accept a start position (seek after
  prepare) and a CW card click should re-resolve the title's top source and play
  at the saved position. Needs a Gradle rebuild.

- **Bring the peek-slider hero to Windows.** The new remote-driven `HeroSlider`
  (peek slider + two-level focus, no auto-advance) currently renders on Android
  only; desktop still uses the classic auto-advancing `FeaturedHero`. Decision:
  adopt the slider on Windows too. For desktop it needs mouse affordances —
  click a peeking neighbour to slide, click the active slide / Watch Now to play,
  and either drop the two-level "enter" step or map it to hover. Likely unify the
  two heroes once that's wired.
- **Bring the TV nav polish to Windows.** Several header tweaks are gated to
  `html.is-android` and should be adopted on desktop when the hero lands:
  true-centred tabs (equal-flex side sections, so the wider clock side doesn't
  push the centre off), smaller/"premium" nav text (tabs 18px, brand/clock 22px),
  tighter tab spacing, and a smaller header→content gap.
- **Spatial navigation: remaining screens.** Done: the Stream tab (tabs + hero +
  rows), the **source-selection screen** (`SourceSelector`), and the series
  **episode browser** (`EpisodeBrowser` — focusable episode grid, season
  prev/next + dropdown, Back; first episode auto-focused; dropdown traps focus
  and closes on Back). The episode-browser **season bar + episode grid still use
  desktop sizing** — give them the same TV scale-down the rest of the detail
  screen got. Search-by-text in the season bar is left as mouse/keyboard only
  (on-screen-keyboard text entry is a separate concern). Still to do: Live TV,
  Discover, settings/onboarding forms, and the EPG grid (the hard one).
- **AVD keyboard → D-pad.** The emulator isn't mapping host arrow keys to the
  D-pad, so testing relies on `adb shell input keyevent`. Worth fixing the AVD
  config for a smoother dev loop.
- **Row-nav performance pass.** Holding ◀/▶ for a fast full-row swipe still dips
  to ~40fps with a handful of long (>32ms, ~60ms) frames — livable, not smooth.
  Confirmed app-side, not the emulator (host-GPU mode made no difference) and
  GPU/paint-bound (emulator logged `Failed to find EmulatedEglImage` texture
  thrash). Already fixed the worst offender: `.stream-card__art` was animating
  `box-shadow` (non-compositable → full repaint per frame). Remaining suspects
  for the pass: the CSS `zoom` on `<body>` forcing per-frame repaints on every
  scroll, the per-frame `scrollLeft` rAF in `lib/scroll.ts`, and poster decode
  on first reveal. Re-add a quick FPS/long-frame overlay to measure (see commit
  `5ae114f` for the throwaway `lib/fpsmeter.ts`); instrument the focus-move
  handler vs. the scroll rAF separately before changing anything.
- **The "white box" was the native focus ring, not a glow ghost.** ✅ Fixed.
  Initially misdiagnosed as the card `box-shadow` glow ghosting on scroll; the
  giveaway was the box appearing on a *different* card than the `.is-focused`
  glow. Cause: we mirror norigin focus onto native DOM focus (for a11y), but
  during fast D-pad nav the native focus lags/diverges, and the browser draws
  its default focus ring on whichever element last held native focus. Fix:
  `html.is-android :focus { outline: none }` — but that only killed the
  `outline`; cards that style `:focus-visible` with a *border-color* (source /
  episode cards) still lit up on the diverged card. Final fix: **stop mirroring
  norigin focus onto native DOM focus on TV** (`lib/tv.ts` `isTv` gate in
  StreamCard/SourceCard/EpisodeCard/FocusButton/HeroAction), so native focus
  never moves on Android — plus desktop-scoping the cards' hover/`:focus-visible`
  rules. norigin's `.is-focused` is now the only focus cue on TV; this also
  removes the latent "Enter activates a stale card" risk.
  Separately, the card glow was reworked off `box-shadow` to a blurred
  `::after` (perf + it's a cleaner glow); `filter: blur` is scoped to the
  focused card only.

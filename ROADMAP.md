# Rebuild roadmap

Working state of the greenfield rebuild (branch `claude/blammytv-rebuild-xclzto`)
and the agreed order of what's next. Update this file as sections land.

## Where we are (v0.1.109)

- **Settings panel: complete.** Playlists (Xtream sub-tabs, folder visibility
  editor), AIOStreams (manifest + hero-slider source chips), Customize
  (clock/startup, accent + light theme, scale/corners, danger zone).
- **Live tab: sidebar complete.** Panel container, mode rail
  (Playlist/Favorites/Recents, Claude-app mechanics, constant-width pill),
  emoji source icons (`emoji.ts`, tested), folded icon rail with fixed-point
  icons and a zoom-aware tooltip.
- **Live tab: hero complete (mock-driven).** 16:9 preview slot (stable
  `#player-slot` id for the mpv wiring, hover bezel), LIVE badge, accent
  channel name, title with overflow fade, dim synopsis, time + progress bar.
  Hover-preview: pointing at any guide row/cell previews it in the hero
  without changing selection.
- **Live tab: guide complete (mock-driven).** One scroll container; ruler and
  channel column pin via sticky; cells from tested `epg.ts` math
  (PX_PER_MIN=9.5, 4h window); accent live cells; dashed No-Information
  lanes; favorites star (rainbow, persisted); sidebar source filters rows;
  click selects the channel and drives the hero.
  - **Pinned-cell system** (the old build's, hardened): the airing cell
    straddling the lane edge swaps to position:sticky (imperatively — React
    never renders pins) and its width is driven per-frame from a rAF.
    Restoration truth lives in React-rendered `data-left`/`data-width`.
    Scrubbing benchmarks identical to a listener-free DOM clone.
  - **Scars, do not reopen:** no `will-change` on pinned cells (WebView2
    reuses stale raster offsets across the abs→sticky swap — geometry clean,
    pixels wrong); no sticky text inside `overflow:hidden` cells (the cell
    becomes the scrollport); no `content-visibility` around sticky
    descendants (layout containment scopes them); imperative styles survive
    React renders AND HMR — always restore from rendered attributes and
    purge on every render pass.
- Quality badges to the exact Figma gradients with border-box gradient rings;
  `extractQuality()` (tested) runs on real channel names.
- **Modes wired (v0.1.59).** Favorites filters the guide to starred channels;
  Recents (`recents.ts`, move-to-front, cap 30) records selections; empty
  modes show a centered nudge. Both persist and verified via Playwright.
- **Xtream content wired (v0.1.60) — no player yet.** `model.ts` is the one
  domain shape (Channel/Programme/LiveData, ids namespaced
  `<playlistId>:<streamId>`); `source.ts#loadLive()` is the seam — real
  playlists when configured, `mockLive()` otherwise, so the mock stays the
  dev harness. Strategy is the old build's, confirmed on origin/main:
  authenticate → `get_live_categories` + `get_live_streams` (all streams,
  two calls) → full `xmltv.php` parsed with DOMParser (`xmltv.ts`, windowed
  −1h..+12h, filler titles dropped, matched by `epg_channel_id`). Per-source
  best-effort: a failing playlist or EPG never sinks the others (group
  carries `error`; channels render No-Information lanes without EPG).
  `hiddenCategories` drops folders AND their channels. Logos render
  `stream_icon` with lettermark fallback. Guide/Hero consume passed
  programme arrays — no mock imports left in either. Live data refreshes
  (debounced, silent) when playlists change in Settings
  (`onPlaylistsChange`). Verified end-to-end with a fake Xtream panel under
  Playwright: 12/12 checks (categories, hidden drops, badges, logos, EPG
  cells, filler, hero, folder filter, favorites on real ids, mock
  fallback).
- **Huge-playlist hardening (v0.1.61).** Reproduced a 90MB-scale provider
  locally (220k streams / 67MB JSON + 40MB xmltv fake panel in the
  scratchpad): the loader died on `push(...spread)` of a six-figure array
  (argument-stack overflow → permanent error state), and had it survived,
  rendering all channels ungrouped would have hung the WebView (the old
  build never did this — it always scoped to one category). Fixes: concat
  instead of spread; **guide rows are virtualized** (spacer-div window,
  ±5 overscan, re-render only on 68px row-boundary crossings — horizontal
  scrub stays render-free and the pin system rides the purge-first resync
  untouched); loading status narrates per-stage progress
  (sign-in/channels/guide download/parse) with `[live]` console timings, so
  a wedged stage names itself. 220k channels: interactive in ~5s, bottom of
  the 15M-px scroll renders, folder filter ~300ms, horizontal p95 16.7ms.
  Watch for: a frozen "Fetching channels…" in the Tauri app means the 90MB
  string is stuck in the `invoke` IPC bridge — that fix is Rust-side
  (stream to disk / byte channel), gated behind a milestone.
- Floating glass nav (progressive-blur experiment parked, commented in
  base.css), F11/Escape fullscreen keys, `--header-h` published by measure.
- `src-tauri` ported wholesale from the old app (Schannel TLS fix, mpv
  composition, updater). The Rust player API is COMPLETE and needs no
  changes — `comp_theater/comp_set_rect/comp_stop/comp_key/comp_popout/
  popout_pos/popout_stop` + the `comp-*` events; geometry is PHYSICAL device
  pixels (frontend multiplies CSS px by devicePixelRatio); the overlay is a
  second webview of our bundle loaded with `?overlay=1` and driven via the
  Rust-injected `window.overlayApi` bridge. Do not touch src-tauri.
- **Native player — Phase 1 VERIFIED working on Windows (v0.1.75).**
  Auto-play on channel select: selecting a channel streams it into
  `#player-slot`, sized/positioned/followed correctly, with rounded 12px
  corners and a minimal overlay (play/pause, channel name, ✕). `lib/tauri.ts`
  has the comp wrappers + `onCompClosed`; `stream.ts` rebuilds the live URL
  from the namespaced channel id (`<playlistId>:<streamId>`) + playlist creds
  (`liveExt` on `XtreamPlaylist`, default "ts"); `CompositionPlayer.tsx` is
  the ported rAF geometry driver (150ms open-debounce, dpr-scaled rect,
  RADIUS_CSS=12); `main.tsx` routes `?overlay=1` to `TheaterOverlay`.
  Browser/mock path untouched (no url → no player).
  - **Overlay bridge gotcha (fixed):** `window.overlayApi.getLoading()` is a
    SYNCHRONOUS boolean (comp.rs), `getMeta()` is a Promise, `on*` return an
    unsubscribe fn. An uncaught throw in an overlay effect unmounts the whole
    overlay tree (looks like "webview didn't load") — match the bridge types
    exactly. A pre-React DOM probe distinguishes "webview didn't composite"
    from "React crashed."
  - **Known native (Rust) items — batch into one Windows pass:**
    (1) round the VIDEO — `round_child`'s window region is bypassed by mpv's
    D3D flip swapchain (intermittently sharp); fix with a DirectComposition
    clip. (2) `cursor: pointer` over the playing video — the mpv child owns the
    OS cursor and `theater_wndproc` doesn't handle `WM_SETCURSOR`; add a handler
    (`SetCursor(IDC_HAND)` for `HTCLIENT`, or forward the overlay's requested
    cursor). CSS `cursor:pointer` is already set on `.overlay`, inert until this
    lands. (3) tighter channel switch WITHOUT losing the overlay: the switch
    gap exists because the overlay WebView2's `Close()` is async and rebuilding
    without a gap races it (tried removing the gap in v0.1.76 — video rebuilt
    but the overlay didn't come back; reverted). A real fix waits for the close
    to settle Rust-side. The idle box is black `#000` + `#ffffff10` so the gap
    reads clean meanwhile.

- **Native player Phase 2 — theater + fullscreen (v0.1.78), needs Windows
  verify.** Three states: mini → theater (large windowed, chrome hidden behind
  a black backdrop, centred largest-16:9 box) → fullscreen (fills the monitor +
  `tauriSetFullscreen`, squared off). `TheaterOverlay` is the old build's chrome
  ported live-only (meta bar, LIVE progress, transport, volume, top-right
  fullscreen/close, auto-hide via `player--active`, click-through via
  `setMouseIgnore`); mini keeps play/pause + ✕ and click-to-expand. LiveScreen
  mirrors the `comp-expand/collapse/fullscreen/exit-fullscreen`/`closed` events
  into `theater`/`fullscreen` state → `.live--theater`/`--fullscreen` geometry
  classes (grow `#player-slot` == `.hero__preview`; the rAF follows). Shortcut
  keys (space/k/m/f/t/j/l/arrows/Escape) forward from the main webview via
  `comp_key`; App.tsx's Escape stays harmlessly redundant. `CompositionPlayer`
  gained a `fullscreen` prop (radius 0). Overlay chrome verified in-browser at
  mini + theater sizes (renders, drives the bridge); the geometry/OS-fullscreen/
  keyboard need a Windows check. **Watch for:** a transformed ancestor of
  `.hero__preview` would trap the `position:fixed` theater box; header is
  covered by the z-40 backdrop in theater.

- **Catch-up / timeshift — groundwork landed, feature SHELVED (v0.1.97).**
  Spiked it because a provider's `get_live_streams` flags catch-up per stream
  (`tv_archive` + `tv_archive_duration` days). Kept, tested, ready: those
  fields parse into `Channel.archiveDays` (`source.archiveDaysOf`, string-
  coerced/guarded), and `stream.ts#catchupStreamUrl` builds both standard
  Xtream timeshift URLs (path + php) with the server-tz question isolated in
  `formatTimeshiftStamp`. Shelved because the **test provider advertises
  catch-up but doesn't serve it** — proven four ways (probe `200 · 0B` at
  every past offset/scheme; mpv perma-load; M3U declares no `catchup-source`;
  and the reference app **Desktop Telly** black-screens on catch-up too, via a
  provider-native AES-obfuscated `/live/play/<token>/<id>` URL). The EPG loads
  past *listings*, but the *video* archive isn't there. Full finish-steps live
  in the `stream.ts` catch-up header comment. **To resume:** point BlammyTV at
  a provider that genuinely serves standard timeshift, settle the tz default
  against it, then wire a Timeshift panel in the right-of-hero space (past cell
  → `catchupStreamUrl` → `CompositionPlayer`; LIVE button already exits to the
  live edge).

- **Load-time perf: response compression (v0.1.100, needs Windows rebuild).**
  Sources loaded in ~10s vs a competitor's 3-5s. Profiled it (real 20k-channel
  streams + a representative ~57MB guide): CPU work is minor — JSON.parse 31ms,
  streams+map ~430ms, xmltv parse ~700ms. The cost was **downloading the guide
  raw**: reqwest was built `default-features = false` with only `native-tls`,
  so `http_get` never sent Accept-Encoding. Enabled `gzip`/`brotli`/`deflate`
  on the client (`Cargo.toml` + `.gzip(true).brotli(true).deflate(true)`).
  Measured ratios on the representative guide: xmltv 56.9MB → **2.4MB** gzip
  (23:1), streams 7.1MB → 0.6MB. **Verified on Windows via the v0.1.103
  `[http]` terminal diagnostics:** compression engaged (95.4MB of xmltv in
  ~2.1-3.6s ≈ compressed wire), whole Rust-side fetch ≈ 4s. The REAL
  remaining killer the diagnostics exposed: **the entire pipeline ran
  twice** — StrictMode's dev double-effect fired two concurrent loadLive
  calls, the cache only writes post-completion, and there was no in-flight
  dedup → double fetch + double IPC haul + double 95MB DOMParser. Fixed in
  v0.1.104 with a single-flight guard (concurrent callers share the
  promise, stage callbacks fan in; forced refreshes bypass). NOTE: gzip
  does NOT shrink the IPC haul — the decoded 95MB string still crosses the
  invoke bridge once per load. If single-pass load is still slow, next
  levers in order: measure the frontend-vs-Rust delta from the [http] +
  [live] logs (that delta = IPC + DOMParser), then the byte-channel /
  stream-to-disk IPC rework, then overlapping xmltv with cat+streams.
  **All landed (v0.1.105-106), measured on Windows: 11s → ~4s** via raw-bytes
  IPC (tauri::ipc::Response — no more JSON-escaping the 95MB body; verified
  against the locked tauri 2.11.3 source) + xmltv download overlapped with
  cat+streams. Then **disk hydration (v0.1.106)**: the parsed catalog
  persists to IndexedDB (structured clone — Maps/Dates native, one record,
  keyed by the playlist-config fingerprint, 8h max age) and a fresh launch
  hydrates instantly while a background revalidation swaps fresh data in via
  onLiveRefreshed (same silent path as playlist edits). Verified against the
  20k-channel fake panel: cold 2.9s → **hydrated reload 0.24s**, with
  revalidation confirmed running behind it. Single-flight note: the slot is
  claimed SYNCHRONOUSLY before the async disk probe — an await between the
  join-check and the claim re-opens the StrictMode double-load race.
  Remaining lever if ever needed: Rust-side windowed xmltv parse (ships only
  the −1h..+12h slice, kills the 95MB DOMParser pass).

- **Settings-over-player (v0.1.114, needs Windows verify).** The settings
  modal rendered BEHIND the playing video: the mpv child HWND + composition
  overlay are native layers above the main webview, so no CSS z-index can
  cover them (Telly wins here by compositing video as a texture inside its
  UI — not our architecture). Fix rides the existing rect driver: App.tsx
  sets `data-native-hidden` on the root while the modal is open, and
  CompositionPlayer's rAF parks the native layers in a 2×2 offscreen rect
  (not 0×0 — avoids WebView2 zero-bounds edge cases) until it clears. Audio
  keeps playing; the picture snaps back on close. Any future full-cover
  surface (Ctrl+K palette) can reuse the same flag.

- **Brand (v0.1.107–109).** The gradient-ring mark is the app identity:
  `public/logo.png`/`logo.svg` in the header + the full `src-tauri/icons`
  set, and `build.rs` declares `rerun-if-changed=icons/icon.ico` so an icon
  swap re-embeds without a clean build. The mark's center is transparent by
  design (reads perfectly on the dark header); if the OS taskbar icon ever
  needs a filled center, that's a deliberate, separate change.

## Live TV 1.0 slate (persona discovery, 2 runs, 8 personas — this section
## is the surviving summary; the scratchpad report died with its container)

Audience: desktop switchers from Windows IPTV clients + Stremio users, AND
newcomers to both (first-five-minutes activation weighs as much as switcher
parity). Telly = live-TV quality bar. In value order:
[Adam's 2026-07-09 triage: #1 #2 keep (awaiting Figma); #3 keep LOW-prio;
#4 reshaped — NO chip in the EPG UI, show the channel number in the HERO
data on hover instead (Xtream `get_live_streams.num` → model → hero);
#5 approved; #6 post-1.0; Stream tab post-0.2.0; timeshift backburner;
**M3U + Stalker sources PULLED INTO v0.2.0 scope**; stats overlay keep;
ambient/motion post-0.3.0; programme-level hero selection keep; hole-rim
seam stays as-is; landing page greenlit (artifact first).]

1. **Ctrl+K channel search** (M) — unanimous 7/7 personas; wire the drawn
   header icon into a fuzzy command palette; needs Adam's palette design.
2. **Stream resilience + tune-in ident** (M) — ✅ frontend half SHIPPED
   v0.1.102 (see below). Remaining: surface mpv end-file/error through
   comp.rs for mid-play death detection — batch with the Windows native pass.
3. **In-player zapping + last-channel + now/next OSD** (M) — closes the
   fullscreen dead end; core zap + toast only (mini-guide strip post-1.0).
4. **First-run welcome + validated paste-anything add** (M) — kill the silent
   mock catalog; Test & Add with human error copy; pairs with Adam's
   onboarding Figma. Xtream-only at 1.0.
5. **Audio/subtitle track menus** (S) — ✅ SHIPPED v0.1.110 (see below).
6. **Adult-hide by default** (S) — ✅ SHIPPED v0.1.113. Global "Show adult
   content" toggle (Settings → Playlists, default OFF). Adult categories —
   panel `is_adult` flag (coerced in `fetchLiveCategories`) or the
   conservative word-bounded name pattern in `live/adult.ts` (xxx / porn /
   adult(s) / erotic / 18+, with an Adult Swim exception) — merge into the
   hiddenCategories drop set (`source.ts#droppedCategories`), so folders,
   channels, and EPG drop identically; stream-level `is_adult` drops
   individual channels from innocent categories too. The filter is part of
   the cache/disk fingerprint (flipping it reloads), and saving emits the
   playlists-change signal so Live refreshes silently. The folder editor
   hides adult rows behind an "N adult folders hidden" note while the
   filter is on. Verified: unit (name patterns, flag coercion, drop set)
   + 8/8 E2E against the fake panel (`scripts/verify-adult-filter.mjs`;
   panel-flag, name-catch, stream-flag-in-innocent-category, Adult Swim
   survives, user-hidden unaffected, toggle restores).
7. Stretch: channel-number chip + favorites drag-reorder (both S).
Post-1.0 headliner: instant recording to disk. Cut line rationale: everything
above removes a switch-blocker or rescues the first session.

- **Audio/subtitle track menus (v0.1.110, frontend-only).** The Rust side was
  already complete and verified by code-trace: comp.rs `spawn_time_watch`
  polls mpv's track list every 500ms and posts `{type:'tracks'}` on change;
  the injected bridge caches `lastTracks` and exposes `getTracks()`
  (SYNCHRONOUS, like getLoading) / `onTracks()` / `selectAudio` / `selectSub`
  (both String() their id; sid `"no"` = subs off). TheaterOverlay now
  subscribes (seeded from the sync cache so a push that lands before React
  mounts isn't lost) and renders glass popover menus in the theater controls:
  audio (globe icon, enabled with ≥2 tracks) and subtitles (CC icon, enabled
  with ≥1 track, with an Off entry keyed off "no sub has selected"). Both
  buttons are ALWAYS visible and gray out (`disabled`) when there's nothing
  to choose — Adam's call in v0.1.112 (they originally hid, which reads as
  "feature missing" on the common 1-audio/0-subs stream). Selection
  is optimistic; the Rust 500ms poll re-pushes the real `selected` flags and
  confirms/corrects. An open menu holds the auto-hide chrome awake; Escape and
  picture-clicks close the menu before their usual actions; mini stays
  menu-free. Verified 12/12 headless (`scripts/verify-overlay-tracks.mjs`,
  mocked bridge — the tune-watchdog pattern) + screenshot. Still wants a
  Windows eyeball on a real multi-audio channel. The tune watchdog lives in
  TheaterOverlay: `loading` flips false only on mpv's first frame, so a dead
  channel = loading stuck true. After 10s with no frame the overlay silently
  reloads the stream in place (goLive = re-loadfile, the live-edge mechanic),
  twice with the loader-watch still armed; out of retries → an honest "This
  channel isn't responding — it's the stream, not you" card with Retry. The
  bare "loading" pulse became a branded tune ident (logo + channel +
  programme). Verified headless with a mocked overlayApi bridge: 8/8 asserts
  across the full escalation (real 10s timers). Mid-play death detection
  still needs the comp.rs end-file event (native pass).

## Layer inversion (Telly-parity architecture) — SPIKE PASSED, A0 IN TREE

**Spike result (Adam's machine, first build, v0.1.115):** PASSED. Video
through the hole, chrome/cards/animation above the video, flip present mode
(the quality path) composites cleanly under the webview. Glass finding:
backdrop-filter over the hole is TINT-ONLY (no blur of the native video) —
which is the status quo, not a regression: the comp.rs overlay never truly
blurred video either (WebView2 can't sample another window's pixels). Tint
glass is the design language over video, as it already was.

**A0 (v0.1.116): the inverted player runs in the REAL app behind a dev
flag.** Ctrl+Shift+U in dev flips old ↔ new player and reloads. Mechanics:
the main window is now `transparent: true` (tauri.conf — replaces
`backgroundColor`; with the flag OFF, body still paints var(--bg) so
nothing changes visually beyond a possible brief launch flash); with the
flag ON, `.app-shell` becomes the window's only opaque paint (base.css
`.invert-player` rules) and CompositionPlayer's same rAF driver cuts an
evenodd clip-path HOLE through it at the slot rect while driving
`inv_open/inv_set_rect/inv_stop` (inv.rs — child at HWND_BOTTOM, flip
model, no overlay webview, no DComp). Parking (modal open) also heals the
hole, so Settings stays fully opaque mid-play. Keyboard chrome only in A0
(LiveScreen drives mpv directly: space/k pause, m mute, f/t/Escape sizes,
arrows/j/l seek — no overlay to forward comp_key into). Rust side for A1 is
already registered: `mpv_pause/mute/volume/seek/go_live/track` +
`mpv_status` (pos/dur/presenting/tracks poll — replaces the bridge's push
threads).

**A1 (v0.1.117, frontend-only): full chrome inline + live video behind
Settings.** A0 Windows check first confirmed theater + fullscreen geometry
work. The pieces:
- `overlayApi.ts` now owns the bridge contract (OverlayApi/Tracks types,
  `api()` accessor) with a module-level override LiveScreen sets BEFORE
  rendering TheaterOverlay inline (state initializers read it sync).
- `useDirectOverlay` implements the contract over the mpv_* commands + a
  500ms `mpv_status` poll: loading flips on first `presenting` (same
  core-idle signal as the Rust loader-watch, so the TUNE WATCHDOG works
  unchanged), tracks push on change, comp-* verbs become LiveScreen
  callbacks (expand/collapse/fullscreen/popout/favorite/close).
- TheaterOverlay grew a `frame` prop ("mini"/"theater"/"fullscreen") —
  inline, the window heuristics are meaningless, LiveScreen passes its own
  state; handlers read it via ref (miniNow/fsNow). Its document key handler
  now preventDefaults handled keys and skips arrows on buttons (inline it
  shares the app document — roving tablists own their arrows). LiveScreen
  does NOT forward comp_key when inverted (double-fire).
- The chrome portals into `#inv-chrome` on document.body (outside the
  shell = outside the clip hole), which CompositionPlayer sizes to the slot
  rect each frame alongside the hole; z 45 (above theater backdrop 40).
- SettingsModal portals to document.body too (z 60) and the inverted path
  no longer parks: the video PLAYS behind the settings card — the Telly
  moment, and the modal card sits clean above it. Comp path still parks.
A1 verified on Windows: chrome + theater + fullscreen + Settings-over-live-
video all work. **A2 (v0.1.118) fixed Adam's three findings:**
- **Frost-behind-modal (needs rebuild):** DOM backdrop-filter can never
  sample the native video (separate window — researched and closed), so
  mpv blurs ITSELF: `frost.glsl` (downsample /8 + two-pass gaussian, GPU,
  trivial cost) ships via include_str!, lands in a temp file, and
  `mpv_blur` toggles mpv's `glsl-shaders` chain when the modal opens
  (additive `mpv::set_glsl_shaders` — first do-not-touch exception,
  3 lines, Adam-covered by the rip authorization).
- **Transition glitch (t between theater/mini):** two causes, two fixes.
  TheaterOverlay now derives mini/fs from the `frame` prop IN RENDER (the
  state+effect route painted one frame of old layout in the new box), and
  the driver two-phases geometry: clip the hole to old∩new FIRST (the
  video covers that overlap throughout the move — the desktop can never
  peek through), push the native rect, then open the full hole + snap the
  chrome one frame after the move lands.
- **Mini corner radius:** the hole stays square; `#inv-chrome
  .mini-overlay::before` paints the four corner bites in var(--bg) — the
  theater fake-corner radial-gradient trick, applied to the inline mini.
**A3 (v0.1.119, frontend-only):** Adam vetoed the whole-picture frost look
and the painted corner bites read funky. New treatment:
- **Modal-over-video = dim scrim** (the chrome host darkens to 60% with a
  fade while `data-native-hidden` is set; video keeps playing). The
  researched blur menu, for Adam's pick later: (1) scrim — SHIPPED; (2)
  tuned shader (/4 + wider gaussian + desat — mpv_blur stays in the build,
  dormant); (3) frozen-frame glass (screenshot → DOM blur under the card,
  picture freezes); (4) region blur under the card via --glsl-shader-opts
  (libmpv-version dependent — probe get_property("mpv-version") first).
  (5) render API → DComp surface is REJECTED as a blur solution (Adam's
  call, 2026-07-09, and he's right): it keeps mpv's native RENDERING but
  forfeits the native PRESENTATION path — fullscreen independent-flip /
  direct scanout and mpv-owned HDR swapchains — i.e. the actual point of
  a native viewer, traded for cosmetics. Only revisit if something far
  bigger forces it, and then only behind a spike proving HDR + fullscreen
  parity. DOM backdrop-filter over the native layer is impossible, full
  stop.
- **Corners are now REAL**: the hole itself is a rounded rect —
  `clip-path: path()` with a clockwise outer rect + counter-clockwise
  inner rounded rect, so the default nonzero fill rule cuts the hole (no
  evenodd dependency). 12px in mini, 0 squared; corner-mask CSS deleted.

**A4 (v0.1.121): frozen-frame glass — built, then REJECTED by Adam (the
video must VISIBLY keep playing behind the panel).** `mpv_snapshot` +
`mpv::screenshot_to_file` (second additive do-not-touch exception) stay in
the build, dormant — future channel thumbnails. Settings modal is centered
now (v0.1.120, Adam's call — the top-right float predates video-behind).

**A5 (v0.1.122, needs rebuild): LIVE region frost — the endgame modal
treatment.** mpv GPU-blurs ONLY the rectangle under the settings card,
every frame: a /8 SAVE pass + a rect-branched composite pass
(`FROST_REGION_TEMPLATE` in lib.rs), with the card rect BAKED into the
shader source at write time (video-normalized; LiveScreen measures
card+slot, re-bakes on resize via `mpv_frost`). SUPERSEDED SAME NIGHT by
**A6 (v0.1.123)**: Adam's terminal answered the version question — **mpv
v0.41.0-724-g71ebd0840, a bleeding-edge dev build** (gpu-next default), so
rect-baking's file-rewrite+reload dance (which left stale frost on tab
switches and lost the rect on window resize) was replaced with //!PARAM
uniforms: the shader loads ONCE (`mpv_frost on/off`, degenerate-rect
defaults = disabled) and every geometry change is a `glsl-shader-opts`
property set (`mpv_frost_rect`, mpv.rs `set_shader_opts` — third additive
exception). Frontend: rAF-throttled pushes from a ResizeObserver on the
card AND the slot plus window resize; pad dropped to 0 so the frost hugs
the card exactly (no halo). `mpv_frost` prints `vo=` to the terminal —
if it ever says `gpu` (not gpu-next), PARAM is unsupported and frost is
silently absent; that's the diagnostic. Hole scrim 0.25. mpv_blur
(whole-frame) stays dormant; render-API/DComp REJECTED (above).

**A7 (v0.1.124): A6 verified feeling great on Windows; polish + shipping
story.** (1) Player chrome fades out under modals (`data-native-hidden`
opacity rule) — the "DOM not blurring" report was transport chrome showing
through the card; hiding it beats blurring it, leaving only frosted video
under the glass. (2) `mpv_frost` now RETURNS capability (current-vo must
be gpu-next for //!PARAM); LiveScreen stamps `data-frost="0"` when
unsupported and the settings card downgrades to a SOLID var(--bg)
background — Adam's requirement for users on older mpv. (3) The installer
already bundled src-tauri/libmpv-2.dll (tauri.windows.conf.json, DLL
gitignored); `scripts/fetch-libmpv.mjs` now refreshes it to the latest
shinchiro build (GitHub API + 7-Zip, manual fallback printed), and
RELEASING.md gained step 0. Adam's dev machine runs mpv v0.41-dev
(gpu-next default), so frost is live for him.
Remaining before default-flip: popout reclaim polish, paused-icon reset on
channel switch, then v0.2.0 deletion milestone (comp.rs overlay subsystem +
WM_SETCURSOR/corner-clip/switch-gap items all die) with the fresh-eyes
agent review fleet first.

## Layer inversion spike history (superseded — kept for the record)

The settings-behind-player question led somewhere big. **Probed Desktop
Telly's actual window tree** (PowerShell EnumChildWindows on Adam's machine,
2026-07-09) and it is LITERALLY OUR STACK: `WRY_WEBVIEW` (Tauri!) +
`Chrome_*` (WebView2) + a native `mpv` child — but with the UI webview ABOVE
the video child in z-order. Their whole UI is a transparent layer over
bottom-parked native video; settings-over-video is free. Their install dir
corroborates: iptv-player.exe + iptv-backend.exe (sidecar), lib/libmpv-2.dll,
plus mpv.exe (popout) and ffmpeg.exe (recording).

**If the inversion works in our window, the entire overlay subsystem
dissolves** — no second webview, no bridge, no comp_key forwarding, no
setMouseIgnore — and four batched native scars die as side effects:
settings-over-player, DComp corner clip (CSS handles the hole's corners),
WM_SETCURSOR (UI layer owns the cursor), async-close switch gap (no overlay
webview to race). TheaterOverlay becomes a normal in-tree component.

**The spike (v0.1.115, dev-only, throwaway):** `spike.rs` + `SpikeScreen`
(`?spike=1`). In dev, **Ctrl+Shift+L** opens a transparent window with an
mpv child parked at HWND_BOTTOM (comp.rs uses HWND_TOP — this is the exact
inversion), auto-playing the last-played channel (falls back to a public HLS
test stream). The page's checklist covers: hole transparency, chrome above
video, glass-blur-over-video (expected: tint only — backdrop-filter can't
sample another HWND; note the design implication), animation smoothness,
occlusion artifacts, flip vs bitblt present modes (buttons for both — flip
is mpv's default and the quality path; comp.rs needed bitblt only for the
DComp overlay we'd be deleting), and HDR brightness. Playing takes over the
shared mpv PLAYER instance (main window's channel stops) — fine for a spike.
NOTE: written against vendored-source-verified APIs (tauri 2.11.3 /
windows 0.61.3) but NOT compiled — the container can't build Rust. First
`pnpm tauri dev` may need a trivial fix; Adam pastes errors.

**Decision rule:** spike composites cleanly (incl. HDR + flip model) → the
inversion becomes the v0.2.0 milestone and replaces the batched native-pass
items; spike fails → keep current architecture, do the settings-PiP variant
instead, and record why here.

## Next steps, in order

1. **Native player Phase 3** — popout/PiP (`comp_popout` + `popout_pos`/
   `popout_stop` reclaim, `popout-closed`), audio/subtitle track menus, the
   update banner (`check_update`/`install_update`). Then **v0.2.0**.
2. **Native (Rust) pass** — the batched WM_SETCURSOR / DComp corner clip /
   async-close switch-tighten items (see the player bullet above).
3. **Stream tab (AIOStreams)** — re-enable the nav glass (commented in
   base.css) once scrolling content exists.

Slated for later, user-approved: ambient backdrop setting, motion toggle,
M3U + Stalker sources, timeshift/track-selection/stats in the player overlay,
programme-level selection
in the hero.

**Live-tab accessibility pass — LANDED (v0.1.98).** The batch from the v0.1.71
audit: keyboard-operable channel-column resize separator (`role=separator` +
`tabindex` + arrow/Home/End + `aria-value*`); roving-tabindex + arrow-key
navigation on the mode-rail tablist; accessible names on guide cells
(channel + programme + time + "on now") and channel cards; favourites star
revealed on `:focus-within`/`:focus-visible`; a themed `:focus-visible` ring
across the Live controls; `role=status`/`role=alert` live regions on
loading/error; `aria-current` for the active folder and the selected channel.
Verified headless (8/8 Playwright a11y asserts). Still deferred until the
player lands: the hero preview's edge uses raw `#ffffff10` (off-token) — fix
when that box is reworked for mpv.

## Working habits (so a fresh session doesn't relearn them)

- **Version bumps** on every user-visible frontend change: root
  `package.json`, `apps/app/package.json`, `apps/app/src/lib/version.ts`.
  Leave `Cargo.toml`/`tauri.conf.json` alone except at milestones — bumping
  them forces a Rust rebuild on the user's `pnpm tauri dev`.
- **Verify with data before shipping:** Playwright (`playwright-core` in the
  scratchpad + `/opt/pw-browsers/chromium`) for geometry/behavior asserts and
  scroll benchmarks (compare against a cloneNode of the DOM as the perf
  ceiling); headless screenshots for visuals; the fake Xtream panels live in
  `scripts/` (wiring-scale and perf-scale); then gates:
  typecheck / lint / test / build.
- **Windows is the target, Linux is the sandbox:** no case-sibling filenames
  (guide.ts vs Guide.tsx broke the Windows build); compositor/raster bugs may
  exist only there — when geometry audits pass but the user sees artifacts,
  suspect rasterization and ship an in-app state dump to capture it.
- **Never publish a GitHub Release below v0.2.4** without the pre-release
  flag — old installs' updater watches `latest.json` (see RELEASING.md).
- Themable color only via tokens (`tokens.css`); accent shades derive from
  `--accent` alone. Plain CSS, no Tailwind. Icons: coolicons-style strokes
  in `ui/icons.tsx`.

# Rebuild roadmap

Working state of the greenfield rebuild (branch `claude/blammytv-rebuild-xclzto`)
and the agreed order of what's next. Update this file as sections land.

## Where we are (v0.1.72)

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
  ceiling); headless screenshots for visuals; then gates:
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

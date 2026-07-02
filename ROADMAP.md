# Rebuild roadmap

Working state of the greenfield rebuild (branch `claude/blammytv-rebuild-xclzto`)
and the agreed order of what's next. Update this file as sections land.

## Where we are (v0.1.62)

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
  composition, updater). Do not touch it during frontend iterations.

## Next steps, in order

1. **v0.2.0 gate.** Live tab complete incl. mpv mini-player in the hero
   (`#player-slot`; `liveStreamUrl()` still to port — credentials-in-path,
   see old `client.ts`); then the Stream tab (AIOStreams) begins —
   re-enable the nav glass (commented in base.css) when scrolling content
   exists.

Slated for later, user-approved: ambient backdrop setting, motion toggle,
M3U + Stalker sources, timeshift/track-selection/stats in the player overlay,
drag-resizable channel column (old build had one), programme-level selection
in the hero.

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

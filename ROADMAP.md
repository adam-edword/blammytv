# Rebuild roadmap

Working state of the greenfield rebuild (branch `claude/blammytv-rebuild-xclzto`)
and the agreed order of what's next. Update this file as sections land.

## Where we are (v0.1.50)

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
  `extractQuality()` (tested) ready for real channel names.
- Floating glass nav (progressive-blur experiment parked, commented in
  base.css), F11/Escape fullscreen keys, `--header-h` published by measure.
- `src-tauri` ported wholesale from the old app (Schannel TLS fix, mpv
  composition, updater). Do not touch it during frontend iterations.

## Next steps, in order

1. **Modes wiring.** Favorites mode: guide shows only starred channels
   (`favorites.ts` already persists ids). Recents: small storage-backed
   module (same `lib/storage.ts` envelope), recording channel selections;
   guide shows them in recency order.
2. **Real data behind the layout** (late v0.1.x). LiveSource interface,
   Xtream first: `get_live_streams` per category honoring each playlist's
   `hiddenCategories`, `get_short_epg` for the guide window, channel logos
   (guide card `.guide__logo` currently renders the initial), loading/error
   states, `extractQuality()` on names. All HTTP through `lib/http.ts`
   (`http_get` command).
3. **v0.2.0 gate.** Live tab complete incl. mpv mini-player in the hero
   (`#player-slot`); then the Stream tab (AIOStreams) begins — re-enable the
   nav glass (commented in base.css) when scrolling content exists.

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

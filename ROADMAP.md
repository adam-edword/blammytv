# Rebuild roadmap

Working state of the greenfield rebuild (branch `claude/blammytv-rebuild-xclzto`)
and the agreed order of what's next. Update this file as sections land.

## Where we are (v0.1.11)

- **Settings panel: complete.** Playlists (Xtream sub-tabs, folder visibility
  editor), AIOStreams (manifest + hero-slider source chips), Customize
  (clock/startup, accent + light theme, scale/corners, danger zone).
- **Live tab: sidebar complete, main area is a placeholder.** Mode rail
  (Playlist/Favorites/Recents) uses the Claude-app mechanics — instant button
  resize, single indicator gliding via transform+width on `--spring`; collapse
  ghost shares the rail's row. Playlist group + folder rows match Figma 126:403.
- **Preserved modules, ready to reuse:** `features/live/guide.ts` (tested EPG
  grid math: windowStart, ticks, cellRect, progress — PX_PER_MIN=5, 4h window),
  `features/live/mock.ts` (deterministic World Cup catalog), `favorites.ts`,
  QualityBadge.
- `src-tauri` ported wholesale from the old app (Schannel TLS fix, mpv
  composition, updater). Do not touch it during frontend iterations.

## Next steps, in order (Live tab, section by section)

1. **Hero section** (next). Preview slot (16:9 placeholder where mpv will
   composite — give it a stable element id so the native wiring later has a
   fixed target) + now-playing panel: channel name/logo, programme title,
   time range with progress bar, quality badge. Mock-driven. Check the Figma
   live frame (133:414 area) before styling.
2. **Guide grid, statics.** Time header ticks + now-line from `guide.ts`,
   sticky channel column with channel cards (logo, number, name, favorite
   star — rainbow star when starred).
3. **Guide grid, cells + interactions.** Programme cells via `cellRect`,
   current-programme state, hover/selection; clicking a channel updates the
   hero; sidebar folder selection filters rows.
4. **Modes wiring.** Favorites mode filters to starred channels
   (`favorites.ts`); Recents needs a small storage-backed module (same
   `lib/storage.ts` seam, versioned envelope).
5. **Real data behind the layout** (late v0.1.x). LiveSource interface,
   Xtream first: `get_live_streams` per category honoring each playlist's
   `hiddenCategories`, `get_short_epg` for the guide window, channel logos,
   loading/error states. All HTTP through `lib/http.ts` (`http_get` command).
6. **v0.2.0 gate.** Live tab complete incl. mpv mini-player in the hero;
   then the Stream tab (AIOStreams) begins.

Slated for later, user-approved: ambient backdrop setting, motion toggle,
M3U + Stalker sources, timeshift/track-selection/stats in the player overlay.

## Working habits (so a fresh session doesn't relearn them)

- **Version bumps** on every user-visible frontend change: root
  `package.json`, `apps/app/package.json`, `apps/app/src/lib/version.ts`.
  Leave `Cargo.toml`/`tauri.conf.json` alone except at milestones — bumping
  them forces a Rust rebuild on the user's `pnpm tauri dev`.
- **Verify visually before shipping:** temp-seed state with sed if needed,
  `pnpm build`, `vite preview`, headless chromium screenshot
  (`/opt/pw-browsers/chromium --headless=new --screenshot=... --virtual-time-budget=8000`),
  revert temp edits, then gates: typecheck / lint / test / build.
- **Never publish a GitHub Release below v0.2.4** without the pre-release
  flag — old installs' updater watches `latest.json` (see RELEASING.md).
- Themable color only via tokens (`tokens.css`); accent shades derive from
  `--accent` alone. Plain CSS, no Tailwind. Icons: coolicons-style strokes
  in `ui/icons.tsx`.

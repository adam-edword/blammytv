## BlammyTV perf and dead-weight audit (v0.9.79, claude/nice-heisenberg-67k4uk)

No repo changes. Builds went to `/tmp/audit-perf/dist` and `dist2`, and scratch is in `/tmp/audit-perf/`. To measure a candidate I rebuilt with that module stubbed out (`/tmp/audit-perf/variant.mjs`).

**Baseline:** dist is 2,308,968 B, and 779 KB zipped (zip -9).

| File | Raw | Zipped |
|---|---|---|
| Entry JS | 906,257 | 295,177 |
| CSS | 193,995 | 33,583 |
| hls chunk | 595,041 | 184.6 KB |
| mpegts chunk | 276,957 | 63.6 KB |
| 11 woff2 fonts | 146,868 | same (already compressed) |
| es.svg + mx.svg flags | 165,711 | 44.4 KB |

Lazy-loading does not shrink the hot-channel download, because lazy chunks still ship in dist. It only cuts boot parse. The rows marked "zip" below are the ones that shrink the download.

### A. Bundle and hot-channel download size

1. **HIGH, zip.** hls.js ships the full build; the light build would do. `MultiviewTile.tsx:57` imports `"hls.js"`, which resolves to `dist/hls.mjs`. esbuild-minified, the full build is 586,222 B (183,875 gz) and `hls.js/light` is 366,928 B (116,937 gz). **Saving: about 219 KB raw, 67 KB gz, roughly 9% of the zip.** Fix: `import("hls.js/light")`. The light build drops alt-audio renditions, subtitles, EME and CMCD. That's fine for muted tiles, but a stream whose only audio is an alternate rendition would play silent. This is a call for Adam. CONFIRMED (size).

2. **HIGH, zip.** Geist Mono ships 6 subsets but only ever renders ASCII. It is used by the hex field (`AccentPicker.tsx:217`), `.stats-overlay__val` (`player.css:720`), `.rec__note code` (`discover.css:372`), and the dead `.license-input`. The cyrillic, cyrillic-ext, vietnamese, latin-ext and symbols2 files add up to 47,320 B of woff2 that the browser never requests for ASCII text. **Saving: 47 KB of the zip (6%).** Fix: replace `import "@fontsource-variable/geist-mono"` (`fonts.ts:52`) with one hand-written `@font-face` for `files/geist-mono-latin-wght-normal.woff2`. Or drop Geist Mono entirely for a further 23 KB. CONFIRMED.

3. **MED, zip.** The Spain and Mexico flags are 44 KB of the zip. `circuits/flags/es.svg` is 80,958 B and `mx.svg` is 84,753 B (coats of arms); they zip to 14.8 KB and 29.6 KB. SVGO at precision 2 only saves 1.6 KB and 1.2 KB. The flag is shown at 277 px tall and faded (`sports.css:2954`). Fix: rasterise these two to WebP at display size (estimate 5 to 10 KB each). **Saving: about 30 to 35 KB zipped.** SUSPECTED (the replacement size is an estimate).

4. **MED, zip.** Circuit SVGs are inlined into the entry JS, unoptimised. `circuits.ts:24` uses an eager `import.meta.glob("./circuits/*.svg", {query:"?raw"})`. Stubbing `circuits.ts` cuts the entry by 65,446 B raw (26,653 gz). SVGO precision 2 on the 25 layouts takes them from 51,434 to 42,009 B (gz 20,903 to 16,197). Fix: SVGO them in `scripts/harvest-circuits.mjs`; they move out of the entry with the Sports lazy split (C1). CONFIRMED.

5. **LOW, zip.** No build target is set for a Chromium-only app. `vite.config.ts` has no `build.target` or `cssTarget`. With `chrome105` (identical to `chrome120`): entry −15,122 B (−4,200 gz), CSS −1,296 B, hls −2,447 B. Fix: `build: { target: "chrome105", cssTarget: "chrome105" }` (Tauri's own template value). The GitHub Pages build (`DEPLOY_BASE`) would get the same target. CONFIRMED.

6. **LOW, zip.** Icon path data carries 6-decimal precision on a 16-unit grid. `icons.tsx:495-520` holds 22 path strings: 23,808 B, which is 16,172 B rounded to 2 decimal places (gz 8,238 to 5,577). Fix: round once in the script that generated them. CONFIRMED.

7. **LOW.** The modulepreload polyfill ships even though WebView2 doesn't need it: `vite/modulepreload-polyfill`, 1,280 B in the entry. Fix: `build.modulePreload: { polyfill: false }`. CONFIRMED.

8. **LOW, zip, judgement call.** Geist Sans cyrillic-ext (7,420) and vietnamese (8,004) subsets. Channel names can be in any script, so keep plain cyrillic. Dropping these two falls back to Segoe UI for those glyphs. **Saving: 15.4 KB.** SUSPECTED as worth it.

9. **Already right, and one premise was wrong.**
   - hls and mpegts really are lazy: dynamic chunks only, no modulepreload in `index.html`, not statically imported by the entry. CONFIRMED.
   - **react-colorful is not lazy.** It sits in the entry via `AccentPicker.tsx:2` (8,540 B rendered); stubbing AccentPicker saves 16,236 B (5,006 gz). CONFIRMED. The fix is covered by C1 (Settings lazy).

### B. Startup parse: what could be lazy (entry JS, raw / gz saved)

Everything is statically imported from `App.tsx:16-28`, so the entry is a single 906 KB chunk.

| Split | Saves raw / gz |
|---|---|
| Settings (`SettingsModal`) | 174,341 / 55,845 |
| Sports (`SportsScreen`, `SportsTheater`, `catalog`, `probe`) | 177,673 / 58,688 |
| Onboarding | 12,327 / 3,546 |
| Discover | 14,195 / 4,341 |
| Library | 6,912 / 1,997 |
| Settings + Onboarding + Sports | 369,158 / 119,627 (entry becomes 537,099 / 175,550, −41%) |
| All five | 390,358 / 125,847 |

1. **HIGH.** Lazy-load Settings, Sports and Onboarding with `React.lazy` in `App.tsx`. The swap is already a `startTransition` (`App.tsx:317`), so Suspense holds the old screen while the chunk loads. Sports only leaves the entry if `main.tsx:12-13` (SportsTheater, useCatalog for the `?sportstheater` harness) and `main.tsx:16` (`installSportsProbe`) become dynamic too. I did not measure the effect on boot time; V8 lazy parsing means it is less than proportional. CONFIRMED (bytes).

2. **HIGH, inside the Settings split.** `@base-ui/react` ships for one Combobox. `components/ui/combobox.tsx:4` is its only importer, used only by `CustomizeTab.tsx:4` via `ui/Combobox.tsx`. Stubbing it saves 116,802 B (40,043 gz). That is 111 modules, with its own floating-ui-react copy alongside Radix's `@floating-ui/react-dom`. It also pulls in `input-group.tsx` (4,363 B rendered), which is why InputGroup is bundled despite "no consumers". Fixed by C1; no need to replace the component. CONFIRMED.

3. **LOW.** The console probes are eager (`main.tsx:14-17`): 7,171 B (2,938 gz). Fix: have `window.btvSports` and friends `import()` their module on first call. That keeps them compiled into every build, which is what the comment wants. CONFIRMED.

4. **LOW.** `@tauri-apps/api/window` is 14,034 B (3,306 gz), pulled in for `getCurrentWindow` (`App.tsx:2`, `lib/tauri.ts:3`). Fix: call `isFullscreen`/`setFullscreen` through `invoke`. That leans on plugin command names, so a judgement call. CONFIRMED.

5. **Checked, not worth changing.** `cn` (shadcn's package) is 25,986 B min (10,675 gz). `tailwind-merge` + `clsx` measured 27,398 B (8,674 gz), so switching saves nothing.

### C. Runtime hot paths

1. **HIGH.** Every disk hydrate re-normalises the whole EPG on the main thread. `live/source.ts:196-200` loops `normalizeProgrammes` over every list. It is guarded as a migration for "snapshots written before the normalize step", but `DISK_MAX_AGE_MS` is 40 h (`epgWindow.ts:19`), so any such snapshot is long expired. Benchmark: 26,621 channels × 12 programmes (319,452) took 225 ms cold and 116 ms on already-normalised data (Node on this box). The real window is about 45 h, so likely more. This sits on the "instant start" path. **Saving: 100 to 200+ ms per Live cold start.** Fix: delete the loop, or stamp the snapshot with a schema version. CONFIRMED (synthetic benchmark).

2. **MED.** The sports catalog index and every game match are rebuilt after each background refresh.
   - A disk hydrate always starts `refreshInBackground` (`source.ts:207`), which produces a new `LiveData` object.
   - `useCatalog` caches by object identity in a WeakMap (`sports/catalog.ts:87-118`), so it misses.
   - `indexChannels` runs again: 160.8 ms on 26,621 channels (`/tmp/audit-perf/bench-matcher.cjs`).
   - `withChannels`' `RESOLVED` cache is keyed by catalog (`useGames.ts:842`), so every game is re-matched too.

   **Saving: one 160 ms+ long task per Sports visit that follows a hydrate.** Fix: key the index on a content fingerprint (ids + names), or build it in `requestIdleCallback`. CONFIRMED (code path), benchmarked.

3. **MED.** `sameSlot` builds a new `Intl.DateTimeFormat` for every candidate channel (`matcher.ts:547-556`, called per candidate at `:513`). Construct plus format costs 52 µs; formatting with a cached formatter costs 2.8 µs (10k runs: 524 ms against 28 ms). On a synthetic catalog, "Arizona Diamondbacks v Pittsburgh Pirates" made 28 `sameSlot` calls and took 2.0 ms per `matchEvent`. **Saving: about 95% of `matchEvent` cost on catalogs with per-game channels.** Fix: compute the date parts once per `matchEvent` (or keep a module-level formatter). CONFIRMED (benchmark).

4. **MED.** The full player chrome re-renders on every guide hover while Live is playing. `setPreview` (`LiveScreen.tsx:1046`) re-renders LiveScreen, which rebuilds `<TheaterOverlay frame playbackKey vod>` inside `createPortal` (`LiveScreen.tsx:1017-1027`). `TheaterOverlay` (2,068 lines) is a plain function, not `memo` (`TheaterOverlay.tsx:190`), and all three props are primitives. Fix: wrap it in `memo`, first checking it doesn't depend on a parent render to pick up `setOverlayApiOverride` (`LiveScreen.tsx:759`). CONFIRMED (re-renders); cost SUSPECTED.

5. **MED.** Guide has a dependency-less layout effect, and one pass inside it reads and writes layout alternately. `Guide.tsx:384-406` is a `useLayoutEffect` with no deps. After every Guide render it:
   - runs `unpin` (style writes, then `clipTitle`, which reads `scrollWidth`);
   - runs `clipTitles` (reads `scrollWidth`/`clientWidth` for every visible title);
   - runs `syncPins`, which writes `el.style.width` and then reads `t.scrollWidth` per lane (`Guide.tsx:366-372`). `unpin` deleted `dataset.tw`, so every lane re-measures.

   That is up to about 36 forced layouts per render: row-window shifts while scrolling, the 30 s tick, data refresh. Fix: batch all reads before writes (measure `tw` before the width write), and skip the purge when the lanes haven't changed. SUSPECTED cost (can't run WebView2 here).

6. **MED.** hls.js `enableWorker: true` does nothing, so HLS tiles transmux on the main thread. The ESM build never defines `__HLS_WORKER_BUNDLE__` (`hls.mjs:12716`), and `workerPath` is null, so `canCreateWorker` is false (`hls.mjs:18645`). Fix: `import workerUrl from "hls.js/dist/hls.worker.js?url"` and pass `workerPath` (`MultiviewTile.tsx:63`). The current CSP's `script-src 'self'` allows same-origin workers. That adds 118 KB raw (41 KB gz) to the dist. mpegts has no easy equivalent: its blob workers are blocked by the CSP (`tauri.conf.json:27`), and changing that is native. CONFIRMED (code path); main-thread cost SUSPECTED.

7. **MED.** The Settings → Sources folder editor re-renders every row per keystroke and per toggle. `PlaylistsTab.tsx:426-431` filters with `toLowerCase` plus the `isAdultCategory` regex on each render. Rows at `:500-509` pass inline `onChange` closures, so nothing can memoise. Big panels have 1,000+ folders (count not measured). Fix: `useDeferredValue(query)`, memoised rows, and a stable toggle keyed by id. SUSPECTED.

8. **LOW.** The multi-view channel search lowercases 26k names on every keystroke (`MultiviewScreen.tsx:74-83`): 1.21 ms per keystroke against 0.45 ms with pre-lowered names. Fix: lowercase once in the `channels` memo. CONFIRMED (benchmark).

9. **LOW.** `SaveButton` parses the whole `lists` blob, including base64 covers, 4 times per mount: lazy inits at `SaveButton.tsx:60-63`, then the `[item.id]` effect at `:70-73` runs on mount and parses twice more. Fix: parse once. CONFIRMED.

10. **LOW.** `RowScroller` calls `useEffect(rove)` with no deps (`StreamScreen.tsx:1938`). Every Home render does `querySelectorAll`, `matches` and a `tabIndex` write on every card in every row, even when unchanged. Fix: only write the ones that differ. CONFIRMED.

11. **LOW.** The Up Next countdown re-renders the whole StreamScreen root once a second for 10 s (`StreamScreen.tsx:630-642`). Fix: move the countdown state into the Up Next component. CONFIRMED.

12. **LOW.** `PlaylistsTab.tsx:54` calls `peekLive()` during render, so every render does `loadPlaylists()` (JSON.parse) plus `JSON.stringify` of all playlists and hidden categories (`source.ts:132-151`). Microseconds each. CONFIRMED.

13. **LOW, layout shift.** `.continue-card__art { height: 300px; width: auto }` (`stream.css:349-352`) with `loading="lazy"`. Each card is about 2 px wide until its art loads, then jumps to about 533 px and pushes the row. Fix: add `aspect-ratio: 16/9`. SUSPECTED at runtime.

14. **LOW, layout shift.** Several logos have one free dimension and shift the text next to them on load: `.theater-bar__logo` (`player.css:388`, height fixed, width auto), `.shero__logo` (`stream.css:174`), `.vod-detail__logo` (`stream.css:775`, max-* only), `.upnext-mini__thumb` (`stream.css:1038`, width only). Logo aspect is unknown, so reserve a fixed box. SUSPECTED.

### D. CSS performance

1. **MED.** An infinite animation drives a custom property that nothing reads. `.update-chip { animation: update-ring-turn 9s linear infinite }` animates the registered `--update-ring` (`base.css:463-490`). Its only consumer (`conic-gradient(from var(--update-ring))`) moved to `styles/old/buttons-blammytv.css:45` in v0.9.57 (commit 67229a84). Registered-property animations run on the main thread, so this costs a style recalc every frame, for no visible effect, whenever the update chip is up. Fix: delete the `@property`, keyframes and `animation` line, or bring the ring back. CONFIRMED.

2. **LOW.** Sports skeletons pulse `background-color`, which repaints on the main thread (`sports.css:1672-1676`, keyframes at `:1711`). It was a deliberate colour choice (comment at `:1665`). Discover's skeleton uses opacity (`discover.css:164-172`). Keep it or accept the cost, but it isn't free. CONFIRMED.

3. **LOW.** Two indicators animate `left`/`width` instead of transform: `.chip-tabs__thumb` (`ui.css:51-53`, Settings tabs and Onboarding) and `.mode-rail__indicator` (`live.css:100-103`). The latter's `will-change: width` does nothing. Each is a small layout per frame for 380 ms. CONFIRMED.

4. **Deliberate, not findings.** The `.navcap` and `.navcap__pill` layout transitions (`base.css:612-622`, `:876-881`) are documented and measured. The boot scene's `border-radius`/`filter` keyframes (`boot.css:234,254,310`) are one-shot. `AppHeader.measure()` does 3 forced layouts per nav item, but only on mount, when `showLive` changes, and when fonts become ready.

### E. CSS: what ships

- **Total shipped:** 193,995 B (33,583 gz).
  - `@layer app` (hand-written): 138,665 (71.5%)
  - Tailwind utilities: 43,066 (22.2%)
  - `@property`: 4,267
  - `@font-face`: 3,437
  - Tailwind header and theme: about 3.3 KB
  - keyframes: 600
  - vendor.css: 313
- **By source file (minified):** sports 39.2 KB, stream 19.8, player 15.2, live 14.0, settings 11.5, base 9.0, tokens 5.7, onboarding 5.4, discover 5.2, ui 4.7, boot 4.4, theme 2.1.
- **Legacy (`styles/old`, `packs.css`, `intense-packs.css`): 0 B shipped.** CONFIRMED: `index.css` imports none of them, and old/ has no importers.
- **Aurora:** 8 rules, 1,418 B shipped (already scheduled).

### F. Dead code, dead CSS, unused dependencies

knip was run with `/tmp/audit-perf/knip.json`, and every item was grep-verified.

1. **MED.** 38 app CSS rules match nothing rendered: 4,444 B of source, about 2.5 KB shipped. Each class name appears in no TSX.
   - `settings.css:371-400, 466-545, 968`: `.accent-row`, `.accent-swatch*`, `.accent-popover__row/__dropper/__hex/__hash`, `.pack-preview-note*`. The v0.9.79 AccentPicker is built on Tailwind utilities and uses none of them.
   - `settings.css:910-950`: `.license-*` (the licence form lives in old/ThemesModal).
   - `discover.css:16-68`: `.discover__toggle`, `.disc-search*`.
   - `onboarding.css:387-470`: `.onb-swatch*`.
   - `ui.css:426`: `.header__searchchip`.
   - `sports.css:1575`: `.sports__note`.
   - `ui.css:55-92`: `.chip-tabs--bare`, about 1.1 KB with its comment. No `ChipTabs` caller passes it; it is only mentioned in a comment at `ChipTabs.tsx:21`. Dead since v0.9.1 / v0.9.14.

   CONFIRMED.

2. **LOW.** The unused shadcn components still cost CSS. Tailwind scans `card.tsx`, `dialog.tsx`, `badge.tsx`, `separator.tsx` and `skeleton.tsx` even though the JS tree-shakes them out: 62 utility rules, 4,480 B. **They go when those files are deleted.** CONFIRMED.

3. **LOW.** Custom properties that are never read:
   - `--nav-settle` (`tokens.css:104`)
   - `--logo-conic` (`tokens.css:133`)
   - `--rainbow-background` / `--rainbow-stroke` (`tokens.css:382-400`)
   - `--sidebar-primary`, `-foreground`, `-ring` (shadcn sidebar scaffolding, no sidebar component)

   CONFIRMED.

4. **LOW.** Dead icons in `icons.tsx`:
   - `HeartGhostIcon` (:165), `HeartRainbowHollowIcon` (:183) and `RainbowHeartIcon` (:203): 60 lines, referenced only by the comment at `:124-126`.
   - `AccountIcon` (:70), `SunIcon` (:786), `MoonIcon` (:796), `ExternalLinkIcon` (:812) and `HeartIcon` (:840): only `old/themes/app/ThemesModal.tsx` uses them.

   These are already tree-shaken, so the saving is lines only. CONFIRMED.

5. **LOW.** Dead functions (definition is the only reference): `stalker.ts:61 resetStalkerSession` (3 lines), `stalker.ts:398 fetchShortEpg` (18), `tmdb.ts:46 setTmdbBase` (3), `languagePrefs.ts:116 onLanguagePrefsChange` (4), `racing.ts:199 sessionName` (3). CONFIRMED.

6. **LOW, native side.** Three `lib/tauri.ts` wrappers have no caller: `openExternal` (:15, only old/), `tauriMpvBlur` (:226) and `tauriMpvSnapshot` (:247). Their Rust commands `open_external` (`lib.rs:932`), `mpv_blur` (`:294`) and `mpv_snapshot` (`:402`) are registered but never invoked. The native layer is frozen until M3, so this is a pointer only. (`inv_focus`/`inv_stop_slot` are the known slot refactor.) CONFIRMED.

7. **LOW.** Exported but only used in their own file, so drop the `export` (no bundle effect): `SESSION_NAMES`, `hasSets`, `racingPath`, `OPEN_LEAD_MS`, `GRID_SIZES`, `BROADEN_FLOOR`, and `buttonVariants`, plus 24 exported types knip lists. `MIN_CONFIDENCE` is used by a test.

8. **LOW.** `tailwind-merge` and `clsx` in `apps/app/package.json` have no importers anywhere. `clsx` still arrives through class-variance-authority. The 7 `@fontsource/*` packages are unused but kept on purpose (Adam, `fonts.ts:23-42`). knip false positives: `tailwindcss` and `tw-animate-css` (CSS `@import`) and `@tauri-apps/cli` (`pnpm tauri`). Root devDependencies are all used by `eslint.config.mjs`. CONFIRMED.

9. **LOW.** Unimported files:
   - `src/styles/old/` (47.8 KB of CSS plus a README).
   - `src/assets/dither-bayer.svg` (16.5 KB), referenced only by `old/themes` CSS and `scripts/gen-bayer-svg.mjs`. Both go with the pack removal.
   - `old/` itself: nothing imports it, it isn't in the tsconfig include, and ESLint ignores it.

   CONFIRMED.

### Checked and clean

These need no follow-up:
- The matcher index is O(n) and cached per `LiveData`.
- The guide is row-virtualised.
- LiveScreen's `visible`/`heroChannel`/`playMeta` are memoised.
- `keepStable` and `withChannels` keep object identity stable.
- Discover `Card` is `memo`.
- No React context in app code.
- No `useEffect` without deps beyond the three noted above (C5, C10, and an Escape listener in `SettingsModal.tsx:65`, which is harmless).
- Other infinite animations run on opacity/transform only.
- The 70 `@supports color-mix` blocks (11.5 KB) are Tailwind's own output.

I did not measure any runtime cost in WebView2. Everything marked SUSPECTED needs the real app, a real 26k catalog, or real streams.

Status: DONE. Read-only audit; nothing to restart.

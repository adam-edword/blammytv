# Roadmap

The current plan is the first part of this file. Everything under
**History** is the record of how the app got here, kept as it was written,
and it goes stale on purpose: read it for reasons, not for status.

Rewritten 2026-09-24 against the tree rather than against the old version of
this file, which still said "v0.1.109" at the top while the app was on
v0.9.78.

## Where we are (v0.9.79, 2026-09-24)

- **Released:** v0.9.0, the Sports tab, on 2026-08-23. That is what users run.
- **Since then: 90 commits and no release, for 32 days.** The longest gap
  before this one was 12 days (0.8.202 to 0.9.0). From June to August a
  release went out every few days.
- **`main` is at v0.9.73.** The redesign's first stretch (plan 014, below)
  landed there on 2026-09-13.
- **`claude/nice-heisenberg-67k4uk` is at v0.9.79 and not in `main`.** It
  carries the sports matcher fixes, the two console probes and multi-view.
  It fast-forwards onto `main` with no conflicts.
- **No open GitHub issues.** The backlog lives in this file and `plans/`.
- **Version numbers 0.9.47 to 0.9.51 exist twice** in history, once on each
  side of the 2026-09-13 merge. Anything that quotes one of those five
  numbers (a changelog, a bug report) needs the commit hash to mean anything.

### What is in flight

| | State |
|---|---|
| **Redesign** (plan 014) | L0 done. L1 partly: Button is in 25 files, Combobox, DropdownMenu, Tooltip and Item are in use, and the accent picker (v0.9.79) is the first consumer of Input and Popover. **Card, Dialog, Badge, Separator, Textarea, Skeleton and InputGroup were generated and have zero consumers.** L2, L3 and the glass have not started. |
| **Multi-view** (plan 013) | Built and reachable off the Sports board. **Never played a frame.** Everything below the demuxer is unit-tested; the demuxer itself is untested until someone opens it against a real stream. |
| **Themes** | Parked at v0.9.58 because a pack outranks the base palette. **The current looks are being removed and the concept returns after 1.0 with new ones.** The accent picker is back on its own in v0.9.79 (decision 1 below). |
| **Sports matcher** | Probed against the real 26,621-channel catalog on 2026-09-13 and fixed from that data. ACCNX, SECN+ and ESPNEWS still miss. |

### Debt from the multi-view work

- **Multi-view's UI is hand-written.** v0.9.76 to 0.9.78 added about eight
  plain `<button>`s, a hand-rolled dialog and a plain `<input>`, after
  v0.9.54 made shadcn's Button the rule for every standalone button. It
  works, and it is exactly the drift plan 014 exists to stop.
- **The native slot refactor is dead weight, and it is the ONLY native
  change since 0.9.0.** v0.9.48 on the multi-view branch turned mpv's one
  player into four, for a native multi-view that became a web one.
  `PLAYERS[4]` only ever holds slot 0, and no native grid was ever built on
  top of it, so it is not a fallback either. `tileRects` and `holesClip`
  are unused for the same reason. Measured 2026-09-24:
  `git diff v0.9.0 origin/main -- apps/app/src-tauri` is empty. The whole
  redesign is frontend. Those three files (`inv.rs`, `lib.rs`, `mpv.rs`) are the one
  thing standing between the next release and a frontend-only one, which
  matters for M3 below.
- **The 2026-09-24 audit: [`docs/audit-0.9.79.md`](docs/audit-0.9.79.md),
  and the plan that works it: [`plans/016-audit-work.md`](plans/016-audit-work.md).**
  Its P0 (the documented hot-channel `tar` command builds a bundle every
  installed copy refuses, and CI runs none of the gate) is Track 0 and has
  to land before M3 ships. Track 1 is the user-visible breakage (Sports
  tuning dies after 30 minutes, the Guide star is invisible, every icon in
  a Button renders at 16px) and belongs in M1. Tracks 3 to 5 are M2 and
  M3's work list; Track N waits for the first native release after M3.
  **Eight decisions come first (D1 to D8), each with a recommendation.**
  Also, M1 step 5's file list below is partly stale: `packs.css`,
  `themePacks.ts`, `verify-intense-themes.mjs` and the rest already sit in
  `old/themes/`; what is left is Aurora in `accent.ts`, `tokens.css`,
  `ui.css`, `onboarding.css` and verify-tailwind's check 8.
- ~~Docs that disagree with the tree~~ Fixed with this rewrite: HANDOFF's
  `"csp": null` line (the CSP shipped in v0.8.115), and `plans/README.md`
  now marks 010 shipped and has a row for 014.

## Decisions, taken by Adam on 2026-09-24

Put to him with a recommendation each. Three went against the
recommendation and one is still open; the plan below follows what he
chose.

1. **Themes: the current looks go, the concept comes back, and the accent
   picker comes back now.** Settled in three answers the same day. First
   "cut"; then *"I do want themes back eventually. So let's make sure to
   keep the groundwork"*; then *"I do want to lose all the themes we have
   now though. But I want the concept of themes to come back."* Themes as
   a concept are not a 1.0 gate ("eventually" is read as after; say so if
   it should land sooner). Paid or free is undecided and does not need
   deciding yet.
   - **Lose the looks, in M1.** Every pack: Classic, BlammyTV, OLED,
     Paper, Streamy, the intense four (Terminal, Dither, Kawaii,
     Supporter) and the premium Nebula. And Aurora. That means
     `packs.css`, `intense-packs.css`, the pack lists in `themePacks.ts`,
     `verify-intense-themes.mjs`, and the Aurora code in `accent.ts`,
     `tokens.css`, `ui.css` and `onboarding.css`. Aurora has not been
     applied at startup since v0.9.60, so nothing a user sees changes
     when it goes.
   - **Keep the machinery.** The switching (`loadThemePack`,
     `applyThemePack`, the `[data-theme-pack]` attribute), the paid-payload
     seam (`injectPackCss`), `license.ts` and `verify-license.mjs`,
     `ThemesModal.tsx` as a reference for the picker, `fake-keybox.mjs`,
     and `services/keybox`, which is deployed and should stay up. The
     Stripe product behind the Themes Pass sells packs that will no longer
     exist; retiring it is Adam's.
   - **The accent picker comes back now** (M1), not with themes. Adam asked
     "Can this come back now?" and it can. The plumbing still works:
     `applyAccent` sets `--accent` and a computed `--accent-ink`, and the
     shadcn bridge maps `--color-primary` and `--color-primary-foreground`
     onto those two, so a light accent gets dark text on its buttons
     without anyone having to think about it. What is missing is a place
     to pick one (it lived inside the Themes modal) and the one boot line
     in `main.tsx` that v0.9.60 removed on purpose, because a stored accent
     with no picker to change it could never be cleared.
   - **Keep the redesign themeable.** Measured 2026-09-24: every colour in
     the shadcn layer reaches the app's own tokens through `@theme inline`
     (`--color-background: var(--bg)`), so a pack that redefines `--bg`,
     `--surface` and the rest under `[data-theme-pack]` repaints shadcn
     components too. Only seven raw colour utilities exist, all scrims over
     posters or video (`bg-black/50`, `hover:bg-black/60`) or shadcn's white
     on destructive red, which should look the same in any theme. Keep it
     at that: new colour goes through a token, and a raw colour utility is
     for a scrim over imagery and nothing else.
   - **The base tokens are the default look.** What forced the parking was a
     default PACK pinning `--bg` and friends from a file imported after
     `tokens.css`, so the new palette never showed. When themes return,
     "no pack selected" has to mean "the tokens as written", and a pack
     only ever exists for a look that is not the default.
2. **Trakt and MAL: A 1.0 GATE**, as decided in July. It was recommended
   for after 1.0 on size (OAuth device flow, token storage, offline queue,
   two-way conflicts). It stays a gate, so it is M4 below, and it gets its
   own plan before any code: the conflict rules are the hard part and
   should be decided on paper.
3. **Code signing: OPEN.** Adam asked whether there is a one-time fee.
   There is not, from SIGNING.md, checked against primary sources on
   2026-08-07: code-signing certificates have always been annual, keys
   have had to live on hardware since June 2023, and since February 2026
   no certificate is valid for more than ~460 days, so even a multi-year
   purchase needs reissuing. The only free route (SignPath) needs an OSI
   licence and probably rejects the bundled `libmpv-2.dll`. The cheapest
   real path is Azure Artifact Signing at $9.99/month, cancellable monthly.
   **Decision 4 changes when it matters**: reputation only accrues from
   installs of signed builds, and with no release until the redesign is
   done there is nothing to sign before M3. So the question is only
   whether the M3 release is signed, and there is no cost before then.
4. **Release: HOLD for the finished redesign.** Recommended the other way
   (release after M1). The next release is the M3 "new look" release; M1
   and M2 end green but do not ship.

## The plan to 1.0

Milestones, not version numbers. Each one ends green. Only M3 and M5
ship, per decision 4.

**The native freeze is lifted (2026-09-24, v0.9.101).** It was here to
keep 0.10.0 frontend-only, so it could be the hot channel's first run.
Multi-view then needed a native stream proxy (Adam's provider stopped
sending CORS headers), and Adam: "a full installer is fine. that should
never be a deterrent to building anything." So:
- 0.10.0 is a native release, through the installer.
- The hot channel (plan 008, built in v0.7.14 and v0.7.33, never run)
  gets its first run on the first frontend-only release after 0.10.0. A
  smaller release is the safer first run anyway.
- Plan 016's Track N no longer waits for "after M3": it can ship in 0.10.0.

### M1: clean up what is decided

1. ~~**Revert the native slot refactor**~~ **Done in v0.9.94.** `inv.rs`,
   `lib.rs`, `mpv.rs`, `hole.ts` and `tauri.ts` are back to v0.9.0's
   bytes, `tileRects` is gone, and `git diff v0.9.0 -- apps/app/src-tauri`
   is empty. (The freeze that followed is lifted; see above.)
2. ~~**Adam runs multi-view against real streams**~~ **Run 2026-09-24.**
   Every tile failed, Cartoon Network included, on a 302 with no CORS
   header (v0.9.100's console lines named it). His provider sent the header
   on 2026-09-13 and no longer does. v0.9.101 reads streams through a
   native loopback proxy (`mvproxy.rs`). Through it, and on v0.9.102's
   buffering, three tiles measured 0 frames dropped, 0 jumps, one 0.6s
   stall in 20s, ~60fps each. A stutter every 20 to 30 seconds went on
   v0.9.103 ("feels good", 60s with 0 hitches and 0 stalls); v0.9.104
   drops the 1.1x catch-up altogether. Paramount+ 01 still fails: the
   provider redirects it to a hostname that does not resolve, which is the
   channel, not the app.
3. ~~Move multi-view onto the primitives~~ **Superseded by plan 017**
   (2026-09-24), the full multi-view design Adam asked for after using it:
   an immersive mode, 16:9 tiles, info and controls on every tile, a
   search-first picker. Built on the primitives from the start.
4. ~~**Bring the accent picker back**~~ **Done in v0.9.79.** Settings →
   Customize, top of Interface: a Default swatch (no accent, follows light
   and dark), the seven presets, and Custom (react-colorful, the
   EyeDropper, a hex field). Built on Button, Popover and Input. The boot
   line in `main.tsx` went back in the same commit. `verify-accent.mjs`
   covers the ink flip (Yellow dark, Blue light), the popover sitting above
   the Settings sheet, the boot line (mutation-tested), and Reset. The
   presets were looked at on screenshots and kept as they were.
5. ~~**Remove the current looks**~~ **Done in v0.9.95.** The packs, their
   lists and `verify-intense-themes.mjs` were already in `old/themes/`.
   Aurora is out of `accent.ts` (the style, its hue, the easter egg),
   `tokens.css` and `ui.css`, both cut by marker with a brace check, and
   verify-tailwind's check 8, which forced it, is retired. The pack-pairing
   key in `accent.ts` stays with the rest of the theme machinery.
6. **Plan 016's Tracks 0 and 1** (done), and **plan 017** in place of
   016's Track 2. 017's P1 shipped in v0.9.105: multi-view is its own tab
   between Guide and Sports, with its own auto-hiding bar and every picture
   16:9. P2 shipped in v0.9.107: each tile says what is on, why it
   failed, and closes from its own X. P3a shipped in v0.9.109: a
   search-first picker in place of the rail, a grid that follows its
   channels up to the line's limit, and the grid remembered. P3b (live
   games) is next.
7. Merge the multi-view branch into `main` (Adam's step: default branch).

### M2: finish the primitives (plan 014 L1 and L2)

- Adopt or delete the seven generated components nobody imports. A
  component with no consumer is a promise nobody is keeping.
- Settings modal onto Dialog, which should let `lib/modalOpen.ts` shrink
  or go (plan 014 phase 1).
- Switch and ChipTabs take shadcn's surface **and keep their thumb**. Adam's
  constraint, 2026-09-06.
- L2: header, nav capsule, app shell. **Move `RowScroller` and `Card` out
  of `StreamScreen.tsx` into `ui/`.** A screen that exports primitives is
  why "redo one screen" keeps touching three.

### M3: the screens and the glass, then release (plan 014 L3)

- Screens in dependency order: Settings, Live, Stream / Discover / Library,
  Sports last because its cards are the most bespoke thing in the app.
- Glass tiers per plan 014, on the one rule it earned the hard way: glass
  only where there is content behind it to see through. Never over the mpv
  surface, which cannot be composited with.
- `prefers-reduced-transparency` and a light-mode contrast pass, together,
  with a `verify-glass` harness.
- **Release it: the new look, 0.10.0.** A native release through the
  installer (the stream proxy is native). Signed, if decision 3 says so;
  this is the first build where signing would buy anything.
- **Themes, in the same release's words.** 0.10.0 is the first release
  without packs, and 0.9.0 users who picked one lose it (a picked accent
  colour is not lost; the picker is back from M1). The changelog says
  themes are coming back with new looks rather than pretending nothing
  moved, and
  `services/site` stops selling the Themes Pass as a thing you can buy
  today. Both change at release, not before: until then the site describes
  0.9.0, which does have themes.

### M4: Trakt, then MAL (decision 2)

- **A plan first** (`plans/015`), before any code. The hard part is not
  OAuth, it is two-way conflict resolution: a title that is on the local
  list and was removed on Trakt has no obviously correct winner, and the
  rule has to be decided rather than discovered.
- Trakt first: its device-code flow needs no redirect URI, which suits a
  desktop app. The data model needs nothing; every stored entry is already
  keyed by IMDb id.
- A token is a credential. Where it is stored gets the same scrutiny as
  playlist passwords.
- MAL after, for the anime lists. The IMDb to MAL mapping is already in the
  tree for aniskip.
- Built on the M2 primitives, so its UI never needs converting.

### M5: 1.0

- TheaterOverlay's clock: it re-renders the whole 1,400-line overlay ten
  times a second during VOD. Measure render counts before and after.
- Every harness green, no generated component without a consumer, docs
  that match the tree.
- Signed, with the reputation M3's installs have built, if decision 3
  says sign.

### Alongside, whenever there is room

- **An app-wide command palette** (Adam, 2026-09-24, on plan 017's M3:
  "bookmark this as a full app feature down the line"). Multi-view's picker
  is its first shape: search-first, keyboard-complete, rows with logos and
  what is on. Grown out to channels, films and series, Settings and actions,
  it is also the Ctrl+K channel search the Live slate ranked first.
- **Sports matcher leftovers.** ACCNX and ESPN+ are carried as per-fixture
  event channels ("Liberty vs. Virginia (ACCNX)"), which is `matchEvent`
  territory. Run `btvSports()` on a college Saturday first; whether those
  games already resolve by team name is the open question.
- **Multi-view phase 4:** tell the viewer when a tile's stream dies, at a
  slower cadence than the 500ms player poll.
- **EPG coverage:** one log line from Adam's next launch settles whether
  v0.9.28's normalised matching recovered anything.
- **Plan 011, a Live home screen**, three questions still open.

## What 1.0 means

One design system across every screen, with the handful of documented
exceptions and nothing else. The glass done. Every colour reachable by a
future theme, so bringing them back is a pack and not a refactor.
Multi-view proven on real streams. Trakt and MAL sync. Docs
that describe the tree. A signed installer, if decision 3 goes that way.

Not in 1.0: recording, anything else below.

## After 1.0

- **Recording to disk.** Named as the post-1.0 headliner since July.
- **Themes, the concept, with new looks** (decision 1). New packs as
  overlays on the settled tokens, under `[data-theme-pack]`, with no default
  pack. The machinery is in `old/themes/`; the looks are gone by then and
  are designed fresh. Cannot start before M3: tokens that are still moving
  cannot be themed. Paid or free gets decided then; `services/keybox` is
  still up if paid.
- **Android TV.** A branch exists from June, before the rebuild, so it is a
  starting point for the packaging and little else.
- Timeshift, the mini-guide strip.

## Working habits (so a fresh session does not relearn them)

- **Version bumps** on every user-visible frontend change: root
  `package.json`, `apps/app/package.json`, `apps/app/src/lib/version.ts`.
  Leave `Cargo.toml`/`tauri.conf.json` alone except at release: bumping
  them forces a Rust rebuild on `pnpm tauri dev`.
- **Check the branch before starting.** `main` sat at v0.9.46 for a week
  while the real line was `claude/requests-b2t4w9`, and a session built five
  versions on the wrong base because of it.
- **Verify with data before shipping.** `pnpm verify` for the harness board
  (read the STATUS column, CRASH is the one that matters),
  `node scripts/check-rust.mjs` for the Rust, and the console probes
  (`btvSports()`, `btvMultiview()`, `btvDiscover()`) for anything that needs
  Adam's real catalog. CLAUDE.md has the details.
- **Windows is the target, Linux is the sandbox:** no case-sibling filenames
  (guide.ts vs Guide.tsx broke the Windows build); compositor and raster
  bugs may exist only there.
- **Never publish a GitHub Release below v0.2.4** without the pre-release
  flag: old installs' updater watches `latest.json` (see RELEASING.md).
- **Styling goes through the design system now.** Tailwind and shadcn since
  v0.9.49: a standalone button is `<Button>`, and plan 014 lists the three
  legal ways to override a variant (`!important` is not one). Colour still
  comes from tokens, and that is what keeps Themes possible later: a raw
  colour utility is for a scrim over imagery and nothing else (see
  decision 1). Icons: coolicons-style strokes in `ui/icons.tsx`.

# History

## Where we were (v0.1.109)

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
    straddling the lane edge swaps to position:sticky (imperatively: React
    never renders pins) and its width is driven per-frame from a rAF.
    Restoration truth lives in React-rendered `data-left`/`data-width`.
    Scrubbing benchmarks identical to a listener-free DOM clone.
  - **Scars, do not reopen:** no `will-change` on pinned cells (WebView2
    reuses stale raster offsets across the abs→sticky swap: geometry clean,
    pixels wrong); no sticky text inside `overflow:hidden` cells (the cell
    becomes the scrollport); no `content-visibility` around sticky
    descendants (layout containment scopes them); imperative styles survive
    React renders AND HMR. Always restore from rendered attributes and
    purge on every render pass.
- Quality badges to the exact Figma gradients with border-box gradient rings;
  `extractQuality()` (tested) runs on real channel names.
- **Modes wired (v0.1.59).** Favorites filters the guide to starred channels;
  Recents (`recents.ts`, move-to-front, cap 30) records selections; empty
  modes show a centered nudge. Both persist and verified via Playwright.
- **Xtream content wired (v0.1.60): no player yet.** `model.ts` is the one
  domain shape (Channel/Programme/LiveData, ids namespaced
  `<playlistId>:<streamId>`); `source.ts#loadLive()` is the seam: real
  playlists when configured, `mockLive()` otherwise, so the mock stays the
  dev harness *(historical: the mock was removed in 0.7.0; empty LiveData
  on zero playlists, and the Live tab hides itself)*. Strategy is the old build's, confirmed on origin/main:
  authenticate → `get_live_categories` + `get_live_streams` (all streams,
  two calls) → full `xmltv.php` parsed with DOMParser (`xmltv.ts`, windowed
  −1h..+12h, filler titles dropped, matched by `epg_channel_id`). Per-source
  best-effort: a failing playlist or EPG never sinks the others (group
  carries `error`; channels render No-Information lanes without EPG).
  `hiddenCategories` drops folders AND their channels. Logos render
  `stream_icon` with lettermark fallback. Guide/Hero consume passed
  programme arrays, no mock imports left in either. Live data refreshes
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
  build never did this: it always scoped to one category). Fixes: concat
  instead of spread; **guide rows are virtualized** (spacer-div window,
  ±5 overscan, re-render only on 68px row-boundary crossings: horizontal
  scrub stays render-free and the pin system rides the purge-first resync
  untouched); loading status narrates per-stage progress
  (sign-in/channels/guide download/parse) with `[live]` console timings, so
  a wedged stage names itself. 220k channels: interactive in ~5s, bottom of
  the 15M-px scroll renders, folder filter ~300ms, horizontal p95 16.7ms.
  Watch for: a frozen "Fetching channels…" in the Tauri app means the 90MB
  string is stuck in the `invoke` IPC bridge: that fix is Rust-side
  (stream to disk / byte channel), gated behind a milestone.
- Floating glass nav (progressive-blur experiment parked, commented in
  base.css), F11/Escape fullscreen keys, `--header-h` published by measure.
- `src-tauri` ported wholesale from the old app (Schannel TLS fix, mpv
  composition, updater). [2026-07-09: HISTORICAL: the comp_* surface below
  was deleted at the v0.1.135 milestone; the current API is inv_open/
  inv_set_rect/inv_stop + popout_open/popout_pos/popout_stop + mpv_*. The
  "do not touch" here referred to the comp era.] The Rust player API was
  COMPLETE then: `comp_theater/comp_set_rect/comp_stop/comp_key/
  comp_popout` + the `comp-*` events; geometry is PHYSICAL device pixels
  (frontend multiplies CSS px by devicePixelRatio, still true); the overlay
  was a second webview of our bundle loaded with `?overlay=1` (today: a
  test seam only).
- **Native player: Phase 1 VERIFIED working on Windows (v0.1.75).**
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
    overlay tree (looks like "webview didn't load"). Match the bridge types
    exactly. A pre-React DOM probe distinguishes "webview didn't composite"
    from "React crashed."
  - **Known native (Rust) items, batch into one Windows pass:**
    (1) round the VIDEO: `round_child`'s window region is bypassed by mpv's
    D3D flip swapchain (intermittently sharp); fix with a DirectComposition
    clip. (2) `cursor: pointer` over the playing video: the mpv child owns the
    OS cursor and `theater_wndproc` doesn't handle `WM_SETCURSOR`; add a handler
    (`SetCursor(IDC_HAND)` for `HTCLIENT`, or forward the overlay's requested
    cursor). CSS `cursor:pointer` is already set on `.overlay`, inert until this
    lands. (3) tighter channel switch WITHOUT losing the overlay: the switch
    gap exists because the overlay WebView2's `Close()` is async and rebuilding
    without a gap races it (tried removing the gap in v0.1.76: video rebuilt
    but the overlay didn't come back; reverted). A real fix waits for the close
    to settle Rust-side. The idle box is black `#000` + `#ffffff10` so the gap
    reads clean meanwhile.

- **Native player Phase 2: theater + fullscreen (v0.1.78), needs Windows
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

- **Catch-up / timeshift: groundwork landed, feature SHELVED (v0.1.97).**
  Spiked it because a provider's `get_live_streams` flags catch-up per stream
  (`tv_archive` + `tv_archive_duration` days). Kept, tested, ready: those
  fields parse into `Channel.archiveDays` (`source.archiveDaysOf`, string-
  coerced/guarded), and `stream.ts#catchupStreamUrl` builds both standard
  Xtream timeshift URLs (path + php) with the server-tz question isolated in
  `formatTimeshiftStamp`. Shelved because the **test provider advertises
  catch-up but doesn't serve it**: proven four ways (probe `200 · 0B` at
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
  streams + a representative ~57MB guide): CPU work is minor: JSON.parse 31ms,
  streams+map ~430ms, xmltv parse ~700ms. The cost was **downloading the guide
  raw**: reqwest was built `default-features = false` with only `native-tls`,
  so `http_get` never sent Accept-Encoding. Enabled `gzip`/`brotli`/`deflate`
  on the client (`Cargo.toml` + `.gzip(true).brotli(true).deflate(true)`).
  Measured ratios on the representative guide: xmltv 56.9MB → **2.4MB** gzip
  (23:1), streams 7.1MB → 0.6MB. **Verified on Windows via the v0.1.103
  `[http]` terminal diagnostics:** compression engaged (95.4MB of xmltv in
  ~2.1-3.6s ≈ compressed wire), whole Rust-side fetch ≈ 4s. The REAL
  remaining killer the diagnostics exposed: **the entire pipeline ran
  twice**: StrictMode's dev double-effect fired two concurrent loadLive
  calls, the cache only writes post-completion, and there was no in-flight
  dedup → double fetch + double IPC haul + double 95MB DOMParser. Fixed in
  v0.1.104 with a single-flight guard (concurrent callers share the
  promise, stage callbacks fan in; forced refreshes bypass). NOTE: gzip
  does NOT shrink the IPC haul: the decoded 95MB string still crosses the
  invoke bridge once per load. If single-pass load is still slow, next
  levers in order: measure the frontend-vs-Rust delta from the [http] +
  [live] logs (that delta = IPC + DOMParser), then the byte-channel /
  stream-to-disk IPC rework, then overlapping xmltv with cat+streams.
  **All landed (v0.1.105-106), measured on Windows: 11s → ~4s** via raw-bytes
  IPC (tauri::ipc::Response: no more JSON-escaping the 95MB body; verified
  against the locked tauri 2.11.3 source) + xmltv download overlapped with
  cat+streams. Then **disk hydration (v0.1.106)**: the parsed catalog
  persists to IndexedDB (structured clone: Maps/Dates native, one record,
  keyed by the playlist-config fingerprint, 8h max age) and a fresh launch
  hydrates instantly while a background revalidation swaps fresh data in via
  onLiveRefreshed (same silent path as playlist edits). Verified against the
  20k-channel fake panel: cold 2.9s → **hydrated reload 0.24s**, with
  revalidation confirmed running behind it. Single-flight note: the slot is
  claimed SYNCHRONOUSLY before the async disk probe: an await between the
  join-check and the claim re-opens the StrictMode double-load race.
  Remaining lever if ever needed: Rust-side windowed xmltv parse (ships only
  the −1h..+12h slice, kills the 95MB DOMParser pass).

- **Settings-over-player (v0.1.114, needs Windows verify).** The settings
  modal rendered BEHIND the playing video: the mpv child HWND + composition
  overlay are native layers above the main webview, so no CSS z-index can
  cover them (Telly wins here by compositing video as a texture inside its
  UI, not our architecture). Fix rides the existing rect driver: App.tsx
  sets `data-native-hidden` on the root while the modal is open, and
  CompositionPlayer's rAF parks the native layers in a 2×2 offscreen rect
  (not 0×0: avoids WebView2 zero-bounds edge cases) until it clears. Audio
  keeps playing; the picture snaps back on close. Any future full-cover
  surface (Ctrl+K palette) can reuse the same flag.

- **Brand (v0.1.107–109).** The gradient-ring mark is the app identity:
  `public/logo.png`/`logo.svg` in the header + the full `src-tauri/icons`
  set, and `build.rs` declares `rerun-if-changed=icons/icon.ico` so an icon
  swap re-embeds without a clean build. The mark's center is transparent by
  design (reads perfectly on the dark header); if the OS taskbar icon ever
  needs a filled center, that's a deliberate, separate change.

## Live TV 1.0 slate (persona discovery, 2 runs, 8 personas: this section
## is the surviving summary; the scratchpad report died with its container)

Audience: desktop switchers from Windows IPTV clients + Stremio users, AND
newcomers to both (first-five-minutes activation weighs as much as switcher
parity). Telly = live-TV quality bar. In value order:
[Adam's 2026-07-09 triage: #1 #2 keep (awaiting Figma); #3 keep LOW-prio;
#4 reshaped: NO chip in the EPG UI, show the channel number in the HERO
data on hover instead (Xtream `get_live_streams.num` → model → hero);
#5 approved; #6 post-1.0; Stream tab post-0.2.0; timeshift backburner;
**M3U + Stalker sources PULLED INTO v0.2.0 scope**; stats overlay keep;
ambient/motion post-0.3.0; programme-level hero selection keep; hole-rim
seam stays as-is; landing page greenlit (artifact first).]

1. **Ctrl+K channel search** (M): unanimous 7/7 personas; wire the drawn
   header icon into a fuzzy command palette; needs Adam's palette design.
2. **Stream resilience + tune-in ident** (M): ✅ frontend half SHIPPED
   v0.1.102 (see below). Remaining half ✅ SHIPPED v0.1.133: mid-play death detection via the
   mpv_status poll (`ended` re-arms the tune watchdog): no comp.rs event
   needed (comp.rs is deleted).
3. **In-player zapping + last-channel + now/next OSD** (M): closes the
   fullscreen dead end; core zap + toast only (mini-guide strip post-1.0).
4. **First-run welcome + validated paste-anything add** (M): kill the silent
   mock catalog; Test & Add with human error copy; pairs with Adam's
   onboarding Figma. Xtream-only at 1.0.
5. **Audio/subtitle track menus** (S): ✅ SHIPPED v0.1.110 (see below).
6. **Adult-hide by default** (S): ✅ SHIPPED v0.1.113. Global "Show adult
   content" toggle (Settings → Playlists, default OFF). Adult categories
   (panel `is_adult` flag (coerced in `fetchLiveCategories`) or the
   conservative word-bounded name pattern in `live/adult.ts` (xxx / porn /
   adult(s) / erotic / 18+, with an Adult Swim exception)) merge into the
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
7. Stretch: channel-number chip: ✅ SHIPPED on the sprint branch
   (v0.1.133/134): hero-only per triage #4, `#137` dark pill right of the
   channel name, Customize → "Channel Numbers" toggle (default on,
   `settings/channelNumber.ts`). Favorites drag-reorder: data layer landed
   (`reorderFavorite` + favorites-order rendering), drag-handle UI deferred
   to a desk session.
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
  to choose: Adam's call in v0.1.112 (they originally hid, which reads as
  "feature missing" on the common 1-audio/0-subs stream). Selection
  is optimistic; the Rust 500ms poll re-pushes the real `selected` flags and
  confirms/corrects. An open menu holds the auto-hide chrome awake; Escape and
  picture-clicks close the menu before their usual actions; mini stays
  menu-free. Verified 12/12 headless (`scripts/verify-overlay-tracks.mjs`,
  mocked bridge: the tune-watchdog pattern) + screenshot. Still wants a
  Windows eyeball on a real multi-audio channel. The tune watchdog lives in
  TheaterOverlay: `loading` flips false only on mpv's first frame, so a dead
  channel = loading stuck true. After 10s with no frame the overlay silently
  reloads the stream in place (goLive = re-loadfile, the live-edge mechanic),
  twice with the loader-watch still armed; out of retries → an honest "This
  channel isn't responding. It's the stream, not you" card with Retry. The
  bare "loading" pulse became a branded tune ident (logo + channel +
  programme). Verified headless with a mocked overlayApi bridge: 8/8 asserts
  across the full escalation (real 10s timers). Mid-play death detection
  landed later via the mpv_status poll (v0.1.133; `ended` re-arms the
  watchdog): the comp.rs end-file event it once waited on never existed
  and comp.rs is now deleted.

## Layer inversion (Telly-parity architecture): SPIKE PASSED, A0 IN TREE

**Spike result (Adam's machine, first build, v0.1.115):** PASSED. Video
through the hole, chrome/cards/animation above the video, flip present mode
(the quality path) composites cleanly under the webview. Glass finding:
backdrop-filter over the hole is TINT-ONLY (no blur of the native video),
which is the status quo, not a regression: the comp.rs overlay never truly
blurred video either (WebView2 can't sample another window's pixels). Tint
glass is the design language over video, as it already was.

**A0 (v0.1.116): the inverted player runs in the REAL app behind a dev
flag.** Ctrl+Shift+U in dev flips old ↔ new player and reloads. Mechanics:
the main window is now `transparent: true` (tauri.conf: replaces
`backgroundColor`; with the flag OFF, body still paints var(--bg) so
nothing changes visually beyond a possible brief launch flash); with the
flag ON, `.app-shell` becomes the window's only opaque paint (base.css
`.invert-player` rules) and CompositionPlayer's same rAF driver cuts an
evenodd clip-path HOLE through it at the slot rect while driving
`inv_open/inv_set_rect/inv_stop` (inv.rs: child at HWND_BOTTOM, flip
model, no overlay webview, no DComp). Parking (modal open) also heals the
hole, so Settings stays fully opaque mid-play. Keyboard chrome only in A0
(LiveScreen drives mpv directly: space/k pause, m mute, f/t/Escape sizes,
arrows/j/l seek: no overlay to forward comp_key into). Rust side for A1 is
already registered: `mpv_pause/mute/volume/seek/go_live/track` +
`mpv_status` (pos/dur/presenting/tracks poll: replaces the bridge's push
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
- TheaterOverlay grew a `frame` prop ("mini"/"theater"/"fullscreen"):
  inline, the window heuristics are meaningless, LiveScreen passes its own
  state; handlers read it via ref (miniNow/fsNow). Its document key handler
  now preventDefaults handled keys and skips arrows on buttons (inline it
  shares the app document: roving tablists own their arrows). LiveScreen
  does NOT forward comp_key when inverted (double-fire).
- The chrome portals into `#inv-chrome` on document.body (outside the
  shell = outside the clip hole), which CompositionPlayer sizes to the slot
  rect each frame alongside the hole; z 45 (above theater backdrop 40).
- SettingsModal portals to document.body too (z 60) and the inverted path
  no longer parks: the video PLAYS behind the settings card, the Telly
  moment, and the modal card sits clean above it. Comp path still parks.
A1 verified on Windows: chrome + theater + fullscreen + Settings-over-live-
video all work. **A2 (v0.1.118) fixed Adam's three findings:**
- **Frost-behind-modal (needs rebuild):** DOM backdrop-filter can never
  sample the native video (separate window: researched and closed), so
  mpv blurs ITSELF: `frost.glsl` (downsample /8 + two-pass gaussian, GPU,
  trivial cost) ships via include_str!, lands in a temp file, and
  `mpv_blur` toggles mpv's `glsl-shaders` chain when the modal opens
  (additive `mpv::set_glsl_shaders`, first do-not-touch exception,
  3 lines, Adam-covered by the rip authorization).
- **Transition glitch (t between theater/mini):** two causes, two fixes.
  TheaterOverlay now derives mini/fs from the `frame` prop IN RENDER (the
  state+effect route painted one frame of old layout in the new box), and
  the driver two-phases geometry: clip the hole to old∩new FIRST (the
  video covers that overlap throughout the move: the desktop can never
  peek through), push the native rect, then open the full hole + snap the
  chrome one frame after the move lands.
- **Mini corner radius:** the hole stays square; `#inv-chrome
  .mini-overlay::before` paints the four corner bites in var(--bg), the
  theater fake-corner radial-gradient trick, applied to the inline mini.
**A3 (v0.1.119, frontend-only):** Adam vetoed the whole-picture frost look
and the painted corner bites read funky. New treatment:
- **Modal-over-video = dim scrim** (the chrome host darkens to 60% with a
  fade while `data-native-hidden` is set; video keeps playing). The
  researched blur menu, for Adam's pick later: (1) scrim: SHIPPED; (2)
  tuned shader (/4 + wider gaussian + desat: mpv_blur stays in the build,
  dormant); (3) frozen-frame glass (screenshot → DOM blur under the card,
  picture freezes); (4) region blur under the card via --glsl-shader-opts
  (libmpv-version dependent: probe get_property("mpv-version") first).
  (5) render API → DComp surface is REJECTED as a blur solution (Adam's
  call, 2026-07-09, and he's right): it keeps mpv's native RENDERING but
  forfeits the native PRESENTATION path (fullscreen independent-flip /
  direct scanout and mpv-owned HDR swapchains), i.e. the actual point of
  a native viewer, traded for cosmetics. Only revisit if something far
  bigger forces it, and then only behind a spike proving HDR + fullscreen
  parity. DOM backdrop-filter over the native layer is impossible, full
  stop.
- **Corners are now REAL**: the hole itself is a rounded rect:
  `clip-path: path()` with a clockwise outer rect + counter-clockwise
  inner rounded rect, so the default nonzero fill rule cuts the hole (no
  evenodd dependency). 12px in mini, 0 squared; corner-mask CSS deleted.

**A4 (v0.1.121): frozen-frame glass: built, then REJECTED by Adam (the
video must VISIBLY keep playing behind the panel).** `mpv_snapshot` +
`mpv::screenshot_to_file` (second additive do-not-touch exception) stay in
the build, dormant: future channel thumbnails. Settings modal is centered
now (v0.1.120, Adam's call: the top-right float predates video-behind).

**A5 (v0.1.122, needs rebuild): LIVE region frost: the endgame modal
treatment.** mpv GPU-blurs ONLY the rectangle under the settings card,
every frame: a /8 SAVE pass + a rect-branched composite pass
(`FROST_REGION_TEMPLATE` in lib.rs), with the card rect BAKED into the
shader source at write time (video-normalized; LiveScreen measures
card+slot, re-bakes on resize via `mpv_frost`). SUPERSEDED SAME NIGHT by
**A6 (v0.1.123)**: Adam's terminal answered the version question: **mpv
v0.41.0-724-g71ebd0840, a bleeding-edge dev build** (gpu-next default), so
rect-baking's file-rewrite+reload dance (which left stale frost on tab
switches and lost the rect on window resize) was replaced with //!PARAM
uniforms: the shader loads ONCE (`mpv_frost on/off`, degenerate-rect
defaults = disabled) and every geometry change is a `glsl-shader-opts`
property set (`mpv_frost_rect`, mpv.rs `set_shader_opts`, third additive
exception). Frontend: rAF-throttled pushes from a ResizeObserver on the
card AND the slot plus window resize; pad dropped to 0 so the frost hugs
the card exactly (no halo). `mpv_frost` prints `vo=` to the terminal:
if it ever says `gpu` (not gpu-next), PARAM is unsupported and frost is
silently absent; that's the diagnostic. Hole scrim 0.25. mpv_blur
(whole-frame) stays dormant; render-API/DComp REJECTED (above).

**A7 (v0.1.124): A6 verified feeling great on Windows; polish + shipping
story.** (1) Player chrome fades out under modals (`data-native-hidden`
opacity rule): the "DOM not blurring" report was transport chrome showing
through the card; hiding it beats blurring it, leaving only frosted video
under the glass. (2) `mpv_frost` now RETURNS capability (current-vo must
be gpu-next for //!PARAM); LiveScreen stamps `data-frost="0"` when
unsupported and the settings card downgrades to a SOLID var(--bg)
background: Adam's requirement for users on older mpv. (3) The installer
already bundled src-tauri/libmpv-2.dll (tauri.windows.conf.json, DLL
gitignored); `scripts/fetch-libmpv.mjs` now refreshes it to the latest
shinchiro build (GitHub API + 7-Zip, manual fallback printed), and
RELEASING.md gained step 0. Adam's dev machine runs mpv v0.41-dev
(gpu-next default), so frost is live for him.
~~Remaining before default-flip~~ → default flipped v0.1.132, desk parity
pass (popout + HDR) PASSED 2026-07-09, and the **v0.2.0 deletion milestone
LANDED (v0.1.135)**: comp.rs + spike.rs + the overlay webview + the
invertPlayer flag are gone; the batched WM_SETCURSOR / DComp corner-clip /
async-close switch-gap scars died with them as predicted. Popout rewired
through `popout_open` (mpv.rs unchanged-in-spirit; see HANDOFF for the
full cut list). Needs Adam's Windows rebuild to compile-verify.

## Layer inversion spike history (superseded: kept for the record)

The settings-behind-player question led somewhere big. **Probed Desktop
Telly's actual window tree** (PowerShell EnumChildWindows on Adam's machine,
2026-07-09) and it is LITERALLY OUR STACK: `WRY_WEBVIEW` (Tauri!) +
`Chrome_*` (WebView2) + a native `mpv` child, but with the UI webview ABOVE
the video child in z-order. Their whole UI is a transparent layer over
bottom-parked native video; settings-over-video is free. Their install dir
corroborates: iptv-player.exe + iptv-backend.exe (sidecar), lib/libmpv-2.dll,
plus mpv.exe (popout) and ffmpeg.exe (recording).

**If the inversion works in our window, the entire overlay subsystem
dissolves** (no second webview, no bridge, no comp_key forwarding, no
setMouseIgnore) and four batched native scars die as side effects:
settings-over-player, DComp corner clip (CSS handles the hole's corners),
WM_SETCURSOR (UI layer owns the cursor), async-close switch gap (no overlay
webview to race). TheaterOverlay becomes a normal in-tree component.

**The spike (v0.1.115, dev-only, throwaway):** `spike.rs` + `SpikeScreen`
(`?spike=1`). In dev, **Ctrl+Shift+L** opens a transparent window with an
mpv child parked at HWND_BOTTOM (comp.rs uses HWND_TOP: this is the exact
inversion), auto-playing the last-played channel (falls back to a public HLS
test stream). The page's checklist covers: hole transparency, chrome above
video, glass-blur-over-video (expected: tint only, backdrop-filter can't
sample another HWND; note the design implication), animation smoothness,
occlusion artifacts, flip vs bitblt present modes (buttons for both: flip
is mpv's default and the quality path; comp.rs needed bitblt only for the
DComp overlay we'd be deleting), and HDR brightness. Playing takes over the
shared mpv PLAYER instance (main window's channel stops), fine for a spike.
NOTE: written against vendored-source-verified APIs (tauri 2.11.3 /
windows 0.61.3) but NOT compiled: the container can't build Rust. First
`pnpm tauri dev` may need a trivial fix; Adam pastes errors.

**Decision rule:** spike composites cleanly (incl. HDR + flip model) → the
inversion becomes the v0.2.0 milestone and replaces the batched native-pass
items; spike fails → keep current architecture, do the settings-PiP variant
instead, and record why here.

## Next steps, in order

1. ~~**Native player Phase 3**~~ ✅ popout/PiP shipped (now `popout_open` +
   `popout_pos`/`popout_stop` reclaim, `popout-closed`); track menus shipped
   v0.1.110. ~~Remaining: the update banner~~ ✅ shipped v0.2.0
   (UpdateChip.tsx: header glass chip, one-click install-and-relaunch;
   testers have been updating through it since).
2. ~~**Native (Rust) pass**~~ ✅ dissolved by the v0.1.135 comp.rs deletion:
   WM_SETCURSOR / DComp corner clip / async-close switch-gap all died with
   the overlay subsystem.
3. ~~**Stalker portal sources**~~ ✅ SHIPPED v0.1.137: the last v0.2.0
   source gate. `data/stalker.ts` (handshake→token→get_profile with
   endpoint-path probing, MAG headers, lazy re-handshake on failure;
   get_all_channels + paginated get_ordered_list fallback; get_epg_info
   keyed-map EPG, window-clamped client-side; create_link with solution-
   prefix strip), `buildStalkerSource` in source.ts (censored/name adult
   drops on both genre and channel axes), `Channel.streamCmd`, async
   `stream.ts#resolveStreamUrl` (M3U url → Stalker create_link per play →
   Xtream sync builder), LiveScreen resolves the play URL in an effect and
   go-live re-resolves Stalker URLs (short-lived play_token; the watchdog's
   silent retries ride the same path). Rust: http_get grew an optional
   headers map (merge semantics verified against locked reqwest 0.12.28;
   names-only in errors: values carry the MAC/token). RUST CHANGED.
   Fixture scripts/fake-stalker.mjs (:8083, LAX=1 for browser E2Es), E2E
   scripts/verify-stalker.mjs 4/4, 8 adapter/source unit tests. NOT yet
   proven against a real portal: endpoint probing + get_epg_info period
   semantics are the fields to watch on first live use.
4. ~~**Stream tab (AIOStreams)**: re-enable the nav glass~~ ✅ live in
   base.css (`--card-glass` fill); Adam signed off the look (2026-07-12).

## The themes era (Adam, 2026-07-12: supersedes the post-onboarding slate)

Onboarding + boot declared DONE and shipped as v0.4.43. Version scheme
reset: v0.4.43 "should've been 0.5.0" (tag stays: never re-tag a shipped
release); dev jumps to 0.5.0. The line:
- **0.5.x: making themes work**: ① theme-pack engine + free built-in
  packs + Customize pill-rail restructure (this slice, v0.5.0); ② Stripe
  Checkout + Oracle-box key service (/validate + payload host) + app-side
  license entry with fail-open entitlement cache; ③ CSP hardening
  (pre-1.0 gate #5's tail) + theme catalog design QA (Adam's Figma
  palettes replace the sample packs).
- **0.6.0: the themes release.**
- **1.0 gates**: My List multi-lists (moved here from the 0.5 slate,
  Adam 2026-07-12), ~~a **Sports tab in Live TV**~~ (Adam 2026-07-12: no
  design yet) BUILT, and code complete for v0.9.0: see the 0.9.0 status
  below and `plans/010-sports.md`. Paid themes shipped, Windows code
  signing, CSP.
- **Ctrl+K command palette CUT** ("i dont really want that"): do not
  build it. Aurora sweep stays slated, unowned.

Slated for later, user-approved: ambient backdrop setting, motion toggle,
timeshift, programme-level selection in the hero, M3U folder editor in
Settings, favorites drag-handle UI (data layer shipped v0.1.133).

## 0.7.0: the polish push, ✅ RELEASED 2026-07-23 (tag v0.7.0 @ main)

v0.6.0 (Apple TV parallax) shipped. This cycle is small features and edits
that really polish the app. **Full polish audit ran 2026-07-22** (6 dimensions,
adversarially verified, 53 findings): `docs/polish-audit-0.7.0.md`, P1 is
user-visible small fixes, P2 scheduled work, P3 a mechanical hygiene batch.
An animations audit ran separately (Adam's session).

**Audit execution, same day (v0.6.1):** all of P3 landed (4 sweep commits:
dead code −233 lines, comment drift, debloat (dist 2.3MB→1.1MB via the
logo.svg swap + the drop-woff Vite plugin) and the CSS quality batch:
status tokens, glass dedup, supporter hover + !important trim), plus all of
P1 (playMeta/Card render storms, Stream-empty state, Continue-Watching
keyboard, playlist arm/confirm delete, tooltips, disabled no-op buttons).
**P2 executed same day (v0.6.3, commits ebb7e91..ad1e56e):** scrubber +
stremio-path tests, retry buttons everywhere Live had one, Discover
failure-vs-empty honesty, quick-resume/episodes silent failures fixed,
app-wide themed focus ring + chip aria-pressed, SidebarSources memoized.
**Still open (refactor-grade, unscheduled):** the two TTL-cache
implementations, Card/RowScroller extraction out of StreamScreen, popout
wiring dedup, z-index scale, the 5x glass-chip recipe, brand-gradient
dedup, and the dither/kawaii occluders, a per-pack design call for Adam,
not mechanical. To-do, in no order yet:

- [x] **Right-click to hide a source folder.** ✅ SHIPPED v0.6.15:
      cursor-anchored glass context menu on the Live sidebar folders
      ("Hide <name>" + an unhide hint pointing at Settings → Playlists).
      Writes the same per-playlist `hiddenCategories` via
      toggleHiddenCategory + savePlaylists (folders/channels/EPG drop
      together; Live refreshes silently on the playlists-change signal);
      hiding the currently-filtered folder clears the filter. Keyboard
      menu-key anchors on the row; Escape/click-away dismiss; plan-002
      entrance language, instant close. **Follow-ups (same cycle):** hover
      EYE on folder rows (guide-star pattern) as the primary path with a
      bottom-center undo TOAST; optimistic pending-hidden filtering (the
      hide pipeline is a full cache-fingerprint reload (seconds) so the
      sidebar AND guide filter instantly and reconcile on land); portaled
      menu/toast (clip-hole safe) + focus restore + viewport clamp.

Also landed this cycle (post-audit): the first-frame hole gate (tune no
longer shows the DESKTOP through the shell's clip hole: InvertedPlayer
holds it closed until mpv presents), Live tab gated on ENABLED playlists
(kills the mock-catalog leak), abandoned-hold click classifier (350ms),
modal sheet-drop entrance + quick exits, EPG surface press + pointer
spotlight (1000px/0.07), and the 2026-07-23 fresh-eyes pre-release review
(31 verified findings, all executed: see the review-fix commit).

**Release tail (v0.6.21→27, all feel-gated; details in HANDOFF Live
state):** mock EPG deleted for real; caption/audio/speed persistence
across episodes (stale-tracks race in TheaterOverlay); chip-label nowrap;
hero-title fade → mask; floating guide (scrimless time rail + channel
column, all themes); Stream row edge scrims removed all themes (mask
alternative bench-rejected: numbers in stream.css); Back button pinned on
source+episodes; episodes metadata un-crushed (grid auto-minimum-0
compression). Released 2026-07-23: tag v0.7.0 @ main, sig-verified
installer + latest.json, updater live.

## 0.7.1–0.7.2: playback-bridge patch (RELEASED 2026-07-24)

Two post-release bugs, same family (async state racing a FRESH mpv
instance), both found by Adam within hours of 0.7.0:

- **VOD rendered the LIVE chrome.** Mode was inferred from async bridge
  meta; late/clobbered meta defaulted to live. Now the HOST declares mode
  via a `vod` prop (synchronous, structural), and it gates more than
  looks: prefs-apply, the tune watchdog window (10s live + goLive reload
  retries vs the patient 40s VOD wait, i.e. wasted debrid requests), and
  dead-source failover. Root cause under it: `getMeta` captured its ref at
  call time and resolved a stale `null` after the real push, with a
  JSON-dedupe that never re-pushes. **Rule: never infer playback mode (or
  any load-bearing state) from async meta: declare it.**
- **Volume/mute died on episode change**: the push raced the mpv spawn
  and landed on the dying instance; React state kept the slider looking
  correct. Re-pushed on `loading` → false.
- Plus quiet update installs (see the two-tier item below).

Full detail in HANDOFF's Live state. **This is why the bridge-seam audit
below exists:** both escaped the polish audit AND the 31-finding
pre-release review, because those swept UI/CSS, not bridge timing.

## 0.7.11: the fix train (RELEASED 2026-07-24)

The playback-bridge audit (four dimensions, all 7 findings shipped) plus
the guide-load fix. Per-finding detail lives in HANDOFF. Two things worth
carrying forward as RULES rather than history:

- **Readiness is "is there a picture", not "is it loading".** Those two
  answers diverge at completion, and conflating them is what put the
  DESKTOP on screen between episodes.
- **Never spend a once-per-file guard on data that has not arrived.**
  `mpv_status` always returns `audio: []`/`subs: []`, never null, so an
  empty-but-truthy track list burned the prefs guard while the file was
  still demuxing. A slow open is the NORMAL case for debrid, not an edge.

**The guide load is now two-phase** (source.ts). Four details that cost
real thinking, so do not re-derive them:
1. Publish a NEW LiveData, never mutate. The screen holds the old one in
   state and would never see an in-place edit.
2. The channels-only snapshot is NOT written to disk. Persisting it would
   let the next launch hydrate a guideless catalog and then sit through
   the whole download again, silently undoing the entire benefit.
3. The detached phase needs its own catch: it outlives its caller, so a
   throw there becomes an unhandled rejection.
4. `announceRefresh()` guards `window` because that dispatch fires from
   the detached promise, and vitest runs in node.

Measured, so nobody re-opens it: the provider's guide is 97.2MB and takes
76.7s, headers back in 122ms. Compression is ALREADY working (the client
sets gzip/brotli/deflate, and reqwest stripping content-length is the
app's own documented signal that it decompressed), so 97.2MB is the
DECOMPRESSED size and there is no transfer win sitting there. The disk
cache is confirmed working too (HIT, 7ms writes), so this is a
once-per-8-hours cost rather than per launch.

## 0.8.0 scope (SET by Adam 2026-07-24, branch `blammytv-0.8.0-push`)

Headline is the Library work; everything else is supporting. Framed that
way deliberately: 0.7.11 was a fix train with no feature, and a release
needs something a user can point at.

| Item | Plan | Notes |
| --- | --- | --- |
| **Library: multiple lists + watch history** | 009 | **SHIPPED.** THE feature. Tab renamed Library, Discover-shaped layout, CW row on top, lists grid below, built-in uncapped Library card, split save button with list picker. Plan 009 is COMPLETE. |
| Two-tier updates | 008 | **BUILT, DORMANT.** Phases 0-3 in the tree. No `frontend.json` is published yet, so nothing fetches anything; the first frontend-only release is the acceptance test. |
| Per-show playback prefs | - | **SHIPPED v0.7.17.** `playbackPrefsByShow`, LRU-capped. Volume/mute stay global (device-level, not show-level). |
| Favorites drag-to-reorder in the guide | - | **CUT from 0.8.0** (Adam, 2026-07-26). Data layer still sits there unused since v0.1.133 (`reorderFavorite` + tests, no caller). Deferred for the same reason as last time: the guide grid is virtualized and carries the pinned-cell scars, and a half-right drag in a virtualized list is worse than none. Wants a session that STARTS with it. |
| `mpv_frost` downgrade fix | - | **SHIPPED v0.7.17.** The frost ask is gated on `videoReady` and re-asked, so opening Settings mid-tune no longer downgrades the card for the whole session. |

**Also in 0.8.0, unplanned but shipped:** the Settings IA rebuild (three
tabs to two, filed by question rather than by screen), real back/forward
with scroll restoration on every screen, mouse side-button nav everywhere,
and the save-affordance rewrite that fixed a live bug where saving from a
title page wrote to the pre-009 key the Library does not read.

**Cut from 0.8.0:** the Sports tab. It became the **0.9.0 headline**: see
`plans/010-sports.md` (Adam 2026-07-27, US first, all major US leagues plus
Premier League and F1, modelled on ScoreBox's cross-reference of a broadcast
schedule against your own channels).

**Status: CODE COMPLETE for v0.9.0, awaiting the release.** Phase 0's gate
passed on 2026-07-26. The hub shipped as a pre-release in v0.8.163, the
v0.9.0 cut was decided 2026-08-08 and every item in it landed across
v0.8.178-183, the audit closed in v0.8.185, and the sports host went under a
headless harness in v0.8.204. The remaining ledger items are post-0.9 by
decision. All that is left is RELEASING.md's step 1 (six version spots to
0.9.0) and a signed build.

## Next after 0.8.0 (queued, unowned)

- **0.8.0 needs a headline.** 0.7.11 was deliberately a PATCH: a fix train
  with no feature, where the previous two minors each had one. Two-tier
  updates is the obvious candidate and is now PLANNED in
  `plans/008-two-tier-updates.md`; pair it with a real feature off the 1.0
  list. **Phase 0 of that plan is a decision gate**: whether the frontend
  can be served from disk WITHOUT changing the page origin. All persisted
  state (playlist credentials, the Themes Pass license key, watch history,
  the guide cache) is origin-partitioned, so the answer changes the cost of
  the whole feature. Verify it before writing anything else.
- **EPG coverage question: HALF ANSWERED (v0.9.28), the rest needs a real
  provider.** One of the two explanations is now impossible: matching was
  exact string equality, so a provider that spelled a channel "Sky.Fake"
  in its guide and "sky.fake" in its panel lost that guide silently.
  `parseXmltv` falls back to a normalised key (trim, lower-case, collapse
  whitespace; punctuation deliberately untouched, since dots and dashes
  carry meaning in these ids). Exact still wins where it matches, so
  nothing that worked can start matching something else.
  The coverage log now ends with `N recovered by normalising case/spacing`.
  **Anything above zero settles it: it was a matching bug, that many
  channels' guides were in the download all along.** Zero means the
  provider's guide really is thin and there is nothing to win here. The
  log only prints against a real panel, so Adam reads it on his next
  launch — this box has no provider to point at.
- **Bridge items still open**, each needing the shipped `[tune-diag]` to
  fire during a real stall: `reload_live()` early-returns when `path` is
  unset, which is plausibly the state at death, so the live watchdog's
  "reconnecting" escalation may do nothing for 30s; whether a death shows
  as `idle-active` or `eof-reached`; and whether `aid`/`sid`/`speed`
  survive a same-url reload (speed has NO reconcile channel, so a
  divergence there is permanent and silent).
- **`mpv_frost` downgrade (needs no measurement):** it conflates "no
  player yet" with "this mpv cannot frost", so opening Settings during a
  tune drops that modal to a solid background for its whole session. The
  frontend can just re-arm on presenting.

- **Refactor batch (invisible, do early in the cycle while the tree is
  quiet).** Partly done in v0.9.28; what is left, with what was learned:
  - ~~dedupe the glass-chip recipe~~ **DONE.** `.live-toast` and
    `.folder-menu` carried six byte-identical properties each; both now
    read `--float-bg` / `--float-border` / `--float-blur` /
    `--float-shadow`. The other nine `rgba(0,0,0,0.55)` uses in the tree
    are a hero scrim and card washes that happen to share a colour, NOT
    this recipe, and were deliberately left: folding coincidences into one
    token is how a token stops meaning anything.
  - **"unify the two TTL-cache implementations" is questionable as
    written.** Looked at both. `stream/source.ts` is a DISK cache
    (localStorage, 30 minute TTL, VodData); `sports/espn.ts` is an
    in-memory Map (30 second TTL, its own sweep at 400 entries and its own
    failure backoff). Different backend, different lifetime, different
    eviction. A shared `TtlCache<T>` would abstract over all three of those
    differences and couple two unrelated subsystems to buy a few lines —
    the "clever abstraction for hypothetical reuse" CLAUDE.md warns off.
    Someone should confirm or overrule this before it is picked up again.
  - **TheaterOverlay's clock re-render is worse than this entry says.**
    `CLOCK_TICK_MS` is 100, not 500, so `setTime` re-renders the whole
    1400-line overlay ten times a second during VOD playback, not twice.
    The fix is to isolate the clock's consumers into a child so the rest of
    the chrome stops re-rendering with it. NOT attempted here: it is
    scar-heavy player code and the change deserves a render count measured
    before and after rather than a confident refactor.
  - Still open and untouched: extract Card + RowScroller out of
    StreamScreen (~2400 lines); dedupe the popout wiring (LiveScreen +
    StreamScreen carry the same heal-hole sequence); a z-index scale.
- **Wave-D motion candidates** (table rows in `plans/audit-report.md`):
  Discover search result-collapse, Settings→Themes hand-off, settings
  tab-content swap, view-navigation crossfades, folded-rail tooltip replay,
  guide star feedback, update-chip spin.
- **Adam design calls:** dither/kawaii guide occluders (per-pack);
  favorites drag-handle UI in the guide (data layer shipped v0.1.133:
  virtualized-grid scar territory, plan carefully).
- **Two-tier updates — HALF OF THIS ALREADY SHIPPED.** Part (2), quiet
  native installs, went in with v0.7.2 (`c7a9f8fb`); `installMode: "quiet"`
  has been in tauri.conf.json since. Only part (1), the frontend hot
  channel, is still open, and it is still plan-doc-first. **(Adam
  2026-07-24, from a friend's suggestion: 0.8 candidate; it touches the
  updater trust path):** (1) *Frontend hot channel*: releases also ship a signed zip of
  dist/ (~1-2MB); when the update's NATIVE version matches the installed
  one, the app downloads it, verifies against the existing minisign key,
  unpacks to a versioned app-data dir, flips a pointer, and reloads the
  webview: no process exit, ~1s UI blink, mpv (a native child) survives.
  Needs: serve UI from disk (custom protocol or app-URL switch), Rust-side
  minisign verify, keep-last-version rollback with the baked-in frontend
  as the always-there fallback, a nativeVersion field in latest.json, and
  release-drill changes (build+sign+upload the zip). (2) *Quiet native
  installs*: `plugins.updater.windows.installMode: "quiet"` in
  tauri.conf.json (one line, next release build): NSIS /S, no progress
  window; truly silent because we install per-user (no UAC). Rust-touching
  updates always require the exit-install-relaunch cycle: Windows locks a
  running exe; the hot channel is how MOST updates stop needing it.
- **Third-party tracking sync (Trakt et al), 0.9/1.0 candidate (Adam asked
  2026-07-24, deliberately NOT in 0.8).** The question was whether to design
  for it now so the Library does not have to be reshaped later. Checked, and
  **the expensive part is already done by accident**: item ids are
  Stremio-convention IMDB ids (`tt2560140`), so every ListEntry and
  WatchEntry ever stored is already keyed by the identifier Trakt, Simkl,
  TMDB and MAL all accept or map from. Retrofitting external ids into
  records users saved months ago is the one thing that would be impossible
  later, and it is a non-issue. Supporting evidence: aniskip already
  resolves IMDB → MAL for skip timings, WatchEntry already carries
  season/episode/position (which is a scrobble payload), and `UserList.id`
  is stable and independent of the name, so a `remoteId` can be added
  without disturbing anything. **So there is nothing to do in the data
  model, and no reason to rush it.** What remains is a feature comparable in
  size to the Library itself: OAuth device flow plus token storage/refresh
  (a token is a credential), rate limits, offline queueing, and the actually
  hard part, two-way conflict resolution (a title local-but-removed-remotely
  has no obviously correct winner). Trakt first if any: it is the default in
  the Stremio/Kodi world and its device-code flow needs no redirect URI,
  which suits a desktop app. Simkl is the near-equivalent with better anime
  coverage. Cheap special case worth remembering: anime-only scrobbling to
  MAL/AniList would be unusually inexpensive given the MAL resolution
  already in the tree.
- **1.0 gates:** paid themes shipped, Windows code
  signing, CSP. (My List multi-lists moves OUT of this list: it is the 0.8.0
  headline, see plan 009.)

**Live-tab accessibility pass: LANDED (v0.1.98).** The batch from the v0.1.71
audit: keyboard-operable channel-column resize separator (`role=separator` +
`tabindex` + arrow/Home/End + `aria-value*`); roving-tabindex + arrow-key
navigation on the mode-rail tablist; accessible names on guide cells
(channel + programme + time + "on now") and channel cards; favourites star
revealed on `:focus-within`/`:focus-visible`; a themed `:focus-visible` ring
across the Live controls; `role=status`/`role=alert` live regions on
loading/error; `aria-current` for the active folder and the selected channel.
Verified headless (8/8 Playwright a11y asserts). Still deferred until the
player lands: the hero preview's edge uses raw `#ffffff10` (off-token), fix
when that box is reworked for mpv.

(The "Working habits" section that used to close this file moved to the top,
updated. Its last line said "Plain CSS, no Tailwind", which stopped being
true at v0.9.49.)

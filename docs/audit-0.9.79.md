# Audit: v0.9.79

*2026-09-24 · branch `claude/nice-heisenberg-67k4uk` at v0.9.79 (c9196ba8) ·
seven parallel auditors, one per dimension: shadcn adoption and design
language, losses since v0.9.0, bugs and security, a11y and UX in the running
app, perf and dead weight, pixel-level visual polish in the running app, and
a repo-wide sweep (code health, stale comments, tests, docs, CI, the 0.7.0
audit's follow-through). No finding cap: Adam asked for every detail.*

This file is the synthesis: deduplicated across auditors, ranked, and marked
by how far it has been checked. The seven raw reports are in
[`docs/audit-0.9.79/`](audit-0.9.79/) with every file:line, measurement and
screenshot name. **The raw reports are unverified agent output. Check an
entry before acting on it**, the same rule as the 0.7.0 audit's verifier
notes. Line numbers are as of c9196ba8.

**How far each item is checked:**
- **checked**: re-read in the code or re-measured by the main session.
- **measured**: an auditor measured it in the running app (Playwright,
  computed styles, contrast). Not re-run.
- **reported**: an auditor traced it in the code. Not re-checked.

**Already fixed in v0.9.80:** the accent popover opening 246px left of its
chip, and the boot line bringing back 0.9.0 accents nobody picked (see that
commit). Both were v0.9.79 bugs.

---

## P0: blocks the M3 release

1. **The hot-channel archive command builds a bundle every installed copy
   refuses.** *checked.* `RELEASING.md:306` says
   `tar -czf frontend-<v>.tar.gz -C dist .`, which writes `./` and
   `./index.html`. The tar crate hands paths through raw
   (`tar-0.4.46 entry.rs:304-322`), and `frontend.rs:348-354` rejects any
   component that is not a plain name, so `./` fails. v0.9.0 has the same
   check. The first frontend-only release would fail closed on every
   machine, silently. **Fix, docs and harness only:**
   `tar -czf … -C dist index.html assets`, plus a `verify-release` check
   that no entry starts with `./` or `/`. Tolerating `CurDir` in the
   unpacker can wait for a native release.
2. **CI does not run the gate.** *checked.* `ci.yml` runs on push and PR to
   `main` only, and runs typecheck, lint and unit tests. No `check-rust`,
   no clippy, no `cargo test`, no `verify-version`, no `pnpm verify`. The 9
   Rust tests in `frontend.rs:597-764`, which guard the unpacker in item 1,
   have never run anywhere. v0.9.74 to 0.9.80 have had no CI at all: this
   branch has never had a PR, and pushes to it trigger nothing.
3. **Hot channel, native, for the record** (can't change before M3 without
   making it a native release). *reported.*
   - The boot sentinel is armed on every boot of a staged bundle, so one
     interrupted launch quarantines a good bundle for good
     (`frontend.rs:134-143,186-193`).
   - The version string accepts `..` and `.`, and `root.join(version)` then
     `remove_dir_all` would delete the app data folder. The manifest's
     `version`, `nativeVersion` and `url` are not covered by the signature
     (`frontend.rs:377-382,405-407`). Needs the ability to publish the
     manifest.

## P1: broken now, and a user would see it

**Sports and multi-view**
- **Tuning dies 30 minutes after the catalog loads.** *checked.*
  `tunedChannel` reads `peekLive()`, which returns null once the cache is
  older than `CACHE_TTL_MS` (30 min, `live/source.ts:155`). Nothing
  refreshes it while you sit on Sports. After that, rail clicks, a game's
  autoplay, failover and the multi-view search all do nothing, while the
  board still shows matches. It is also null right after a disk-hydrated
  launch, because `cache.at` is the snapshot's age. For a three-hour game
  this is the failover path. Fix: give `tunedChannel` the catalog
  `useCatalog` already holds, or an allow-stale peek for id lookups.
- **The matcher deletes accented letters.** *checked* with a probe:
  "TUDN México" becomes `tudn m xico`, "ESPN Fútbol" becomes
  `espn f tbol` (`matcher.ts:113`). A broadcast name with an accent can't
  meet a playlist name without one. Fix: strip diacritics
  (`normalize("NFD")`) before the `[^a-z0-9+]` pass, with a test.
- **The Sports board has a 111px dead band at the top.** *checked.* The
  board carries both `.discover` and `.sportsboard__main`
  (`SportsScreen.tsx:741`); `discover.css` is imported after `sports.css`
  in the same layer (`index.css:114-115`), so Discover's padding wins.
- **Multi-view collapses to a narrow strip** (540px at 1400 wide; the
  header clock draws over tile 1 and the capsule covers "0/2"). *measured.*
  `.mvscreen` has no width or `flex: 1` and no header offset
  (`player.css:1129`).
- **The multi-view notice floats top-right.** *checked.*
  `.modal-backdrop--center` (`MultiviewNotice.tsx:42`) is defined nowhere.
  It is also `aria-modal` with no focus trap and no scrim. *measured.*
- **Selected states that vanished in v0.9.56** (1cfcec91 parked the rules,
  nothing replaced them):
  - Tournament draw filter: the selected chip looks like the rest.
    *checked* (no `.tourndraw__chip.is-on` rule outside `styles/old`).
  - Player menu triggers lost their open state, track menus their
    selected row, and unseekable VOD shows ±10s at full strength
    (`data-inert` is set and nothing reads it). *reported.*
  - Library "Delete" list and "Clear history" have no danger colour and no
    armed state. *reported.*
- **Text overflowing icon-sized buttons**: "Remove from Favorites"
  (`LeaguePicker.tsx:318`), "Sure?" (`PlaylistsTab.tsx:247`), "Remove"
  over every Library poster (`LibraryScreen.tsx:342`). `size="icon-sm"`
  pins them to 32×32. *reported*, by two auditors.
- **The right carousel arrow paints over the team name** on game cards
  (`stream.css:260-269`, transparent ghost, no scrim). *measured.*

**Live**
- **The Guide's favourite star is invisible in every state**, and its
  32px hit area is still live at the right edge of every channel card.
  *checked.* `.guide__fav { opacity: 0 }` (`live.css:574`); the reveal
  rule only exists in `styles/old`. Starring shows nothing. The Favorites
  empty state still says "hit the star". Three auditors found it.
- **The folder "hide" eye shows on every row, all the time**, covering
  the right 40px of each name; the league picker's star borrows the class
  and shows on all 151 rows. *reported.*
- **On the Guide with nothing playing, search and "Restart now" are
  dead** (Windows build only). *checked.* LiveScreen appends `#inv-chrome`
  on mount (`LiveScreen.tsx:766`), and `isPlaying()` and the header's
  search shortcut read that host as "playing".

**Everywhere**
- **Every icon inside a Button renders at 16px**, whatever its `size`
  says. *checked* by measurement: play/pause asks for 26, skip for 24, the
  rest 20; all render 16. The cause is Button's
  `[&_svg:not([class*='size-'])]:size-4` (`button.tsx:7`). The header gear
  is 16px next to 23px nav icons (*measured*).
- **Light mode has no control.** *checked.* The Theme Style pill left with
  the Themes panel in v0.9.58; nothing but Reset calls `pickTheme`, and
  Reset forces dark. A stored "light" from 0.9.0 still applies at boot
  (`main.tsx:43`). **Adam's call:** bring back a Light/Dark control, or
  drop light until the redesign reaches it. Everything under "Light
  theme" below only hits users with a stored light preference today.
- **Light theme surfaces that don't work:**
  - Ghost and outline hover, and every `secondary` "on" chip, are
    invisible: `--color-accent` and `--color-secondary` map to
    `--surface-raised`, which is pure white in light
    (`theme.css:156-158`, `tokens.css:294`). *checked.* Card Details and
    Player Overlay chips measure 1.0:1 on vs off. *measured.*
  - The Live toast's text is white on a white toast (`live.css:1010`).
    *checked.*
  - Title page: "Add to Library" and genre pills are near-white on white.
    Sports theater rail: dark names on dark rows. Onboarding: the primary
    Continue nearly vanishes on black. BETA chip: 1.25:1. *measured.*
- **Settings doesn't manage focus.** *checked* in part: Escape is a
  window listener (`SettingsModal.tsx:64-72`), so Escape inside the
  accent popover closes the popover AND Settings. *measured:* focus
  doesn't move in, isn't trapped, and returns to BODY on close; no
  `aria-modal`; no scrim; the sheet overlaps the capsule by 4px.
- **The Recommender shows raw transport errors on screen**, which can
  carry the addon manifest URL (a credential) or the TMDB `api_key`.
  *checked* (`Recommender.tsx:124` skips `scrubbedMessage`). Related: the
  scrubber stops at `)`, so `password=se)cret` leaks the tail (*checked*
  with node, `lib/errors.ts:10`), and the console probes print raw errors
  (`discover/probe.ts:69,134,218`, `tmdb.ts:371`). *reported.*
- **The REC panel tells users to open the developer console** ("Add a TMDB
  key in the console with `btvTmdb(…)`", `Recommender.tsx:217`).
  *checked.*
- **Stream hero: 8 of 12 tab stops are on off-screen slides**, and
  autoplay moves a focused button off screen after 8s. Autoplay pauses on
  mouse hover only. *checked* (`StreamScreen.tsx:2165`); the tab-stop
  count is *measured*.

## P2: elegance and consistency

This is most of what the redesign (M2, M3) exists to do, so it is grouped by
system rather than by screen. The raw `polish.md` ends with the full list of
distinct values in use.

- **The sprawl, measured:** 31 font sizes, 7 weights, 24 radii (the scale
  is 6/8/10/14/pill), 15 shadows, 32 durations and 15 easings, and text
  greys built from a dozen white and `#f2f2f4` alphas plus opacity
  0.3 to 0.85 on already-muted tokens. *measured.*
- **Focus.** The ring is `--ring` at 50% (`ui.css:222`, *checked*), which
  measures 1.9:1 in dark and 1.2 to 1.7:1 in light. The nav search, the
  Row Size slider and the Guide star show no focus change at all.
  *measured.*
- **Dim text by opacity fails contrast**: `.settings__section-note--dim`
  at 2.2:1 dark and 1.7:1 light, the header clock 2.5:1, the version
  1.9:1. *measured*, by two auditors.
- **Header:** the Settings gear lost its 44px round chip in v0.9.56 and is
  now a bare glyph; the capsule sits 117px off-centre when there is no
  live source; the clock, gear and capsule sit on three centrelines.
  *measured.*
- **One component per job, not four.** From `shadcn.md` (reported, counts
  from grep): 4 retry-button looks, 5 back-button looks, 4 arm-then-confirm
  looks, 5 pressed-chip looks, 7 text-input treatments (one uses
  `<Input>`), 3 quality badges, 9 empty/error layouts, 3 tooltip systems
  (Hint at 4 sites, native `title` at 47, `.live-tip`). The generated
  Badge, Skeleton, Separator and Dialog have zero consumers.
- **z-index has no scale.** Popover and Combobox are z-70 by local edit;
  Tooltip and DropdownMenu are still z-50, below the Settings sheet's 60,
  so the next one used inside Settings opens behind it. *reported*, by two
  auditors.
- **Dark theme:** the mode-rail track is the same colour as the sidebar
  under it (both oklch 0.205), so the segmented control has no track.
  *measured.* LIVE indicators went grey in the hero and player while the
  Sports pip stayed red. *reported.*
- **The Guide, up close** (*measured*): programme cells show through the
  sticky channel column on horizontal scroll; ruler ticks are a literal
  "|" character; programme times are 10px and not tabular; card and cell
  radii differ (14 vs 8); the now-line overshoots the last row by 8px; the
  selected channel has no visual state (deliberate, overrulable).
- **Sports, up close** (*measured*): "Hide finished" and "Compact results"
  are two different toggles side by side; status text mixes "Final",
  "FINAL" and "6:52 - 2ND", times ignore the 12h/24h setting
  (`espn.ts:955`, also `CardFoot.tsx:41`, `racing.ts:212`,
  `live/stream.ts:200`); fractional sizes (18.46px, 21.3px) from an
  unrounded scale factor; the card palette is off-token.
- **Stream, up close** (*measured*): movie and series pages use different
  left edges and section order; source rows don't align their name column
  and "2160p ⚡" overflows; hero meta uses spaces where cards use " · ".
- **Motion:** the duration tokens exist, but most of the 168 transitions
  use literals; three thumbs animate `left`/`width` rather than transform.
  *reported*, by three auditors.
- **Copy:** Title Case and sentence case mixed across buttons and
  headings; "Favorites" and "favourites" in the same control; onboarding
  still mentions themes, "My List" and "a couple of preferences".
  *reported*, by four auditors.

## P3: accessibility, beyond the above

All *measured* in the running app unless marked.
- Every Guide programme cell is its own tab stop and there are no arrow
  keys. The Sports sidebar puts 305 tab stops ahead of the first game.
  There is no skip link.
- No screen has an `<h1>`, and heading levels skip (H3 first on Discover
  and Library).
- Two combobox icon buttons have no accessible name (axe: critical,
  `components/ui/combobox.tsx:42-52,74-83`).
- The ⚡ cached marker is emoji-only; "← Back" puts the glyph in the
  accessible name; ChipTabs is `aria-pressed` buttons, not a tablist.
- Reduced motion misses the Discover second row, chip-tabs and the poster
  lift.
- Accent extremes: the text flip works (every case at or above 4.5:1), but
  a near-surface accent (#f5f5f5 on light, #141414 on dark) makes the
  primary button and an on toggle vanish into the sheet.

## P4: download size and speed

Sizes are *measured* by building to a scratch dir. The hot-channel zip is
779KB today.
- **Lazy-load Settings, Sports and Onboarding**: the entry drops from
  906KB to 537KB (−41%). `@base-ui/react` (117KB) ships for one Combobox
  and would leave the entry with Settings.
- **Smaller zip:** `hls.js/light` saves 67KB gz (Adam's call: it drops
  alt-audio renditions, fine for muted tiles); Geist Mono's non-Latin
  subsets 47KB; the Spain and Mexico flag SVGs about 30KB; SVGO on the
  circuit layouts; `build.target: "chrome105"`.
- **Launch:** every disk-hydrated launch re-normalises the whole EPG on the
  main thread, 100 to 200ms on a 26k-channel catalog. *checked* that the
  loop runs; deleting it is NOT proven safe (this clone is too shallow to
  date the migration), so stamp the snapshot with a schema version instead.
- **Sports:** the channel index (160ms on 26k channels) and every match are
  rebuilt after each background refresh; `sameSlot` builds an
  `Intl.DateTimeFormat` per candidate (52µs vs 2.8µs cached).
- **Runtime:** TheaterOverlay (2,068 lines, not memoised) re-renders on
  every guide hover during playback; the Guide's dependency-less layout
  effect interleaves reads and writes. *reported.*
- **An infinite animation drives nothing:** `.update-chip` animates
  `--update-ring` forever, and its only consumer moved to `styles/old`.
  *checked.*

## P5: correctness, smaller

From `bugs.md`, all *reported* unless marked. F-numbers are that file's.
- Live cache races: a stale-window load defeats the guide-downgrade guard
  (F2); an older config's guide phase overwrites the newer config's cache
  and disk snapshot (F3).
- Multi-view: never stops a running popout, so it takes an extra
  connection with double audio (F10); its resolve effect cancels its own
  in-flight resolves, and a failed pick holds a slot forever (F12); tile
  focus is an index, so audio jumps streams (F13); the grid-size clamp
  overwrites the saved preference (F14).
- LiveScreen's popout-closed listener reclaims popouts it didn't start
  (F11). ESPN fetches have no timeout behind a 6-slot gate (F16). XMLTV
  drops spec-valid programmes without seconds or a stop time (F17). M3U
  names with a comma are truncated (F18). Updates hides the installer
  while a hot bundle is pending (F20). A game near midnight Central can
  fall off the board (F22, needs live ESPN data).
- The accent drag writes four storage keys per pointer move (F23).
- Console probe `mpvGet("path")` prints the stream URL, and `mpv_set`
  allows any property (F15).
- Types that lie: `load<T>` results for playlists, favourites, recents and
  credentials are trusted unvalidated (`sweep.md` 1).

## P6: hygiene

- **Dead code:** about 250 lines of CSS matching nothing (150 of them went
  in v0.9.80), seven unused generated shadcn components (which still cost
  4.5KB of Tailwind output), unused icons, functions and tauri wrappers,
  and `clsx` and `tailwind-merge` with zero importers. Full lists in
  `perf.md` F and `sweep.md` 1.
- **Stale comments:** about 40, listed in `sweep.md` 2, e.g. `player.css`
  describing a `.player__btn--glass` recipe that no longer exists,
  `accent.ts` saying everything red derives from `--accent`.
- **Tests:** 33 storage warnings per run mean persistence is effectively
  untested; several vacuous assertions; `harness/*.tsx` rigs import CSS
  that moved to `old/`; verify-tailwind skips any declaration with a
  comment in front of it, which hides four dead rules (two auditors
  reproduced this); light mode has no harness coverage; `verify-all`
  starts `fake-keybox` for nothing. `verify-cw-sources`' last check runs
  only when the catalog is still loading at the click, so the board reads
  402 or 403 (*checked*: the old tree does it too).
- **Docs:** README, HANDOFF (32 days behind) and the docs site describe
  Profile, squircles, themes and settings paths that are gone; ROADMAP M1
  step 5 lists files that already sit in `old/themes/`; the privacy page
  omits TMDB and ESPN; `services/site` advertises Trakt and the theme
  packs, and its Privacy and Terms links go to `#`.

## Wins, so nobody undoes them

- v0.9.53 (729c17ba): one global `:focus-visible` rule replaced a
  41-selector registry that kept going stale. It needs a stronger colour
  (P2), not a different mechanism.
- Player playback fixes since 0.9.0: Play now stops the old episode
  (4c262b29), remembered languages survive the episode roll (7230a0c2),
  track preferences retry until mpv confirms (0bce5e62), cancelling a
  resolve really cancels (cc63c8ca).
- `pnpm verify` and the board (3d534a35), which found a real bug on its
  first run.
- Of the 0.7.0 audit's 53 findings, most P1s and P2s are fixed; the open
  and regressed ones are listed in `sweep.md` 6.
- Checked and clean: listeners, intervals and observers balance; hls.js
  and mpegts.js instances are destroyed; the CSP is `script-src 'self'`;
  all 35 IPC calls match their Rust signatures; `http_get` logs only the
  origin.

## Not covered from here

Real video and libmpv, the Windows build, real addons and portals, real
ESPN and TMDB data, WebView2's own rendering and focus, and the player
chrome over a playing stream. The auditors said so each time; nothing
above claims otherwise.

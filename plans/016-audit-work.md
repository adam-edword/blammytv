# 016: Working the v0.9.79 audit

**Status (2026-09-24, v0.9.103):** Adam agreed all eight recommendations
(D1 to D8). **Track 0 and Track 1 are done**, v0.9.82 to v0.9.96, each fix
with a check that fails without it; so are ROADMAP M1 steps 1 and 5 and
D7's privacy page (not yet deployed: that needs the `docs` and `website`
branches). **M1 step 2 ran:** every multi-view tile failed on a provider
302 with no CORS header, so v0.9.101 adds a native stream proxy and the
native freeze (rule 3) is lifted. Through the proxy, v0.9.102's buffering
measured clean over 20s (0 drops, 0 jumps, ~60fps on three tiles), but Adam
still sees a stutter every 20 to 30 seconds; v0.9.103 raises the catch-up
threshold and gives the probe a timeline to find it. **Next:** that
stutter, then Track 2. Deviations from this plan are in the commits: 1.1's
proof is a unit test (the theater fixture can't observe a re-tune), 1.5
leaves the draw chip and league tile without a harness (no fixture builds
them), 0.2(c) links Chromium to the harnesses' path rather than editing 24
harnesses.

*Written 2026-09-24 against v0.9.81. Source: [`docs/audit-0.9.79.md`](../docs/audit-0.9.79.md)
(the ranked synthesis) and the seven raw reports beside it. This plan puts
that list in order, attaches each item to a ROADMAP milestone, and says what
proves each fix.*

The audit found about 200 things. Most of them are one of three kinds: a
state or rule that v0.9.56's prune took away and nothing replaced, a design
system that exists but isn't used yet, and a release path that has never
been run. This plan does them in the order that stops user-visible damage
first, then builds the system that stops it coming back, then polishes each
screen once, on that system.

## Rules for every step

1. **Reproduce before fixing.** The audit marks each item *checked*,
   *measured* or *reported*. A *reported* item starts by reproducing it. If
   it doesn't reproduce, strike it here with the evidence and move on.
2. **Every fix lands with a check that fails without it.** A unit test or a
   harness check, mutation-tested the way v0.9.80's two were: put the bug
   back, watch the check fail, restore. A check that can't fail is not
   coverage.
3. ~~**The native layer stays frozen until M3 ships**~~ **Lifted
   2026-09-24, v0.9.101** (ROADMAP). Adam: "a full installer is fine. that
   should never be a deterrent to building anything." 0.10.0 is a native
   release, so Track N can ship in it.
4. **One version bump per commit, board green, CLAUDE.md's usual close.**
5. **Line numbers are as of c9196ba8.** They drift. Search for the code, not
   the number.

Sizes: **S** is under an hour, **M** is a session, **L** is more than one.

---

## Decisions for Adam, before the work that needs them

Each has a recommendation. One message can settle all of them.

| # | Question | Recommendation | Blocks |
|---|---|---|---|
| D1 | **Light mode.** It has no control since v0.9.58, a stored light setting from 0.9.0 still applies, and several light surfaces are broken. | **Dark only until M3's light pass.** Boot ignores a stored light setting (and keeps it, so nothing is lost), and the toggle comes back in M3 with the contrast pass the ROADMAP already plans there. Bringing the toggle back now would show everyone the broken surfaces. | 1.12, 4.8 |
| D2 | **Player icon scale.** Every icon in a Button is 16px today. | **Restore the hierarchy the props already ask for:** play/pause 24, skip 22, the rest 20. It is what 0.9.0 looked like. | 1.4 |
| D3 | **Copy conventions.** Title Case and sentence case are mixed; so are "Favorites" and "favourites". | **Sentence case everywhere and US spelling in UI text.** Sentence case is the house voice. US spelling matches "Customize" and "Favorites", already on screen. The accent picker's own "Accent colour" labels change too. | 1.11, 4.x |
| D4 | **`hls.js/light`** saves 67KB of the download but can't play alternate audio renditions. | **Decide after M1 step 2.** Adam's real-stream test shows whether any of his HLS streams use alternate audio. None in a real playlist means light is safe. **Settled by that rule (2026-09-24):** his Xtream panel's live URLs are all `.ts`, so none of his multi-view streams touch hls.js at all. | 5.5 |
| D5 | **The Guide's selected channel has no visual state** (deliberate). | **Give it a quiet one:** `bg-accent` on the card. Keyboard users have no other way to see where they are. | 4.3 |
| D6 | **M3 goes out on the hot channel with a known risk.** The boot sentinel is armed on every boot of a staged bundle (`frontend.rs:178-187`, checked). Close the app (or crash, or lose power) in the moment between launch and the UI mounting, and that version is quarantined: that user runs the old 0.9.0 interface until the next hot release. The fix is native (N1). | **Ship on the hot channel anyway**, because proving it is half the point of M3, and follow with a hot fix release within days so anyone quarantined picks up the next version. Put the risk in the release checklist. | M3 release |
| D7 | **Published pages that are wrong today:** the docs site's privacy page doesn't list TMDB or ESPN, and the marketing site's Privacy and Terms links go to `#`. | **Fix the privacy page now**, with Adam's OK because it is published. The site's themes and Trakt copy changes at the M3 release, as the ROADMAP already says. | 7.5 |
| D8 | **REC with no TMDB key** tells users to open the developer console. There is no key field in the app. | **Hide REC until a key exists.** A key field in Settings can come with the M3 Discover pass if REC is worth keeping. | 1.10 |

---

## Track 0: the release path (P0). In M1, before anything else.

**0.1 The hot-channel archive.** S.
- `RELEASING.md:306` packs dist's top-level names, not `.` (naming `index.html assets` by hand drops `logo.svg`),
  with the reason in one line: the unpacker rejects `./`.
- `verify-release.mjs` gets an archive-layout check that mirrors
  `frontend.rs:348-354` exactly: list the entries with `tar -tzf` and fail
  on any path with an empty, `.` or `..` component or a leading `/`.
- Proof: pack with the old command, the check fails; pack with the new
  one, it passes. Then a dry run: `pnpm build`, pack, verify.
- Also correct `RELEASING.md:308-311`, which says only absolute paths and
  `..` are refused.

**0.2 CI that runs the gate.** M.
- (a) Trigger on every push and every PR, not only `main`. S.
- (b) A `windows-latest` job running `cargo test` and clippy (held to the
  9-warning baseline).
  - Mirror `check-rust.mjs`'s prerequisites. `build.rs` refuses to run
    without a `libmpv-2.dll` file, so drop in the same empty placeholder.
    Its contents don't matter, because libmpv only loads at runtime
    (libloading) and the unpacker tests never touch it.
  - Build `dist` first if the crate asks for it.
  - This is the first time the 9 Rust tests in `frontend.rs:597-764` will
    ever run. Running them changes nothing in `src-tauri`; a test that
    fails is a Track N item, not a reason to touch native code before M3.
- (c) `pnpm verify` on `ubuntu-latest`. The 24 harnesses hard-code
  `/opt/pw-browsers/chromium`; give them one helper that reads
  `CHROMIUM_PATH` and falls back to that path. Mechanical. M.
- (d) `permissions: contents: read` on every workflow (there are three). S.

**0.3 The board says FAILED when a harness fails.** `verify-all.mjs` labels
every non-zero exit CRASH. Distinguish "exited after printing its summary"
from "threw". S.

---

## Track 1: broken now (P1). M1, in this order.

**1.1 Sports tuning dies after 30 minutes.** M. *checked.*
- `tunedChannel` (`sports/catalog.ts:21`) and `MultiviewScreen` read the
  catalog from `useCatalog`'s `LiveData`, which is never null once loaded,
  instead of `peekLive()`, which is null past `CACHE_TTL_MS`.
- Same file, same session: F2 (don't null a stale cache while a load for
  the same key is in flight) and F3 (a guide phase only writes if its key
  is still current; a generation counter is simplest).
- Proof: vitest with fake timers on `live/source.ts` for F2 and F3. For F1,
  `verify-sports-theater` installs Playwright's `page.clock`, advances 31
  minutes, clicks a rail channel, and asserts a tune reaches the IPC stub.

**1.2 The matcher deletes accented letters.** S. *checked.*
- `normalize()` strips diacritics (`.normalize("NFD")` and drop
  `\p{Diacritic}`) before the `[^a-z0-9+]` pass (`matcher.ts:113`).
- Proof: tests for "TUDN México" = "TUDN Mexico", "ESPN Fútbol" = "ESPN
  Futbol", plus a check that no existing real-catalog test moves.

**1.3 Hover reveals that became always-on or never-on.** S.
- The Guide star: restore the 0.9.0 reveal (card hover, focus-within,
  focus-visible, starred). *checked.*
- The folder hide eye and the league picker's star: back to hover and
  focus reveal. *reported.*
- The Live mini-preview's Play and Stop, the row arrows, the Continue
  Watching Sources chip: restore hover reveal, but each must still show on
  keyboard focus. *reported.*
- Proof: harness checks on computed opacity at rest, on hover, on focus,
  and when starred.

**1.4 Icons in Buttons render at 16px.** S to M. *checked.*
- Per D2, give icons inside Buttons explicit `size-*` classes (44 sites,
  listed in `shadcn.md` X1 and `losses.md` 3), and delete `size` props that
  do nothing. Don't make the Svg helper emit inline sizes instead: icon
  defaults run from 16 to 24 (`icons.tsx`), every icon in a Button that
  passes no size renders 16 today, and an inline size would resize all of
  those at once without anyone choosing it.
- Proof: `verify-overlay-tracks` asserts the rendered play icon is 24px and
  mute is 20.

**1.5 Selected and armed states that vanished.** M.
- Choose the Button variant from state, the way meta-pick already does:
  - the tournament draw chip (*checked*)
  - player menu triggers while open, and the selected track-menu row
  - `data-inert` ±10s on unseekable VOD
  - the Library's Delete and Clear history (destructive when armed)
  - the playlist "Sure?" and the league "Remove from Favorites"
- The three text-in-icon-button cases switch `size` with state, so the
  text has room.
- Proof: for each, a harness check that the on (or armed) state's computed
  background differs from off.

**1.6 Settings and the Guide, small and separate.** S each.
- Escape inside a popover must not also close Settings: the window listener
  (`SettingsModal.tsx:64-72`) skips events already handled. The full
  Dialog conversion is 3.3.
- LiveScreen appends `#inv-chrome` only while something plays, keyed on
  `playUrl` as SportsTheater does (`LiveScreen.tsx:766`). Windows build
  only, so the proof is a harness with the `__TAURI_INTERNALS__` stub: on
  the Guide with nothing playing, no host and the search shortcut works.

**1.7 Credentials that can reach the screen or the console.** S.
- `Recommender.tsx:124` uses `scrubbedMessage`.
- The scrubber doesn't stop at `)`: match the whole URL-shaped run, parse
  it, keep the origin (`lib/errors.ts:10`).
- The probes pass errors through `scrubbedMessage`
  (`discover/probe.ts:69,134,218`, `tmdb.ts:371`), and TMDB errors drop
  the query string.
- `mpvGet` refuses `path`, `filename`, `stream-open-filename` and
  `playlist*` (`playerPerf.ts:335`).
- Proof: `errors.test.ts` cases with `)` and `'` in a password, and a
  TMDB URL.

**1.8 The Sports board's layout.** S.
- Drop `.discover` from the board (`SportsScreen.tsx:741`). First check
  what `.discover` provides that the board still wants.
- Give the carousel arrows a scrim so they stop painting over team names.
- Proof: a `verify-sports-days` check that the first card's top is within
  the header height plus 16px.

**1.9 The Stream hero and keyboard focus.** S.
- Inactive slides are `inert`. Autoplay pauses on focus-within and under
  reduced motion, not only on hover.
- Proof: tabbing reaches only the visible slide's buttons, and a focused
  button is still on screen after 9 seconds.

**1.10 REC with no key** per D8. S.

**1.11 Copy that describes an older app.** S.
- Onboarding: "themes", "My List", "a couple of preferences", "Get
  Started" beside "Skip setup". The Favorites empty state's "hit the star"
  becomes true again with 1.3.
- Per D3, one pass over casing and spelling on the strings this track
  touches. The full pass is per screen in Track 4.

**1.12 Light mode** per D1. S. Boot applies dark whatever is stored, and a
comment says why and when that ends. Proof: a harness check that a stored
light setting boots dark.

---

## Track 2: multi-view, finished (ROADMAP M1 step 3, widened)

Waits for Adam's real-stream test (M1 step 2). If mpegts.js doesn't play
real video, this track becomes "hide the button" and stops there.

- **Layout.** `.mvscreen` fills the main area and clears the header
  (`player.css:1129`). *measured.*
- **The notice becomes a Dialog:** centred, focus-trapped, with a scrim.
  `.modal-backdrop--center` was never defined. *checked.*
- **Primitives:** Button for the size picker, close and rail rows; Input
  for the search.
- **The bugs** from `bugs.md`:
  - F10: stop any running popout when multi-view opens.
  - F12: track in-flight resolves in a ref, not in the effect's deps; a
    failed pick says so and frees its slot.
  - F13: focus follows a stream id, not an index.
  - F14: the clamp to the connection cap is read-time only, never saved.
- `useConnections` polls only while multi-view is open, not the whole
  time you're on Sports.
- Search lowercases channel names once, not per keystroke.
- Copy: "Plays in your browser, not mpv" says what it means to a viewer.
- **Proof:** a new `verify-multiview.mjs` against the fake panel:
  - the notice is centred and traps Tab;
  - the grid fills the width;
  - two picks make two tiles;
  - deselecting the first keeps audio on the same stream.

---

## Track 3: the system (M2)

This is plan 014's L1 and L2, with the audit's counts as the work list.
Order matters: tokens first, so every conversion after them uses the
final values.

**3.1 Tokens.** M.
- **z-index scale** in `tokens.css`: base, sticky, header, sheet, popover
  and toast. Tooltip and DropdownMenu move above the sheet. They are z-50
  under Settings' 60 today, and the next one used in Settings would open
  behind it.
- **Focus:** a solid ring (`--ring` at full strength, one offset
  everywhere), and a ring for the inputs that have none today (range, nav
  search).
- **Text:** no opacity-dimmed text anywhere. Raise dark `--text-dim` to
  about oklch 0.6. Add `--on-image` for the 17 hard-coded `#f2f2f4` values
  and `--warning` for multi-view's amber.
- **Motion:** override Tailwind's default transition to the app's
  duration and `--ease-out`, and use `transition-colors` rather than
  `transition-all` on Button.
- **Proof:** verify-tailwind checks. Every z-index comes from the scale;
  no text colour carries opacity; the focus ring measures 3:1 or better
  against `--bg` and `--surface`.

**3.2 verify-tailwind can't be fooled.** S.
- Strip comments before splitting declarations. This hides four dead
  rules today.
- Add `width`, `line-height` and the `font` shorthand to OWNED.
- Replace check 8 (the Aurora button, unreachable) with a light-bridge
  check once D1 is decided.

**3.3 One component per job.** L, in this order:
1. **Dialog:** the Settings sheet (moves focus in, traps it, gives it
   back, scrim, `aria-modal`), the multi-view notice (if Track 2 hasn't
   done it), and onboarding's overlay semantics. `lib/modalOpen.ts`
   should shrink.
2. **Input, InputGroup and Label:** the seven text-input treatments,
   `.settings-input`, the AIOStreams field, `Field` in PlaylistsTab.
3. **Toggle and ToggleGroup:** the Sports toggles, the Card Details and
   Player Overlay chips, the draw filter. The accent swatches are worth
   trying as a single-select ToggleGroup.
4. **Badge:** LIVE (drawn three ways), the connections pill, the three
   quality badges, BETA, the hero's channel number.
5. **Tooltip through Hint** for every icon-only control: 47 native
   `title`s and `.live-tip`. Player chrome is included only if Adam
   wants it there.
6. **Empty and Alert:** the nine empty and error layouts become one
   pattern (icon, title, description, action). Guide errors keep their
   button beside the message.
7. **Skeleton, Sonner** (the Live toast), **ContextMenu** (the folder
   menu), **Slider** (Row Size), **Separator**.
8. **App components on top:** `BackButton`, `ConfirmButton` (one
   arm-then-confirm look and one wording, announced to screen readers),
   and a rule for Retry: link-style inside a sentence, default when
   standalone.

Each conversion updates its harness checks in the same commit, the lesson
from v0.9.54.

**3.4 ChipTabs is a tablist.** S. Tab, tablist and tabpanel semantics with
arrow keys, and the thumb moves on `transform` rather than `left` and
`width`. The thumb stays (Adam's constraint, 2026-09-06). Same for the mode
rail's indicator.

**3.5 Header and capsule** (plan 014 L2). M.
- The Settings gear gets its 44px round chip back, glyph 20.
- The capsule centres itself when there's no live source (117px off
  today).
- Clock, gear and capsule share one centreline.
- `--header-h` comes from the capsule's real height, so Discover's first
  heading clears the open second row.

**3.6 Delete what is still unused** after 3.3: generated components with
no consumer, `clsx` and `tailwind-merge`, the remaining dead CSS
(`perf.md` F1), dead icons and functions. S.

---

## Track 4: each screen once (M3)

Each screen's list is done while that screen is converted, so nothing is
polished twice. The lists are in `polish.md` and `a11y.md` under the
screen's heading. What matters most per screen:

**4.1 Settings.**
- The tab switcher centred on the card.
- One order for the Live TV and Stream pills.
- One row design.
- Inputs `h-9`, one trailing column for switches.
- One primary button per pane.
- The combobox's two unnamed buttons get names (axe: critical).
- AIOStreams results announced.

**4.2 Header and nav:** done in 3.5.

**4.3 The Live Guide.**
- Programme cells stop showing through the sticky channel column.
- One radius for card and cell.
- The now-line stops at the last row.
- 40px logo tiles, and the lettermark on a tile.
- Tabular times at 12px. A 1px tick, not a "|".
- Even card padding. The selected state per D5.
- **Keyboard:** the grid is one tab stop with arrow keys (roving
  tabindex, the pattern RowScroller already uses).
- The hero's chips as Badges.
- A visible mode-rail track.

**4.4 Sports.**
- One toggle style.
- One toolbar row beside the heading.
- Status text in sentence case, times through `formatClock`, en dashes
  in scores.
- Card colours from tokens.
- Whole-pixel sizes (snap the scale factor).
- No hole under the pills in row 1. Glare radius equal to the card
  radius. Hover parity between card types. A top fade on the scroll.
- League names, not raw ESPN codes ("NASCAR Cup Series", not
  "NASCAR-PREMIER").
- The sidebar stops putting 305 tab stops ahead of the first game (roving
  tabindex, or a skip link).

**4.5 Stream, Discover, Library.**
- Movie and series pages share a left edge, a section order and one
  vertical rhythm.
- Source rows align; ⚡ gets a name.
- " · " in hero meta.
- An icon Back button.
- Discover's grid fills its row with `auto-fill`. The search pill shows
  focus, and its placeholder fits.
- Empty-search copy.
- Library's save menu label, and a confirmation after "Add to Library".

**4.6 Onboarding.**
- The stage scopes dark tokens (`data-theme="dark"`) so shadcn parts stay
  readable whatever the app theme.
- Colours from tokens.
- The finale's copy matches the nav.

**4.7 Structure, every screen.**
- One `<h1>` per screen, then no skipped levels.
- A skip link.
- Live regions mounted empty and filled later.
- Reduced motion covers the Discover row, chip tabs and poster lift.
- Targets at least 24px.

**4.8 The light pass** (per D1).
- `--color-accent` and `--color-secondary` map to `muted` in light, not
  pure white.
- Every light finding in the audit, re-measured: toast, title page,
  sports rail, onboarding, BETA, airing cell, hero glow.
- Accent extremes: add a border when the accent is within 1.5:1 of the
  surface.
- The toggle comes back. `verify-glass` or a light harness covers it.

**4.9 The glass**, per plan 014.

---

## Track 5: download size and speed (M3, before the release)

**Budget:** the hot-channel zip is 779KB. Fonts (5.2), flags (5.3) and
`hls.js/light` (5.5) take it to about 635KB; the code split (5.1) moves
bytes out of the entry but not out of the zip. Set **650KB** as a
`verify-release` check, so it can't creep back. If D4 says no to light,
the budget is 710KB.

1. **Code-split** Settings, Sports and Onboarding with `React.lazy`. The
   entry goes from 906KB to about 537KB. `main.tsx`'s harness entries and
   the console probes become dynamic imports too, or Sports never leaves
   the entry. This doesn't shrink the zip; it cuts boot parse. M.
2. **Fonts:** Geist Mono as one Latin `@font-face` (−47KB). Geist Sans
   cyrillic-ext and vietnamese are a judgement call; keep plain cyrillic.
   S.
3. **Flags:** Spain and Mexico as WebP at display size (about −30KB).
   **Circuits:** SVGO in `harvest-circuits.mjs`. S.
4. **Build:** `build.target: "chrome105"`, no modulepreload polyfill, icon
   paths rounded to 2 decimals. S.
5. **hls.js/light** per D4, and hls.js's worker (`workerPath`) so HLS
   tiles stop transmuxing on the main thread. S.
6. **Runtime, each with a before and after number:**
   - Stamp the disk snapshot with a schema version and skip
     re-normalising when it matches. Don't delete the loop: this clone
     can't prove every old snapshot has expired.
   - Key the sports index on a content fingerprint, so a background
     refresh with the same channels reuses it.
   - One `Intl.DateTimeFormat` per `matchEvent`.
   - `memo` on TheaterOverlay (check `setOverlayApiOverride` first). The
     Guide's layout effect reads before it writes.
   - SaveButton parses once. RowScroller writes only changed tabindexes.
     Up Next's countdown state moves into Up Next.
   - Delete the update chip's endless animation of a property nothing
     reads.
   - Reserve boxes for logos and Continue Watching art, so nothing shifts
     on load.

---

## Track 6: correctness, small and independent (fill M1 and M2)

Each gets a unit test. From `bugs.md`:
- **F11:** Live's popout-closed handler only reclaims popouts Live started.
- **F16:** ESPN fetches get a 15s timeout.
- **F17:** XMLTV accepts times without seconds and programmes without a
  stop (inferred from the next start).
- **F18:** M3U names keep their commas.
- **F20:** the Updates row shows the installer and the hot bundle both,
  and install waits for playback like Restart does.
- **F21 and the sweep's clock finding:** every time on screen goes through
  `formatClock(d, loadClockFormat())`. That's the overlay, ESPN, racing
  and CardFoot.
- **F22:** games near midnight Central. Probe a real late West Coast or
  Hawaii game first; fix by pooling fetched days and bucketing by local
  date.
- **F23:** the accent drag applies live and saves on release.
- **`load<T>` validation:** playlists, favourites, recents, watching,
  AIOStreams and playback prefs get a shape check, the way their siblings
  already do.

---

## Track 7: hygiene (whenever a file is open anyway, plus two sweeps)

**7.1 Stale comments.** About 40 are listed in `sweep.md` 2. Fix each one
when its file is touched. Whatever is left at the start of M3 goes in one
sweep commit.

**7.2 Tests.**
- A vitest setup file with an in-memory Storage. That removes 33 warnings
  per run and lets tests assert what was saved.
- Fix the vacuous assertions (`sweep.md` 3).
- The `harness/*.tsx` rigs import CSS that moved to `old/`; repair them or
  delete them.
- Screenshots go to `SHOT_DIR`, not the repo root.
- `verify-all` stops starting `fake-keybox`.
- Refresh the "Run:" headers that still recommend `vite preview`.

**7.3 Code shape** (M2, when those files are converted anyway).
- A `features/player/` module for the shared player that Stream and
  Sports import from `features/live`.
- `openPopout()` and `useInvChromeHost()`, each written once instead of
  three times.
- One `definePref()` for the 31 load/save modules.
- `reducedMotion.ts` as the only reader of that media query.
- Split `StreamScreen.tsx` (3,150 lines) and `TheaterOverlay.tsx`
  (2,068), as ROADMAP M2 already says.

**7.4 Docs, as the M3 release gate.**
- README rewritten against the tree.
- HANDOFF brought current.
- CONTRIBUTING's root-command claim.
- `components/README.md` and `components.json`'s utils alias.
- The docs site's settings paths, and its building page.
- `stalker-implementation.md`'s status line.

**7.5 Published pages** per D7.

---

## Track N: the next native release (0.10.0, now the freeze is lifted)

In order of how much each protects users. None of these can reach anyone
before a native release. They waited for one after M3; since v0.9.101,
0.10.0 is one, so they can ship in it. N1 in it also retires D6's risk.

- **N0** is Track 0.2(b): Windows CI first, so these land tested.
- **N1:** arm the boot sentinel only on the first boot of a version (or
  quarantine only after two consecutive failures) (F19). This is the one
  that bites real users (D6).
- **N2:** a version string must contain a digit and no `.` or `..`
  component. Sign the manifest's `version` and `nativeVersion`, or carry
  them inside the signed tarball and check them there (F8).
- **N3:** the unpacker tolerates a leading `CurDir`, as a second line
  behind 0.1, with a test for a `./index.html` entry.
- **N4:** build the `CString` before `mpv_create` (F7). The frontend half,
  `validUrl` and `httpUrl` returning `u.href`, can land in Track 6 now.
- **N5:** an allowlist for `mpv_set`, or debug builds only (F15).
- **N6:** remove the commands nothing calls (`open_external`, `mpv_blur`,
  `mpv_snapshot`) and `tauri-plugin-opener`. The slot commands already go
  with M1 step 1.
- **N7:** `tauri.conf.json`'s Android block and `targets: "all"` for a
  Windows-only app.
- **N8:** a CSP that allows mpegts.js's blob workers, if Track 5 shows
  multi-view needs it.

---

## The order, in one place

1. Adam answers D1 to D8.
2. **M1:** Track 0, then Track 1 top to bottom, around the ROADMAP's own
   M1 steps (revert the native slots, Adam's real-stream test, remove the
   looks). Then Track 2. Merge.
3. **M2:** Track 3, with Track 6 and 7.3 alongside.
4. **M3:** Track 4 screen by screen, Track 5, then the release gate below.
5. **Track N** in 0.10.0, which is a native release since v0.9.101.

## The M3 release gate

- [ ] 0.1's archive check passes on the release archive, and a dry run
      unpacks it under the same rules as the app.
- [ ] CI green on the release commit, the Windows `cargo test` included.
- [ ] Board green, no CRASH.
- [ ] Zip at or under 650KB.
- [ ] D1's light decision shipped.
- [ ] Docs match the tree (7.4). The privacy page lists every host the app
      contacts.
- [ ] N1 ships in 0.10.0, which retires D6's risk. If it does not, D6's
      risk is in the checklist and a follow-up release is ready within days.
- [ ] `services/site` stops selling themes and Trakt, at release (ROADMAP).

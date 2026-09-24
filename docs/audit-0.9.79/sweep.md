The audit is complete. The two findings that matter most:

1. **The first frontend-only release will fail on every install.** The tar command in RELEASING.md produces archive paths the app refuses to unpack. The released 0.9.0 app has the same check, and ROADMAP's M3 depends on that release path working.
2. **CI does not run the checks CLAUDE.md treats as the gate.** It only runs on `main`, so v0.9.74 to v0.9.79 on this branch have never had a CI run. The Rust unit tests that guard the unpacker are never executed anywhere.

What I ran myself: `pnpm test` (64 files, 810 passing), `pnpm lint` (clean, 0 warnings) and `pnpm typecheck` (clean). I also ran small vitest and rustc probes from /tmp to check specific claims. I did not run `pnpm verify`, keybox's tests, clippy or cargo. A scan of tracked files for committed secrets found none.

Each finding: severity · claim · file:line · evidence · fix · CONFIRMED or SUSPECTED.

---

## 1. Code health

**Largest files, and what should split out** (CONFIRMED by `wc -l` and a scan of top-level declarations)
- **med** `StreamScreen.tsx` is 3,150 lines. The main component runs from :122 to :1764, followed by Home :1765, RowScroller :1905, Hero :2123, Card :2374, ContinueCard :2443, GenrePills :2640, Detail :2665 and Episodes :2885. Split into `cards.tsx` (Card, ContinueCard, RowScroller), `Hero.tsx`, `Detail.tsx`/`Episodes.tsx` and a `useVodPlayback` hook.
- **med** `TheaterOverlay.tsx` is 2,068 lines, and one component spans :190 to :1989. Split out the seek row and time display (0.7.0 P3.33), the track menus, the skip chip and credits logic, and the tune watchdog (HANDOFF queue #1).
- **low** `sports.css` is 3,803 lines; split it by surface. `stream.css` 1,509, `player.css` 1,262, `live.css` 1,190, `base.css` 1,119 and `settings.css` 1,005 are next.
- **low** `espn.ts` (1,076) holds the fetch gate, backoff, cache, mappers and dispatch together. `LiveScreen.tsx` (1,066) is one component from :255, and `SportsScreen.tsx` (1,010) is one component from :82. `live/source.ts` (865) holds the single-flight cache, the disk cache and all three source builders. Also large: `useGames.ts` 987, `Onboarding.tsx` 869, `AppHeader.tsx` 767, `icons.tsx` 935.
- **low** In Rust, `lib.rs` (1,041) holds all 35 commands plus the HTTP client, popout and updater. `mpv.rs` is 1,136.

**Duplicated logic and parallel implementations**
- **med** The "heal the clip hole, then pop out" sequence now exists three times: `LiveScreen.tsx:713`, `StreamScreen.tsx:1057`, `SportsTheater.tsx:337`. The `#inv-chrome` host is also built three times (`LiveScreen.tsx:759`, gated on `INV`; `StreamScreen.tsx:1320` and `SportsTheater.tsx:389`, gated on `isTauri()`). Fix: an `openPopout()` helper and a `useInvChromeHost()` hook. CONFIRMED.
- **med** The app has two text normalizers and they disagree on accents. `discover/match.ts:29-30` `fold()` strips accents; `sports/matcher.ts:106` `normalize()` deletes accented letters. A probe printed `"ESPN Fútbol" -> "espn f tbol"` and `"Televisión Pública" -> "televisi n p blica"`. Fix: strip accents before the `[^a-z0-9+]` pass. The output is CONFIRMED; real-catalog misses are SUSPECTED.
- **med** The 12h/24h clock setting is ignored outside Live. `espn.ts:955-957` and `racing.ts:212` use the OS locale via `toLocaleTimeString([])`, `CardFoot.tsx:41` calls `formatClock(start)` with its hard-coded `"12h"` default, and `live/stream.ts:200` also uses the OS locale. Fix: `formatClock(d, loadClockFormat())`. CONFIRMED.
- **low** Preference-module boilerplate: 31 modules repeat the load/save KEY/VERSION pattern and 10 hand-roll an `on*Change` event. `cardMeta.ts:31-54` and `overlayMeta.ts:40-63` are the same code line for line. Fix: one `definePref()` helper. CONFIRMED.
- **low** Two single-flight caches remain (0.7.0 P3.34): `live/source.ts:57,104-111,174-220` and `stream/source.ts:34,114`. CONFIRMED.
- **low** Accent reset logic is written three times: `AccentPicker.tsx:78-95` (twice) and `CustomizeTab.tsx:219-223`. Each copy also writes the Aurora and pack-pairing keys, which nothing reads. CONFIRMED.

**Inconsistent patterns for the same job**
- **low** Storage: `lib/storage.ts:1-6` says every persisted key lives there, but `onboardingGate.ts:21,29` and `welcome.ts:62,70` bypass it with a `btv:` prefix. CONFIRMED.
- **low** Reduced motion: `lib/reducedMotion.ts:14` says every surface should read one answer, yet seven inline `matchMedia` calls remain: `BootScene.tsx:108`, `App.tsx:314`, `App.tsx:363`, `welcome.ts:56`, `Onboarding.tsx:154`, `StreamScreen.tsx:1959` and `:1990`. CONFIRMED.
- **low** Fetch: `espn.ts:478` and `live/probe.ts:107` call `fetch` directly, while `lib/http.ts` presents itself as the only seam. SUSPECTED deliberate (ESPN allows cross-origin requests), but it isn't documented.
- **low** Errors: 55 `.catch(() => {})` silent swallows with no shared helper; some sites log and some don't. CONFIRMED.
- **low** Tooltips: `Hint.tsx:10-16` says Hint replaces `title` across "92 aria-labelled controls". Hint has 4 call sites, and 56 `title=` attributes remain (15 in TheaterOverlay). CONFIRMED.

**Module boundaries and naming**
- **med** The shared player lives in `features/live`, but Stream and Sports import `TheaterOverlay`, `InvertedPlayer`, `useDirectOverlay` and `overlayApi` from it. Multiview is split between `live/Multiview*` and `sports/MultiviewScreen.tsx`. Fix: a `features/player/` module. CONFIRMED.
- **low** Sports preferences (`theaterFolded`, `sportsSidebar`, `rankedOnly`, `hideFinishedRow`, `compactResults`) and Stream preferences (`showHero`, `rowCap`, `oneClickPlay`) live in `features/settings` rather than with the feature that owns them.
- **low** Naming drift. `StreamTab` "mylist" is labelled "Library" (`AppHeader.tsx:56,90`; `openRequest.ts:19`). `live/source.ts:137` names the no-sources cache key "mock", but no mock data exists. `ui/Combobox.tsx` wraps `components/ui/combobox.tsx`: the same name in two `ui` folders. There are three icon systems (`ui/icons.tsx`, `ui/icons/*.svg`, lucide-react). There are two parking lots for retired code (`old/` at the root, `src/styles/old/`). CONFIRMED.

**Types that lie**
- **med** `load<T>` results are trusted without validation for list and credential data: `playlists.ts:240`, `favorites.ts:9`, `recents.ts:11`, `watching.ts:43`, `aiostreams.ts:29`, `playbackPrefs.ts:51`. `settingsTab.ts:12-13` itself calls the type parameter "a promise nobody enforces". Sibling modules do validate. The pattern is CONFIRMED; a crash on corrupt storage is SUSPECTED.
- **low** Other casts and non-null assertions: `Guide.tsx:300-306` uses `rect!` after a filter TypeScript can't narrow (use a type-guard filter). `LiveScreen.tsx:973` repeats a `.find()` and asserts `!` on it. `live/source.ts:187` has `undefined as unknown as Promise`. `harness/race.tsx:41` has `f1 as never`. CONFIRMED.

**Dead or residual code** (auditor 5 may overlap)
- **low** `accent.ts` has zero-importer exports: `applyAurora` :156, `isAuroraUnlocked` :188, `unlockAurora` :192, `loadAccentPairedBy` :174. CONFIRMED.
- **low** `lib/tauri.ts` wrappers with no caller: `openExternal` :15, `tauriInvFocus`, `tauriInvStopSlot`, `tauriMpvBlur`, `tauriMpvSnapshot`. Their native commands stay registered (`lib.rs:987-1023`, including `open_external` :932 and `mpv_snapshot` :402), along with the `tauri-plugin-opener` dependency. This is a native change; batch it with the M1.1 slot revert. CONFIRMED.
- **low** `vite.config.ts:6-31` `dropWoffFallbacks` is now a no-op. Only the two Geist packages are imported, and they ship `.woff2` only (10 and 12 files, no `.woff`). CONFIRMED.
- **low** Generated shadcn files were edited in place: `popover.tsx:31` and `combobox.tsx:113` use z-70, while `tooltip.tsx:52` and `dropdown-menu.tsx:42,230` stay at z-50, below the Settings modal's 60 (`settings.css:10`). Re-running `shadcn add` would silently undo the edits. The values are CONFIRMED; a menu actually painting under Settings is SUSPECTED.
- **low** `live.css:289-291` is an empty rule with a stray `;`. CONFIRMED.
- **low** Wrong-value `var()` fallbacks have come back: `discover.css:35` uses `--dur-hover, 120ms` against a 140ms token, `discover.css:369` uses `--danger, #ff6b6b`, and `player.css:1050,1191,1246` use `--accent, #6c8cff`. CONFIRMED.

## 2. Stale comments (all CONFIRMED)

- `player.css:172-175` points to a shared `.player__btn--glass` recipe and a `.player__btn` base rule. Neither exists in any stylesheet since the v0.9.56 shadcn sweep, but TSX still sets the classes (`TheaterOverlay.tsx:1471,1484,1498,1507`).
- `player.css:200` credits "CompositionPlayer" with sizing the chrome host. No such component exists; `InvertedPlayer.tsx` does this.
- `player.css:202-203` and `settings.css:8-9` cite "the theater backdrop (40)". Nothing called a theater backdrop has z-index 40; the only 40 is `.live-tip` (`live.css:296`), and that was already true at v0.9.0.
- `stream.css:1104-1105` says the Sources chip is "revealed on card hover". It has been always visible since 1cfcec91 (v0.9.56); the hover rules exist only in `styles/old/`.
- `lists.ts:11-13` calls `myList.ts` "a thin shim over the DEFAULT list". `myList.ts:1-12` says the mutators are gone, and it exports only a type.
- `favorites.ts:21-23` promises "returns a persisted copy regardless". For an absent id it returns the original list, unsaved (:29).
- `startupTab.ts:3` refers to "the header's TabKey", which doesn't exist (the types are StreamTab and LiveTab).
- `settingsTab.ts:6-7` mentions "changing a theme", and `:11-12` mentions `cornerStyle`, which was removed in c0701645 (v0.9.52).
- `SettingsModal.tsx:32-35` mentions a Themes launcher and an `onOpenThemes` prop. Neither exists.
- `CustomizeTab.tsx:115-116` says the light/dark control "lives in the Themes panel now". That panel is parked, so light mode has no control anywhere. A stored "light" still applies at boot (`main.tsx:43`) and only Reset Appearance clears it. This repeats the trap v0.9.60 hit with the stored accent. Also for auditor 2 (regressions).
- `App.tsx:115-118` is a Themes-panel comment with no Themes code below it.
- `App.tsx:128` and `onboardingGate.ts:35` say "Settings → Customize → Replay Onboarding". It is in General (`GeneralTab.tsx:76`).
- `lib/modalOpen.ts:4-7` mentions "four components" and says "Settings and Themes render as siblings". Only Settings does now.
- `main.tsx:44` is an orphaned comment ("Paid theme CSS... see license.ts") with no code under it; `license.ts` is parked.
- `main.tsx:64-68` says the `?overlay=1` route "survives only for that harness". Five harnesses use it.
- `TheaterOverlay.tsx:67-71` says LiveScreen alone passes the frame state and calls the overlay "Live-only (no VOD seek/speed)". There are three hosts, and VOD seek and speed exist (:1817).
- `accent.ts:4-6` says "Everything red derives from --accent". The default accent has been neutral since v0.9.57 (`tokens.css:78` "THE BRAND IS GONE").
- `accent.ts:78-85`, `:163-171` (ThemePackMeta.pairedAccent) and `:182-185` describe an Aurora easter egg ("CustomizeTab counts" ten clicks). No counter exists.
- `tokens.css:4-6` says the palette is "built around #c22727... the brand carries over", contradicting :78. `tokens.css:73-75` quotes red mix percentages. `tokens.css:241-244` refers to `intense-packs.css` and says `--font-mono` is the system stack; it is Geist Mono (:262).
- `base.css:167-172` says `.app-shell::before` is painted by intense packs. Nothing sets `--pack-bg-*` any more.
- `fonts.ts:50-52` says the licence key field is one of three users of the mono font. That field is dead CSS (`settings.css:919`); `AccentPicker.tsx:217` now uses the font instead.
- `index.css:17-18` says "fourteen sheets" (11 remain). `:99-101` says "then the packs that override them". `:160` cites `ui.css:166` (the rule is now at :172). `:164` says "six variables" and then lists ten.
- `ui.css:3-5` names a "#2a2a2a chip" (it's a token now). `ui.css:215-216` points to `discover.css:38`, which sits inside `.disc-search`, a class nothing renders. `ui.css:423-428` has a comment and rule for `.header__searchchip`, but search moved out of the header.
- `ModeRail.tsx:33` mentions theme packs. `icons.tsx:785,795` describe Sun and Moon as the "Themes panel's theme-style pill"; both icons have zero importers.
- `tmdb.ts:34-36` cites `scripts/fake-tmdb.mjs`, deleted in 7df41fd2 (v0.9.43). TMDB is now answered inside `verify-recommender.mjs:3-8`.
- `StreamScreen.tsx:100-101` calls the VOD scrubber "the next phase". It exists.
- `lib/version.ts:1-2` says "Keep in sync with tauri.conf.json". That contradicts the dev-bump rule in RELEASING.md:144-148 (the files are at 0.9.79 and 0.9.0 by design).
- `lib/tauri.ts:281-283` says the status poll runs every 500ms. It's 100ms while a stream is loading (`useDirectOverlay.ts:44`).
- `index.html:8-10` says "The Tauri window's backgroundColor covers the same gap". No backgroundColor is set anywhere; the window is `transparent: true`.
- `live/source.ts:193` says "mock never persists". No mock exists (:231-235).
- `harness/race.tsx:28-29` says the racing adapter "is still to be written" (`racing.ts` is it), and `:38` names a `toBoard` function that doesn't exist. `harness/golf.tsx:20` and `sports.tsx:34` use `--filter blammytv-app`; the package is `@blammytv/app`.
- `mpv.rs:614-616` quotes a TheaterOverlay comment that no longer exists. `Cargo.toml` and `lib.rs:928-930` describe "theme checkout links" / "Buy links"; nothing calls `open_external` any more.
- `settings.css:128-135` says "the Themes panel wears that class too". `settings.css:930-931` compares to `.chip-select__add`, gone since v0.9.67.
- `fake-keybox.mjs:7-11` points to `verify-license.mjs` (parked) and a theme called "ember".
- `verify-tailwind.mjs:156-162` refers to the "slate" pack in `packs.css` and to verify-themes; both are parked.

## 3. Test quality

- **high** The Rust unit tests never run. `frontend.rs:597-764` has 9 tests covering hot-channel unpacking, but `check-rust.mjs` only compiles them (`cargo check`) and CI runs no cargo at all. None of them covers `./`-prefixed archive entries (see 4.1). Fix: a `windows-latest` CI job running `cargo test`, plus a test for `./index.html`. CONFIRMED.
- **med** Every run prints 33 `[storage] could not persist ... localStorage is not defined` warnings (favorites, recents, follows, source.vod). Persistence is effectively untested, and the one intentional warning (the QuotaExceeded test in `lists.test.ts`) is buried in the noise. Seven files hand-roll the same localStorage stub. Fix: a vitest setup file with in-memory Storage, and assertions on what was persisted. CONFIRMED.
- **low** Weak or vacuous assertions:
  - `placeName.test.ts:37-42`: `not.toBe("NL")` would pass for an empty string. The real output is "NED"; assert `toBe("NED")`.
  - `match.test.ts:140-145`: titled "never returns ... at or below the floor", yet every result is exactly the floor (a probe gave `abcde→abcd`, `interstellar→inte`), and an `if (b)` guard means it passes vacuously if `broaden()` returns null.
  - `networkMap.test.ts:144-148` is a negative-only check on a list that could be empty.
  - `leagues.test.ts:36-38` has an `if (l.logo)` guard; `lists.test.ts:51` asserts only `toBeTruthy`.
  - CONFIRMED.
- **med** Important modules have no tests: `lib/http.ts` (403 browser retry, non-JSON error handling), `lib/storage.ts` (envelope and version fallback), `lib/viewStack.ts`, `stream/openRequest.ts`, `live/diskCache.ts`, `live/useDirectOverlay.ts` (456 lines) and `lib/fitText.ts`. CONFIRMED.
- **med** Two harness subjects have gone out of reach.
  - `verify-tailwind.mjs:605-644` forces the Aurora accent style to check the primary button. No user can reach Aurora since v0.9.60, and ROADMAP M1 deletes it.
  - `verify-tailwind.mjs:156-162` skips the light-theme check because "the pack pins it". The packs are gone, so light mode now has no coverage.
  - Fix: swap check 8 for a light-theme bridge check. CONFIRMED.
- **med** `verify-all.mjs:44` starts `fake-keybox` on :8085, but no active harness uses that port (its consumer, `verify-license`, is parked). CONFIRMED.
- **med** The `harness/*.tsx` dev rigs are broken. `golf`, `race`, `sports` and `theater` each import `../src/styles/packs.css` and `themes.css` at lines 5 and 8; both files moved to `old/` in 8ce5e53c. `tsc` can't catch this because `vite/client` declares `*.css`, so the `tsconfig.json:24-31` safeguard misses it. Nothing runs these rigs. CONFIRMED.
- **low** Screenshots ignore `SHOT_DIR`: `verify-cw-sources.mjs:347` and `verify-probe.mjs:79` write PNGs to the repo root, and `verify-nav-feedback.mjs:68` writes to `/tmp`. CONFIRMED.
- **low** Other harness nits:
  - `verify-conns` is a single check.
  - 24 harnesses hard-code the browser path `/opt/pw-browsers/chromium`.
  - The "Run:" headers of seven harnesses still recommend build plus `vite preview`, the stale-dist trap `verify-all.mjs:97-110` warns about (`verify-adult-filter.mjs:9`, `verify-cw-sources.mjs:18`, `verify-m3u.mjs:10`, `verify-overlay-tracks.mjs:10`, `verify-stalker.mjs:13`, `verify-stream.mjs:5`, `verify-track-prefs.mjs:21`).
  - `verify-probe.mjs` has no header comment.
  - fake-stalker's `NO_BULK` mode is never used.

## 4. Docs vs tree

- **HIGH (4.1)** The frontend-only release command produces an archive the app rejects.
  - RELEASING.md:306 says `tar -czf frontend-<v>.tar.gz -C dist .`. Running it lists `./`, `./assets/`, `./assets/app.js`, `./index.html`.
  - `frontend.rs:348-354` rejects any path component that isn't a plain name. A rustc probe shows `./index.html` becomes `[CurDir, Normal]` and is rejected.
  - The released v0.9.0 has the same check (f7816a6c `frontend.rs:351`).
  - `verify-release.mjs` never inspects the archive's contents.
  - RELEASING.md:308-311 also understates the rule: it says only absolute paths and `..` are refused.
  - Fix: `tar -czf … -C dist index.html assets`, an archive-layout check in `verify-release`, and tolerating `CurDir` at the next native release. CONFIRMED.
- **med** RELEASING.md:203 reads "does steps 2" (typo). `release.ps1:29` builds only the NSIS installer while step 2 builds all targets (`tauri.conf.json:44`), and `release.ps1` never runs `verify-version --release`. RELEASING.md:5-6 ("0.2.0+ installs update themselves") contradicts :27-29. CONFIRMED.
- **med** README.md is out of date in many places.
  - :33 and :50 describe a Profile and a "squircle UI". Profile is gone (`AppHeader.tsx:748`) and the squircle went in v0.9.52.
  - :29-31 still says "v0.0.x ground-up rebuild".
  - :17 and :19 point to "Settings → Playlists / Updates"; the real path is General → Sources / App.
  - :58 promises "demo data"; there is none.
  - :75 says plain CSS with no Tailwind, `#c22727` and Stack Sans. Tailwind arrived in v0.9.49, and the font has been Geist since v0.9.59.
  - :47 and :49 list a "hide channels with no info" setting (it doesn't exist) and "light mode" (no control).
  - M3U and Stalker aren't mentioned. :50 omits sports and components/ui.
  - CONFIRMED.
- **low** CONTRIBUTING.md:28-29 says root commands "fan out" to every package. Root `lint` is `eslint .` (package.json:11), so the app's own lint script never runs. :38-40 says the Rust layer reads localStorage; it doesn't. CONFIRMED.
- **med** HANDOFF.md is 32 days behind.
  - :18-35 still reads "v0.9.0 RELEASED, dev == released... Nothing is half-finished".
  - :97-104 and :170-176 say `verify-overlay-tracks` and `verify-credits` are broken; 3d534a35 (v0.9.23) fixed them.
  - :1561-1563 lists gates without `pnpm verify` or `check-rust`, and "724 tests in 61 files" (now 810 in 64).
  - :1336-1338 says release manifests live in `releases/`; that stopped at v0.3.1.
  - CONFIRMED.
- **med** ROADMAP.md:73-81 and :165-167 list `packs.css`, `themePacks.ts`, `verify-intense-themes.mjs` and others to remove, and name `license.ts`, `ThemesModal.tsx` and `verify-license.mjs` as machinery to keep. All of them left the app in 8ce5e53c and sit in `old/themes/`. What M1.5 actually still has to remove: Aurora in `accent.ts:78-195`, `tokens.css:332-390`, `ui.css:345-441`, `onboarding.css` (2 references) and `verify-tailwind` check 8. ROADMAP:175 and plans/README.md:28 say "nine" unused generated components; the real count is seven, which ROADMAP:31 already has right. CONFIRMED.
- **low** plans/README.md is titled "Motion improvement plans" but now holds everything. Plan numbers 010 and 013 each belong to two files, and `010-handoff-network-map` and `013-brackets` are missing from its table. CONFIRMED.
- **low** `docs/stalker-implementation.md:3` still says "No code written yet"; Stalker shipped in v0.1.137. CONFIRMED.
- **low** `components/README.md:6-14` says `cn` comes from `@/lib/utils` (no such file; every component imports the `cn` package) and names clsx and tailwind-merge as required (both have zero importers). Its `add` command lists 5 of 14 components. `components.json:14` points its utils alias at a missing file. CONFIRMED.
- **med** The docs site (services/docs):
  - `origin/docs` has diverged from this branch, so the "fast-forward docs from main" rule (README:75-79) can't be followed. The deployed privacy page is the older "Short answer" version. That the live site serves `origin/docs` is SUSPECTED, from services/docs/README:64.
  - This branch's privacy page (`how-it-works/index.md:28-36`) omits `api.themoviedb.org` and `a.espncdn.com`, both of which the app contacts. CONFIRMED.
  - Settings paths are stale in `sources/aiostreams.md:23,35,72`, `m3u.md:12`, `stalker.md:17`, `xtream.md:20` and `first-launch.md:51-52`. The app has only General and Customize, and that was already true at v0.9.0. CONFIRMED.
  - `using/themes.md` describes 9 packs, corner style and licences; none of it is in the dev app. CONFIRMED.
  - `contributing/building.md:16-20` says to run `pnpm tauri dev` from the repo root; the tauri CLI is only installed in `apps/app`. The page also skips the libmpv fetch step. CONFIRMED.
- **low** `services/keybox/README.md:1-8` says "the app pastes that key into Settings"; there's no licence UI since v0.9.58. `payloads/nebula.css` ships in the Docker image but isn't in `catalog.json`. CLAUDE.md says verify starts "five fake servers", but one of them is unused. CONFIRMED.

## 5. The rest of the repo

- **high** CI doesn't run what CLAUDE.md calls the gate. `ci.yml:3-7` triggers only on push or PR to `main` and runs typecheck, lint and test. It never runs `check-rust`, the clippy baseline, `cargo test`, `verify-version` or `pnpm verify`. v0.9.74 to v0.9.79 on this branch have had no CI (they're green locally). Neither workflow sets a `permissions:` block (low). CONFIRMED.
- **low** `deploy-pages.yml` publishes a web build to GitHub Pages on every push to `main`, and no doc mentions it. It's a browser copy of the app on a github.io address, with no demo data, that asks for provider credentials. SUSPECTED orphan.
- **services/site** (its content matches the `website` deploy branch):
  - **high** It advertises "integrated list features like Trakt". Trakt is unbuilt and is a 1.0 gate (ROADMAP:108-112). CONFIRMED.
  - **med** The themes grid (4 free packs, 4 paid at $2.50, the $12.50 Pass) and the FAQ sell looks that decision 1 removes. "Sketchbook" isn't in keybox's `catalog.json`. CONFIRMED.
  - **med** The FAQ says "your key was emailed to you"; keybox email delivery is optional (keybox README:292-300). CONFIRMED.
  - **med** The Privacy Policy and Terms links are `href="#"` (index.html:790-791). CONFIRMED.
  - **low** Wrong image alt text at index.html:529/534, 531/536, 532/537 and 610.
  - **low** A 722KB `logo.png` is used five times while `logo.svg` (4.6KB) sits unused, the same issue the app fixed in 0.7.0 P3.7. The page carries 17MB of screenshots.
  - **low** All five site motion plans are still TODO.
- **low** `website/` is an orphaned second landing-page builder. `scripts/gen-bayer-svg.mjs` is tooling for the parked Dither theme. `releases/` stops at v0.3.1. CONFIRMED.
- **low** Dependencies:
  - `clsx` and `tailwind-merge` are unused (replaced by `cn`).
  - `tailwindcss` and `@tailwindcss/vite` sit in dependencies rather than devDependencies.
  - `typescript` is declared in both the root and the app.
  - Two headless UI libraries: `radix-ui`, plus `@base-ui/react` for the combobox only.
  - `tauri.conf.json:60-62` has an Android block and `targets: "all"` for a Windows-only app.
  - The six unimported fontsource packages are documented as intentional, so they're not a finding.
  - CONFIRMED.
- **low** Lint and TypeScript config:
  - `eslint.config.mjs:47-49` enables only two react-hooks rules. There are no type-aware rules, and CI doesn't pass `--max-warnings=0` (currently 0 warnings and 2 disables).
  - The base tsconfig has no `noUncheckedIndexedAccess`.
  - These are judgement calls.
- keybox is deployed, and I only read it. The dev app can't redeem keys after M3; ROADMAP already names that as Adam's call.

## 6. Follow-through on docs/polish-audit-0.7.0.md

- **Fixed:**
  - P1.1 (`LiveScreen.tsx:678`, `StreamScreen.tsx:1012`), P1.2 (`tokens.css:149-153`), P1.4 (`:2374`), P1.5 (`:1845`), P1.6 (`:2515-2529`), P1.7 (`AppHeader.tsx:748`), P1.8 (`PlaylistsTab.tsx:62,251-277`), P1.9 (`:1501,2405,2825`).
  - P2.2 (`lib/errors.test.ts`), P2.3, P2.4 (`LiveScreen.tsx:88`), P2.5, P2.6 (`DiscoverScreen.tsx:224-236,532`), P2.7 (`ui.css:221`), P2.8 (only the minimal `aria-pressed` fix, `ChipTabs.tsx:83`), P2.9 (`:2980-2993`).
  - P3.1, P3.2, P3.4, P3.5, P3.6, P3.7, P3.9, P3.13, P3.14, P3.15, P3.18, P3.20, P3.21, P3.22, P3.24, P3.29.
- **Moot, because themes are parked:** P1.3, P3.8, P3.10, P3.11, P3.12 (the recipe is gone; the comment residue at `player.css:172-175` remains).
- **Partly fixed:**
  - P3.16: `ui.css:3` still says "#2a2a2a".
  - P3.17: the old fallbacks are gone, but new wrong ones appeared at `discover.css:35,369` and `player.css:1050,1191,1246`.
  - P3.23: three apostrophe styles remain. `&rsquo;` ×13, a literal curly apostrophe ×4 (`Onboarding.tsx:332,429,434,449`) and a straight `'` ×3 (`SportsScreen.tsx:793,942,954`).
  - P3.32: `--logo-stops` exists (`tokens.css:124`), but `boot.css:161-174` and `onboarding.css:188-201` still hand-copy a different 12-stop list, and `base.css:498` has a 5-stop one.
- **Regressed or grown:**
  - P2.1: the surviving `.pack-preview-note` (`settings.css:519-545`) is now dead.
  - P3.3: the whole `.license-*` family (`settings.css:910-949`) is now dead.
  - P3.25: two copies became three.
  - P3.26: the file grew from 2,245 to 3,150 lines, and its importers from 2 to 3.
- **Still open:**
  - P3.27/28: `stalker.ts:61` and `:398` have zero callers.
  - P3.30: there is no z-index scale. Values in use: 20, 30, 40, 45, 46, 50, 60, 200 and 1000, plus z-50 and z-70 utilities and `TheaterOverlay.tsx:461` at z-1000.
  - P3.33: `TheaterOverlay.tsx:406` still subscribes to time updates at the top of the component.
  - P3.34: both single-flight caches remain.
- **The audit's "came back clean" baseline still holds:** 0 `console.log`/`console.debug`; `console.info` rose from 8 to 56 sites, all in the console probes and the `[live]` timing logs.

**Status: DONE.** Everything above is as checked from here. Not checked: `pnpm verify` and the keybox tests (both start servers), clippy and cargo, the live deployments, and any Windows runtime behaviour. I made no repo writes, so there's nothing to commit and nothing to restart.

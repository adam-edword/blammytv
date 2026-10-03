# Audit of 0.11.0, overnight 2026-10-02

Morning summary: (written when the audit is done)

## How it ran

Adam, after publishing 0.11.0: "run until its actually done". Ten auditors,
read-only, briefed with the 2026-09-28 audit's log so nothing fixed then is
reported again:

- **The new code since v0.10.63** (25 commits, about 2,250 lines): the HLS
  proxy (security first), Sports (the odds model, the board split, the
  folding rail), and everything else new (glass and light mode, Trakt
  without a secret, live subtitles off).
- **A second pass over the whole app**: Live TV, Multi-view, Stream and
  VOD, the native code, the app shell, security across everything, and the
  tooling, harnesses and site.

Every finding is checked here before anything changes. Confirmed and
clear-cut: fixed on the branch, through the `sonnet` builder when it's past
a small tweak. A judgement call, or anything touching main, a release, the
site deploy or keybox: held below, with the case for it.

## Findings

### Tooling, harnesses and site (second pass)

**T1. MEDIUM. The privacy page is false at 0.11.0.** Confirmed.
`services/docs/src/content/docs/how-it-works/index.md:62-68` says "It has no
account" and "nothing that reports what you watch"; Trakt and MyAnimeList
are accounts, and a connected Trakt is sent what you watch. The host table
(lines 32-41) misses `api.trakt.tv`, `auth.trakt.tv`, `myanimelist.net`,
`api.myanimelist.net` (`src-tauri/src/lib.rs:884, 948-949`) and TMDB, and
still lists `themes.eddtv.org`, which nothing in the app calls now. Line 97,
"doesn't re-encode, re-host or relay anything", is false for Multi-view's
proxy and HEVC conversion. `using/library.md:41` says nothing is synced; the
Trakt watchlist is. Plan: rewrite those passages from the code. The deploy
(`origin/docs` is a further 59 lines behind main) is Adam's.

**T2. LOW-MEDIUM. `verify-release` passes manifests the updater rejects.**
Confirmed by reading: manifest mode (`scripts/verify-release.mjs:266-310`)
never checks `pub_date`, the platform key, or that `version` is semver, and
`tauri-plugin-updater` refuses all three. RELEASING.md promises "a green run
means an install will accept the update". Plan: check all three.

**T3. LOW. `verify-conns` sleeps 30s on every run.** Confirmed:
`scripts/verify-conns.mjs:35-38` waits for "Fake Sports HD", which only
fake-stalker serves (`fake-stalker.mjs:82`), and swallows the timeout. Plan:
wait for a name its own fake serves.

**T4. LOW. CI's harness job has little headroom.** Confirmed:
`.github/workflows/ci.yml:56` gives it 25 minutes; recent runs take 20 to
21.5. Plan: raise it to 35.

**T5. LOW. The 0.11.0 changelog oversells the Escape fix.** Confirmed:
`CHANGELOG.md:101` says Escape closes Settings the first time; v0.10.43's own
message (`88fb40c2`) says 4 of 40 runs still lost it to a 7-14ms Radix gap.
Plan: soften the repo's line. The GitHub release notes are Adam's own text
and don't make the claim.

**T6. LOW. RELEASING.md and `verify-release` describe the hot-bundle
unpacker as it was at 0.9.0.** Confirmed: RELEASING.md:334 says "unchanged
since 0.9.0" and that a leading `./` is refused (tolerated since v0.10.38);
the unpacker refuses link entries since v0.10.47 (`frontend.rs:466-470`) and
`verify-release`'s layout check doesn't. Plan: fix the doc and teach
`verify-release` the link rule, with T2.

**T7. LOW. Clippy's warning gate runs on an unpinned toolchain.** Plausible,
not reproducible today: `ci.yml` uses `dtolnay/rust-toolchain@stable` and
counts warnings against 9, so a new default lint on a Rust release turns CI
red with no code change. **Held** (see below).

**T8. LOW. The deployed site still lists UI Scale.** Confirmed on
`origin/website:services/site/index.html:653`; main's copy doesn't have it.
**Held**: the site deploy is Adam's, as last week's drift finding was.

### App shell and shared code (second pass)

**S1. MEDIUM. The player's keys act on the stream while Settings is
open.** Confirmed: `TheaterOverlay.tsx` `onDocKey` (around line 1388) skips
inputs, held modifiers, a taken Escape, and a button's own keys, and nothing
else. Settings focuses its card, so over a playing Guide preview the arrows
seek and change volume, Space pauses, and M, F and the rest act, while
`preventDefault` also stops the arrows scrolling Settings. `isModalOpen()`
(`lib/modalOpen.ts`) is the bit made for this. Plan: stand down while a
modal is open.

**S2. MEDIUM. Onboarding adds the same playlist twice.** Confirmed:
`Onboarding.tsx` `continueTv` verifies and calls `addPlaylist`, which never
dedupes (`playlists.ts:149`); Back keeps the form filled, so Continue again
adds "Xtream Playlist 2" with the same line, and the Guide shows every
channel twice. Also confirmed, LOW: Back pressed while the check is still
running doesn't stop it, and its `.then` arms `advance` after `retreat`
cleared the timer, so the step jumps forward again. Plan: a repeat Continue
replaces the playlist it saved instead of adding one, and a check that
finishes after Back doesn't advance.

**S3. LOW. A live pop-out doesn't count as playing.** Confirmed:
`lib/playingNow.ts` looks for `.vod-stage`, `#inv-chrome` and a Multi-view
tile; popping out a live channel unmounts the in-app player, so Restart now
and Install pass their guard and end the PiP. `lib/tauri.ts` already tracks
`livePopout`. Plan: count it.

**S4. LOW, accessibility. The header search has no focus ring.** Confirmed:
`.navcap__searchinput` sets `outline: none` (`base.css:786`), ui.css opts
text inputs out of the global ring, and settings.css's restore list
(`:322-329`) doesn't include it. Plan 016 3.1 listed it. Plan: a ring on the
search capsule while its input has keyboard focus.

**S5. LOW. A new AIOStreams manifest can empty the hero.** Confirmed: saved
Hero Slider Sources are only pruned when Customize's section is opened, and
`source.ts:185` uses them whenever any are saved; keys the new manifest
doesn't have each pool to nothing, so no hero. Plan: use the saved keys the
manifest has, and the default mix when it has none of them.

## Held for Adam

- **T7, pinning Rust for CI.** Two ways: pin the CI jobs only
  (`dtolnay/rust-toolchain@1.99.0`), which keeps your machine on whatever
  rustup gives it; or a `rust-toolchain.toml`, which pins your machine too
  and makes every build agree. I'd pin CI only: the gate is the thing that
  breaks, and a repo-wide pin turns every Rust update into a chore.
- **T1 and T8's deploys.** The docs and the site deploy from their own
  branches. The fixed text lands on the dev branch; publishing it is a
  merge you make.

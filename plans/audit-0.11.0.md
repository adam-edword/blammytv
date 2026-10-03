# Audit of 0.11.0, overnight 2026-10-02

Morning summary: (written when the audit is done)

**Progress:** all 10 auditors back. A session restart at 03:30 UTC killed
seven of them and Sonnet's fullscreen run; the seven were started again
and 0.11.1 was finished here (v0.11.1, `8e9b5ef0`). Every finding is
checked; fixes go out in batches through the builder: Sports first, then
the app shell, Live TV, Stream, Multi-view, light mode, native, tooling.

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

### Security, whole app (second pass)

Nothing HIGH or MEDIUM, and no way found for provider data to inject HTML
or script (the CSP, the three vendored SVGs, every stream URL traced to an
http(s) check). Its third finding is T1 again.

**X1. LOW. The native player opens any path it's handed.** Confirmed:
`inv_open` and `popout_open` (`src-tauri/src/lib.rs`) pass the string to
mpv's `loadfile` unchecked; only the frontend's `validUrl`, `httpUrl` and
Stalker's regex restrict it to http(s), and the frontend is the
hot-swappable layer. `open_external` (`lib.rs:1135`) already refuses
anything but https, and `tunable()` exists for exactly this threat. With
script in the page, a UNC path would hand Windows' NTLM hash to another
host. Needs script in the page first, and none was found. Plan: refuse
anything but http and https natively.

**X2. LOW. `http_get`'s timing line can print a password.** Confirmed:
`lib.rs:782` keeps the first three `/`-pieces as "the origin", which for
`http://user:pass@host/...` includes `user:pass@`. Dev terminal only
(release has no stdout), but that output is what gets pasted into
sessions. Plan: log the parsed origin.

### Sports (new code, then the whole feature)

**SP1. HIGH. A hidden NFL station whose nickname matches a club in
another league leads the rail, and autoplay tunes it.** Confirmed,
reproduced (the auditor's `/tmp/audit-sports/a.test.ts`, run here): Cubs v
St. Louis Cardinals on FOX with three FOX games in the slot gives
`[NFL Teams: FOX Cardinals (KSAZ) Phoenix AZ 90 team hidden, US: FOX 23]`,
and the card's only channel is the Phoenix station, which shows Phoenix's
game. SF Giants pick the New York NFL station the same way; Baylor Bears v
Oklahoma St Cowboys picks Chicago's and Dallas's. `carries()`
(`matcher.ts:398-403`) takes a nickname among other words as `team`
without asking whose league the channel names, and `settle()` lets a
hidden `team` at 90 out of the folder (v0.10.76, for your hidden team
stations). Plan: a channel that names another league ("NFL Teams" for an
MLB game) is never this game's `team`. Your NFL stations keep working for
NFL games.

**SP2. MEDIUM. The board split counts games that are over, and splits
two-hour doubleheaders.** Confirmed, reproduced: an ESPN game at 7:00 ET,
final, and one at 9:00, live, both read `{espn: 2}`, so the live one's ESPN
drops to 45 and off its card. `sharing.ts` counts every game within 150
minutes whatever its state; its own comment says a doubleheader shouldn't
share, and ESPN's college basketball runs every two hours. Plan: finished
games don't count, and the window drops to 120 minutes (strict, so a
two-hour doubleheader doesn't share; 4:05 and 4:25 still do, and nothing
regional starts more than half an hour apart).

**SP3. MEDIUM. The theater ignores the "Usually found on" fallback.**
Confirmed, reproduced: a UEFA qualifier's card says "Usually found on US:
CBS Sports Network" (`useGames.ts` presumed fallback), and opening it
shows "No broadcast listed for this game." and plays nothing, because the
theater's `railFor(game.broadcasts, ...)` sees no listing. Multi-view
tunes the same presumed channel. Old (v0.9.0 or before). Plan: the
theater falls back the way the card does.

**SP4. LOW. A presumed network is never split by other games that
presume it.** Confirmed: three qualifiers at one kick-off each claim
CBSSN at 90. **Held**: "usually found on" is a claim about carriage, not
about which game is on, and splitting it would take the card's only
answer away for the leagues that list nothing. Your call if you'd rather
it split.

**SP5. LOW. `airing()` counts another game's show on shared nicknames.**
Confirmed, reproduced: Auburn Tigers v Georgia Bulldogs counts "LSU Tigers
at Mississippi State Bulldogs". Diagnostic only, but it's the measurement
`btvPairing` reports for the guide's place in the matcher. Plan: at least
one club by full name or place, not two bare nicknames.

### The rest of the new code (glass and light, Trakt, live subtitles)

Trakt without a secret, the copyable code, live subtitles off and the
release commit: nothing found. Four of five findings are light-mode
screens nobody looked at in light.

**N1. MEDIUM. The film and series pages are white text on a light scrim
in light mode.** Confirmed by reading, measured by the auditor (title
contrast 1.05 to 1.56 in light, 9.6 to 18.9 in dark): `.vod-detail`'s
scrim fades to `--bg` (`stream.css:676-684`), which light makes near-white,
and every word on the page is `--on-image` white. Plan: the title page is
a picture page, so it takes `.on-picture`, the way the Home hero's header
does, with its no-art ground dark too. In light it reads like dark there,
which is what a page over a backdrop should do.

**N2. MEDIUM. Multi-view's channel names are white on the light page.**
Confirmed: `.mvcap` (`player.css:2153-2164`) sits in `MultiviewGrid`, not
inside the `.on-picture` tile, and takes `--on-image`; its siblings
`.mvcap__now` and `.mvcap__sound` already take `--text`. Plan: so does the
name.

**N3. LOW-MEDIUM, accessibility. A menu's highlighted row doesn't show in
light mode.** Confirmed: the dropdown, context-menu and combobox items
use `bg-accent`, which is `--surface-raised`, white in light, on 72% white
glass (1.03:1). Ctrl+K already fixed the same pairing
(`player.css:2012`). Plan: light's menu highlight a step darker, the
palette's way.

**N4. LOW. `.on-picture` paints page-coloured things around a picture
near-black in light.** Confirmed: the windowed theater's rounded corners
(`player.css:352-367`) and a focused multi-view tile's gap ring
(`player.css:1600-1604`) use `--bg`, which `.on-picture` makes dark. In
light the corners show as dark notches on the grey page. Plan: a page
colour token `.on-picture` doesn't override, for those two rules.

**N5. LOW. A verify-appearance check passes vacuously.** Confirmed by
reading: "Dark stays dark whatever Windows says" emulates light while the
page is already light, so no change event fires
(`scripts/verify-appearance.mjs:121-130`). Plan: emulate dark first, then
flip.

### Live TV core (second pass)

**LV1. MEDIUM. A playlist that fails on a refresh loses its channels
until the next good load.** Confirmed, reproduced
(`/tmp/audit-live/vt/partial.test.ts`): with A and B on disk and B
answering 503 at launch, the guide phase publishes A's channels only and
writes that to disk; B's channels leave the Guide, Favorites and Sports,
and a playing B channel stops. Plan: a source that errors keeps its last
good channels, folders and hidden list from the snapshot.

**LV2. MEDIUM. Hiding a folder blanks every lane's guide for the whole
XMLTV download.** Confirmed, reproduced (`hide.test.ts`): hide changes the
cache key, the forced reload's first phase has no programmes, and the
screen and `lookupLive()` show "Loading guide…" for the 60 to 77 seconds
your guide takes. Undo does it again. Plan: the channel half is seeded
with the previous guide's programmes by channel id; hiding doesn't change
a programme.

**LV3. MEDIUM-LOW. A playlist change made on Sports or Multi-view loads
nothing.** Confirmed by reading: only `LiveScreen` listens to
`onPlaylistsChange`; `useLiveData` loads once at mount, and Sports' tune
reads `lookupLive()`, which is null under the new key. Rail clicks and
autoplay do nothing until the Guide is opened. Plan: a playlist change
loads the catalog whatever screen is up.

**LV4. LOW. The 100ms status poll never slows on a dead channel.**
Confirmed by reading: `useDirectOverlay.ts:345` polls at the tune rate
while `loading` is true, which a stream that never presents leaves true:
ten IPC calls a second for as long as the dead card shows. Plan: back off
once the tune is called dead.

**LV5. LOW. On Stalker, switching channel keeps the old picture under the
new name.** Confirmed by reading: the `[playing, heroId]` effect
(`LiveScreen.tsx:672-690`) doesn't clear `playUrl` while `create_link`
runs (up to 30s), and a failed link closes the player with no message.
Plan: clear the old URL at the switch, and say when the link fails.

**LV6. LOW, security. A queued disk write can undo Clear All Login
Info.** Confirmed by reading: `scheduleDiskPut` (`source.ts:89-93`) writes
1.5s later without asking whether its key is still current, so a clear in
that window is followed by a record whose key holds the Xtream password.
Plan: ask `isCurrent` inside the timer.

**LV7. LOW. Catalog downloads keep the 30s total timeout.** Plausible,
reasoned only: the guide gets 180s because it was measured; nobody has
measured a big catalog on a slow line. **Held**: not changed without a
number.

**LV8. LOW. Stalker's Unhide list shows genre ids.** Confirmed by reading:
`PlaylistsTab.tsx:386-399` assumes the stored ids are folder names, which
holds for M3U; Stalker stores the portal's genre id, so you see "14".
Plan: show the folder's name.

### Multi-view (second pass)

**MV1. MEDIUM. The grid is held to the wrong line, two ways.** Confirmed
by reading and reproduced (`/tmp/audit-multiview/probe.test.ts`):
`lineFor` (`mvGrid.ts:274-278`) gives up whenever two Xtream lines answer,
so with every tile on a one-stream line A there's no cap at all and Add
offers four; and an empty grid takes the one line's cap even with an M3U
beside it, so "Your line allows one stream at a time" hides Add and a
Guide channel from the M3U is dropped. The reconnect gate already uses
each channel's own line. Plan: all tiles on one playlist means that
playlist's line; an empty grid is blocked only when that line is the only
live source. One pinned test (`mvGrid.test.ts:241`) changes with it.

**MV2. MEDIUM. Fill with live games adds a game already on the grid
through another feed.** Confirmed, reproduced: `fillFrom` skips channel
ids only (`mvGames.ts:263-283`), so a game picked on its second feed goes
in again on its first. Plan: skip by game.

**MV3. LOW-MEDIUM. Saved tiles from a deleted or disabled playlist stay
forever.** Confirmed by reading: a playlist with no group never counts as
gone (`MultiviewTab.tsx:325-332`), so a deleted line's tiles read "No
stream" and hold a slot, and a disabled one's play on its saved
credentials. Plan: tiles on a playlist that's deleted or off are dropped.
The other half (an empty 200 counts as loaded and drops tiles) stays as
it is, with LV7's reasoning: read only, confidence 6.

**MV4. LOW. Holding M, G, S or F toggles at key-repeat rate.** Confirmed
by reading: only Delete and R ignore `e.repeat`
(`MultiviewTab.tsx:765-805`); held F thrashes the window. Plan: toggles
ignore repeats.

**MV5. LOW. A closed tile's reconnect gate keeps running.** Confirmed by
reading: the gate waits up to 45s and then calls `fresh()`, which, if the
channel was re-added, restarts the new tile's healthy stream. Plan: tile
cleanup aborts its gate.

**MV6. LOW. One league's failed poll blanks its games' scores.**
Confirmed by reading: `mergeLeagues` replaces a rejected league with
nothing (`mvGames.ts:54-79`). Plan: a failed league keeps its last games.

### Stream, VOD and the player (second pass)

**ST1. MEDIUM. Continue Watching on a finished episode replays it.**
Confirmed by reading: `quickResume` resolves `entry.episodeId`, and
`resumePoint` gives 0:00 for a finished one, so leaving in the credits and
clicking the card starts the same episode over. The comment on
`retiredFromContinue` promises it rolls forward. Plan: a finished series
entry resumes the next episode.

**ST2. MEDIUM. A rewatch you leave in the first seconds is sent to Trakt
as watched again.** Confirmed by reading: `setPlaying` keeps the old
`posSec` for the same episode even when it was finished
(`StreamScreen.tsx:309-311`), and the scrobble's cleanup prefers the entry
over this session's own number, so it sends a stop at about 99%. Plan:
progress is kept only when it's being resumed.

**ST3. MEDIUM. Eight of Settings' 28 languages never match a coded
track.** Confirmed, reproduced (`/tmp/audit-stream/lang.test.ts`, ten
failures): `langKey` cuts a three-letter code to two letters
(`playbackPrefs.ts:198-202`), so `pol`, `tur`, `swe`, `ind`, `cze`, `gre`,
`dut` and `rum` miss, and `rum` matches Russian. Plan: a real ISO 639-2
table.

**ST4. LOW-MEDIUM. A Trakt 401 or 403 drops a queued watch.** Confirmed
by reading: the drain treats anything under 500 but 429 as sent
(`trakt/sync.ts:83-84`), and the app's own native code treats a 403 as
Cloudflare's passing challenge. Plan: keep and retry 401, 403 and 408.

**ST5. LOW. A new Trakt account gets the old account's watches.**
Confirmed by reading. **Held**: the ledger is also the app's own watched
record, and there's no notion of whose it is; clearing it at sign-out
loses your checkmarks. Your call.

**ST6. LOW. Retry with nothing cached plays an uncached source.**
**Held**: it's your click on Retry, and the rule against uncached sources
is about automatic paths. No change.

**ST7. LOW. Kitsu-keyed anime never get exact skip ranges.** Confirmed by
reading: AniSkip's index is IMDb-only (`aniskip.ts:75-76`) though the
Kitsu to MAL mapping exists and MAL's writes use it. Plan: use it here
too.

**ST8. LOW. A MAL tick is lost when the mapping data can't load.**
Confirmed by reading: the item is marked handled before the lookup, which
then answers nothing (`mal/sync.ts:98-111`). Plan: not handled until it's
sent or queued.

**ST9. LOW. A palette pick during a resolve is overruled by it.**
Confirmed by reading: `consume` stops a playing stream but not a resolving
one (`StreamScreen.tsx:541-565`). Plan: it cancels the resolve.

**ST10. LOW-MEDIUM. Long series lose their oldest checkmarks.** Confirmed
by reading: `markWatched` cuts the ledger to 600 (`watched.ts:73`) while
Trakt's sync writes it whole, so a 700-episode show loses 100 ticks and
"next up" falls back to episode 1. Plan: no cap on what Trakt wrote.

### The HLS proxy (security first)

No security hole: a 128-bit token, children per route, loopback only with
an exact Host check, and no URL ever taken from a request.

**H1. LOW-MEDIUM. A master playlist's variants are forgotten after about
4,096 segments.** Confirmed, reproduced (the auditor's host-crate copy):
`trim` (`mvproxy.rs:121-139`) evicts by when a playlist last named a URI,
and fetching never refreshes it, so the master's variant goes first and
the tile fails after 2 to 11 hours depending on segment length. Plan: a
fetch refreshes the entry.

**H2. LOW. The rewriter misses playlists hls.js reads.** Confirmed,
reproduced for the space case: `#EXT-X-KEY:METHOD=AES-128, URI="k.bin"`
comes back unrewritten (hls.js trims attribute names); a non-UTF-8 body,
a playlist served as `text/plain`, and CR-only line ends go through
whole too. Each leaves a relative URI hls.js resolves against loopback,
and the tile fails. Plan: trim, decode lossily, know a playlist by
`#EXTM3U`, split on CR.

**H3. LOW. One huge playlist stalls every tile.** Confirmed, reproduced:
8 MiB of short URIs holds the routes lock 2.4 to 3.5s and returns 78 MB.
Needs a hostile provider. Plan: cap the URIs per playlist and answer 502
past it.

### Native (second pass)

Nothing in `inv.rs`, `credman.rs`, `build.rs`, the config or the
capabilities, and no way for the webview to reach anything X1 and X2
don't cover. check-rust and the host crate's 68 tests pass.

**NA1. LOW-MEDIUM. A second launch can sign Trakt out and throw away a
good hot bundle.** Confirmed, reproduced for Trakt (two `Trakt`s over one
vault and a fake server): both processes load the same refresh token,
which is single-use; the second one's refresh gets 400 and
`refresh_locked` clears the vault (`trakt.rs:327`), deleting what the
first just saved. The hot channel can quarantine a new bundle the first
launch is still booting. There's no single-instance guard
(`lib.rs:1147-1150`). Plan: `tauri-plugin-single-instance` in release
builds, focusing the open window. Dev builds stay unguarded so
`pnpm tauri dev` still runs beside an installed copy.

**NA2. LOW. Pop out drops the audio track and the speed.** Confirmed by
reading: the handoff carries start, volume, mute and subtitles
(`mpv.rs:211-260`), so a Japanese track or 1.5x comes back as mpv's
default at 1x in the PiP. Plan: carry `aid` and `speed` the way `sid` is.

**NA3. LOW. A quarantined hot bundle downloads again on every launch.**
Confirmed by reading: `should_stage` (`frontend.rs:692-696`) doesn't know
about quarantine, so `frontend_check` fetches the 1.1MB bundle and only
then refuses it, silently, until the next release. Plan: don't stage a
quarantined version.

**NA4. LOW. `http_get` buffers a whole body with no size cap.**
Plausible, reasoned only (`lib.rs:819`). **Held** with LV7: not changed
without a number.

## Held for Adam

- **T7, pinning Rust for CI.** Two ways: pin the CI jobs only
  (`dtolnay/rust-toolchain@1.99.0`), which keeps your machine on whatever
  rustup gives it; or a `rust-toolchain.toml`, which pins your machine too
  and makes every build agree. I'd pin CI only: the gate is the thing that
  breaks, and a repo-wide pin turns every Rust update into a chore.
- **`mpv_snapshot` (plan 016 N6).** With X1 fixed it can only grab a
  frame of a stream; it's a diagnostic, and removing it is the open N6
  item you own.
- **T1 and T8's deploys.** The docs and the site deploy from their own
  branches. The fixed text lands on the dev branch; publishing it is a
  merge you make.
- **SP4, splitting "usually found on".** I'd leave it: it's a carriage
  claim, and splitting it empties the card for leagues that list nothing.
- **ST5, the old Trakt account's watches.** Clearing the ledger at sign-out
  loses your own checkmarks; keeping it pushes them to the next account.
  I'd keep it as is: one person switching Trakt accounts is rare, losing
  checkmarks isn't.
- **ST6, Retry choosing an uncached source.** It's a click, so I'd leave
  it.
- **LV7, MV3's empty-answer half, NA4.** Each needs a number nobody has
  measured (a big catalog's download time, how often a panel answers an
  empty 200, a body size cap). Unchanged until there's one.

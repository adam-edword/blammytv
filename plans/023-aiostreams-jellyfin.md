# Plan 023: AIOStreams' Jellyfin side

**Status: BUILT, 2026-10-04, overnight. Not yet run against a real
AIOStreams.** Adam took all six decisions as recommended and asked for it
built overnight ("Can you proceed during the night?").

## Where it landed (morning of 2026-10-04)

- **B2, v0.11.13** (`86d275ae`): `features/aiojf/ids.ts` (the packed ids,
  against AIOStreams' own vectors) and `rules.ts`, pure, 122 tests.
- **B1, `595c29a1`**: `src-tauri/src/aiojf.rs`, Quick Connect, the session
  in Credential Manager (`BlammyTV/aiostreams`), every call from Rust, and
  the guard that refuses the stream-search paths whatever the page asks.
  24 host tests (host crate 125). Native: needs a rebuild.
- **B3 to B6, v0.11.14** (`30d66746`): the Settings row, the reports, the
  sync, the Next Up and Upcoming rows and the skip markers.
  `verify-aiojf`, 57 checks, including zero `GET /Items/<id>`.

Calls made on the way, any of them one message to undo:
- **A rewatch you leave early un-plays it on AIOStreams.** Its rule, not
  ours: any stop under 90% writes `played: false`
  (`core/src/watch-state/local-provider.ts`, `stopPatch`), and so does its
  own idle sweep five minutes after a client goes quiet. Every AIOStreams
  app does the same. Fighting it means re-sending the played mark after
  every partial rewatch, which bumps its play count and reaches its
  tracker addons as a new watch. Left alone; BlammyTV's own ticks keep
  the union either way. This bends D3's "never removed" for the one case
  the server decides.
- **Sync triggers are Trakt's real ones**: launch, back after 15 minutes,
  Sync now. "After playback" was in this plan but not in Trakt's code.
- **The played list is read a page at a time, and `Limit=20` on Resume.**
  Unasked, AIOStreams answers 100 and 12. Asked for 500 played it still cuts
  at its `browseLimit`, 250 by default and 100 when the instance sets
  `maxCatalogItems` to 0, and it holds at most 500 played rows per user. So
  the sync pages by `StartIndex` until the total, an empty page or 500.
- **Upcoming's date is a calendar day** (`calendarDay`), as episode dates
  are elsewhere since v0.10.45.
- **Leaving past the line between two 10s looks is a finish** (stop, then
  the mark), as Trakt's scrobble reads it.

Still to see on a real build: the code approving on the configure page,
a play showing in AIOStreams' own apps, a Next Up row with real art, and
a Skip Intro from AIOStreams' markers on a show.

Adam, 2026-10-04: "next up we should plan for jellyfin", then, on
AIOStreams' v2.35 update: "make sure you're fully caught up". Asked which
Jellyfin he meant, his own server or AIOStreams' new Jellyfin side, he
picked **AIOStreams' Jellyfin side**. He has no media server of his own;
this plan is not a Jellyfin library client.

Before that answer he had picked, for a server of his own: its library in
Stream, both ways (rows and "On your server" on matching titles), and
two-way watch sync. Here those become: AIOStreams' Continue Watching, Next
Up and Upcoming in Stream, and two-way sync with AIOStreams' own watch
state. "On your server" has no meaning against AIOStreams, which serves
every title.

## What AIOStreams' Jellyfin side is, checked

Read on 2026-10-04 from AIOStreams' source at tag **v2.35.9** (commit
`1dcfa76`, released 2026-10-03), not from memory. Its docs site is blocked
from the build box; the repo's own docs (`packages/docs/content/docs/guides/
jellyfin.mdx`, `media-server.mdx`, `reference/jellyfin-extensions.mdx`) were
read instead. Paths below are under `packages/`.

- **Every configuration is a Jellyfin-compatible server**, on by default
  (`core/src/config/schema/jellyfin.ts:11-20`, `JELLYFIN_ENABLED`). An
  instance can switch it off. Mounted at `/jellyfin`, `/jellyfin/u/:alias`
  and `/jellyfin/:uuid/:encryptedPassword` (`server/src/app.ts:243-246`).
  BlammyTV already stores the manifest URL, so it knows the host.
- **Sign-in is Quick Connect,** made for apps like this one: the app asks
  for a 6-digit code (`POST /QuickConnect/Initiate`, 10 minutes), you
  approve it on your AIOStreams configure page (Save & Install, Jellyfin
  apps, Connect), and the app polls `/QuickConnect/Connect?secret=` then
  trades the secret at `/Users/AuthenticateWithQuickConnect`. The approval
  page is where a household user and its PIN are picked. The manifest URL
  alone can't get a token (`server/src/routes/api/jellyfin.ts:359-375`).
- **The token never expires** (`core/src/jellyfin/auth.ts:10-45`). It dies
  when the config's password changes, when that user's PIN changes, or when
  the user is deleted. Read from `Authorization: MediaBrowser … Token="…"`.
- **What you watch can be reported by item id alone.** `POST
  /Sessions/Playing`, `/Progress` and `/Stopped` take `ItemId` and
  `PositionTicks`; `PlaySessionId` and `MediaSourceId` are optional
  (`server/src/routes/jellyfin/playstate.ts:50-57, 152-176`). Nothing is
  ever refused: an id it can't read is a silent 204. The duration comes
  from the title's meta, so a stop may not mark it played; `POST
  /UserPlayedItems/{id}` does, explicitly.
- **Item ids can be computed here, from the ids BlammyTV already has.** A
  packed id is 16 bytes as 32 hex: `0xa1`, kind and id type, the Stremio
  type, the numeric id (6 bytes), season and episode (2 bytes each,
  `0xffff` for none), three zero bytes (`core/src/jellyfin/ids.ts:150-185`,
  code tables `:32-67`). Checked by hand: `tt0111161` (a movie) is
  `a1110100000001b239ffffffff000000`. Episodes pack only when the meta's
  video id is the plain `tt…:S:E` (or `kitsu:ID:E`); otherwise the server
  uses a hashed id only it can read.
- **Watch state lives in AIOStreams' own database**, shared with every app
  signed into that config (Infuse, Swiftfin, its own desktop app). Resume
  (`/UserItems/Resume`), Next Up (`/Shows/NextUp`), Upcoming
  (`/Shows/Upcoming`) and played items (`/Items?Recursive=true&IsPlayed=true`)
  come back as Jellyfin items: films and shows with `ProviderIds` (Imdb,
  Tmdb, Kitsu…), episodes with `SeriesId`, season and episode numbers and a
  packed id. There is no "changed since"; it's poll everything.
- **Trackers:** AIOStreams pushes plays, stops and played marks to any
  addon you've added that declares the `watch_state` resource, every 60
  seconds (`core/src/config/schema/watch-state.ts:49`). None is built in.
  The known ones forward to AniList, MDBList and Simkl; no Trakt one was
  found.
- **Skip markers:** `GET /MediaSegments/{id}` gives Intro, Recap and Outro
  ranges from IntroDB (IMDb, season, episode), AniSkip (MAL) and PMDB, on
  by default (`schema/jellyfin.ts:141-150`). It needs the token. Without
  a runtime (which a play it didn't start doesn't have), AniSkip can't pick
  a release and open-ended markers are dropped. The instance's own setting
  text: it "sends the id, season and episode of everything played to the
  providers".
- **The trap:** `GET /Items/{id}` with no `Fields`, on a film or an
  episode, runs AIOStreams' whole stream search (your addons, debrid
  checks), the same work as pressing play (`server/src/routes/jellyfin/
  items.ts:702-713`, `library.ts:100-106`). Anything this plan reads must
  ask for `Fields` without `MediaSources`, or use `/Items?Ids=`.
- **Rate limits** per kind of call answer 429 (`routes/jellyfin/index.ts:
  168-201`). It reports itself as `ProductName: "Jellyfin Server"`,
  `Version: "12.0.0"`, with an extra `aiostreams` object in
  `/System/Info/Public`, which is how the app tells it from a real server.

## What BlammyTV has today

- **Continue Watching** (`features/stream/watching.ts`): one entry per
  title, position and duration, 20 entries; Trakt's paused progress merges
  in, newest first (`features/trakt/progress.ts`).
- **Episode checkmarks**: `watchedEpisodes`, which Trakt's sync replaces
  whole for every IMDb-keyed show on each pass (`features/stream/
  watched.ts`, `features/trakt/sync.ts:128`); MAL's ticks sit apart in
  `malWatched` so that replace can't wipe them.
- **Skip Intro** for anime from AniSkip (`features/stream/aniskip.ts`), and
  a credits window that pops the mini Up Next.
- **Trakt and MAL** connections, each native (`trakt.rs`, `mal.rs`), tokens
  in Windows Credential Manager, a Settings row each.

## What it does (recommended scope, D1)

**A1. Connect.** Settings → General → Accounts, an "AIOStreams sync" row
under Trakt and MAL. Connect shows the 6-digit code and opens your
configure page; once approved it shows the user's name, when it last
synced, Sync now and Disconnect (which signs the device out). It only
appears once an AIOStreams URL is set, and changing that URL disconnects
it, since the token belongs to that config.

**A2. What you watch goes to AIOStreams.** Playing a film or an episode
reports start, pause and stop with the position, and progress every 10
seconds. At BlammyTV's 90% line it marks the title played. Offline, a
played mark waits and goes at the next sync.

**A3. What you watched elsewhere comes in.** Its resume points join
Continue Watching (newest wins, alongside Trakt's), and its played
episodes tick in the episode grid, in their own store.

**A4. Skip Intro, Skip Recap, and credits, for films and shows.** Its
markers drive the player's skip button and the credits window, for every
title it has markers for. Anime keeps BlammyTV's own AniSkip (D4).

**A5. Next Up and Upcoming rows** in Stream, under Continue Watching.

**Not in this plan:** browsing or playing through the Jellyfin side
(BlammyTV keeps the Stremio side for titles and sources, which works and
would be a large refactor to replace for no new content), favourites,
ratings, external subtitles from subtitle addons (they need mpv work of
their own), the WebSocket, and a Jellyfin library client for a real
server.

## Decisions

**D1. Scope.** A1 to A5. *Recommend all five.* A2 and A3 are the point:
your plays here show in AIOStreams' other apps and theirs show here. A4 is
the new thing you can see, skips for everything, not only anime.

**D2. Trakt, and AIOStreams' trackers.** AIOStreams forwards plays to any
tracker addon in your config. BlammyTV already scrobbles to Trakt itself.
- (a) **Keep BlammyTV's Trakt as it is**, and don't add a Trakt tracker in
  AIOStreams. The Settings row says so in one line.
- (b) Turn BlammyTV's own scrobbling off while AIOStreams sync is on, and
  let a tracker addon do it.
*Recommend (a).* No Trakt tracker addon was found, BlammyTV's Trakt does
more (history, paused progress, the watchlist), and (b) would make Trakt
depend on an addon. Both on would count every play twice.

**D3. The conflict rules,** the same shape as Trakt's (plan 015, D3):
- **Watched:** a watch is a fact. AIOStreams' played episodes live in
  their own store (`aioWatched`), replaced on each sync like Trakt's, so
  un-marking on another AIOStreams app un-ticks here too. A tick shows if
  any store has it: yours, Trakt's, MAL's or AIOStreams'.
- **Progress:** the newest position wins, by its time, whichever side it
  came from.
- **Played marks out:** only ever added from here, never removed.
*Recommend all three.*

**D4. Skip markers.**
- **Films and shows:** AIOStreams' markers (IntroDB, PMDB). Recap and intro
  get the skip button, outro opens the credits window.
- **Anime:** BlammyTV's own AniSkip, as today. AIOStreams' AniSkip needs a
  runtime it won't have for a play it didn't start.
- **Skip stays a button**, never automatic, as it is now.
*Recommend this split.* The privacy line: AIOStreams' marker lookup sends
the title, season and episode to those providers; that's the instance's
setting, and the privacy page will say so.

**D5. Where the token lives.** Windows Credential Manager, and every call
made from Rust, the same as Trakt and MAL (plan 015, D4a). It never
reaches the page or localStorage. A stable device id is generated once per
install; without one, every install would share one AIOStreams session.
*Recommend.*

**D6. Household users.** Picked on AIOStreams' approval page, PIN
included; BlammyTV only shows whose it is. *Recommend.* A user picker
inside BlammyTV is a later step if you share the app.

## What Adam does

1. Nothing to register: Quick Connect needs no app keys.
2. Check your AIOStreams config's trackers, in AIOStreams' own settings,
   and leave any Trakt one out (D2).
3. On the first run: Connect, approve the code on the configure page, play
   something for a minute, and see it appear in AIOStreams' own Continue
   Watching (its web app at `/web`, or Infuse).

## Build order

1. **B1, native (a rebuild):** `aiojf.rs`. The `MediaBrowser` header
   (`Client="BlammyTV"`, the stable device id, the version), Quick Connect
   (initiate, poll, authenticate), the token in Credential Manager, one
   request command for GET and POST with JSON, 401 means disconnected,
   `Retry-After` honoured on 429. Host-tested against a fake, like trakt.rs.
2. **B2, the rules as pure functions:** the id packing, ported with the
   five vectors from the source and checked against AIOStreams' own
   `tryPack`; decoding pulled ids back to `tt…` and `tt…:S:E`; the merge
   rules (D3). Unit tests, one per rule.
3. **B3:** the Settings row (A1).
4. **B4:** reporting (A2), hooked where Trakt's scrobble is.
5. **B5:** bringing it in (A3, A5), on Trakt's triggers: launch, back after
   15 minutes away, after playback, Sync now.
6. **B6:** the skip markers (A4).

**Harness:** `scripts/fake-aiojf.mjs`, a fake of AIOStreams' Jellyfin side
the way `fake-trakt` stands in for Trakt, and `verify-aiojf`: the sign-in
(code shown, pending, approved, expired), the reports a play, a pause and
an ending send (with the packed ids), a resume point and a tick arriving,
Next Up and Upcoming rows, a skip button from a marker, a 401 that
disconnects, and Disconnect. **The fake fails any `GET /Items/{id}`
without `Fields`**, so the trap can't creep in.

**Docs:** the privacy page (what AIOStreams receives once connected, and
the marker providers), and a "Sync with AIOStreams" section on the
AIOStreams page.

## Risks

- **AIOStreams moves fast:** ten releases from 2.35.0 to 2.35.9 in eight
  days, plus nightlies. This plan is pinned to v2.35.9; the fake mirrors it,
  and the first real run is the check. Your instance must be 2.35 or later
  with the Jellyfin side on; the row says so plainly when it isn't.
- **The stream search trap** (above), held by the fake.
- **Ids that don't pack:** an episode whose meta video id isn't plain
  `tt…:S:E` can't be reported. Skipped quietly, and counted in the sync's
  log line so a real run shows how often.
- **Two trackers counting one play** (D2).
- **Not checkable from the build box:** your instance and its version, the
  approval page, marker coverage for what you watch, Credential Manager.
  Those are your first run.

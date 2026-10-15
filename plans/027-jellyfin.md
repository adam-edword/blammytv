# Plan 027: Jellyfin, your own server

**Status: BUILT, not yet released** (branch `claude/jellyfin-027-i009y2`,
batches 0 to 6, 2026-10-14). The release of everything since 0.11.12 is
still held for it (see "The held release" at the end), and goes out as 0.12.0
when Adam says. Written 2026-10-14 as the handoff for a new session; the
rest of this file is that handoff, unchanged. What was built and what is
unchecked is in the next section.

## What was built

Decisions D1 to D7 were taken as recommended: Jellyfin is its own source
beside AIOStreams, password and Quick Connect, the token to mpv as a header
only, a new `jf.rs` and `features/jellyfin/`, a full sync, no Live TV, one
server. The facts it was built on are in `027-api-facts.md`, from Adam's own
Jellyfin 12.2.

| Batch | Commit | What |
|---|---|---|
| 0 | b141f65 | the real server's answers, and `fake-jellyfin.mjs` built from them |
| 1 | 05d8711 | `jf.rs`: sign-in, Quick Connect, vault, guarded requests |
| 2 | d200220 | items, ids and sources as Stremio shapes (`features/jellyfin/`) |
| 3 | 482f2a3 | playback: the token to mpv as a header, put back after |
| 4a | a2e01f6 | Settings → Sources → Stream → Jellyfin, sign-out, kept out of Export |
| 4b | 7e6e431 | libraries as Stream rows, a title's page, its files, playback |
| 4c | 6d21bc5 | Discover: libraries in the grid, genres, search, art |
| 4d | c595988 | external subtitles (`sub-add ... auto`), `mpvsubs.rs` |
| 5 | 3d2ce5e | reporting, Resume into Continue Watching, watched marks, Next Up, skips |
| 6 | | docs (a Jellyfin page, How it works), baselines, this section |

Two cards, not one (D1): a title in both a Jellyfin and an AIOStreams is two
cards, each opening its own source. Merging them is the follow-up the plan
named, not built.

Nothing from Jellyfin reaches Trakt or MAL: `jfWatched` is its own store, read
by the ticks (`loadWatched`) and never pushed, and Continue Watching keeps one
card per title (`mergeAioProgress`, newest wins, `from: "jf"` on a resume from
the server). A live play still goes through Trakt's scrobble like any source.

### Not checked, and why

From a Linux container with a fake server. Each needs Adam's device and his
server:

- **Real libmpv on Windows.** `sub-add <url> auto <title> <lang>` and what
  `auto` picks; that `path` reads back byte-identical to the loaded URL (the
  in-app add waits on it); whether `sub-add` blocks mpv's core during the
  fetch; the pop-out's add on `MPV_EVENT_FILE_LOADED`.
- **Not run against a live server:** Discover's `genres` and `searchTerm`
  (read from the server's OpenAPI, not probed); the reply to
  `EnableResumable=false` on Next Up; a non-default `MaxResumePct`; real
  positions and media segments.
- **Not on real WebView2:** images from the server, and the screens as a
  whole (the harnesses run Chromium).
- **Windows Credential Manager** holding the token (the host tests use the
  in-memory vault).
- **A Jellyfin-side Trakt plugin** would count a play from here twice. The
  docs say so; there is no in-app note.

## Against AIOStreams' own Jellyfin client (2026-10-15)

Adam asked whether ours works the way AIOStreams' new app does. Read from
Viren070/AIOStreams at `59a0a02` (static, nothing run; AGPL, so ideas only).
Their `packages/web` is a general Jellyfin client, with extras when the
server is an AIOStreams, and their desktop app draws libmpv under a
transparent web view, the same shape as ours. Paths below are under their
`packages/web/src/`.

**The same:** password and Quick Connect sign-in; `/Sessions/Logout` on
sign-out; direct play of the file only, no transcoding
(`lib/playback/stream.ts`); reports every 10 s with `IsPaused`, `CanSeek`
and `PlayMethod: DirectPlay`, and the server's own thresholds deciding
played (`lib/playback/reporter.ts:43-70`); `MediaSegments` for skipping;
Next Up with `EnableResumable=false`; clearing Continue Watching as position
0; a `/web/index.html` address cut back to the server (`lib/servers.ts:137-157`,
ours `jf.rs:424-443`).

**Where ours is safer, and stays that way:** their token is plain JSON in
localStorage, in jellyfin-web's own `jellyfin_credentials` shape
(`lib/credentials.ts`), and rides in every stream URL as `ApiKey`
(`lib/playback/stream.ts:8-19`). Ours is in Credential Manager, never
reaches the page, and goes to mpv as a header only when the server refuses
the stream without it. Their client can call anything the token can; ours is
an allow list, which matters because an admin's token can delete media.

**What they have that we don't**, roughly by worth:

1. **Sized images.** Every image asks for `maxWidth` (the display width in
   device pixels, rounded to fixed steps) and `quality=90`
   (`lib/images.ts:7-34`). Ours asks for the original (`items.ts:56-64`).
   Not measured on Adam's server.
2. **A stop that couldn't be sent is kept**, and sent as the position once
   the server answers again (`lib/playback/reporter.ts:84-146`). Ours drops
   it, so a network blip at the end of a play loses where you were.
3. **Watched and unwatched by hand** (`POST`/`DELETE /UserPlayedItems`,
   `lib/queries.ts:817-836`), and "watched up to here". Our guard already
   allows the calls; nothing in the app makes them.
4. **Favourites**: a heart (`/UserFavoriteItems/{id}`, `lib/queries.ts:909-921`)
   and a Favourites page.
5. **Live watch state**: the server's WebSocket `UserDataChanged` refreshes
   what's watched within a second (`lib/server-events.ts`). Ours waits for
   the next sync.
6. **Track choice from the server**: the Jellyfin user's own audio and
   subtitle settings (`lib/user-config.ts`), and the picks remembered per
   show in `DisplayPreferences` (`lib/playback/show-tracks.ts`).
7. **A richer title page**: person pages, similar titles
   (`/Items/{id}/Similar`), trailers, ratings, studios.
8. **"Who's watching?"**: the server's public users as a grid at sign-in
   (`/Users/Public`, `pages/sign-in.tsx:487-491`).
9. Several servers (D7 kept one), offline downloads (their desktop and
   Android shells only), search suggestions and history.

Not worth taking: the token in localStorage and in stream URLs.

## Start here

You are a new session with none of the context that wrote this. In order:

1. Read `CLAUDE.md`. It is binding: no guessing, data before significant
   changes, the Confusion Protocol, the Sonnet builder for anything past a
   small tweak, the gates, the writing style, and the reply format Adam
   expects.
2. Work on the branch `claude/nice-heisenberg-67k4uk` (or one cut from it).
   `main` may sit at 0.11.12, which has none of the AIOStreams Jellyfin
   code this plan builds beside.
3. Read plans 023 and 024. They built BlammyTV's only Jellyfin client so
   far, for AIOStreams, and most of what they decided carries over.
4. Confirm with Adam what this plan means (next section), then put the
   decisions below to him before any code. Each has a recommendation; each
   is his call.
5. Get a real Jellyfin to test against before trusting any API fact in
   this file ("Data before code").

## What "the actual Jellyfin side" means here

Today the app speaks Jellyfin's API to one kind of server: AIOStreams'
Jellyfin-compatible side (plans 023, 024). A plain Jellyfin server, your own
library of files, is refused at sign-in. `aiojf.rs` reads
`GET /System/Info/Public`, wants an `aiostreams` object in it, and answers
`UNSUPPORTED` without one (`apps/app/src-tauri/src/aiojf.rs:18-21`,
`:198-203`, `:742`). Adam asked about this on 2026-10-14 after learning the
existing "Jellyfin" work was AIOStreams-only.

This plan takes it to mean: **connect to a real Jellyfin server, sign in,
browse its films and shows, play its files, and keep watched marks and
resume points in step with it.** Not confirmed with Adam yet:

- Whether he runs a Jellyfin server himself, and which version. This
  decides the first real test, and maybe the scope.
- Whether Jellyfin's Live TV (its tuners and guide) is wanted too. Out of
  scope below unless he says so.

## What exists, and what of it carries over

| Piece | Where | Carries over |
| --- | --- | --- |
| Native client: sign-in, vault, header, guard, calls | `src-tauri/src/aiojf.rs` (about 3,760 lines with its tests) | The shape, not the code. No Tauri in the file; tested in the host crate (`scripts/mvproxy-host`) against a fake; the token never leaves Rust (plan 023, D5); the session in Windows Credential Manager (`credman.rs`, a blob of at most 2,560 bytes, `aiojf.rs:79-80`); the `Authorization: MediaBrowser` header percent-encoded; a 401 signs out here; a 429 waited out once (`MAX_RETRY_WAIT`). |
| The address reading | `aiojf.rs` `derive` (`:380`) | No. It reads AIOStreams addresses (manifest, configure, `/stremio/` paths). |
| The guard | `aiojf.rs` `on_the_list` (`:475-497`) and `guard` (`:542-557`) | No. It is an allow list of the fourteen calls AIOStreams needs, and its trap rules (no single-item read without `Fields`, never `MediaSources`) exist because AIOStreams runs a whole debrid search on those. On a real Jellyfin a single-item read is cheap and `MediaSources` is the server's file list. A real Jellyfin needs its own allow list. **AIOStreams' guard must not get any looser for it.** |
| Sources | `aiojf.rs` `sources` and `SOURCE_KEEPS` (`:219-233`) | No. On AIOStreams `PlaybackInfo` is the stream search and a source's `Path` is the stream URL. On a real Jellyfin `Path` is the file's path on the server, which nothing here can open. |
| Commands | `lib.rs` `aiojf_status`, `_start`, `_poll`, `_request`, `_sources`, `_disconnect` (`:1242-1320`, registered `:1806-1811`) | As a pattern. |
| Jellyfin to Stremio shapes | `features/aiojf/browse.ts` | Partly. Views to catalogs and items to metas are generic Jellyfin DTOs. The Stremio id is read from `Path`, which only AIOStreams fills that way. |
| Ids | `features/aiojf/ids.ts`, `idmap.ts` | No. They pack and unpack AIOStreams' own 16-byte ids. A real Jellyfin's ids are the server's own. |
| Watch state rules | `features/aiojf/rules.ts` | Largely: ticks (`TICKS_PER_SEC`), `UserData`, resume points, Next Up are Jellyfin's DTOs. Keyed by packed ids today. |
| Reporting plays | `features/aiojf/report.ts` | The routes (`/Sessions/Playing`, `/Progress`, `/Stopped`, `/UserPlayedItems/{id}`) are Jellyfin's own. The 90% rule and the stop-then-mark order are written for AIOStreams' stop semantics; check Jellyfin's. |
| Sync | `features/aiojf/sync.ts` | The list routes are Jellyfin's own. |
| Skip markers | `features/aiojf/skips.ts` (`GET /MediaSegments/{id}`) | Maybe. Jellyfin added media segments in 10.10 (verify), filled by a plugin if the server has one. |
| The one door | `features/aiojf/conn.ts`, `data/aio.ts` | The idea: one place decides where Stream reads from. |

Everything downstream keys a title by its Stremio id (`browse.ts`'s header):
Continue Watching, the watched ledgers, Trakt, MAL. A real Jellyfin item
carries `ProviderIds` (IMDb, TMDB, TVDB) when its metadata matched, which
gives a Stremio id. One that didn't match needs its own scheme, as
AIOStreams' hashed titles got `aiojf:<Id>`.

## What a real Jellyfin needs that AIOStreams didn't

These are from memory, not read. **Check each against the server's own
OpenAPI before relying on it** (Jellyfin serves its spec; find where on
the version you test). Jellyfin's server source is GPL-2.0: read it for API
facts, write our own code, the rule this repo already keeps for AIOStreams
(AGPL) and Telly.

- **Sign-in by password.** `POST /Users/AuthenticateByName` with the user
  name and password. The password goes to Rust and is never stored; only
  the token is. Quick Connect works too, but an admin can turn it off.
- **Sign-out revokes.** `POST /Sessions/Logout` ends the token on a real
  server. AIOStreams' did nothing (`aiojf.rs:35-36`).
- **Playback needs the token on the file's request.** mpv plays the file
  from the server (`/Videos/{id}/stream` with `static=true` and the media
  source, for a direct stream). Either the token rides in the URL
  (`api_key=`), where the page and any log line could see it, or as a
  header. mpv takes headers per file (`http-header-fields`), and v0.11.40
  already sets mpv's `user-agent` per file and puts it back
  (`mpv.rs:261-281`, `mpvagent.rs`).
- **Its own files, several of them.** An item can have more than one
  version (`MediaSources`), each with its own audio and subtitle streams,
  and external subtitle files. mpv direct-plays all of them; no transcoding
  is needed for this app.
- **Versions.** Routes moved in 10.9 (`/UserViews`, `/UserItems/Resume`,
  `/UserPlayedItems`); older servers have the `/Users/{userId}/...` forms.
  `/System/Info/Public` gives the version without a sign-in.
- **No addon search, no debrid.** A source list is the item's own media
  sources, there at once.

## Decisions for Adam

Each with a recommendation. Ask them together, with the trade-offs, before
any code.

- **D1, where the library shows.**
  (a) A Jellyfin server is a source of its own in Settings → Sources →
  Stream, beside AIOStreams. Its libraries become rows in Stream and
  Discover, and a title opened from them plays the server's files.
  (b) Stream reads one or the other, as AIOStreams' sign-in and manifest
  do today.
  (c) A tab of its own.
  Recommended: **(a)**, without merging a title found in both into one page
  at first. Merging is a follow-up once both work side by side.
- **D2, how you sign in.** Password and Quick Connect both (recommended:
  password always works, Quick Connect saves typing it), or one of them.
- **D3, how mpv gets the token.** As a header set per file and put back
  (recommended: the token is never in a URL the page, a log line or an
  error could carry), or `api_key` in the URL.
- **D4, shared code.** A new `jf.rs` and `features/jellyfin/` that copy
  aiojf's shape, with only truly identical helpers shared (recommended:
  AIOStreams' guard and trap rules are security work tested line by line,
  and a common client would have to bend them), or one generalized client
  with an AIOStreams flavour.
- **D5, what syncs.** Plays reported to the server, resume points into
  Continue Watching, watched marks both ways, and Next Up as a row, as
  AIOStreams' sync does (recommended), or less.
- **D6, Live TV from Jellyfin.** Out (recommended for this plan), or in.
- **D7, one server or several.** One, like AIOStreams (recommended).

## Data before code

- **A server.** Adam's own, if he has one (ask its version). Otherwise
  Jellyfin's public demo, if this container can reach it (check; it can't
  reach Cinemeta, ESPN or TMDB). Run the sign-in, a library read, a play
  and a report against it before building on the facts above.
- **A fake for the harnesses and host tests**, `scripts/fake-jellyfin.mjs`,
  shaped like `scripts/fake-aio.mjs`, with the shapes taken from the real
  server's answers and its OpenAPI.

## Rules this must not break

- The token never reaches the page, localStorage, a log line or an error
  (plan 023 D5). Every call is made from Rust.
- AIOStreams' guard stays exactly as tight as v0.11.20 left it.
- Logs cut URLs to their origin (`mvproxy::origin_of`), and the page's
  lines go through `lib/scrub.ts` (runs of 32 token characters redacted,
  `scrub.ts:63`). A stream URL is never logged whole.
- Export never writes a sign-in into a file (v0.11.38's never group).
- Clear All Login Info clears it (v0.11.14 did this for AIOStreams).
- Two-tier updates: a new command rejects on an older native build and the
  page takes that quietly (plan 008).
- Continue Watching, the ledgers, Trakt and MAL keep keying titles by their
  Stremio id.

## A starting shape for the build

Firm this up after the decisions, then hand batches to the builder with a
brief each (CLAUDE.md, "Bigger changes").

1. Native `jf.rs`: sign-in (password, Quick Connect), the vault, the
   header, status, disconnect (revoking), and a guarded request with its
   own allow list. Host tests against the fake.
2. A pure adapter: Jellyfin items to Stremio shapes, ids from
   `ProviderIds` and a scheme for the rest. Unit tests.
3. Playback: native builds the request for an item and a media source, and
   mpv gets the token as D3 decides.
4. Wiring: Settings → Sources, rows in Stream and Discover, a title's page,
   its sources from its media sources.
5. Sync and reporting, as D5 decides.
6. Docs: How it works's host table, a Jellyfin page, and a harness
   (`verify-jellyfin`).

Gates per CLAUDE.md for every batch: typecheck, lint, test; check-rust,
clippy at its baseline, the host crate; the harnesses touched, with a
mutation where a check could pass vacuously.

## The held release

Everything since 0.11.12 (v0.11.13 to v0.11.49) was about to go out on
2026-10-14 and was held for this. `CHANGELOG.md` keeps its entry under
"Unreleased", to be headed with the real version when it ships. Adam was
also weighing 0.12.0 over the dev number, recommended because the batch is
bigger than 0.11.0 was. When it goes, the steps are in `RELEASING.md`, and a
push to `main` deploys the site and docs, so push `main` when the release
goes out, not before.

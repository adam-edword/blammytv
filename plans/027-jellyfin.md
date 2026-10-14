# Plan 027: Jellyfin, your own server

**Status: TO PLAN.** Written 2026-10-14 as the handoff for a new session,
nothing built. Adam: "lets not release this yet and then create a readme for
a new session to build the actual jellyfin side". The release of everything
since 0.11.12 is held for it (see "The held release" at the end).

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

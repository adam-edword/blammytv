# Plan 024: AIOStreams by sign-in

**Status: CALLS TAKEN, 2026-10-04.** Adam took all four as recommended:
the manifest stays as a fallback (D1), an adapter behind today's
functions (D2), sources no older than 3 minutes on open (D3), and a saved
manifest URL deleted once you've signed in (D4). B1 (native: sign-in from
an address, `aiojf_sources`) and B2 (the adapter's pure half, every id kind
AIOStreams packs) are built in v0.11.16, not wired yet. B3 next.

Adam, 2026-10-04, after plan 023's sync worked on his instance: "we should
have this be the default aiostreams connection method now". Asked whether
he meant offering sync at setup or the Jellyfin side replacing the
manifest, he picked **Jellyfin replaces the manifest**: sign in with the
instance's address and a code, nothing pasted, and Stream's catalogs,
details, sources and playback all come over AIOStreams' Jellyfin side.

Plan 023 left this out on purpose (its "not in this plan" list). This is
that plan.

## What you get, and what it costs

**You get:**
- **No manifest URL to paste.** You type your instance's address and
  approve a code on its configure page, the way plan 023's sync works.
- **Nothing secret in the app's profile.** The manifest URL is a password
  in plain text today (how-it-works says so in a caution box). The
  sign-in lives in Windows Credential Manager, and the page never sees it.
- **One sign-in** for Stream and sync. Plan 023's row folds into it.
- **Household users** (plan 023, D6), each with their own AIOStreams
  variants, so two people on one config can get different libraries and
  sources.

**It costs:**
- **25 sources per title**, where today you get every one the addons
  return. The instance can raise that to 50; a config can only lower it.
- **The first 20 catalogs** show; any past that don't.
- **Discover stops 250 titles deep** into any one catalog.
- **Instances with the Jellyfin side off can't sign in.** It's on by
  default, but ElfHosted's public instances have it off, and its private
  ones ship with it off (D1 is about this).
- **A five-batch build**: a native command, a pure adapter with tests,
  the wiring, a harness fake, the docs.

**Nothing changes** for anything BlammyTV already leaves out: torrents and
magnets, YouTube and external links (the source list only keeps http(s)
URLs, `mapper.ts:351-363`), streams that need headers (mpv is never given
any), and addon subtitles (never loaded today).

## What AIOStreams' Jellyfin side does, checked

Read on 2026-10-04 from AIOStreams v2.35.9's source (commit `1dcfa76`), the
same checkout as plan 023. Paths are under `packages/`. Two research
passes mapped it; the lines below were each read first-hand.

- **On by default, and an instance can switch it off.** `JELLYFIN_ENABLED`,
  default `true` (`core/src/config/schema/jellyfin.ts:11-20`). Its docs:
  "Public instances have it on except ElfHosted's, and ElfHosted's private
  instances have it off until you turn it on"
  (`docs/content/docs/guides/media-server.mdx:9`).
- **Sign-in needs only the instance's address.** Quick Connect works from
  the plain `/jellyfin` mount; the configure page's approval picks the
  config and the household user. The token never expires and dies on a
  password or PIN change (plan 023 has the detail).
- **Catalogs are libraries.** `GET /UserViews` lists one per browsable
  catalog, in your config's order. A catalog with a required extra other
  than a genre isn't one (`core/src/jellyfin/library.ts:40-48`). At most
  20 (`maxLibraries`, `jellyfin.ts:76-86`), each paged with `StartIndex`
  and `Limit` to at most 250 deep (`maxCatalogItems`, `:65-75`). Each view's
  `Path` is `/aiostreams/<type>/<catalogId>`, so it maps back to the
  catalog BlammyTV knows today.
- **Details come with no stream search** when the request names `Fields`
  without `MediaSources`, as plan 023's guard already enforces. A title's
  `Path` is `/aiostreams/<type>/<id>/…` (`core/src/jellyfin/dto.ts:555`),
  so the Stremio id comes back on every item.
- **Sources are the same search.** `PlaybackInfo` runs
  `engine.getStreams`, the call Stremio's `/stream` route makes
  (`server/src/routes/jellyfin/resolve.ts:273-281`).
  - Each source's `Name` is the formatter's name and description lines
    joined (`core/src/jellyfin/label.ts:45-56`), the text the source list
    shows today.
  - An `aiostreams` object carries `cached`, `service`, `resolution`,
    `size`, `filename` and `bingeGroup` (`core/src/jellyfin/media.ts:133-163`).
    That covers what the source list reads now: the cache groups, the
    quality badge and the same-release roll.
  - Capped at 25 by default, 50 at most, and a config can only pick lower
    (`jellyfin.ts:98-108`, `resolve.ts:132-136`).
- **Playback goes straight to the source.** A source's `Path` is the
  stream's own URL (`media.ts:594-597`), the one the Stremio side hands
  over today. Only the Android Jellyfin app is sent through AIOStreams'
  stream route (`server/src/routes/jellyfin/context.ts:49-53`,
  `items.ts:766`). AIOStreams never carries the video. Its built-in debrid
  links answer with a 307 to the CDN (`server/src/routes/api/debrid.ts:265`).
- **It keeps the last search.** Without asking, `PlaybackInfo` hands back
  any kept list with playable sources, up to 4 hours old. `Fresh: true`
  means no older than the reuse window (180 s); `Refresh: true` searches
  again (`server/src/routes/jellyfin/playback.ts:132-161`).
- **Images need no token** and redirect to the original URL
  (`server/src/routes/jellyfin/images.ts:256-264`, `context.ts:397-401`).
- **Rate limits.** `PlaybackInfo` shares the Stremio stream route's bucket,
  10 per 15 s per IP (`server/src/routes/jellyfin/index.ts:64, 168-180`,
  `core/src/config/schema/rate-limits.ts:109-114`), so the same as today.
  Everything else is 250 per 30 s.

## How BlammyTV would read it

**An adapter, not a rewrite (D2).** Today the Stream tab reads the
Stremio side through four functions in `data/stremio.ts`
(`fetchManifest`, `fetchCatalog`, `fetchMeta`, `fetchStreams`) and
`fetchAioCatalogs` in `data/aiostreams.ts`, and every store that
remembers a title keys it on its Stremio id: Continue Watching, the
watched ledgers, lists, Trakt, MAL, AniSkip, the caches. The adapter
answers those same calls from the Jellyfin side, in the same shapes:
- the manifest's catalogs from `/UserViews` (id and type from each view's
  `Path`, genres from `/Genres?ParentId=`);
- a catalog page from `/Items?ParentId=&StartIndex=&Limit=` (`genre` and
  `search` extras as `GenreIds` and `SearchTerm`);
- a title's details from `/Items/{id}?Fields=…`, its episodes from
  `/Shows/{id}/Episodes`;
- its sources from `PlaybackInfo`, each one rebuilt as the stream
  `mapper.ts` already reads (name and description lines,
  `streamData.service.cached`, `behaviorHints.bingeGroup`, `url`).

So `mapper.ts`, the screens, the ledgers, Trakt and MAL don't move.

**Ids stay Stremio ids.** Going in, an id is packed as AIOStreams packs
it (plan 023's `ids.ts`, extended from IMDb and Kitsu to the other kinds
AIOStreams packs: TMDB, TVDB, MAL, AniList, AniDB, Simkl). Coming back,
it's unpacked, or read from the item's `Path`. A title from an addon's own
id scheme gets a hashed id from AIOStreams, which the adapter remembers
from the list it arrived in.

**The token stays native.** Browse and details go through plan 023's
`aiojf_request`, whose guard keeps refusing a stream search. Sources get
their own command, `aiojf_sources(itemId, fresh)`, so starting a search
is something the page asks for by name and never by accident. Images and
playback URLs carry no token. Addon subtitles do (AIOStreams puts the
token in their URL), so they stay out of this plan, as they are today.

## Decisions

**D1. The manifest URL as a fallback.**
- (a) Sign-in is the default, and "Use a manifest URL instead" stays for
  instances with the Jellyfin side off.
- (b) Sign-in only: the Stremio path is deleted.
*Recommend (a).* ElfHosted users would otherwise have no way in. The
Stremio path is built and tested, and behind the adapter (D2) keeping it
costs nothing extra.

**D2. How Stream reads the Jellyfin side.**
- (a) The adapter above: the Jellyfin answers in today's shapes, behind
  today's functions.
- (b) Jellyfin throughout: the screens and the stores move to Jellyfin's
  items and ids.
*Recommend (a).* (b) rewrites every screen that reads a title and every
store that keys one, and migrates everyone's Continue Watching, lists and
ticks, for nothing you'd see. (a) is one module and its tests.

**D3. How fresh the sources are.**
- (a) `Fresh` on every open: a list no older than 3 minutes, else a new
  search. Going back and forth on a title is instant; anything later
  searches as today. Retry asks for `Refresh`.
- (b) Take AIOStreams' kept list (up to 4 hours) on open, `Refresh` on
  Retry.
*Recommend (a).* A 4-hour-old list can say "cached" about a file your
debrid service has since dropped. Today every open is a new search, and
Retry searches again rather than reloading a link that may have expired
(`StreamScreen.tsx:738-797`). (a) keeps that and still saves the repeat
search.

**D4. A manifest URL you already have, once you've signed in.**
- (a) Deleted when sign-in succeeds: the secret leaves the profile.
- (b) Kept as the fallback until you remove it.
*Recommend (a).* It dies with the same password change the sign-in does,
so keeping it buys little, and taking it off the disk is half the point.

## What Adam does

- Answer D1 to D4.
- If you host your own instance: `JELLYFIN_MAX_VERSIONS=50` gets the most
  sources AIOStreams allows. Its default is 25.

## Build order

1. **B1, native** (`aiojf.rs`): `aiojf_start` from an address as well as a
   manifest URL, probed at `/jellyfin/System/Info/Public`;
   `aiojf_sources(itemId, fresh)`, a POST to `PlaybackInfo` with `Fresh`
   or `Refresh`, answering the sources without their subtitle URLs (those
   carry the token). The generic guard is unchanged. Host tests against
   the fake, as plan 023's.
2. **B2, the adapter, pure** (`features/aiojf/`): views to catalogs,
   items to metas, episodes to videos, sources to streams, the id packing
   for every kind AIOStreams packs. Unit tests with fixtures shaped from
   `dto.ts` and `media.ts`.
3. **B3, wiring**: `data/stremio.ts` asks the adapter when signed in, the
   manifest otherwise (D1). Onboarding and Settings → AIOStreams get the
   address field and the code; plan 023's sync row folds into it; the
   Connection Test checks the sign-in path; D4 on success. Careful there:
   since plan 023, changing or clearing the manifest URL signs out of
   sync (`saveAioUrl`), so D4's delete must not.
4. **B4, harnesses**: plan 023's fake grows the browse routes and
   `PlaybackInfo`. A new `verify-signin` covers sign-in from onboarding,
   rows, a title's page, its sources (cache groups and badges from the
   `aiostreams` object), a play whose URL reaches mpv untouched, Retry
   asking for `Refresh`, and zero stream searches from browsing. The
   Stremio harnesses keep running, since D1 keeps that path.
5. **B5, docs**: `sources/aiostreams.md` leads with signing in;
   `how-it-works` drops the manifest URL from the "stored in the clear"
   caution for signed-in users; onboarding's copy.

## Risks

- **AIOStreams v2.35 is a day old** (released 2026-10-03). The adapter
  reads `aiostreams.features` from `/System/Info/Public`
  (`system.ts:30-74`) and says plainly when an instance is older.
- **Speed is unmeasured.** A Jellyfin list is AIOStreams fetching the same
  addon catalog server-side, plus its own work on top. Time the Stream home
  on your instance both ways before B3 lands.
- **Hashed ids expire.** AIOStreams forgets one it hasn't served in 180
  days. A Continue Watching card that old, for an addon-only id, would need
  finding again by title.
- **A title not typed `movie` can change kind.** AIOStreams decides film
  or show from what it has seen of the catalog (`isLeafEntry`,
  `dto.ts:428-441`), and the id changes with it. The adapter keys on the
  Stremio id from `Path`, which doesn't.

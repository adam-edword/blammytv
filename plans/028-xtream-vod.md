# Plan 028: your provider's movies and shows, in Stream

**Status: DECIDED, building** (2026-10-17). Adam wants to announce BlammyTV
in his provider's Discord once this works, so it ships to people whose first
look at Stream is this. It gets the release treatment: the full board, a
fresh-eyes review, and a run on Adam's real provider before anyone else sees
it ("Before the announcement", at the end).

## What it is

An Xtream playlist's movies and shows become a library in Stream: rows on the
home page, a title's page, its seasons and episodes, played straight from the
provider in mpv. Built beside AIOStreams and Jellyfin the way Jellyfin was
(plan 027): its own rows and pages, `from: "xt"` on everything it builds,
nothing merged into another source's results.

Not in it, on purpose:

- **M3U and Stalker.** Adam, 2026-10-17: "lets just skip m3u and stalker". No
  M3U or Stalker portal with movies to test against, and the repo does not
  build on guesses. An Xtream-made M3U lists movies as `/movie/` and
  `/series/` URLs, which today show up in the Live TV guide as channels; that
  stays as it is.
- **Showing the provider's copy as one more source on another source's title
  page** (Ponyo from AIOStreams listing the provider's file). It needs each
  title matched to an IMDb id, and the provider sends none (below). Adam:
  "just rows".
- **Trakt and MyAnimeList.** They key titles by IMDb id. A provider title has
  its own key (below), so it is not scrobbled, the same as a Jellyfin title
  with no IMDb id.

## Decisions (Adam, 2026-10-17)

- **D1, on by default.** Every Xtream playlist whose provider has movies or
  shows puts them in Stream, with a switch per playlist to turn that off. A
  playlist-only user's Stream tab, which today says "No Movies or Shows
  Yet", has their provider's library in it.
- **The picker, redesigned (Adam, 2026-10-17, after the chip version in
  v0.12.1 read as "a row of text").** Four directions were drawn on a canvas
  (artifact "Stream Folder Picker"); he took three, each for its own place:
  - **Stream with no other source** (no AIOStreams, no Jellyfin, a playlist
    with movies or shows, nothing picked yet): the page is **B, Collections**,
    a grid of folder cards, each a fanned stack of three of its newest
    posters, picked with the accent ring and a check.
  - **Stream with other sources**: a button after the rows opens **D, the
    Rows drawer** from the right, over Stream: search, Movies and Shows,
    each folder with a small poster stack and a switch, rows appearing
    behind it as they are switched on. The same drawer is how a
    playlist-only user edits their rows once they have some.
  - **Settings**: **C**'s pills, a round poster beside each folder's name,
    under the playlist.
  - **All three stage the picks and commit them with a button**, none live
    (Adam: "all of these should be commits instead of live updates"). B's
    is "Show Rows", D's and C's say what they save. The button that opens D
    reads "Add Rows from Your Playlist" before anything is picked and "Edit
    Rows" after; with several playlists B and D group the folders under each
    playlist's name. One data layer (folders, their posters, the staged
    picks), three thin views over it.
  - **Rows can be reordered**, the provider's own rows only (Adam agreed
    2026-10-17; ordering them among AIOStreams' and Jellyfin's is a separate
    piece of work, since an addon's catalog ids move with its setup). The
    order is the order picked, then whatever is dragged: one order across
    movies and shows, not movies first. C in Settings is a grid: "Your
    Rows" (the picked folders, dragged to reorder, an x to unpick) above
    "More Folders" (a click adds one to the end). D's drawer has the same
    "Your Rows" list at its top. Both on dnd-kit's sortable (keyboard
    reordering and screen reader announcements built in): the app has no
    drag-to-reorder of its own yet, and a hand-made one is more than a few
    lines.
- **The switch and the picks are not stored on the playlist.** Any save of
  the playlist list makes Live reload its channels (`live/source.ts:492`,
  `LiveScreen.tsx:505`), and a folder pick must not cost a guide reload.
  They live in their own store, keyed by playlist id.
- **D2, folders are picked, every one off to start.** No provider folder is a
  row until it is picked. The empty Stream page IS the picker: the provider's
  folders right there, and picking one adds its row on the spot. Not a button
  that sends you to Settings. (Adam agreed to this after the Discord news.)
- **D3, search across everything, and Discover.** Search covers the whole
  library whether or not a folder is picked. No genre rail for its movies:
  the movie list carries no genres.
  - **What feeds Discover's grid: (b), one Movies and one Shows feed per
    playlist, newest first, from the full lists** (Adam, 2026-10-17: "agreed
    with b"). Discover has no catalog picker (every catalog feeds one mixed
    grid), so "its folders in the picker" was wrong. Not (a), every folder as
    a feed: his folders are mostly genres, so 58 feeds mix the same titles in
    from 58 directions. Not (c), only the picked folders: a fresh install
    would have an empty Discover until something was picked.

## The data (Adam's provider, 2026-10-17)

From `player_api.php` on his real panel. The panel's host stays out of the
repo.

| | |
|---|---|
| Movie folders | 25 (`4K Movies`, `2026 Releases`, `2025 Releases`, then genres: Action, Adventure, Animation, Bollywood, Comedy, ...) |
| Show folders | 33 |
| Movies | 30,664 |
| Shows | 8,024 |
| The movie list | 10.2 MB, 4.1 s |
| TMDB ids held by more than one movie | 581 (a 4K copy beside the HD one, mostly) |

What each call answers (fields as sent; numbers arrive as numbers or strings,
so read both):

- `get_vod_streams`: `num`, `name` ("4K The Fantastic 4: First Steps (2025)"),
  `stream_type: "movie"`, `stream_id`, **`tmdb_id`** (a number; other panels
  call it `tmdb`, read both), `stream_icon` (a TMDB poster URL), `rating`,
  `rating_5based`, `added` (unix seconds, a string), `is_adult`,
  `category_id` (a string), `container_extension` ("mkv"), `custom_sid`,
  `direct_source` ("").
- `get_series`: `num`, `name` ("'Allo 'Allo! (1984)"), `series_id`,
  **`tmdb_id`**, `cover`, `plot`, `cast`, `director`, `genre` ("Comedy, War &
  Politics"), `releaseDate`, `last_modified`, `rating`, `rating_5based`,
  `backdrop_path` (an array of URLs), `youtube_trailer`, `episode_run_time`
  ("30"), `is_adult`, `category_id`.
- `get_vod_info&vod_id=`: `info` {`movie_image`, `name`, `tmdb_id`,
  `backdrop`, `backdrop_path` [], `youtube_trailer`, `genre`, `plot`, `cast`,
  `rating`, `director`, `releasedate`, `duration_secs` (6900), `duration`}
  and `movie_data` {`stream_id`, `name`, `added`, `category_id`,
  `container_extension`, `custom_sid`, `direct_source`}.
- `get_series_info&series_id=`: `info` (the list's fields again, no
  `tmdb_id`), and `episodes` keyed by season number as a string, each
  episode {`id` ("186", a string), `episode_num`, `title` ("'Allo 'Allo!
  S01E01"), `container_extension`, `added`, `season`, `custom_sid`,
  `direct_source`, `info` {`movie_image`, `releaseDate`, `plot`, `rating`,
  `duration_secs`, `duration`}}.
- **No IMDb id anywhere**: not in the lists, the movie info, the series info
  or an episode.

Playback is the standard Xtream path: `{server}/movie/{user}/{pass}/{stream_id}.{container_extension}`
and `{server}/series/{user}/{pass}/{episode id}.{container_extension}`, the
same credentials-in-the-path shape Live's `/live/` URLs already have.

## How it is built

**One list, many views.** For each Xtream playlist with movies on, the app
reads the whole movie list and the whole show list (two calls, plus the two
folder lists) and keeps them on disk. Everything else is a view of those
lists: a picked folder's row, search, the copies of a title, Discover's feed.
Per-title calls happen only when a page opens: `get_vod_info` for a movie,
`get_series_info` for a show. This is why there are no per-folder fetches:
search needs the whole list anyway, and a title's page needs every copy of
it, which can sit in another folder ("4K Movies").

- **On disk in IndexedDB, in a database of its own** (`blammytv-vod`), not
  Live's `blammytv` one: that is opened at version 1 by `live/diskCache.ts`,
  and a second store there means a version bump both modules must agree on.
  Never localStorage: its quota is a few megabytes, and the movie list alone
  is 10. Keyed by a fingerprint of the
  playlist's server, user and password, and like Live's, that key is never
  logged (only a digest).
- **Stale, then fresh.** A launch shows the last lists at once and refreshes
  behind them, like the guide. A failed refresh keeps the last lists.

**Keys** (persisted in Continue Watching, My List and the watched marks, so
they cannot change later):

| What | Key |
|---|---|
| A movie with a TMDB id | `xt:<playlistId>:m:t<tmdbId>` |
| A movie without one | `xt:<playlistId>:m:<stream_id>` |
| A show with a TMDB id | `xt:<playlistId>:s:t<tmdbId>` |
| A show without one | `xt:<playlistId>:s:<series_id>` |
| An episode | the show's key, then `:<season>:<episode>` |

TMDB-keyed because providers re-upload and stream ids change; a TMDB id does
not. It also folds copies: every movie with the same TMDB id is one card and
one page, with a source per copy (the 4K and the HD). Shows fold the same
way, an episode's sources gathered from each copy by its season and number.
A playlist removed and added again is a new id, so its keys start over, the
same as Live's favourites (`<playlistId>:<streamId>`).

**Names.** A leading quality tag comes off the name and becomes the source's
quality ("4K The Fantastic 4: First Steps (2025)" is "The Fantastic 4: First
Steps", 2025, a 4K source). A trailing `(year)` becomes the year.

**Adult.** A folder or title the panel flags `is_adult`, or whose folder name
looks adult (`live/adult.ts`), is left out while Settings hides adult content
(`settings/adultFilter.ts`), as the guide does.

**The User-Agent.** A playlist's own User-Agent rides every call to its panel
(`data/xtream.ts:16`) and must reach mpv too. Stream has never passed one:
add it to the playing state (`StreamScreen.tsx:198`) and pass it to
`InvertedPlayer` (`:1744`) and the pop-out (`:1353`). `tauriInvOpen` and
`tauriPopoutOpen` already take it. No native change.

## Where it plugs in (read 2026-10-17)

From plan 027's wiring, `from: "jf"` at each:

- `stream/model.ts:68` `VodFrom = "jf"` gets `"xt"`. `myList.ts:18` spells
  `from?: "jf"` as a literal; widen it to `VodFrom`.
- `stream/source.ts`: `resolveVodItem` (:283) and `resolveVodList` (:362)
  route `from === "xt"` to the new resolvers; `configKey` (:43) takes the
  Xtream library's key.
- `StreamScreen.tsx`: the home merge (`Home`, :2102; rows at :2199, hero at
  :2189, the no-source card at :2135, the empty card at :2206), the Jellyfin
  load effect (:441) as the pattern for a third source, `catalogItem` (:948)
  and `quickResume` (:953) for Continue Watching, "more like this" skipping
  any `from` (:2698).
- Every "is Stream set up" check reads `loadAioConn() || loadJfConn()`:
  `App.tsx:553` (the palette), `PlaybackPage.tsx:102`,
  `AppearancePage.tsx:124`, `discover/data.ts:122` and `:147`,
  `StreamScreen.tsx:167`, `:2133`, `:2135`. Each needs "or an Xtream library
  with movies or shows".
- Discover: `DiscoverCatalog.from` (`discover/data.ts:19`), `itemKey`
  (:130), the routing at :248 and :438, `seedFromStream` (:472).
  **`catKey` (:453) has no `from` in it**, and Xtream folder ids are small
  numbers that can equal an addon catalog's id: add `from` to it, or the two
  share a paging cursor.
- Trakt and MyAnimeList must ignore `xt:` keys the way they ignore `jf:` ones.
  Trakt's replace already keeps a ledger entry that isn't a `tt` id
  (`watched.ts:119`), so `xt:` ticks survive it; check that every push skips
  one (Trakt reads ids in `trakt/ids.ts`, MAL its own mapping).

## Batches

Each goes to the builder (`.claude/agents/sonnet.md`) with a brief; this
session reads the whole diff, reruns the gates and the touched harnesses,
then versions, commits and pushes.

1. **The fake and the pure layer.** `scripts/fake-panel.mjs` answers the four
   VOD calls and the two info calls, built from the shapes above, only for
   the user `vod` (every other user still gets `[]`, so no existing harness
   sees a Stream tab appear). Includes a 4K copy and an HD copy of one movie,
   a movie with no TMDB id, an adult folder and an adult title, a show in two
   seasons, and a `/movie/` and `/series/` route. `features/xtvod/`: reading
   the lists (every field coerced), folding, names, keys (make and read),
   movies, shows and episodes as `VodItem`s, play URLs, the adult rule. Unit
   tests for all of it.
2. **The library.** Loading and caching the lists per playlist, the rows for
   picked folders, the hero (picked shows with a backdrop), the resolvers,
   `from: "xt"` through `source.ts`.
3. **Stream.** The home merge, the picker as the empty page, every
   "is Stream set up" check, the User-Agent to mpv, Continue Watching, My
   List and the Library, watched marks kept locally.
4. **Settings.** Per Xtream playlist: the switch (D1) and the same folder
   picker. Export carries both with the playlist. Removing a playlist clears
   its lists from disk.
5. **Discover.** Search over the cached lists, and the grid feed D3 settles.
6. **Docs, site, harness.** `verify-xtvod` (Stream rows, the picker, a page,
   both copies as sources, an episode, the URL and User-Agent sent to mpv,
   Continue Watching, search), the Xtream docs page, How it works, the site
   FAQ's "What can I add?", the changelog.

## Rules this must not break

- Live TV does not change: same calls, same guide, same favourites. The VOD
  calls are new calls; nothing in `live/` reads them.
- Credentials never reach a log line: URLs are cut to their origin, the page
  scrubs (`lib/scrub.ts`), and the cache key is logged as a digest only.
- AIOStreams and Jellyfin behave exactly as before for anyone without an
  Xtream library.
- Copy follows CLAUDE.md's "Words in the app": Title Case, read aloud, empty
  states say what to do with a button to do it.

## Before the announcement

1. The full board locally and on CI, and a fresh-eyes review by an agent with
   none of this context.
2. Adam, on his own provider, with the build:
   - Pick two folders on the empty Stream page; their rows appear.
   - Open "The Fantastic 4: First Steps": a 4K and an HD source. Play the 4K.
   - Play an episode of a show; back out part way; resume it from Continue
     Watching.
   - Search for a movie in a folder you didn't pick.
   - Turn the playlist's Movies and Shows off in Settings; Stream's rows from
     it go.
   - With Multi-View using the line's connections, play a movie: what does
     the provider say? (Not handled in the plan; the answer decides whether
     it needs to be.)
3. The site FAQ, the docs and the changelog say Xtream movies and shows
   work, live the day of the post.

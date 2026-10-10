# The AIOStreams app against BlammyTV

Read 2026-10-10 from AIOStreams' own source (commit b17de1e, desktop
v0.11.0 released 2026-10-06): `packages/desktop` (the native shell, Rust)
and `packages/jellyfin-web` (the page it shows, React). It is open source,
so this is a source read, not reverse engineering. Licence **AGPL-3.0**:
everything below is an idea to re-write from scratch, never code to copy.
Two readers took an area each (the player and shell; browsing, titles,
accounts and settings); the claims that decide anything were re-read
first-hand, and are marked where they were checked.

It is built the way we are: a native window, WebView2 on Windows, libmpv
drawing into a child window under a transparent page, JSON messages between
them. The page is a full Jellyfin client for AIOStreams' Jellyfin side, the
same API our sign-in path uses (plans 023, 024).

## The short version

Theirs is broader on the player and on the account: subtitle styling,
delay, sync and files; auto-skip per segment type; a real Up Next with a
countdown, prefetch and "still watching?"; rebindable keys and gamepads;
media keys and the Windows media flyout; "your own mpv"; a release log;
calendar, activity, person pages, ratings, several servers and users.

Ours is better at what we went deep on: instant paint from a disk-mirrored
catalog, Discover's cross-catalog genre rail, search that reaches past the
catalogs, the Recommender, lists, native Trakt and MAL, cached-source
one-click play with failover and Retry, the pop-out, live TV and sports,
the hot update channel, and the token: theirs sits in localStorage and in a
socket URL; ours never leaves Rust.

## Found by reading them, checked here

- **Our libmpv cannot load without a Vulkan loader. Checked.** The pinned
  build (`mpv-dev-x86_64-20260926-git-35af06172b.7z`, sha256 matching
  `scripts/deps.json`) imports `vulkan-1.dll` (objdump). A Windows machine
  with no Vulkan loader (some VMs, basic display drivers) cannot start the
  player at all, and the app says "It's the stream, not you". AIOStreams hit
  this in desktop v0.10.1 and now ships a fallback `vulkan-1.dll` loaded only
  when Windows has none. For us: the same fallback in `mpv.rs`, and the open
  error shown on the tune card instead of `console.error`
  (`InvertedPlayer.tsx:258`).
- **`GET /Items/{id}` does not search on our calls. Checked against their
  server.** Their client never calls it, saying it makes the server run its
  addons. At b17de1e the server resolves versions only when `Fields` is
  missing or names `MediaSources` (`server/src/routes/jellyfin/library.ts:102-106`,
  `items.ts:840-866`: "`false` never resolves"). We always send `Fields`
  without `MediaSources` (`features/aiojf/remote.ts:12, 277`). No change.

## Worth taking, cheapest and surest first

1. **The Vulkan fallback and an honest open error** (above).
2. **Prefetch the next episode's sources at the credits window.** Today the
   roll resolves after the countdown, about 4s (`StreamScreen.tsx:618-623`).
   Signed in, AIOStreams reuses a source list for 180s.
3. **A VOD that never opens fails fast, with the reason.** A failure before
   the first frame is ignored (`features/live/ending.ts:69-70`), so a 403
   link sits 40s, then says "It's the stream, not you". They read mpv's
   first HTTP error into words ("the link answered HTTP 403"). Data first:
   read `idle-active` per poll during a real dead link.
4. **Small player wins:** media keys in the player's key handler (if WebView2
   delivers them), chapter ticks and hover time on the VOD rail, colour rows
   in the stats overlay (the HDR reading CLAUDE.md describes taking by hand),
   volume past 100%.
5. **Subtitle delay** (±100ms, Z/X, per stream) and **auto-skip per segment
   type** (Show a button / Skip automatically / Do nothing, per Intro, Recap,
   Credits, Preview). Telly has the same auto-skip.
6. **Track choice before the first frame:** hand mpv `alang`/`slang` at open
   and keep our confirm loop as the backstop. Native.
7. **Fit / Crop / Stretch.** Native (outside `mpv_set`'s release families).

Each its own decision (Adam's): subtitle styling and files, addon
subtitles (needs the token kept native, below), a release log and Copy
diagnostics, the Windows media flyout, a keymap and remap screen, gamepad,
Discord, "your own mpv", "still watching?".

## The AIOStreams API: what they do that we don't

- **Next Up asks `EnableResumable=false`**, so it doesn't repeat Continue
  Watching. We don't send it (`features/aiojf/sync.ts:204`). Query-only; the
  guard allows it.
- **Feature flags** from `/System/Info/Public` (`aiostreams.features`:
  `history`, `playedUpTo`, `fillers`, `versions`, `refreshVersions`,
  `genreRequired` and more). We read the endpoint at sign-in only to tell
  AIOStreams from Jellyfin.
- **Filler and recap marks** on `/Shows/{id}/Episodes` (feature `fillers`);
  they skip those when playing on. We walk Stremio seasons instead.
- **Addon subtitles** come as external subtitle streams with a delivery URL
  that carries the token. We strip `MediaStreams` on purpose. If taken, the
  list stays native and the page gets an opaque index.
- **Preview segments:** they ask MediaSegments with no type filter; we ask
  Intro, Recap and Outro.
- **"None" as a genre:** for a catalog that needs a genre, they open on the
  genre named "None" and hide it from pills; we turn "None" into the
  catalog's first genre (`remote.ts:229-230`), so a hero source can be one
  genre's titles. Check on the real instance.
- **History, ratings, favourites, PlayedUpTo, Similar, person pages,
  household users, a WebSocket:** calls we don't make. Each would need an
  allow-list entry; none is urgent.

## Gaps in ours the read turned up

1. Stale copy: Discover and Customize still say "Connect your AIOStreams
   manifest" (`DiscoverScreen.tsx:491-496`, `CustomizeTab.tsx:278-284`);
   sign-in is the default since plan 024.
2. Next Up can repeat what Continue Watching shows (the `EnableResumable`
   point above).
3. Resume plays the first cached source, not the one you were on.
4. A future episode looks playable and searches for nothing.
5. Why a source list is empty is thrown away (AIOStreams sends notices as
   placeholder sources).

## Their settings, for plan 025

A left column of tabs in two groups, **Watching** (Playback, Audio,
Subtitles) and **App** (Interface, Shortcuts, Theme, Account, Desktop app,
About); cards with a one-line note that says where the setting lives ("Kept
on this device" or "Saved to your account"); rows that hide when they don't
apply; no search; per-item resets, no broad Danger Zone. The full inventory
is in the session scratchpad; plan 025 carries what matters.

## Can't tell from a static read

Whether WebView2 hands media keys to the page; what AIOStreams does with
`PlaySessionId` and `MediaSourceId`; whether it emits Preview segments; the
real click-to-first-frame of either app.

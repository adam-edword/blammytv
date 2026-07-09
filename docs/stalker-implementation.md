# Stalker / MAG portal support — implementation guide

Status: research only (v0.2.0 target). No code written yet. This document is the
protocol reference so the implementer doesn't have to re-derive the Stalker
portal API. Every protocol claim below is corroborated by at least two of:
a real client (Python), the server-side PHP source, and a walkthrough. Anything
I could **not** confirm is flagged explicitly rather than guessed.

Read alongside: `apps/app/src/data/xtream.ts` (the sibling adapter this mirrors),
`apps/app/src/features/live/source.ts` (the load seam), `apps/app/src/features/
live/stream.ts` (URL resolution), `apps/app/src-tauri/src/lib.rs#http_get` (the
Rust fetch), and CLAUDE.md / HANDOFF.md (why fetches are Rust-side).

## Sources

- QUASSI, "The wonderful world of Stalker IPTV" — end-to-end walkthrough with
  example URLs: https://www.quassi.nl/2020/03/23/the-wonderful-world-of-stalker-iptv-2/
- progdvb forum, "Support for IPTV Stalker Portal" — request/response examples:
  https://forum2.progdvb.com/viewtopic.php?t=12975
- `agsimeonov/StalkerTalker` — `session.py` (handshake, headers, cookies, Bearer):
  https://github.com/agsimeonov/StalkerTalker/blob/master/session.py
- `esxbr/plugin.video.stalker` — `load_channels.py` (genres, ordered_list,
  create_link parsing): https://github.com/esxbr/plugin.video.stalker/blob/master/load_channels.py
- `grinco/stalker_portal-1` — server source of truth:
  `server/lib/itv.class.php` (actions, getAllChannels, createLink) and
  `server/lib/epg.class.php` (get_short_epg / get_epg_info backing methods):
  https://github.com/grinco/stalker_portal-1/blob/master/server/lib/itv.class.php ,
  https://github.com/grinco/stalker_portal-1/blob/master/server/lib/epg.class.php
- `iptvhakr/stalker_portal` — `server/load.php` (the endpoint):
  https://github.com/iptvhakr/stalker_portal/blob/master/server/load.php
- Infomir (Ministra, the commercial descendant) — REST API v1 / OAuth2 Bearer:
  https://wiki.infomir.eu/eng/ministra-tv-platform/ministra-setup-guide/rest-api-v1

---

## Overview

A Stalker / Ministra portal ("MAG portal") is IPTV middleware whose identity is a
**MAC address**, not a username/password. A set-top box (or an app pretending to
be one) performs a **handshake** to get a bearer **token**, calls **get_profile**
to register the device, then queries **live TV genres** (categories) and
**channels**. Unlike Xtream, a channel's row does **not** contain a directly
playable URL — it carries an opaque **`cmd`** string that must be exchanged, at
play time, via **create_link** for a short-lived tokenized stream URL.

Two structural differences from our Xtream path drive the whole design:

1. **Auth is header-based and stateful.** Every request carries
   `Authorization: Bearer <token>` plus a `Cookie` (mac, stb_lang, timezone) and
   a MAG-style `User-Agent`. The token expires (~1 hour, see Risks) and must be
   refreshed by re-handshaking. Xtream, by contrast, puts credentials in the URL
   query string and is stateless.
2. **Stream URLs are resolved per-play, server-side.** `create_link` is a live
   round-trip per channel start — it cannot be precomputed into a pure string
   builder the way `stream.ts#channelStreamUrl` does for Xtream. This is the main
   architectural change (see "Mapping" and "Risks").

Everything else — the up-front catalog fetch, per-source best-effort, the
namespaced-id model, the disk cache — maps cleanly onto what `source.ts` already
does for Xtream.

### Endpoint base

The API entry point is one PHP endpoint, reached at one of two paths depending on
the portal's install layout:

- `http://HOST[:PORT]/stalker_portal/server/load.php` (classic Stalker install)
- `http://HOST[:PORT]/portal.php` (also `/c/portal.php`; common on resold panels)
- `http://HOST[:PORT]/stalker_portal/c/portal.php` (some Ministra deployments)

All actions are `GET`s to that endpoint with `type`, `action`, action-specific
params, and a trailing `JsHttpRequest=1-xml` (a JsHttpRequest transport marker;
the response is still JSON despite the `xml` token). Responses are JSON of the
form `{ "js": <payload> }`.
(Sources: iptvhakr/load.php; QUASSI; progdvb.)

**The portal field in `StalkerPlaylist.portal` is user-entered and its exact path
varies.** The implementer must probe candidate paths (try the URL as given, then
append the common suffixes above) at add-time and remember which one handshook
successfully. Flag: I could not find one canonical rule — real clients (TiviMate,
OTT Navigator) all probe. Treat path discovery as a required step, not an assumption.

---

## Auth flow (exact request shapes)

All requests in this section share these headers. Assemble them per playlist and
send on **every** call:

```
User-Agent: Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3
Referer:    http://HOST/stalker_portal/c/          (or http://HOST/c/ — the portal's own /c/ path)
Accept:     */*
Cookie:     mac=<MAC>; stb_lang=en; timezone=Europe/London
X-User-Agent: Model: MAG254; Link: WiFi
Authorization: Bearer <token>          (omit on the first handshake; required after)
```

Notes:
- The MAC in the cookie is URL-encoded (`00%3A1A%3A79%3A...`). MAG MACs
  conventionally start with the Infomir OUI `00:1A:79:`; the user supplies the
  full MAC in `StalkerPlaylist.mac`.
- `timezone` should be a real IANA zone; it affects EPG timestamps the server
  returns. Use the machine's zone or a stored per-playlist value.
- `User-Agent` must look like a MAG STB — some portals reject a browser UA.
  The exact MAG string varies by client; the QtEmbedded/MAG form above is what
  StalkerTalker and load_channels.py send.
  (Sources: StalkerTalker session.py; plugin.video.stalker load_channels.py; QUASSI.)

### Step 1 — Handshake (get token)

```
GET {base}?type=stb&action=handshake&token=&JsHttpRequest=1-xml
```

Send with the headers above **minus** `Authorization`. Some portals want
`token=` empty; some want it omitted — send it empty. Response:

```json
{ "js": { "token": "C00F7332ED272F00D5FD3E82F567A282", "random": "..." } }
```

Extract `js.token`. All subsequent requests set `Authorization: Bearer <token>`.
(Sources: iptvhakr/load.php; StalkerTalker `key = info['js']['token']`;
load_channels.py `key = info['js']['token']`; QUASSI.)

### Step 2 — get_profile (register the device)

```
GET {base}?type=stb&action=get_profile&hd=1&ver=<ver>&num_banks=1&stb_type=MAG254&image_version=218&auth_second_step=0&hw_version=1.7-BD-00&not_valid_token=0&JsHttpRequest=1-xml
```

Sent with the Bearer header. Many portals additionally read `sn` (serial),
`device_id`, `device_id2`, and `signature` — omit them for a plain MAC-only
portal; include them only if a specific portal demands them (rare, and requires
device-fingerprint derivation we should not attempt speculatively). `ver` is a
firmware descriptor string (e.g.
`ImageDescription: 0.2.18-r14; ImageDate: ...; PORTAL version: 5.6.0; API Version: JS API version: 343; ...`).

`get_profile` returns the account/profile object (`js.id`, `js.name`, status,
tariff plan, `js.blocked`, etc.). Treat a non-error response as "device
accepted"; a `js` with a blocked/expired flag or an HTTP 4xx means auth failed —
surface that as the playlist's `LiveGroup.error` (same as Xtream's
"panel rejected the credentials"). (Sources: StalkerTalker; load_channels.py;
QUASSI.)

> Optional variant — login/password portals: a minority of portals layer an
> account login on top of the MAC. Those need
> `type=stb&action=do_auth&login=<u>&password=<p>&device_id=...` after handshake.
> Out of scope for the first cut (our `StalkerPlaylist` is portal+mac only);
> flag it as a known unsupported variant if a user's portal returns an
> auth-required error after handshake.

### Auth summary

handshake → token → set Bearer → get_profile → (device registered) → itv calls.
Hold the token in a per-playlist in-memory record; refresh on expiry (see Risks).

---

## Live channels + categories

### Categories (genres)

```
GET {base}?type=itv&action=get_genres&JsHttpRequest=1-xml
```

Response `js` is an array of genre objects: `{ id, title, alias, censored, ... }`.
Map to our `LiveFolder`: `id = <playlistId>:<genre.id>`, `name = genre.title`.
`id` "*" / "0" is the "All" pseudo-genre — skip it as a folder (it's not a real
category). (Sources: load_channels.py `results = info['js']` with `id`/`title`/
`alias`; itv.class.php `getGenres()`.)

### Channels — prefer the single bulk call

**Recommended: `get_all_channels` (one request, all channels).** Verified against
the server source: `getAllChannels()` returns the full channel set with **no
pagination** (`getChannels(true,true)->orderby('number')`, no limit).

```
GET {base}?type=itv&action=get_all_channels&JsHttpRequest=1-xml
```

Response: `js.data` is an array of channel rows. Confirmed fields per row:

```
id            channel id (ch_id)            -> our stream id
name          channel display name          -> Channel.name
number        channel number                -> hero channel-number (ROADMAP slate #4)
cmd           opaque play command           -> feed to create_link (see below); STORE IT
xmltv_id      EPG id                         -> EPG join key (like Xtream epg_channel_id)
logo          logo path (often relative)    -> Channel.logo (resolve against portal host)
tv_genre_id   genre/category id             -> Channel.folderId join
enable_tv_archive  0/1 catch-up flag         -> Channel.archiveDays groundwork
hd            0/1                            -> quality hint
censored      0/1                            -> adult/parental hint
```

(Source: itv.class.php `getAllChannels()` field list, quoted verbatim in
research: `id, name, number, cmd, xmltv_id, logo, tv_genre_id, status, hd,
censored, enable_tv_archive, use_http_tmp_link, wowza_tmp_link,
nginx_secure_link, use_load_balancing`.)

This is the clean analogue of Xtream's `get_live_streams` (all streams in one
call) and fits `source.ts`'s "fetch everything up front" model exactly.

**Fallback: `get_ordered_list` (paginated, per-genre).** Some portals don't
implement `get_all_channels`, or return only a subset. When `get_all_channels`
returns empty/errors, iterate genres and page through each:

```
GET {base}?type=itv&action=get_ordered_list&genre=<genreId>&p=<page>&fav=0&sortby=number&hd=0&force_ch_link_check=&JsHttpRequest=1-xml
```

Response: `js.total_items`, `js.max_page_items`, `js.data` (this page's rows).
Page count = `ceil(total_items / max_page_items)`; iterate `p=1..pages` (some
portals are 0-based — start at the value the first response implies). Params
confirmed both client-side (load_channels.py: `genre`, `p`, `fav`, `sortby`) and
server-side (itv.class.php reads `genre`, `hd`, `sortby`, `fav`, page-via-offset).
(Sources: load_channels.py; itv.class.php `getOrderedList()`/`getData()`; QUASSI;
progdvb.)

> Recommendation: try `get_all_channels` first (one round-trip, matches our
> up-front model); fall back to the paginated per-genre walk only if it comes
> back empty. Flag: portal coverage of `get_all_channels` is not universal —
> build the fallback, don't skip it.

### Logos

`logo` is frequently a relative path (e.g. `misc/logos/foo.png`). Resolve against
the portal host: `http://HOST/stalker_portal/misc/logos/...` or the path the
portal's `image_url` implies. Reuse the existing `validUrl()` guard in
`source.ts`; prepend the host when the value isn't already absolute.

---

## create_link stream resolution

This is the step with no Xtream analogue. At play time, exchange the channel's
`cmd` for a real, tokenized URL:

```
GET {base}?type=itv&action=create_link&cmd=<url-encoded channel cmd>&forced_storage=undefined&disable_ad=0&JsHttpRequest=1-xml
```

- `cmd` is the channel row's `cmd` value from the list call, URL-encoded.
- Response: `{ "js": { "cmd": "ffmpeg http://host:port/ch/<id>?token=...", ... } }`.

**The returned `js.cmd` may be prefixed with a "solution" word** — `ffmpeg`,
`ffrt`, `auto`, etc. — followed by a space and the real `http(s)://…` URL. This
is confirmed on both sides: the server builds
`$channel['cmd'] = $solution.' http://'.$streamer.'/ch/'.$link_result` where
`$solution` defaults to `'ffrt'` (or is copied from the original cmd's prefix);
clients strip it. **Strip rule:** take the substring from the first occurrence of
`http` to the end (robust to any prefix word), or split on whitespace and pick
the token starting with `http://`/`https://`. Trim whitespace. That stripped URL
is what mpv plays.
(Sources: itv.class.php `createLink()` — the `preg_match("/(\w+)\s+http:/", ...)`
solution logic + `'ffrt'` default, quoted verbatim; load_channels.py
`cmd = info['js']['cmd']` then split, fallback to `s[1]`; QUASSI example
`ffmpeg http://ip.tv:8000.../47534?play_token=...`.)

Important properties of the resolved URL:
- It typically carries a **`play_token`** (or `?token=`) and is **short-lived /
  effectively single-use**. Do not cache it long or persist it. Re-resolve on
  every fresh play and on any player reload (the tune-watchdog's re-loadfile, the
  go-live action) — a stale token yields a 403/blank.
- Always go through `create_link` even if the channel's raw `cmd` looks like a
  URL: it registers the play and returns the load-balanced / secure-link variant
  the portal expects. All reference clients call it unconditionally before play.

---

## EPG options

Two granularities exist; there is **no single XMLTV bulk document** analogous to
Xtream's `xmltv.php`. (Stalker *imports* XMLTV operator-side, but does not expose
one download URL for clients — confirmed across the EPG discussions and the
server having only per-channel / per-window query methods.)

### Short EPG (now + next few) — per channel

```
GET {base}?type=itv&action=get_short_epg&ch_id=<channelId>&size=10&JsHttpRequest=1-xml
```

Backed server-side by `getCurProgramAndFiveNext($ch_id)`. Returns `js` = array of
programme objects: `{ id, ch_id, name, descr, time, time_to, start_timestamp,
stop_timestamp, duration, ... }`. `start_timestamp`/`stop_timestamp` are UNIX
seconds — map directly to `Programme.start`/`Programme.end` (`new Date(ts*1000)`),
`name → title`, `descr → synopsis`. `size` bounds how many entries.
(Sources: epg.class.php `getCurProgramAndFiveNext`; QUASSI; load_channels.py.)

### Window EPG (a date range, many channels) — the guide fill

```
GET {base}?type=itv&action=get_epg_info&period=<hours-or-days>&JsHttpRequest=1-xml
```

Backed server-side by `getEpgForChannelsOnPeriod($channel_ids, $from, $to, ...)`
(and the paginated `getDataTable()` bulk view). Returns `js` as a **map keyed by
`ch_id`**, each value an array of programme objects with the same fields as above
plus `category`, `director`, `actor`. `period` is the look-ahead span (clients
send small integers like `3`/`6`; confirm whether a given portal reads it as
hours or days — flagged below). This is the closest thing to a bulk EPG fetch.
(Sources: epg.class.php `getEpgForChannelsOnPeriod`/`getDataTable`;
search-confirmed `action=get_epg_info&period=6`.)

### Recommended EPG strategy

1. **Primary:** call `get_epg_info` once with a period covering our guide window
   (now −1h..+12h, matching what `parseXmltv` keeps). Build the `ch_id →
   Programme[]` map straight from the keyed response — no XMLTV parsing needed,
   so the 95MB-DOMParser problem simply doesn't exist for Stalker.
2. **Fallback / lazy:** if a portal ignores `get_epg_info` or returns thin data,
   fetch `get_short_epg` per **visible** channel on demand (the hero/guide already
   know which channel is selected). This mirrors how real STBs work ("requests
   EPG for currently visible channels rather than the entire list at once").
3. Channels with no EPG render "No Information" lanes — exactly the existing
   best-effort behavior.

Flag (could not fully confirm): the `period` unit (hours vs days) and whether
`get_epg_info` accepts an explicit channel-id list or always returns all
channels' windows. Both vary by portal version. Verify against a live portal
before committing the window math; until then, request conservatively and clamp
client-side to our −1h..+12h window.

---

## Mapping to BlammyTV's model / seams

The target output is unchanged: a Stalker adapter must produce the same
`Channel[]` / `LiveGroup[]` / `Map<channelId, Programme[]>` (`model.ts`) that the
Xtream path produces, so Guide/Hero/favorites/recents work untouched. The
namespaced-id contract (`<playlistId>:<streamId>`) carries over directly:
`streamId = the Stalker channel id (ch_id)`.

### Where each seam lands

- **`source.ts#loadLive` / `doLoad`** — the load orchestration. Today it filters
  to `enabledXtream()` and maps each playlist through `buildXtreamSource`. Add an
  `enabledStalker()` and a `buildStalkerSource(p, now, narrate)` that returns the
  same `{ group, channels, programmes }` shape, then merge both source lists into
  `data`. Per-source best-effort already isolates failures — a broken Stalker
  portal sets its `LiveGroup.error` and never sinks the Xtream sources.
- **`cacheKey`** — must fingerprint Stalker playlists too (id, portal, mac,
  hiddenCategories) so a Settings change misses cache/disk naturally. Extend it
  beyond the current Xtream-only tuple.
- **New `data/stalker.ts`** — mirrors `data/xtream.ts`: pure-ish functions
  `handshake(p) → token`, `getProfile(p, token)`, `fetchGenres`, `fetchChannels`
  (all-channels with ordered-list fallback), `fetchEpg`, and `createLink(p, cmd,
  token)`. All go through a new header-aware Rust fetch (below).
- **`stream.ts` — the real refactor.** `channelStreamUrl(channelId)` is currently
  **pure + synchronous**. Stalker cannot be: create_link is an async,
  authenticated, per-play round-trip. Introduce
  `async resolveStreamUrl(channelId): Promise<string | null>`:
  - mock id (no `:`) → `null` (unchanged);
  - Xtream id → the existing sync `channelStreamUrl` result (wrap in
    `Promise.resolve`); keep the pure builder for tests;
  - Stalker id → look up the playlist + the channel's stored `cmd`, ensure a
    valid token, call `create_link`, strip the prefix, return the URL.
- **`LiveScreen.tsx` (lines ~461-465, 487)** — today `playUrl` is derived
  **during render** (`channelStreamUrl(heroChannel.id)`) and fed straight into
  `useDirectOverlay(INV && !!playUrl, playUrl, ...)`. For an async resolver,
  move `playUrl` into **state** set by an effect keyed on
  `[playing, heroChannel?.id]`: on change, `await resolveStreamUrl(id)` and
  `setPlayUrl`. The existing `playUrlRef` bridge already exists; the player just
  mounts one tick later (imperceptible; Xtream stays effectively instant because
  its resolver is synchronous under the hood). This is contained — no change to
  InvertedPlayer (née CompositionPlayer) or the mpv command layer, which only
  ever receive a finished URL. [Post-v0.1.135 note: the comp.rs overlay
  bridge this doc occasionally references was deleted; the shipping chrome is
  useDirectOverlay in the main webview.]
- **Carrying `cmd`** — create_link needs the channel's `cmd`, but `model.ts
  Channel` has no field for it. Recommendation: add an **optional opaque
  `streamCmd?: string`** to `Channel`, populated only by the Stalker adapter
  (Xtream leaves it undefined). Rationale: it survives the IndexedDB disk cache
  (structured clone keeps it), it's the same "provider-derived field on the
  generic Channel" pattern `archiveDays` already established, and it avoids both
  (a) a module-level `Map<id,cmd>` that's lost on disk-hydration until the
  background revalidate repopulates it, and (b) fragile client-side
  reconstruction of the cmd from ch_id (portal-specific — do not guess it).

### Fetches must be Rust-side — with custom headers

Same two reasons the Xtream path is Rust-side, both binding here:
1. **CORS** — portals send no CORS headers (like Xtream panels); a WebView
   `fetch` is blocked.
2. **TLS fingerprint** — HANDOFF's native-tls (Schannel) rule: the Windows TLS
   stack is a deliberate anti-bot-fingerprint fix. Keep Stalker on the same
   client.

But `http_get(url)` today takes **only a URL** and hardcodes a Chrome UA + no
Cookie/Authorization. Stalker needs per-request `Cookie`, `Authorization: Bearer`,
and a MAG `User-Agent`. Two options:

- **(Recommended) Extend `http_get`** to
  `http_get(url, headers: Option<HashMap<String,String>>)`. Merge caller headers
  over the defaults (request-level headers override the client's default
  `user_agent`/Accept — a standard reqwest behavior; **confirm against the locked
  reqwest source in `Cargo.lock` before relying on it**, per HANDOFF's "verify
  Rust API claims" rule). This reuses everything hard-won: the shared client,
  the Schannel TLS fix, gzip/brotli/deflate, connection pooling, and the
  query-stripped `[http]` diagnostics. `lib.rs#http_get` is explicitly
  "fair game" per HANDOFF. The existing Xtream/AIOStreams callers pass no headers
  and are unaffected.
- (Alternative) A parallel `stalker_get(url, headers)` command. Rejected:
  duplicates the client + diagnostics for no benefit.

Security (HANDOFF's "never log a full URL / credentials"): the `[http]` log
already strips query strings. Extend that discipline — **never log the `Cookie`
header (contains the MAC) or the resolved create_link URL (contains
`play_token`)**. Add the headers path to the same redaction.

### Rust vs TS split

- **Rust (minimal):** only the header-aware GET. No Stalker logic in Rust — it's
  a dumb authenticated pipe, exactly as it is for Xtream.
- **TS (everything else):** header assembly, token state + refresh, path
  discovery, handshake→profile→channels→epg orchestration, create_link + prefix
  stripping, and all mapping into `model.ts`. This mirrors `xtream.ts` +
  `source.ts` and keeps the protocol in one testable place.

---

## Implementation plan (ordered)

1. **Rust: header-aware fetch.** Extend `lib.rs#http_get` to accept an optional
   `headers` map, merged over the defaults; add Cookie/Authorization redaction to
   the `[http]` log. Verify reqwest per-request-header override semantics against
   the locked source. (One Rust change → needs a rebuild; batch it with any other
   pending native work.)
2. **TS: `data/stalker.ts`.** Header/cookie assembly; `handshake`, `getProfile`,
   token record + `withAuth` retry-once-on-401/403 (re-handshake); `fetchGenres`,
   `fetchChannels` (all-channels + ordered-list fallback), `fetchEpg`
   (get_epg_info primary, get_short_epg fallback), `createLink` + prefix strip.
   Pure URL/param builders separated from fetches, exactly like `xtream.ts`.
3. **TS: model.** Add optional `streamCmd?: string` to `Channel` (`model.ts`).
4. **TS: `source.ts`.** `enabledStalker()`, `buildStalkerSource()` producing the
   standard `{ group, channels, programmes }`; merge into `doLoad`; extend
   `cacheKey` to fingerprint Stalker playlists.
5. **TS: `stream.ts`.** Add `async resolveStreamUrl(channelId)` dispatching by
   id/kind (mock → null, Xtream → sync builder, Stalker → create_link). Keep the
   pure `channelStreamUrl` for Xtream + tests.
6. **TS: `LiveScreen.tsx`.** Move `playUrl` from render-time derivation to
   effect-driven state via `resolveStreamUrl`; re-resolve on player reload /
   go-live so a stale `play_token` never replays.
7. **Settings UI.** The add-playlist form already knows the `stalker` kind
   (`KIND_LABELS`, `playlistSource`, `StalkerPlaylist` type exist) — wire the
   portal + MAC inputs and a "Test & Add" that runs handshake→profile→genres and
   reports a human error on failure (matches the first-run validated-add ethos).
8. **Verify (headless).** Build a fake Stalker portal like `scripts/fake-panel.mjs`
   (handshake→token, get_profile, get_genres, get_all_channels with `cmd` rows,
   get_epg_info keyed map, create_link returning an `ffmpeg http://…?play_token`
   string). Assert: token flow, header assembly, channel/genre mapping, EPG map,
   prefix stripping, per-source best-effort isolation, and the async play-URL
   resolution. Gates: typecheck / lint / test / build.

---

## Open questions / risks

- **Token expiry & refresh (medium).** Guides report tokens expiring ~1 hour into
  a session; players that don't refresh start getting 403s. There's also a
  `watchdog` heartbeat (`type=watchdog&action=get_events`, typically ~88s) that
  STBs poll to keep the session alive. Decision needed: implement a lightweight
  watchdog poll, or just **refresh lazily** (catch 401/403 → re-handshake →
  re-get_profile → retry once). Recommendation: lazy refresh first (simpler,
  covers the create_link-after-idle case, which is the one that actually bites);
  add the watchdog only if a portal drops sessions faster. (Sources: multiple
  guides; not verified against a specific portal's exact TTL.)
- **create_link is per-play and tokens are short-lived (medium).** Confirmed
  behavior, but the exact TTL / single-use semantics vary by portal. Must
  re-resolve on every play and on any reload; never persist the resolved URL.
- **Endpoint path discovery (medium).** `load.php` vs `portal.php` vs
  `/stalker_portal/c/portal.php` — no universal rule found. Probe at add-time and
  remember the working path per playlist.
- **`get_all_channels` coverage (medium).** Confirmed in the reference server,
  but not every portal implements it (or it may return a subset). The
  `get_ordered_list` per-genre paginated fallback is mandatory, not optional.
- **`get_epg_info` shape/units (low-medium).** `period` unit (hours vs days) and
  whether it accepts an explicit channel list are portal-version-dependent —
  verify against a live portal; clamp client-side to our window meanwhile.
- **MAG `User-Agent` / device fields (low).** Some strict portals check the UA
  string and/or want `sn`/`device_id`/`signature`. The MAC-only path covers the
  common case; device-fingerprint fields require reverse-engineering we should
  not attempt speculatively — flag as a known unsupported-portal class.
- **Catch-up (low, deferred).** `enable_tv_archive` on the channel row is the
  Stalker analogue of Xtream's `tv_archive`; it can feed `Channel.archiveDays`.
  But timeshift is shelved project-wide (ROADMAP) and Stalker archive uses its own
  `create_link` variant (`cmd` with a timestamp) — leave it for the timeshift
  resume, don't build it now.
- **No bulk XMLTV (informational, not a risk).** Unlike Xtream there's no single
  guide document — which is actually a win: the 95MB-DOMParser / IPC-haul saga
  that dominated Xtream load time does not apply. EPG arrives as compact JSON.

---

## One-paragraph summary

A Stalker adapter is a header-authenticated sibling of the Xtream path:
handshake→token→get_profile, then `get_all_channels` (bulk, with a paginated
`get_ordered_list` fallback) + `get_genres` + `get_epg_info` map onto the same
`Channel`/`LiveFolder`/`Programme` shapes via a new `data/stalker.ts` and a
`buildStalkerSource` in `source.ts`. The two real changes are: (1) fetches need
per-request Cookie/Authorization/UA headers, so extend Rust `http_get` to take a
headers map (reusing the Schannel-TLS/gzip client and adding Cookie/token
redaction); and (2) stream URLs are resolved per-play via `create_link` (stripping
an `ffmpeg`/`ffrt` prefix off the returned cmd), so `stream.ts`'s pure
`channelStreamUrl` grows an async `resolveStreamUrl`, and `LiveScreen` resolves
the play URL in an effect instead of during render. The channel's opaque `cmd`
rides on a new optional `Channel.streamCmd`. Everything else — namespaced ids,
per-source best-effort, disk cache, Guide/Hero — is unchanged.

# Plan 027: what a real Jellyfin 12.2 answered (batch 0 and round 2)

Data, not memory. Taken 2026-10-14 from Adam's own server (Jellyfin 12.2.0,
`ProductName: "Jellyfin Server"`, no `aiostreams` object) by
`scripts/jf-probe.mjs`: 80 calls, signed in by password as `edd`, then the
OpenAPI spec (`/api-docs/openapi.json`, 294 paths). The shapes live in
`scripts/fixtures/jellyfin-12.2.json`, and `scripts/fake-jellyfin.mjs`
serves them. This file is what differs from plan 027's "What a real
Jellyfin needs" list and what is still open. "Spec" means the server's own
OpenAPI; "probe" means a call that was made.

## What the plan had right

- Sign-in by password works as the plan says: `POST /Users/AuthenticateByName`
  with `{Username, Pw}`. The answer is `{User, SessionInfo, AccessToken,
  ServerId}`. No expiry is given. A wrong password is `401`, `text/plain`,
  body `Error processing request.`.
- Sign-out revokes: `POST /Sessions/Logout` is `204`, and the same token is
  `401` on the next call.
- `/System/Info/Public` gives `Version` with no sign-in.
- The new routes exist: `/UserViews`, `/UserItems/Resume`,
  `/UserPlayedItems/{id}`, `/UserItems/{id}/UserData`, `/MediaSegments/{id}`.
- `PlaybackInfo`'s `Path` is the file's path on the server
  (`C:\jf-test\shows\...mkv`), as the plan said: nothing here can open it.
  A direct stream is `GET /Videos/{id}/stream?static=true&mediaSourceId=
  {Id}&tag={ETag}&playSessionId=...`, `206` with `Accept-Ranges: bytes`,
  `video/x-matroska`.
- `ProviderIds` carry through: Severance has Imdb `tt11280740`, Tmdb
  `95396`, Tvdb `371980`; each episode has its own Imdb, Tmdb and Tvdb; the
  movie (The Turn) has Imdb `tt2043923` and Tmdb `491457`; "Zzz Test Show"
  has `{}`. A Stremio episode id is the series' Imdb id plus
  `ParentIndexNumber` and `IndexNumber` (`tt11280740:1:1`); that is a
  construction, not something the server gives.

## Where it differs from the plan (each one changes the build)

1. **Only two ways to give a token work.** `Authorization: MediaBrowser
   Client=..., Token="..."` and `?ApiKey=`. These were all `401` with an
   empty body: `?api_key=`, `X-Emby-Token`, `X-MediaBrowser-Token`, and
   `X-Emby-Authorization` carrying the same string. `jf.rs` must not
   assume the common `X-Emby-Token` or `api_key` forms. The header mpv is
   handed is `Authorization: MediaBrowser Token="..."`.
2. **The direct stream and images need no token at all.** The same
   `/Videos/{id}/stream` call with no credentials got `206` and the same
   bytes; so did `/Items/{id}/Images/Primary`. The spec lists no
   `security` on the stream, and `CustomAuthentication` on the routes that
   were refused. So for D3: no token needs to reach mpv today. Recommended
   anyway: still send the `Authorization` header per file (one header,
   put back after, never in a URL), so a server that tightens this later
   keeps playing. A token in a URL stays out either way.
3. **The old `/Users/{userId}/...` routes are not in the 12.2 spec**, though
   this server still answered `/Users/{id}/Views`, `/Users/{id}/Items`,
   `/Users/{id}/Items/{id}` and `/Users/{id}/Items/Resume` with `200`.
   Recommended: the new forms only (the plan's 10.9 floor), and a clear
   "needs Jellyfin 10.9 or newer" below that. Do not lean on routes the
   spec dropped.
4. **`Recursive=true` with no `IncludeItemTypes` returns Folders, Seasons and
   Episodes too.** Adam's "Movies" and "Shows" libraries each hold 259
   `Folder` items (the paths sit under a directory on his Desktop). Every list call must pass
   `IncludeItemTypes`. The fake keeps three junk Folders under Movies so a
   missing filter shows.
5. **Query names are case-insensitive** (`ParentId`, `parentId` and
   `userId` all bound). The spec spells them lower camel.
6. **Stop semantics (settled, round 2).** The server's own thresholds
   (`GET /System/Configuration`, admin only) are `MinResumePct` 5,
   `MaxResumePct` 90, `MinResumeDurationSeconds` 300. On a 600 second item:
   a stop at 3% resets the position and does not mark it played; at 50% and
   85% it saves the reported position exactly (`PlaybackPositionTicks`
   3000115000 and 5100195500, `PlayedPercentage` 50 and 85) and the item
   appears in `/UserItems/Resume`; at 95% and 100% it is `Played: true`
   with position 0 and leaves Resume. Every stop adds one to `PlayCount`,
   even the 3% one. An item under 300 seconds is marked played at any stop
   over 5% and is never resumable (the 30 second clips). The exact 90%
   edge was not hit (85 and 95 only). So the 90% rule written for
   AIOStreams is Jellyfin's own too, and the app need not mark anything
   played itself after a stop: send `Stopped` with the real position and
   read `UserData` back. The thresholds are the server's to change and need
   an admin to read, so nothing should depend on them being these numbers.
   `/Shows/NextUp` after the 3, 50 and 85% stops still offered episode 1;
   after 95 and 100% it was empty: episodes skipped before the last watched
   one are not offered.
7. **Played marks:** `POST /UserPlayedItems/{id}` gives `Played: true`,
   `PlayCount` 1, `LastPlayedDate`, position 0. `DELETE` gives `Played:
   false`, `PlayCount` 0, no `LastPlayedDate`. `POST /UserItems/{id}/
   UserData` with `{PlaybackPositionTicks: 0, Played: false}` is the
   reset.
8. **Report bodies:** `/Sessions/Playing`, `/Progress` and `/Stopped` took
   `{ItemId, MediaSourceId, PlaySessionId, CanSeek, PlayMethod,
   PositionTicks}` and answered `204`. Spec fields besides those include
   `IsPaused`, `IsMuted`, `AudioStreamIndex`, `SubtitleStreamIndex`.
   `PlaySessionId` is minted by `PlaybackInfo`.
9. **Next Up** after episode 1 was played returned episode 2 ("Half
   Loop") with `ProviderIds`; **Upcoming** and **segments** came back
   `{Items: [], TotalRecordCount: 0, StartIndex: 0}`. Segment types in the
   spec: `Unknown`, `Commercial`, `Preview`, `Recap`, `Outro`, `Intro`
   (`StartTicks`, `EndTicks`, `ItemId`).
10. **Unknown ids (round 2).** An all-zero id is not a 404: `GET /Items/000...0`
    returns the root "Media Folders" item with `200`. A random GUID is `404`
    `application/problem+json` (`{type, title: "Not Found", status, traceId}`)
    on `/Items/{id}`, `PlaybackInfo`, `/UserItems/{id}/UserData` and
    `POST /UserPlayedItems/{id}`. A non-GUID id (`nope`) is `400` problem+json
    with `errors.itemId`. `POST /Sessions/Playing/Stopped` for an unknown item
    is `204`, silently accepted. An unknown route is an empty `404`.
11. **`PlaybackInfo`:** the POST with no profile and the GET both gave
    `SupportsDirectPlay`, `SupportsDirectStream` and `SupportsTranscoding`
    all true; the POST with a direct-play-only profile and no transcoding
    profiles gave transcoding false. No `TranscodingUrl` in any of them.
    Each media stream carries `Index`, `Type`, `Codec`, `DisplayTitle`,
    `IsDefault`, `IsForced`, `IsHearingImpaired`, `IsExternal`,
    `IsTextSubtitleStream`, `SupportsExternalStream`. The 30 second clips have one
    video stream (h264, 1280x720, `yuv444p`) and one mono AAC stream.
12. **External subtitles (round 2).** The route is `/Videos/{itemId}/
    {mediaSourceId}/Subtitles/{index}/Stream.{format}` (and a variant with a
    start position). For `Severance S01E03.en.srt` the stream is `{Codec:
    "subrip", Language: "eng", DisplayTitle: "English - SUBRIP - External",
    Type: "Subtitle", Index: 0, IsExternal: true, IsTextSubtitleStream: true,
    SupportsExternalStream: true}`: the subtitle took Index 0, ahead of the
    video (1) and the audio (2). `DeliveryMethod: "External"` and a
    `DeliveryUrl` appear only when the PlaybackInfo body carries a
    `DeviceProfile` with `SubtitleProfiles`, and the `DeliveryUrl` is
    `/Videos/<dashed guid>/<mediaSourceId>/Subtitles/0/0/Stream.srt?ApiKey=<the
    session token>`: **the server puts the token in the URL it hands out**.
    `jf.rs` drops `DeliveryUrl` and `Path`; build the URL from the index, as
    below. The route needs no token: `200`, `application/x-subrip`, with or
    without `ApiKey`, and the dashed or the plain item id both resolve.
    A subtitle stream that does not exist is `500` (observed with no token),
    not a 404.

## Quick Connect (live, round 2)

`GET /QuickConnect/Enabled` is `200 true`. `POST /QuickConnect/Initiate`
(no token) is `200 {Authenticated: false, Secret, Code (6 digits), DeviceId,
DeviceName, AppName, AppVersion, DateAdded}`, no expiry field. `GET
/QuickConnect/Connect?secret=` is `200` with the same object while pending
(polled eight times) and `Authenticated: true` after Adam approved the code
in Jellyfin's web page (`DateAdded` changes); an unknown secret is `404` with
the JSON string body `"Unknown secret"`. `POST
/Users/AuthenticateWithQuickConnect` with `{Secret}` then gives `200` and the
usual `{User, SessionInfo, AccessToken, ServerId}`. Sign-out is `204` and the
token is `401` after.

## Token, round 2 additions

`?apikey=` in lower case works (`200`), `?ApiKey=` works, `?api_key=` is `401`.
The guard in `jf.rs` refuses a credential key in any case, which is right.
`X-Emby-Authorization` alone is `401` as a token carrier.

## What it means for the build

- A subtitle for mpv is `${base}/Videos/{itemId}/{mediaSourceId}/Subtitles/
  {index}/Stream.srt` built by the page from the stream's `Index`; any text
  subtitle (`IsTextSubtitleStream`) can be asked for as `.srt`. No token.
- The direct stream is `${base}/Videos/{itemId}/stream?static=true&
  mediaSourceId={Id}&tag={ETag}`, built the same way (batch 3); no
  `DirectStreamUrl` or `TranscodingUrl` comes for a direct-playable file.
- mpv and the token (batch 3, measured on mpv 0.37 through libmpv's
  `mpv_set_property_string`, the call `mpv.rs` makes): `http-header-fields` is a
  list split at commas, so the header is `Authorization: MediaBrowser
  Token="<token>"` with nothing else in it (a `Client="...", Token=...` form is
  split in two and the open fails); set before `loadfile` it is sent on that
  file's requests, and `""` puts it back. **It follows a redirect to another
  host** (a redirect from one port to another carried it). So D3 is kept
  (header, per file, put back, never a URL) with two tightenings: the stream
  is first asked for with no token (12.2 serves it, so the token never leaves
  Rust there), the header is only given when the server refuses that and
  serves it with the token, and never for a stream that is only reached by a
  redirect off the server (`jf.rs` `prepare_stream`, `auth_header_for`).
- The movie in Adam's library ("The Turn") is a game-mod `.bin` file with no
  runtime, not a video: playback and progress tests use the episodes.

## What the fake does not claim

Marked in `scripts/fake-jellyfin.mjs`'s header: the movie's `PlaybackInfo`
is derived from the episode shape; Quick Connect's Authorize is from the
spec. The stop rule, the unknown ids, the subtitle route and Quick Connect
are all observed now. Not hit: the exact 90% edge of a stop.

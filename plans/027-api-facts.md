# Plan 027: what a real Jellyfin 12.2 answered (batch 0)

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
6. **Stop semantics are NOT settled.** On a 30 second clip, a stop at 3%
   gave position 0, not played, `PlayCount` 1; a stop at 50, 85, 95 and
   100% gave played, position 0, `PlayCount` 1. `/UserItems/Resume` stayed
   empty after every one. That fits a rule that short items are never
   resumable, but a 30 second clip cannot show the 90% rule or a saved
   position, and the cause is not confirmed. The 90% rule written for
   AIOStreams cannot be checked or dropped from this data. Needs a clip of
   about ten minutes (round 2).
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
10. **An all-zero id is not a 404.** `GET /Items/000...0` returned the
    root "Media Folders" item with `200`. A real unknown id was not tried
    (round 2).
11. **`PlaybackInfo`:** the POST with no profile and the GET both gave
    `SupportsDirectPlay`, `SupportsDirectStream` and `SupportsTranscoding`
    all true; the POST with a direct-play-only profile and no transcoding
    profiles gave transcoding false. No `TranscodingUrl` in any of them.
    Each media stream carries `Index`, `Type`, `Codec`, `DisplayTitle`,
    `IsDefault`, `IsForced`, `IsHearingImpaired`, `IsExternal`,
    `IsTextSubtitleStream`, `SupportsExternalStream`. The test clips have one
    video stream (h264, 1280x720, `yuv444p`) and one mono AAC stream, and no
    subtitles, so subtitle delivery was not exercised.
12. **The subtitle route in the spec** is `/Videos/{itemId}/{mediaSourceId}/
    Subtitles/{index}/Stream.{format}` (its path parameters are named
    `routeItemId` and so on), with a variant carrying a start position.

## Quick Connect

Not run in this probe (password mode). From the spec: `GET
/QuickConnect/Enabled`; `POST /QuickConnect/Initiate` gives `{Authenticated,
Secret, Code, DeviceId, DeviceName, AppName, AppVersion, DateAdded}`;
`GET /QuickConnect/Connect?secret=` gives the same object (404 for an
unknown secret); `POST /QuickConnect/Authorize?code=` (signed in) approves
it; `POST /Users/AuthenticateWithQuickConnect` with `{Secret}` gives the
usual `AuthenticationResult` (400 when not approved). The fake follows
that; the live run is round 2.

## Round 2 (needs Adam at his PC, nothing else)

1. A ten minute clip with an external subtitle (below), to settle the stop,
   resume and played rules and the external subtitle shape.
2. `GET /System/Configuration` (the probe now reads it): the server's own
   resume and played thresholds.
3. A real unknown id (the probe now tries it on four routes plus an
   unknown-item report), a non-GUID id, and `?apikey=` in lower case.
4. Quick Connect live (`JF_MODE=q`), end to end.

## What the fake does not claim

Marked in `scripts/fake-jellyfin.mjs`'s header: the movie's `PlaybackInfo`
and record are derived from the episode shape; Quick Connect bodies are
from the spec; an unknown item is a `404` there (unverified); stops on an
item of five minutes or more apply Jellyfin's usual rule, which is
unverified until round 2.

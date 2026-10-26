# Plan 029: record live TV, and pause and rewind it for hours

**Status: DECIDED, Phase 0 next** (2026-10-26). The roadmap's first "Next"
item (docs.eddtv.org/roadmap/), and the post-1.0 headliner since July
(ROADMAP.md:359). Research: a read-only survey of this code, mpv and ffmpeg
at their pinned commits (scripts/deps.json), and how Jellyfin, Kodi, Channels,
Plex, Emby, TiviMate and Desktop Telly do it.

## What exists today

Pause and rewind half exist already, and recording not at all.

- **The rewind rail is real.** The theater's live rail scrubs back through
  mpv's in-memory buffer (`features/live/dvr.ts`, `liveEdge.ts`,
  `TheaterOverlay.tsx` ~1947-2087), and ±10s works on live. The buffer is
  `demuxer-max-bytes=512MiB` + `demuxer-max-back-bytes=256MiB` (`mpv.rs:914-915`):
  about 13 minutes back at 8 Mbit/s, 4 at 4K. Pause keeps reading until the
  forward buffer is full, then stops reading the socket.
- **Go Live throws the buffer away.** It reloads the URL (`mpv.rs:1214`
  `reload_live`), so does a channel switch, and so does the watchdog's silent
  self-heal. The pop-out sets no cache options at all, so it gets libmpv's
  150/50MiB.
- **`cache-on-disk` was turned down on purpose** (`mpv.rs:910-913`): for VOD it
  writes every byte of a 60GB remux to disk. For live it is the tool.
- **No recording code exists.** The release `mpv_set` allowlist refuses
  `stream-record` and anything named record or dump (`lib.rs:343-380`), and
  stays that way: recording gets its own commands.
- **The parts a recorder needs are built**, for Multi-View: the Rust fetch on
  Windows' own TLS with the playlist's User-Agent (`mvproxy.rs`), and ffmpeg
  fed on stdin so it never sees a URL or a credential, killed on drop,
  windowless (`mvconvert.rs:869-937`).
- **Connections** are counted per Xtream line from the panel
  (`connections.ts`), and Multi-View keeps its grid inside `max - elsewhere`
  (`mvGrid.ts`). A recording is one more connection the app must count as its
  own, or Multi-View calls it "Elsewhere" and a full line breaks.
- **Naming:** in this repo "timeshift" has meant the provider's catch-up
  archive (built and shelved, `stream.ts:86-205`, HANDOFF.md:1610). This plan
  is local pause and rewind, which needs nothing from the provider. Code and
  copy say "rewind", not "timeshift".

## Decisions (Adam, 2026-10-26)

- **D1, two halves.** Pause and rewind ride mpv's own cache, moved to disk.
  Recording is a separate native recorder. They share no machinery in v1, so
  a recording survives a channel switch, Go Live, a self-heal and the app
  closing. Rejected: one shared download per channel that both read (Jellyfin's
  `SharedHttpStream` shape). It saves a connection when you watch and record
  the same channel, but it rewrites the live player, the most
  regression-scarred code in the app.
- **D2, version one records two ways:** a Record button while watching, and
  Record on a programme in the Guide, which starts and stops by itself at the
  programme's times. A scheduled recording fires only while the app is open.
- **D3, one connection, same channel:** when the line allows 1 connection and
  you press Record on the channel you're watching, record from the player's
  own buffer (mpv `dump-cache <now> no <file>`) instead of refusing. A popup
  says what that means every time, until "Don't Show Again": it stops if you
  change channels, go live, or the stream reconnects.
- **D4, recordings show in both places:** a Recordings mode in the Live TV
  sidebar beside Playlist, Favorites and Recents, and a Recordings section in
  Library.

## Phase 0: data from Adam's PC, before any build

No rebuild. In the app's console on a live channel:

1. `await mpvSet("cache-on-disk","yes")`, wait a minute, then
   `await mpvGet("demuxer-cache-state")`. A `file-cache-bytes` field means the
   disk cache works under libmpv on Windows. Then find the file: mpv's default
   cache folder is resolved by `mp_find_user_file("cache")`, and where that
   lands for libmpv on Windows is unverified (search `%APPDATA%\mpv` and
   `%LOCALAPPDATA%` for a growing file).
2. Pause a channel for 20 minutes. Note whether the sidebar's n/m drops when
   mpv stops reading, and whether Play resumes or the stream has died. This
   decides whether a long pause needs a reconnect-and-stitch or just works.

## Phase 1: pause and rewind for hours (native, small)

- Live only: `reset_per_file` turns `cache-on-disk` on with an app-chosen
  `demuxer-cache-dir` under the app's data folder, emptied at startup (Kodi's
  pattern). VOD keeps today's in-memory cache.
- The limit is time, not bytes: up to 2 hours back. On disk that is bitrate ×
  time (about 2.25 GB/h at 5 Mbit/s), deleted on channel change. Stop growing
  it when free disk drops under 2 GB.
- Go Live becomes a seek to the buffer's end when reading never stalled, and a
  reload only when it did. The self-heal keeps reloading (a dead socket has
  nothing to seek to).
- The pop-out gets the same options.
- Checks: host-crate tests for the option set per file kind; a harness check
  that Go Live sends a seek and not a reload when the stub says reading never
  stalled. Real playback is Adam's.

## Phase 2: Record (native recorder, the button, the lists)

- **Native (`rec.rs`, beside `mvconvert.rs`):** upstream from
  `mvproxy::fetch` (HLS through its loopback) into ffmpeg's stdin,
  `-c copy -f mpegts` to a `.ts`. Stop by closing stdin, so the file is whole
  and an app that dies takes its recordings down cleanly (reasoned from
  ffmpeg's source; tested in the host crate with the real ffmpeg). Reconnects
  in Rust, waiting for a free slot like `mvRecover`; a Stalker link is asked
  for fresh from the frontend each time. Hold Windows awake while any
  recording runs (`SetThreadExecutionState`; needs the `Win32_System_Power`
  feature). An index of recordings in the app's data folder: id, channel,
  programme, start, end, size, status (Recording, Done, Partial, Failed).
- **Where files go:** `Videos\BlammyTV` by default, changeable in Settings →
  Playback. Refuse to start under 2 GB free, and stop at 1 GB with the file
  kept.
- **Playing a recording:** by id, native resolves the path, so `mpvurl`'s
  http-only rule stays.
- **Connections:** a recording counts in `roomOn`, `allowedSizes` and the
  sidebar meter as the app's own, and the meter refreshes on start and stop.
  Install and Restart wait while one runs (`playingNow.ts`).
- **D3's buffer recording:** its own native command (`dump-cache`), the popup,
  and the "Don't Show Again" setting.
- **UI:** Record and Stop Recording in the player's controls; a recording dot
  on the channel in the Guide; Recordings in the Live TV sidebar and in
  Library (play, delete, show in folder).

## Phase 3: Record a programme from the Guide

- Right-click a programme → Record. It starts at the programme's start (or now,
  if it's on) and stops at its end, plus a minute either side for a guide
  that runs late.
- Scheduled recordings are kept across restarts. One whose start passed while
  the app was closed is marked Missed, not started late.
- A conflict (more recordings than the line allows) is said when you schedule
  it, not when it fails.

## Open, for later

- Series rules ("record every new episode"), recording without the app open
  (a Windows service), and converting `.ts` to something smaller.

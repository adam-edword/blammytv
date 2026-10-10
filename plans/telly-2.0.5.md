# Telly 2.0.5 against BlammyTV, feature by feature

Read 2026-10-09 from Telly's Windows installer (2.0.5): its UI bundle,
beautified, and a strings dump of `iptv-player.exe`. Static reading only.
No Telly binary was run, no licence check was touched, and nothing here is
their code: approaches are described in our words. Five readers took one
area each (VOD, Live TV and the guide, the player and multi-view, sports,
the shell and privacy); the claims below that decide a verdict were re-read
first-hand before they were written down.

Telly's stack is ours: Tauri 2, WebView2, libmpv, plus a separate `mpv.exe`
for the pop-out and `ffmpeg.exe` for recording. Its Rust side holds a
SQLite database and answers the UI over JSON-RPC through Tauri events, not
HTTP.

## Decided 2026-10-10 (Adam)

- **Multi-view stays on web tiles.** Native tiles would buy any codec and
  faster HEVC starts; they would cost the tile motion and a refactor already
  reverted once (v0.9.94), for a multi-view that works. Adam: "I like how it
  works now."
- **Guide downloads:** stop re-downloading the guide on every launch, and add
  Refresh now. Done in v0.11.22: each source reuses its guide for 12 hours
  (`GUIDE_REFRESH_MS`) while its channel list still reloads every time, so
  event channels renamed during the day are read fresh for sports.
- **Surround:** stop forcing stereo. Done in v0.11.21, with a Channels row in
  the stats overlay to read what reached the device.

## The short version

Telly is broader: 13 settings tabs to our 2, recording, catch-up, Emby,
Jellyfin and Plex, rebindable keys, gamepads and remotes. We are better at
the parts we chose to go deep on: pairing a game with a channel, the sports
theater, multi-view built around games, start-up speed, the hot update
channel, and privacy.

| Area | Telly better | We are better |
| --- | --- | --- |
| VOD | auto-skip intro, Up Next settings, a row editor | hero, Discover, cached-source grouping and failover, Trakt depth, MAL, resume |
| Live TV and guide | refresh cost, several guide sources and manual mapping, a 25h window with navigation, catch-up, sorting and per-channel hide | warm and cold start, XMLTV tolerance, channel numbers, the adult filter, parallel playlists |
| Player | deinterlace and reconnect options, a stall watchdog, track labels, aspect, recording, rebindable keys | an honest DVR window, seek keys, source failover |
| Multi-view | native tiles (any codec), 16 tiles, custom layouts, per-tile tracks | picking and filling with games, scores on tiles, the line's limits, recovery wording |
| Sports | standings, team and player pages, match stats, a scores panel in the live player | pairing, by a wide margin (below); the theater; racing, golf and tennis cards |
| Shell and privacy | settings breadth, a quarantine screen, release notes in the update prompt | the hot channel, no install mid-watch, onboarding, the palette, reduced motion, no telemetry |

## Sports: how Telly pairs a game with a channel

Adam asked about this one specifically, so it was read line by line.

**Nothing pairs until you press Watch.** The card carries no channel. Watch
opens a dialog that asks TheSportsDB for that event's TV listings (one row
per broadcaster per country) and scores every channel with a url against
each listing:

- Both names are lowercased, everything outside `[A-Za-z0-9_]` becomes a
  space (accented letters included), and a stop list is dropped: `hd sd fhd
  uhd 4k 1080p 720p tv channel network broadcasting live sports sport the a
  an and or of in on us usa uk eu`.
- Equal after that scores 100. One containing the other AS CHARACTERS scores
  70 plus up to 25 for length. Otherwise the best of token overlap (with a
  13-entry alias table) at 70% weight and edit distance at 50%.
- A channel whose folder names the listing's country gets +10.
- Each listing keeps channels at 25 or more, top 5. Rows show a % and a bar,
  "Best" at 70.
- No team names, no league, no kick-off time, no guide. If TheSportsDB has
  no listing, the dialog says "No broadcast information available" and
  there is no fallback.
- A "map a league to a channel" table and wizard exist, but nothing in 2.0.5
  opens the wizard and nothing reads the table. Dead code.

**Where that goes wrong, worked by hand on Adam's 1,875-channel dump
(`apps/app/src/features/sports/fixtures/channels.json`):**

| Listing | Telly | Ours |
| --- | --- | --- |
| ESPN | four ESPN rows at 100, then **ESPN 2 at 87, "Best"** | the four at 90; ESPN 2, U and News rejected (`matcher.ts:374-386`) |
| CBS | **CBS Sports Network 100**, CBS Sports HQ 83, Golazo 78, then the right CBS 4K at 75 | CBS 4K at 90; CBS Sports Network and Golazo at 15 under "Less likely" |
| NBC | NBC Sports Network 100, NOW 81, Boston 78, Bay Area 76, Golf Pass 76; **the right NBC 4K is 6th and cut by the top 5**; a CNBC channel would score 89 | NBC 4K at 90, regionals at 15 |
| FS1 | FS1 4K at 75; **"US: FOX Sports 1 FHD" at 24.5, under the floor** | both at 90 through ALSO |
| MLB.TV | MLB Network and The MLB Channel at 100 (plan 010's finding, explained: the stop list reduces all three to "mlb") | this game's own feeds at 97; MLB Network not offered |
| ESPN+ (a Mariners game) | five cable ESPN rows at 100; the game's real ESPN+ feed about 72 and cut | the game's ESPN+ and MLB feeds at 97 through the club names |
| four CBS games at 1pm | the same CBS channel at 100 for all four | split by the games sharing it (`sharing.ts`); a club's own station at 90 |

A listing that is only stop words ("USA Network") normalises to nothing, and
every string contains nothing, so every channel scores 70 and "Best".
Whether TheSportsDB spells it that way: can't tell from here.

**Where Telly is ahead:** listings carry a country (useful outside the US,
where ESPN names nobody), and each row says which listing it came through.

**Worth taking:**
- A "via" line on rail rows ("via MASN"). `Match` would carry the network
  it matched through (`matcher.ts:52-57`), shown in the rail row
  (`SportsTheater.tsx:900-960`). It answers plan 010 #51's "scores that don't
  mean what they say".
- A persisted override, which is plan 010 #26. Telly's unused table (league,
  channel, priority) is the right shape; ours would key on the network name
  (plan 010:202-203) and let "Wrong channel for this game" stick as a
  negative.

**Not taking:** character containment, the stop list, the per-listing cap.

**Gaps in ours that the comparison turned up:**
1. ESPN's market suffixes DET, KC, MW, OH, OK, SE, SW, WI and FL (all in
   `fixtures/broadcast-names.json`) have no WORDS entry (`matcher.ts:85-108`),
   so "FanDuel SN DET" never reaches "FanDuel Sports Network Detroit". Each
   one needs both sides checked against data before it goes in, per the
   table's own rule.
2. `sameSlot` reads "27 Jul" but not "Jul 27", which is how the dump's ESPN+
   feeds are stamped. They skip the date check; the ±90 minute time check
   still runs (`matcher.ts:776-782`).
3. `matchEvent` needs every word of both clubs' full names, so a provider
   that drops the city or writes "D-backs" misses. `guideMatch.ts` is more
   forgiving and still runs only in the dev probe.

## Live TV and the guide

- **Refresh cost: Telly better.** Each playlist has a guide and a playlist
  interval, 24 hours by default, and nothing is fetched until it passes. We
  start a full background reload on every launch that hydrates from disk
  (`features/live/source.ts:316-342`, the unconditional
  `refreshInBackground`) and on a Guide remount after 30 minutes
  (`source.ts:160-173`). That is the whole xmltv, about 95MB on Adam's line,
  every launch. That has been the design since v0.1.106 (hydrate, then
  always revalidate), so it is a choice to revisit, not a regression.
- **Guide sources: Telly better.** Several per playlist with priorities, a
  typed-in guide URL, a name tier after the id, and "Map EPG Channel" per
  channel. We take one guide per source and match ids only
  (`features/live/xmltv.ts:68-119`). Its prefix tier can attach the wrong
  guide; skip that part.
- **Time window: Telly better.** 25 hours with ±6h and Now. Ours is a fixed
  4 hours (`features/live/epg.ts:6-15`) while 44 hours sit in memory.
- **Search: mixed.** Telly finds what is on now; our palette looks 24 hours
  ahead but skips anything already airing (`features/palette/Palette.tsx`).
- **Favourites, sorting, per-channel hide, sidebar counts: Telly better.**
- **Catch-up: Telly ships it.** Ours is built and shelved
  (`features/live/stream.ts:71-160`).
- **Ours better:** warm start paints the whole guide from IndexedDB where
  Telly shows "Select a category"; the cold start overlaps the guide with the
  channel fetch; XMLTV tolerance (truncated times, missing `stop`, a bare
  `&`); channel numbers (Telly has no column for them); the adult filter
  (Telly has none); playlists load in parallel; a failed source keeps its
  last good channels.

## The player

- **Options Telly sets that we don't.** `deinterlace=auto` (mpv's default at
  our pin is `no`, so our 1080i channels are never deinterlaced), and lavf's
  `reconnect_streamed` and `reconnect_on_network_error` (mpv itself sets only
  `reconnect=1`, which skips non-seekable inputs). Both want a reading on
  Adam's machine first: `video-frame-info/interlaced` on a 1080i channel.
- **A stall watchdog.** Telly watches `time-pos` and reloads a stream that
  stops moving (9s, unless the cache is growing). Ours catches death only at
  EOF or idle, so a frozen stream waits out mpv's 60s `network-timeout`.
- **A health advisor** that turns mpv's counters into "connection can't keep
  up" or "decoding too slow". We have nothing like it.
- **Track labels** carry codec and channel count; two "eng" tracks look
  identical in ours (`src-tauri/src/mpv.rs:919-939`).
- **Go Live** is a seek to the buffer's end in Telly. Ours reloads
  (`mpv.rs:827-861`), whose comment says an earlier forward seek couldn't
  reach live. `liveEdge.ts` measured that seeking back 10s grows
  `demuxer-cache-duration` by 10, so after a seek BACK the way forward is
  held. Both can be true (a long pause stops the reading); only a test on a
  real stream settles which case a seek would cover.
- **Ours forces `audio-channels=stereo`** (`mpv.rs:314,501`). Telly leaves
  mpv's `auto-safe`, so 5.1 reaches a surround setup. Nothing in the repo
  records why we downmix.
- **Ours better:** a scrub window bounded by what is actually held, seek
  keys (Telly has none by default), failover between sources, and a pop-out
  that carries tracks, mute and speed across.
- **Telly only:** recording (ffmpeg `-c copy` with reconnect flags, rules,
  partial files kept), aspect override, subtitle styling and delay, channel
  up and down with a recent-channels strip, rebindable keys.

## Multi-view: plan 013's premise has changed

Plan 013 settled that Telly's multi-view was a web player, on the strength
of its own modal. **That is no longer true on Windows.** In 2.0.5 the tile
engine is chosen per OS: none on Linux, VLC on macOS, libmpv on Windows. Each
Windows tile is its own libmpv instance with a `wid`, placed over
transparent DOM rectangles, with `gpu-next`, `d3d11`, `deinterlace=auto` and
the reconnect flags. The web player survives only as Linux's fallback, and
the "web-based player" notice text is gone from the bundle.

What that buys Telly: any codec in a tile with no conversion, where our HEVC
tile pays about 1.7s in `mvconvert`. What it costs: tiles that can't
animate, which ours do. Up to 16 tiles, custom layouts, drag-to-swap and
per-tile tracks and aspect are Telly's; picking and filling with live games,
scores on tiles, the line's real limits with ghost-connection waits and a
remembered grid are ours. Whether to revisit native tiles is Adam's call;
the reason it was ruled out (Telly went web) no longer holds.

## Shell, settings and privacy

- **Telemetry and Discord presence are both on by default** in Telly
  (`diagnosticsEnabled` and `discordRpcEnabled` default true). Telemetry goes
  to their own OTLP endpoint with a scrubber and a first-run toast offering
  to turn it off. We send nothing.
- **"System" theme doesn't follow Windows** in Telly: nothing reads the OS
  theme, and the root only goes dark when the setting says "dark". Ours
  follows Windows live.
- **Update prompt:** Telly shows What's New. Our `latest.json` already
  carries notes, but `check_update` returns only the version
  (`src-tauri/src/lib.rs:1254-1271`), so they never reach the chip.
- **Credentials:** provider logins are plaintext in both. Telly keeps Trakt
  and other OAuth tokens in localStorage; ours are in Credential Manager.
  Telly's "import from provider" routes Xtream logins through its server.
- **A quarantined DLL:** Telly says "Backend failed to start" and points at
  an antivirus exclusion. Ours logs to the console and the player never
  starts (`features/live/InvertedPlayer.tsx:250-259`).
- **Ours only:** the hot channel with signed bundles and rollback, no install
  while you watch, onboarding, the Ctrl+K palette, reduced motion, a hardened
  ephemeral-port proxy.
- **Telly only:** SOCKS5 with a kill switch, per-protocol User-Agents and
  timeouts, encrypted backup, close to tray, portable mode, gamepad and HID
  remotes, a debug console.

## What to borrow, in the order worth doing it

Cheap and certain:
1. Skip the guide's background reload while the snapshot is younger than an
   interval, and add "Refresh now" (`source.ts:316-342`).
2. Show the release notes in the update chip (`check_update` returns
   `update.body`).
3. "On now" in the palette (`Palette.tsx`).
4. Codec and channel count in track labels (`mpv.rs:919-939`).
5. Sports: the "via" line on rail rows.

Worth a measurement first:
6. `deinterlace=auto` and the two reconnect flags on the main player.
7. A `time-pos` stall check beside the EOF check.
8. Go Live as a seek when the way forward is buffered, the reload otherwise.
9. Why stereo is forced, and whether 5.1 should pass through.
10. The sports market suffixes, each checked on both sides.

Features, each its own plan:
11. A wider guide window with ±N h and Now.
12. Manual "map guide channel" and a guide-URL override per playlist.
13. The persisted sports override (plan 010 #26).
14. Auto-skip intro and Up Next settings on VOD.
15. Recording (already the post-1.0 headliner), catch-up, native multi-view
    tiles, a keymap: each a decision before it is work.

## Can't tell from a static read

TheSportsDB's coverage and spelling of US networks; whether Telly's
telemetry sends anything before its toast is answered; its proxy's bind
address and token strength; what its licence gates; anything about runtime
behaviour, since nothing was run.

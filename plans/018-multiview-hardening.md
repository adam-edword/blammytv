# 018: Multi-view, hardened

**Status: COMPLETE.** Adam took both decisions (2026-09-25) and added
two calls of his own: a grid opens in Focus, and one stream fills the
stage. All four shipped in v0.9.124, and L6 went with them. **H1
shipped in v0.9.125** (a rebuild), **H2 in v0.9.126, H3 in v0.9.129, H4
in v0.9.130, H5 in v0.9.131 (a rebuild), and its N5 after it (build
scripts only: Adam's call was our own copy, see H5).** The test on his
line turned out not to be needed (see H1).

*Source: five audits run against v0.9.122 on 2026-09-25, one per
dimension: state and lifecycle, the native proxy, performance, hands-on UX
in a browser, and resilience over a long session. Their raw reports and
proof scripts are in the session scratchpad, not the repo. Every finding
below was checked against the code by the main session before it was
written here; the ones that also have a reproduction or a measurement say
so.*

Plan 017 built multi-view to be used. This plan is about using it for four
hours: a Sunday of games on three tiles. The audits agree on the shape of
the problem. A tile that goes wrong often doesn't know it has, and when it
does know, it keeps holding what it had (a connection on a line of three,
memory, the sound). The fixes for that are one piece of work (H1), so they
go in one version and not piecemeal. The rest follows in the order that
matters to a viewer: the line's count and the grid you saved (H2), what
the tab costs (H3), the keyboard, screen readers and layout (H4), and the
proxy's hygiene (H5).

How each finding was confirmed:
- **measured:** reproduced against the real code (the proxy's host crate
  with a real ffmpeg, or mpegts.js's own classes in Chromium).
- **test:** a unit test asserting the wrong behaviour passes on today's code.
- **seen:** observed in the running tab (screenshots in the scratchpad).
- **read:** the code path is plain; no reproduction.
- **inferred:** depends on WebView2 or a real line; not reproducible here.

---

## Findings

### R: a tile's life and death

- **R1. A failed tile never lets go.** `fail()` sets state and nothing
  else (`MultiviewTile.tsx:284-290`); the player is destroyed only on
  unmount, Retry, or an unplayable codec. After a decode error Chromium
  keeps the MediaSource open and every append throws; mpegts.js puts each
  segment back on its queue and keeps loading. So the tile holds its
  provider connection, keeps transmuxing a dead stream, logs once per
  segment, and grows memory at the stream's bitrate (about 2.7GB an hour
  at 6 Mbps) until the renderer dies and takes the app with it. Three
  audits found it. *Measured:* mpegts's `MSEController` past a decode
  error held 160 of 160 segments fed.
- **R2. A stream that ends looks like one that finished.** The proxy ends
  the body cleanly when the provider closes (`mvproxy.rs:439`), and on the
  HEVC path every upstream failure (a drop, 20s of silence) becomes a
  clean end, because the feed just stops ffmpeg's input
  (`mvproxy.rs:454-460`, `mvconvert.rs:777`). mpegts.js reads a clean end
  as "loading complete", and the tile listens only for `playing`,
  `waiting` and `error` (`MultiviewTile.tsx:330-332`). The tile freezes on
  its last frame with no failure and no Retry. *Measured* against the real
  proxy for all four upstream cases.
- **R3. A hung ffmpeg is held forever.** There is no timeout on ffmpeg's
  output after its first bytes (`mvconvert.rs:773-784`). *Measured:* the
  response still open at 45s, the provider connection still held at 40s.
- **R4. A silent freeze spins forever.** Nothing watches for progress: a
  stream that stops sending shows Buffering until someone acts, and a
  decoder that sticks while bytes flow shows a frozen picture with LIVE on
  it. (The known gap that started the audits.)
- **R5. Closing a tile doesn't close its stream.** `close()` only forgets
  the token (`mvproxy.rs:171-179`); the provider connection goes when the
  webview closes its socket, and mpegts.js on a buffering stream waits for
  the next chunk before it does. Close or replace a tile on a quiet stream
  and its connection is held about 20s, so the replacement can be refused
  on a line of three. Plan 017 says "the X hands the connection back the
  moment the tile goes". *Measured:* released 18.9s after `close()` with
  the socket held, 0.4ms with it closed.
- **R6. Closing a converting tile before its first picture leaves the
  provider connected.** ffmpeg dies (`kill_on_drop`), but the feed task
  owns the provider response and isn't aborted before the `Running` guard
  exists (`mvconvert.rs:705-718, 747-765`). *Measured:* ffmpeg gone in
  53ms, the provider released after 18.1s.
- **R7. Stalker tiles reuse an expired link.** The resolved URL is kept
  for the whole visit (`MultiviewTab.tsx:384-402`) and reused by Retry,
  a profile change, and closing and re-adding the channel.
  `stalker.ts:417-418` says it must never be cached: an expired play token
  is a 403 every time, which the tile words as the line's limit. *Read.*
- **R8. The sound stays on a dead tile.** The sound tile is picked by id
  without skipping failed tiles (`MultiviewGrid.tsx:191-192`). The failed
  tile stays unmuted with the ring and "sound on", and the working one
  stays muted. Plan 017 P2 says a failed tile can't take the sound.
  *Seen, and test.*
- **R9. Three failures say the wrong thing.** Your own network going down
  reads as the channel being off the air (`mvTile.ts:120-128`; plan 017
  says "Can't reach your provider"). A refusal just after a tile's own
  connection dropped reads as the line's limit, when the other stream is
  the tile's own ghost. And a 403 on a four-tile grid reads as the line's
  limit on any line, because `atCap` is `room.left === 0`
  (`MultiviewTab.tsx:738`), which four tiles also make true. *Read.*
- **R10. Retry doesn't ask the panel again.** The connections key doesn't
  change on Retry (`MultiviewTab.tsx:294`), so the tile's own old
  connection can read as "1 elsewhere" for up to a minute. *Inferred.*

### L: the line's count and the grid you saved

- **L1. One failed poll lifts the line's limit.** A failed or timed-out
  panel poll deletes the line (`connections.ts:57-67`), and with no line
  there is no cap: Add offers up to four until the next good poll, 60s
  later. *Test.*
- **L2. Making a small tile big resets the count.** A Focus swap reorders
  the picks, which changes the connections key (`MultiviewTab.tsx:294`),
  which restarts the 25s settle and re-polls though no connection
  changed. For those 25s a line with one stream elsewhere offers Add
  again, and a fourth stream can be opened on a line of three. *Test.*
- **L3. "Elsewhere" trusts a reading by the time since the change, not
  the reading's age** (`MultiviewTab.tsx:297-302` against
  `connections.ts:81-85`). From 25s to 60s after a change the reading used
  was taken at 20s, or at mount before any tile connected, so it can
  over-count (Add off for a closed tile's ghost) or under-count.
  *Read; depends on real panel timing.*
- **L4. With an M3U and an Xtream line, the Xtream line's limit governs
  both.** `line` means "one Xtream playlist answered", not "every tile is
  on that line" (`MultiviewTab.tsx:294-296`; only Xtream is polled,
  `connections.ts:50-51`). A max-1 Xtream line reads the whole tab as
  "one stream at a time" and a Guide channel from the M3U sent to
  multi-view is dropped silently. *Read.*
- **L5. A playlist that fails to load loses its tiles for good.** When one
  of several playlists fails, the catalog carries only the others, and the
  stale-channel filter drops the failed one's picks and saves the smaller
  grid (`MultiviewTab.tsx:277-283`). Mid-game, from a background refresh.
  The same path doesn't clear the sound, and hiding a folder on an M3U or
  Stalker playlist drops its tiles too. *Test* (the real `loadLive` with
  one playlist timing out).
- **L6. A filled tile stays filled going between one and two streams.**
  The fill resets when the cell count changes, and one stream and two both
  lay out two cells (`MultiviewGrid.tsx:200-204`). Add one while the only
  tile fills the window and it tunes out of sight. *Test.* **Gone in
  v0.9.124:** one stream is one cell now, so the count changes.
- **L7. A seam drag can stick.** `dragSplit` clears only on the seam's own
  pointerup (`MultiviewGrid.tsx:176, 483-502`); press G or Enter while
  dragging and the seam unmounts with the drag still set. *Read.*
- **L8. An add can do nothing, silently.** If room drops to zero while the
  picker is open (the settle flips, a poll lands), picking a row records a
  recent, closes the picker and adds nothing (`MultiviewTab.tsx:457`).
  *Read.*
- **L9. A game tile never stops being a game.** A pick keeps its game
  forever (`MultiviewTab.tsx:418-419`): tomorrow the tile still says
  "Buffalo at Kansas City" and the tab still polls ESPN every 90s.
  *Read.*
- **L10. A stale score looks live.** When every league fails, the last
  result is kept with nothing to say it's old (`mvGames.ts:70-73`); after
  local midnight the date asked for rolls over and a late game can drop
  off. *Inferred.*

### P: what the tab costs

- **P1. The sound meter runs every frame, all session.** The loop runs
  whenever the sound tile plays (`mvLevel.ts:69-79`,
  `MultiviewTile.tsx:464-475`), though the badge it draws is invisible
  except for a 3-second flash and on hover. Each frame writes three
  properties that restart a transition. *Measured headless:* 64.8ms of
  main thread a second as shipped, 13.5 with the writes skipped while
  hidden. This is the thread that transmuxes every tile.
- **P2. Each tile keeps two to three minutes it can never use.** The smooth
  profile passes mpegts.js no config (`multiviewTuning.ts:56-60`), so its
  live cleanup keeps 120 to 180s behind the playhead; hls.js keeps all of
  it (`backBufferLength: Infinity`). Tiles can't seek. About 75 to 150MB
  a tile. *Read* (the libraries' defaults).
- **P3. The picker searches 26k channels on every render, even closed.**
  `liveWithChannels()` returns a new array each render
  (`MultiviewTab.tsx:421`), which defeats the picker's memo, which
  rebuilds a 26k-entry Map each time (`MultiviewPicker.tsx:125`): 4.4ms,
  on every idle wake, volume notch and score poll. The search box is also
  only cleared by the Dialog's own close (`MultiviewPicker.tsx:218-221`),
  so a pick reopens it on the old search. *Measured* (synthetic 26k list).
- **P4. Every render looks each tile up the slow way.** `tunedChannel()`
  parses the playlists out of localStorage and scans 26k channels, per
  tile, per render (`MultiviewTab.tsx:426-438`). 0.9ms for four tiles.
  *Measured.*
- **P5. The score poll asks every league.** With the picker closed only the
  grid's games matter, but it re-asks every league that answered
  (`mvGames.ts:58-68`): about 20 requests every 90s. *Read.*
- **P6. The audio context outlives the tab** (`mvLevel.ts:17, 46`): its
  render thread keeps running after you leave for the Guide. *Read.*
- **P7. A window resize is an IPC call per event**
  (`MultiviewTab.tsx:155-161`), about 60 a second while dragging. *Read.*

### U: the keyboard, screen readers, and layout

- **U1. Focus falls to the page after the picker or a close.** The picker
  is a fresh Dialog each time with no trigger to return to
  (`MultiviewPicker.tsx:215-222`); the next Tab starts over at the nav.
  Same after a tile's X. *Seen.*
- **U2. The volume slider shows no focus.** `input:focus-visible { outline:
  none }` (`ui.css:228-231`) is meant for text fields and catches
  `type=range` too. *Seen.*
- **U3. The bar never dims after a shortcut straight after entering the
  tab.** The nav pill keeps keyboard focus, and `.header :focus-visible`
  counts as busy (`MultiviewTab.tsx:114-116`). *Seen.*
- **U4. A keyboard-focused tile keeps its chrome over the picture while
  idle** (`player.css:1561-1566`: hover waits for the bar to be awake,
  focus doesn't). Worst in fill. *Seen.* **Decision D1. Done in v0.9.124:**
  the chrome rests with the bar, the ring stays, a key brings it back.
- **U5. A long channel name pushes "what is on" out of the caption.** The
  name's `flex: 0 1 auto` wins over the programme's `flex: 1 1 0`
  (`player.css:2002-2022`): 8px left for it at 1400, none at 1000.
  *Seen.*
- **U6. The connection meter isn't there for a screen reader, and on a
  narrow window it's bare dashes.** The label sits on a span with no role
  and both children are hidden (`MultiviewTab.tsx:613-629`); below about
  1460px the words go and nothing replaces them. Grid and Focus lose their
  words there too, with no tooltip. *Seen.*
- **U7. "Can't play this here" has no way forward on the card.** It says
  the Guide's player can, and the only button on a failed card is Retry,
  which this failure doesn't get (`MultiviewTile.tsx:510-523`). Watch in
  player and Replace are hover icons. *Seen.*
- **U8. "Swap for …" overflows.** `.mvtile__pickword` asks for 38px and
  the later `.mvchip` rule wins at 30px, with no wrap control
  (`player.css:1591-1597, 1622-1632`): three lines in a 30px pill at
  1000px. *Seen.*
- **U9. At 1000px the bar meets the capsule:** 3px apart with a stream, 6px
  over it in pick-a-tile mode (target 16px, `MultiviewTab.tsx:215`).
  *Seen.*
- **U10. The picker dims rows with opacity, and can highlight a row you
  can't pick.** `opacity: 0.55` on disabled rows (`player.css:1887-1890`)
  breaks the no-opacity-text rule (2.9:1). When every Favorite is in the
  grid, it opens on a disabled row and Enter does nothing. *Seen.*
- **U11. Reduced motion doesn't stop overlays zooming, app-wide.** The
  guard in `index.css:169-182` is wrapped in `:where()`, which has no
  specificity, so a component's `zoom-in-95` beats it. The picker even
  zooms further under reduced motion (from 0.95, since it drops its own
  0.98). Every shadcn overlay with a zoom utility has the same bug.
  *Seen* (the picker's keyframes).
- **U12. Focus is Grid at one and two streams.** Focus is offered from two
  cells (`mvLayout.ts:55-57`), which one stream plus the add place makes,
  and the natural split of a one-tile stack is equal. Same tile sizes
  either way. *Seen.* **Decision D2. Done in v0.9.124,** with Adam's two
  calls on top: Focus is offered from two streams and is what a grid of
  two or more opens in, and one stream has no add place beside it, so it
  fills the stage (the bar's Add, or A, adds the next).
- **U13. Small ones:**
  - the seam is last in Tab order, after every tile;
  - the default near-white accent makes the sound's flash ring look like a
    focus ring;
  - the seam's tip says "double-click to reset" after a keyboard move;
  - picker rows read the quality badge twice ("Fake Sky Sports FHD FHD").

### N: the proxy's hygiene

- **N1. HEVC with a long programme map is never converted.** The PMT is
  read only when it fits in one 188-byte packet (`mvconvert.rs:140-150`).
  A channel with many audio tracks and descriptors can need two, every
  time, so the proxy gives up at 2MB and passes HEVC to a webview that
  can't play it. *Measured* on a built stream (15 audio tracks, a 192-byte
  PMT). How common that is on real feeds is unknown.
- **N2. ffmpeg's log stops at the first non-UTF-8 byte** (`lines()`,
  `mvconvert.rs:719-721`): a Latin-1 service name ends the log, including
  the colour-tag lines, and a conversion that fails early reports "stopped
  before any output" instead of ffmpeg's reason. *Measured.*
- **N3. The proxy holds idle connections forever.** No header-read or idle
  timeout (`mvproxy.rs:138-143`). *Measured:* 501 of 501 held after 40s.
  Low impact: loopback only.
- **N4. Every reply says `Access-Control-Allow-Origin: *`, 404s included**
  (`mvproxy.rs:187-201`), so a web page in any browser on the machine can
  tell that multi-view has run this session. It can't reach a stream
  without the 128-bit token. *Measured.*
- **N5. The bundled ffmpeg is unpinned and unverified.** It ships
  shinchiro's latest with no version or hash check
  (`scripts/fetch-ffmpeg.mjs:34`); CI can test one build while a release
  bundles another. `fetch-libmpv.mjs` has the same shape. *Read.*
- **N6. A failed capability check is kept for the whole run**
  (`mvconvert.rs:564-592`) while the tile still offers a Retry that can't
  help. *Read.*

### Not in this plan

- **The focus ring's contrast** (about 1.9:1 over a tile,
  `ui.css:221-224`): Adam's call on the ring, and plan 016 3.1 already
  makes it solid. It lands with M2's tokens.
- **The fourteen plain `<button>`s and the raw whites on the stage**
  (plan 014's drift). They move to the primitives with M2. The raw whites
  would vanish in light mode, which can't be reached yet (016 D1).
- **mpegts.js's worker.** No evidence it's needed: three tiles dropped 0
  frames. P1 and P3 are the main-thread costs the audits found.
- **Four tiles.** Adam's line caps at three.
- **The Sports theater growing into multi-view.** A feature, mocked up and
  waiting on Adam's calls.

What the audits found clean, so it isn't re-audited: the proxy is not an
open proxy (loopback bind, 128-bit tokens, the Host header checked, only
http and https at every redirect hop); ffmpeg's arguments are fixed and
never see a URL; nothing from the network can panic it; every tile's proxy
open is paired with a close on unmount, Replace, the X, a URL change, Retry
and a StrictMode double-run; Escape does one thing per press; every key in
017's table works; every picture is 16:9 at every size.

---

## Build order

Each phase ends green with a check that fails without each fix, and a
version bump.

### H1. Tiles that recover (native and frontend: a rebuild)

R1 to R10. One version: they are the same code paths.

**The proxy never ends a live stream cleanly.** A provider EOF, a read
timeout, a feed error and ffmpeg exiting all end the body with an error,
so every ending reaches the tile's error path (R2). ffmpeg gets an output
timeout after its first bytes (R3). `close()` aborts the route's upstream
and its ffmpeg, so the connection goes when the tile does (R5), and the
feed task is aborted if the handler goes before the first bytes (R6).

**The tile.** `fail()` destroys the player (R1). A watchdog on progress,
not on events: the buffered end growing and decoded frames counting,
since `waiting` lags a stop by the whole 6 to 14s cushion and
`currentTime` keeps moving on audio alone (R4). On no progress, or an
error, it reconnects: two tries, then the failure with Retry, the budget
refilled by a first frame. The theater's loop is the model
(`TheaterOverlay.tsx:544-625`).

**The line's own ghost.** A panel takes up to about 20s to notice a
dropped connection, so on a full line a reconnect before then is likely
refused by the tile's own old connection; the theater's 10s and 20s
timing would die just as the ghost clears. Rather than guess at the
panel's timing, a reconnect on a full line waits until the panel's own
count shows a free slot, asked every few seconds while a tile is down, up
to a ceiling, and a refusal before then doesn't count against the budget.
The line is then never asked for more than it allows, so whether a panel
refuses the extra stream or drops the oldest never comes up. (Adam's test
hit multi-view's own limit, which is the same rule.) When several tiles
fail at once (the network,
the PC waking), reconnects are staggered through the tile registry
(`multiviewTuning.ts:89-99`). A Stalker tile resolves a fresh link on
every reconnect (R7). The panel is asked again after a reconnect or a
Retry (R10).

**The sound** never sits on a dead tile, and moves to the next live one
when its tile dies (R8). **The words** (R9): your network down is "Can't
reach your provider"; a refusal inside the ghost window says it's waiting
on the line, not that the line is full; four tiles is the ceiling, not the
line.

*Proof:* host-crate tests for each proxy ending (an error, never a clean
end), ffmpeg going silent, and `close()` releasing the provider inside a
second on both paths. Unit tests for the watchdog as a pure function of
its inputs (progress, errors, time, the line) and for the sound. A harness
on a fake stream that ends, then one that stalls, then one that keeps
dying: the tile reconnects and plays, then shows the failure with Retry
once its budget is spent; the sound leaves a dead tile.

**Shipped in v0.9.125 (native: a rebuild).** Where it differs from the
above, or says more:
- **The proxy** (R2, R3, R5, R6). Every response goes through `live_body`:
  the stream until `close()` drops the route, and never a clean end, so
  a provider EOF, a read timeout and ffmpeg exiting all reach the tile as
  a dropped connection. `close()` ends a route by dropping the only
  sender of a watch channel its responses listen on. ffmpeg's output
  times out after 20 seconds (`output`), and the feed and log tasks stop
  when their handle drops (`Stops`), from the moment they are spawned.
- **The budget** (mvRecover.ts): three reconnects, refilled by a minute of
  picture; a freeze is 12 seconds without a decoded frame while the tile
  can be seen and isn't paused, counted only once a frame has really
  moved; the gate waits up to 45 seconds for a slot and spaces
  reconnects 1.5 seconds apart. The gate is `passGate`, a pure function
  of its clock, the line and a fresh-link step, so its rules are unit
  tested.
- **Only a tile that has played reconnects.** One that fails on its first
  connection (off the air, refused, a codec) says so at once, as before;
  the same thing again straight away rarely goes differently.
- **Retry by hand goes through the same gate,** with a full budget. On a
  full line it waits for a slot, and says so, rather than being refused
  again.
- **The sound** moves in sound only: in Focus a dead tile keeps the big
  place. Moving it would reorder the grid under you while a tile comes and
  goes.
- **R9's first case** turned out to be wider: the provider's own server
  failing (no redirect in the proxy's reason) is "Can't reach your
  provider", whether its name didn't resolve, it refused, or it was slow.
  Only a server the provider sent the stream on to is the channel off the
  air.
- **R10** is the fast poll: the panel is asked every 4 seconds while a
  tile waits, and once at once when none does.

### H2. The line's count and the grid you saved (frontend)

L1 to L10.
- A failed poll keeps the last good reading, marked old, rather than
  dropping the cap (L1).
- The connections key is the set of channels, not their order (L2).
- "Elsewhere" is trusted by the reading's own age (L3).
- The line's cap applies to the tiles on that playlist only (L4).
- A pick is dropped only when its playlist loaded and the channel isn't in
  it; a failed playlist's tiles wait for it (L5). Dropping a pick moves the
  sound properly. Hidden folders don't drop tiles.
- The fill resets on the stream count (L6).
- The seam drag clears when the seam unmounts (L7).
- A pick that can't be added says why and keeps the picker open (L8).
- A game tile goes back to a channel tile a while after its game ends, and
  its league leaves the poll (L9).
- A score says when it's old (L10).

*Proof:* unit tests for each rule in `mvGrid.ts` and `connections.ts`,
turned from the audit's proof tests (which assert today's behaviour) into
tests of the right one. verify-mvfill gains the one-and-two case.

**Shipped in v0.9.126.** Where it differs from the above, or says more:
- **The rules are pure** in `mvGrid.ts` (`countKey`, `lineFor`,
  `settledOn`, `goneFrom`, `gameOver`) and `connections.ts`
  (`foldReading`), unit tested, and wired into the tab.
- **L1 and L3 share a change:** every reading carries when it was taken.
  A failed poll now throws out of `fetchConnections` (its only caller was
  the hook) and leaves the last reading standing. The Live sidebar and
  Sports get that too. "Elsewhere" is believed from a reading taken 19
  seconds or more after the grid last changed. The tab also asks once
  more 20 seconds after it opens, so that isn't a minute away.
- **L4 is the simple form:** the line's limit holds while every tile is
  on it. With a tile from another source there is no single limit, and
  Add is offered up to four, as with several lines.
- **L5 went further than the tab.** M3U and Stalker now keep what a
  folder the user hid holds, as Xtream always has (never an adult one),
  so hiding a folder in the Guide no longer deletes its multi-view tiles.
  The Sports matcher gets the same fallback on those sources. Kept M3U
  channels are numbered apart, so keeping them changes no visible
  channel's id, and one that would share a visible channel's id isn't
  kept. Hiding a folder can still renumber a later channel sharing a
  tvg-id with one in it, as it always could; numbering them all together
  would fix that, at the cost of renumbering once for anyone it affects.
- **L6** went in v0.9.124 (one stream is one cell).
- **L8:** a pick that finds the line full turns into picking the tile it
  replaces, as a channel sent from the Guide does.
- **L9** needs to know when a game started, so a game pick carries
  `start` from now on. A pick saved before that goes when the board no
  longer has its game.
- **L10** says "as of" once a score is five minutes old (three looks
  missed). The midnight half of L10 (a late game leaving the new day's
  board) is not done: a game with `start` keeps its tile until 12 hours
  after it began, so the tile stays and only its score stops.

*Proof:* verify-mvline (new):
- a failed poll keeping a full line full
- a failed playlist keeping its tiles
- an add on a filled line asking which tile it replaces
- a long-over game tile going back to its channel
- an old score saying so

verify-mvseam: a drag held through G. Unit tests: the rules above, and
M3U and Stalker keeping hidden folders aside. Mutations: 14 of 14. The
failed-playlist check first passed on an empty page (no catalog, so
nothing was judged); it now loads an M3U beside the failed line and
checks the picker lists it.

### H3. What the tab costs (frontend)

P1 to P7.
- The meter's loop runs only while its bars can be seen (P1).
- The back buffer is capped: about 30s for mpegts.js, and
  `backBufferLength` for hls.js (P2).
- The picker's inputs are memoised, and closing it any way clears the
  search (P3).
- The tile lookup is one index per catalog (P4).
- The score poll asks only the grid's leagues while the picker is closed
  (P5).
- The audio context suspends when no tile needs it (P6).
- The fullscreen question is asked once per resize settle (P7).

*Proof:* the audit's measurements re-run before and after, with the
numbers in the commit. A harness check that the meter's frame loop stops
when the badge hides (a counted `requestAnimationFrame`). The picker
reopens on an empty search.

**Shipped in v0.9.129.** Where it differs from the above, or says more:
- **P1 was measured in the app**, not a synthetic page: three tiles on
  verify-mvsound's tone, the badge hidden, the pointer on the bar. Main
  thread 81.9ms a second before, 25.8 after; the frame loop and the style
  recalcs it caused 60 a second before, 0 after. The badge's conditions
  are mirrored in the tile (the flash, or hover with the tab awake; not
  muted, not picking), which needed the tab's idle passed down.
- **P6 rides on P1:** the context runs only while the bars are measured,
  so it rests behind a hidden badge as well as on the Guide.
- **P2 is 30s**, trimmed to 20, for both profiles and hls.js. The
  audit's 120 to 180s was right: `isLive` turns mpegts.js's cleanup on at
  those defaults. Not measurable here (nothing decodes headless).
- **P3 and P4 share one index**, `channelIndex` in mvGrid.ts, per catalog.
  The picker asks it for visible channels only, as it always offered; the
  tiles ask with hidden ones, as tunedChannel had them. The audit's
  benchmarks re-run: the picker's 26k Map was 3.9ms per memo run, and ran
  on every render of the tab; now once per catalog, and nothing while
  closed. Four tiles' lookups were 0.81ms a render; now four Map gets.
- **P5 keeps one cache:** a look at only the grid's leagues replaces those
  leagues' games in the last full look (`mergeLeagues`), so the picker
  still opens on the whole list, and a full look runs as it opens if the
  last one is a poll old.
- **P7 waits 150ms** for the window to hold still.

*Proof:*
- verify-mvsound: the bars written and the context running only while
  the badge shows, and resting after the tab is left.
- verify-mvgames: with the picker shut and following nothing, only the
  grid's two leagues are asked; opened, all 149.
- verify-mvpick: after a pick, the picker opens again on an empty search
  (mutated: fails with the clear removed).
- verify-multiview: 12 resizes ask about full screen once.
- Unit tests: `mergeLeagues`, and the back buffer in both profiles.

### H4. The keyboard, screen readers, and layout (frontend)

U1 to U13.
- Focus comes back to what opened the picker or held the closed tile, or
  to the next tile (U1).
- The range input gets a ring (U2).
- The nav pill loses its focus on a shortcut (U3).
- U4 per decision D1.
- The caption shares its width (U5).
- The meter gets a role and name, and a tooltip when it's only dashes, as
  Grid and Focus do (U6).
- The can't-play card gets Watch in player on the card (U7).
- The swap pill fits (U8).
- The bar keeps its 16px at 1000 (U9).
- Disabled rows use a muted colour, and never open highlighted (U10).
- The reduced-motion guard wins app-wide (U11).
- U12 per decision D2.
- The small ones (U13).

*Proof:* checks in verify-multiview, verify-mvpick and verify-mvsound for
each: the focused element after each close, the ring's outline, the idle
state after a shortcut, the caption widths at 1000 and 1400, the meter in
the accessibility tree, the pill's height, the bar's clearance, the
picker's keyframes under reduced motion. The reduced-motion fix gets one
check on another overlay too, since it's app-wide.

**Shipped in v0.9.130.** Where it differs from the above, or says more:
- **U11's cause was not `:where()`.** The guard is unlayered, so it wins
  over the utilities whatever its specificity. It never MATCHED: shadcn
  writes `data-[state=open]:animate-in`, and `.animate-in` found one
  component of nine. Measured first: the picker and the Guide's right-click
  menu both started from a scale of .95 under reduced motion. The guard
  now matches the class attribute, and both start from 1.
- **U1** remembers what had focus as the picker opens, and hands it back
  in `onCloseAutoFocus`; when a replace took the opener with it, the tile
  in its place. A closed tile that held focus passes it to the next one,
  or the one before when it was last, or the place to add one.
- **U3** releases the header only for a key the tab or the grid took
  (`releaseHeader`), not for one the nav handled itself.
- **U5** caps the name at 55% only when a programme sits beside it.
- **U6:** the meter is a named image; at a compact width it, Grid, Focus
  and the pick-a-tile Cancel say their words in a tooltip.
- **U9:** with streams the bar already had 20px at 1000; picking a tile
  ran 6px into the capsule. Compact, Cancel drops its "Esc" (said on
  hover): 21px.
- **U10** sorts a section with nothing left to add below the rest (Base UI
  does highlight a disabled first row: the mutation shows it), and mutes
  disabled rows by colour.
- **U13:** the seam sits after the big tile in the DOM; its tip names `\`
  after a key; keyboard focus is a second ring outside the sound's; the
  quality badge is hidden from screen readers everywhere, since the
  quality is always read out of the name beside it.

*Proof:* verify-mvaccess (new, 22 checks), one section per finding. Two
mutated, both caught: U3 (the header kept) and U10 (the order kept).

### H5. The proxy's hygiene (native: a rebuild)

N1 to N6.
- The PMT is reassembled across packets (N1).
- ffmpeg's log is read as bytes, lossily (N2).
- The server gets header and idle timeouts (N3).
- CORS only on a stream's own response (N4).
- ffmpeg and libmpv are pinned to a release with a hash (N5).
- A failed capability check is asked again on the next tile (N6).

*Proof:* host-crate tests for each (a two-packet PMT converts; a Latin-1
name keeps the log; an idle socket is closed; a 404 carries no CORS). The
fetch scripts refuse a hash that doesn't match.

N1 moves into H1 if Adam meets an HEVC channel that stays unplayable.

**Shipped in v0.9.131 (native: a rebuild), N5 apart.** Where it differs
from the above, or says more:
- **N1** gathers a PAT or PMT across the packets its PID carries,
  following the continuity counter; a missed packet drops the section and
  the next copy starts over. Measured on the audit's built stream (HEVC
  and 15 audio tracks, a 192-byte PMT): v0.9.130 still read "need more"
  at 2MB, and gave up; now HEVC is found in the first 64KB.
- **N2** reads ffmpeg's log as bytes, each line made text lossily
  (`follow_log`).
- **N3:** a 10-second header-read timeout, hyper's own, with the timer it
  needs. It covers the idle wait between requests too.
- **N4:** CORS only on a live route's replies (the stream, the provider's
  own status, the 502 with its reason, a preflight). An unknown token, a
  rebound host and a method nobody sends get a bare reply.
- **N6** keeps the capability check only when it worked; a failure stands
  for 30 seconds, then the next tile or Retry asks again (`caps_with`).
- **N5** shipped after v0.9.131, in the build scripts only. shinchiro
  keeps about 30 builds (the tags run from 2026-06-02 to 2026-09-26 on a
  years-old repo), so a pin to its downloads would stop working a few
  months on. Adam's call: keep our own copy. The "Mirror bundled binaries"
  workflow (`deps.yml`, `mirror-deps.mjs`) copies one shinchiro build's
  two archives into a `deps-<tag>` release here, a prerelease and never
  "latest", and commits their SHA-256 to `scripts/deps.json`.
  `fetch-ffmpeg.mjs` and `fetch-libmpv.mjs` take only that, and refuse a
  file whose hash doesn't match or a missing pin. CI's ffmpeg is the same
  file. First pin: `deps-20260926`. A push that asks for the build already
  pinned does nothing, so merging `deps-request.txt` into main can't
  re-pin.

  *Proof:* the workflow's first run made the release, and GitHub's own
  digest of each asset matches the pin. From here, both real archives
  download and pass the check; a wrong file served in the pinned one's
  place is refused with both hashes; with no pins both scripts refuse;
  a push run asking for the pinned tag exits before any request. The
  updater's "latest" is still v0.9.0, and the Discord post didn't fire.

*Proof:* host crate, 33 tests, 5 new: a PMT across two packets with
another PID between, one missing its second half, a Latin-1 log line with
the reason after it, a socket that sends nothing closed within a second
(the test's timeout) and not at all without it (mutated), a failure
asked again and a good answer kept. No CORS on an unknown or closed
token's 404 or an OPTIONS to one; a provider's 403 keeps it. Clippy at 9,
the Windows type check clean.

---

## Decided (Adam, 2026-09-25)

- **D1 (U4):** a keyboard-focused tile rests with the bar. Shipped v0.9.124.
- **D2 (U12):** Focus from two streams. Shipped v0.9.124.
- **A grid opens in Focus** wherever Focus is offered, and choices saved
  under the old default start over once. Shipped v0.9.124.
- **One stream fills the stage;** the add place beside it is gone.
  Shipped v0.9.124.
- **The over-limit test:** not needed. A reconnect waits for the panel to
  show a free slot (H1), so the line is never asked for one too many.

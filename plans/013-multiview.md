# 013: multiview, four sports at once

**Status: phase 1 SHIPPED in v0.9.48, phases 2-4 to build.** Scoped
2026-09-08 with Adam, who set both parameters: **2x2**, and **sports only**
for now.

Four games in a 2x2 grid inside the sports theater. One tile has the audio
and the player controls; the other three are muted video. Click a tile to
move both.

## The architecture, and why the alternatives are not choices

Four child windows, four mpv instances, extending the inverted-layer
arrangement `inv.rs:1` has used since v0.1.132. Each tile is its own HWND
parked at `HWND_BOTTOM` with its own mpv bound to it, and the frontend cuts
four clip-path holes instead of one.

Two other shapes were considered and neither survives contact:

- **One instance, mpv's own `lavfi-complex` tiling.** No Rust refactor at
  all, and it fails on the thing this feature is for. One filter graph means
  one dead IPTV stream takes the whole grid down, tiles cannot be swapped or
  focused independently, and four live sources with different latencies have
  no way to stay in step. Sports streams die mid-game; that is the premise
  the whole sports feature is built on (see matcher.ts's MIN_CONFIDENCE
  note).
- **Webview `<video>` elements.** Throws away hwdec, the mpv quality path
  and the entire player stack. This is what the comp.rs overlay subsystem
  was, and it was deleted at the v0.2.0 milestone for these reasons.

## The decision that kept phase 1 small: a focused slot

There are two dozen public functions in `mpv.rs` and a dozen take the player
lock. Threading a slot argument through all of them would have touched every
caller in `lib.rs`, `tauri.ts`, `InvertedPlayer` and `StreamScreen`, for a
feature only the sports grid asks for.

Instead there is one `FOCUS: AtomicUsize`, and every command that does not
name a slot addresses it. The grid moves that number; pause, seek, tracks,
volume, shaders, screenshots and the status poll all follow it without
knowing tiles exist. Single-stream playback is slot 0 with `FOCUS` at 0,
which is byte-for-byte what the app did before.

**It is also what keeps the status poll affordable, and that is not a bonus.**
`mpv_status` is a 500ms SYNC command that runs on the UI thread, and it
already carries its own perf instrumentation block (`mpv.rs:130`) because it
was expensive at ONE player. Polling four would be four times that on the
same thread, in a feature whose whole point is four decoders competing for
the machine. Polling the focused slot alone keeps it at exactly today's
cost.

The one place the distinction has to be explicit is `reset_per_file`: the
grid loads a tile while you are listening to a different one, so the
per-file reset has to reach the slot being LOADED. Hence `set_prop_on`.
Sending `pause=no` to the wrong instance is precisely the failure that
function's own pause comment is about.

## THE RISK THAT DECIDES WHETHER THIS WORKS AT ALL

**Four tiles is four provider connections.** `mpv.rs`'s `unload` doc calls
one-connection-at-a-time "the app's invariant" and says a `max_connections=1`
line outright FAILS to tune when a second stream is open. Multiview breaks
that invariant deliberately and by a factor of four.

Most IPTV lines cap at 1 or 2. If Adam's caps below 4, the grid cannot work
and no amount of frontend care changes it.

We do not have to guess: `parseConnections` in `data/xtream.ts` already
reads `active_cons`/`max_connections` off the panel, and the Live sidebar
already shows the n/m badge. **Phase 2 gates on it.** A line that cannot
carry four tiles gets told so in a sentence, rather than three black
rectangles and no explanation.

Second risk, smaller and unmeasured: four `hwdec auto-safe` decoders. Fine
at 1080p on anything modern, unknown at 4x 4K on a modest GPU. And four
streams is four times the bandwidth, so a provider that buffers occasionally
buffers four times as often. Both want a real machine to answer; neither
blocks building.

## Phases

**Phase 1 — the slot foundation. SHIPPED v0.9.48.** A pure refactor with no
behaviour change: single-stream playback occupies slot 0 and everything is
as it was.

- `inv.rs`: `CHILD` becomes `CHILDREN[SLOTS]`; `open`/`ensure_child`/
  `set_rect` take a slot, and the four loose rect numbers become `Rect`.
  `close_slot` stops one tile; `close` still stops everything.
- `mpv.rs`: `PLAYER` becomes `PLAYERS[SLOTS]`, `PLAYER_WID` becomes
  `PLAYER_WIDS[SLOTS]`, plus `FOCUS`, `set_focus`, `unload_slot`,
  `set_prop_on`. `unload` and `shutdown` cover every slot, because "stop
  playing" has to mean the whole grid or leaving multiview leaks three
  sockets.
- `lib.rs`: `inv_open`/`inv_set_rect` gain an OPTIONAL `slot`, so every
  existing caller works untouched. New `inv_focus` and `inv_stop_slot`.
- `hole.ts`: `holesClip` cuts N holes with the same nonzero winding trick.
  Nonzero rather than evenodd is load-bearing here in a way it was not for
  one hole: tiles that touch still read as one continuous opening instead of
  cancelling back to opaque.

Verified: Rust type check clean at the 9-warning clippy baseline, 787 unit
tests, 25/25 harnesses. NOT verified, and cannot be from Linux: that four
mpv instances actually render into four child windows. That is what phase 2
finds out.

**Phase 2 — the grid.** A `MultiviewGrid` that lays out four tiles, drives
`inv_set_rect` per slot off the same rAF contract `InvertedPlayer` uses,
sets the shell clip-path with `holesClip`, and routes clicks to
`inv_focus`. Gate on `max_connections` first: build the refusal before the
grid, so the failure mode is a sentence rather than a mystery.

**Phase 3 — filling it from sports.** Picking four games is the interesting
half and it is a sports problem, not a player one. The board already knows
what is live and which of your channels carry it; a game with several
matches already offers several. The obvious first cut is "send these four
live games to multiview" off the board.

**Phase 4 — tiles that die.** A tile whose stream drops shows black and
nothing says why. The single player has a tune watchdog; the grid needs a
per-slot liveness read at a slower cadence than the 500ms poll, for the
reason phase 1 gives about the UI thread. Deliberately last: a first cut
where you click the dead tile and retune is honest, and shipping the grid
teaches us how often it actually happens.

## Notes for whoever builds phase 3

`matcher.ts` currently lists `multiview` in its QUALIFIERS set, so a channel
named "... Multiview" is rejected as a different channel from its bare name.
That is correct today and will need revisiting when there is a grid to put
those channels in. Adam's provider ships real material for this: `USA | NFL
Multi Screen / HDR` is 20 channels, and the Apple TV F1 folder carries 50
feeds of a single race (driver cams, driver tracker, mixed on-board).

# 012: stop asking mpv, let it tell us

> **CLOSED 2026-08-08. Phase 1 shipped and verified; everything else cut.**
>
> One persistent mpv instance landed in v0.8.168-172 and is confirmed on a
> real machine: the provider connection releases on unload, channel switches
> show black rather than the desktop, and several hundred switches leave no
> leak and no stuck demuxer.
>
> The event loop, the observer state migration and the list-count gating were
> all cut by phase 0's measurement — they existed to remove a UI-thread cost
> of **0.08% of one core**. The one surviving idea, a faster poll for scrubber
> smoothness, was **declined by Adam**: the scrub drag was already fixed in
> v0.8.165, and a progress bar that steps twice a second is not worth another
> change to the player. Nothing here is pending. Reopen only if the clock's
> granularity actually starts to annoy someone.

**Status: phase 1 SHIPPED, the rest cut or reduced.** Written 2026-08-08 after benchmarking against
Stremio, which Adam named as the bar for player quality. The finding is
architectural and it explains both symptoms he reported — jank during
playback, and seeking/scrubbing feel — with one mechanism.

## Three findings, and the second one reorders the plan

1. **They push, we poll.** (Below.)
2. **They keep ONE mpv handle for the app's lifetime. We destroy and recreate
   it on every stream switch.** This turned out to be the bigger finding: it
   explains channel-switch latency AND it is the reason the event thread
   looked dangerous. See "The handle" below.
3. **We already match them on rendering** — and did so deliberately.
   `inv.rs:1` calls it "the Telly arrangement, spike-proven in v0.1.115 and
   THE architecture since v0.1.132": mpv as a child window at the bottom of
   the z-order, transparent webview above, clip-path hole. That is the same
   direct-render approach stremio-shell-ng cites as its 2-5x win over Qt. The
   expensive-to-get-right half is already done and needs no work.

So this is not "catch up with Stremio". It is one axis of state transport and
one lifecycle decision.

## The handle: the finding that de-risks everything else

`Player::build_partial()` in stremio-shell-ng calls `create_mpv()` **exactly
once**, wraps it in `Arc<Mpv>`, and shares it across threads. New videos are a
`loadfile` command on that same instance. The event thread spawned by
`create_event_thread()` runs until `Event::Shutdown`. **`mpv_terminate_destroy`
is never called between videos.**

Ours, `mpv.rs#play_wid`, does the opposite on every single tune:

```rust
stop();                 // terminate_destroy
stop_popout();
let h = (l.create)();   // a brand new handle
```

and the function's own comment names the cost:

> teardown is the OLD stream letting go (`terminate_destroy` blocks until its
> demuxer and network threads unwind, **and this runs on the UI thread**)

Two consequences:

- **Channel-switch latency is partly self-inflicted.** Every switch pays a
  full libmpv teardown plus create plus initialize, synchronously, on the UI
  thread, before `loadfile` is even queued. `play_wid` already instruments
  these three phases separately — that timing has never been read either, and
  it belongs in phase 0 alongside `playerPerf()`.
- **It is the whole reason the event thread looked scary.** The `wait_event`
  vs `terminate_destroy` hazard documented at `mpv.rs:267-311` only exists
  because handles die. With one persistent handle the event thread is
  spawned once, lives forever, and the race cannot occur. Stremio does not
  solve that problem; it does not have it.

**Therefore the persistent handle comes FIRST**, before any event work. It is
independently valuable (switch latency), and it converts phase 1 from the
riskiest step into a routine one.

### Decided: ONE player, shared by Live and VOD

Asked 2026-08-08: with a persistent handle, should Live TV and VOD share one
instance or get one each?

**One, shared.** The deciding facts, all from `play_wid`'s own option list,
every one of which is set BEFORE `mpv_initialize`:

```rust
set("wid", &wid.to_string());     // <- INIT-ONLY
set("hwdec", "auto-safe");
set("d3d11-flip", "no");          // when composited
set("audio-channels", "stereo");
set("terminal", "no");
set("start", &start.to_string()); // <- per-FILE, wrongly global; see below
```

- **Nothing here differs by content type.** `hwdec`, `audio-channels` and
  `d3d11-flip` are properties of the machine and the compositing path, not of
  whether the content is live or on-demand. A split would buy nothing at the
  mpv layer.
- **`wid` is init-only**, so it permanently binds a handle to one child
  window. Two handles therefore means two child windows in `inv.rs` — their
  own creation, z-order, visibility and resize plumbing — for no measured
  gain.
- **"One provider connection at a time" is already an app-wide invariant**
  that `play_wid` defends by calling `stop_popout()`. It exists because a
  `max_connections=1` line fails outright when two streams open. Two
  simultaneous players is in tension with a rule the code actively enforces.
- Stremio runs exactly one instance and serves both streaming and local files.

**When two would be right, for the record:** if we wanted a live channel to
keep buffering while the user browses VOD, so returning to it is instant.
That is a real feature and worth its own decision later — but it doubles idle
memory and contradicts the one-connection invariant, so it must be chosen
deliberately, not inherited as a side effect of this refactor.

### `start` and `composited` are dead on the in-app path

First read of this said `start` was a migration bug in waiting. **It is not** —
corrected here so the plan does not carry the wrong warning.

`play_wid` has exactly ONE caller:

```rust
crate::mpv::play_wid(url, child.0 as isize, false, 0.0)   // inv.rs:79
```

`composited` is hardcoded `false`, so `d3d11-flip` is never set on the in-app
path. `start` is hardcoded `0.0` and the option is guarded by
`if start > 0.0`, so it never fires either — its comment ("resume when
reclaiming from the popout") describes a path that now routes through
`inv_open` with 0.0 and resumes by seeking after load instead.

So neither is a hazard for the persistent handle, and both are candidates for
deletion. The per-file state that DOES need explicit resetting is `speed`,
`aid` and `sid` — see below — because those are set at runtime by the user
rather than at create time.

The general principle still holds and is still the template: anything set as
a global option that is really about *this file* must move to the load path.
It just happens that the two parameters that look like instances of it are
already inert.

### What currently depends on handles dying

A fresh instance per stream resets mpv state for free, and the code leans on
that. `TheaterOverlay.tsx:255` says so outright:

> Playback speed (VOD menu). A fresh mpv instance per stream means the real
> rate resets to 1 on every switch — mirror that locally below.

And `mpv_diag` (`lib.rs:340`) already flags the murk:

> do `aid`/`sid`/`speed` survive a same-url reload? Nothing re-applies them,
> and `speed` has no reconcile channel at all.

With a persistent handle, `speed`, `aid` and `sid` would carry across
streams. That is a real behaviour change: start a 1.5x VOD, switch to a live
channel, and it plays at 1.5x. Every one of these must be reset explicitly on
`loadfile` — which is strictly better than relying on the side effect of
destroying a handle, but it has to be done deliberately and tested.

## The polling finding

**Stremio's player is entirely event-driven. Ours polls.**

Stremio's Qt shell (`Stremio/stremio-shell`, `mpv.cpp`) registers properties
with `mpv_observe_property(mpv, 0, name, MPV_FORMAT_NODE)`, installs
`mpv_set_wakeup_callback`, and drains with `mpv_wait_event`. There is no
timer anywhere in it. Property changes arrive as `MPV_EVENT_PROPERTY_CHANGE`
and are re-emitted as signals the UI subscribes to. The property set is not
hardcoded — the JS layer declares what it wants observed.

Their newer shell is even more relevant: **`Stremio/stremio-shell-ng` is
"Stremio shell using WebView2/mpv, written in Rust"** — our exact stack, mpv
rendering directly into the window rather than through a UI toolkit. Its
`src/stremio_app/stremio_player/player.rs` runs a **dedicated event thread**:

```rust
mpv_event_client.wait_event(0.1)
```

with properties registered dynamically at typed formats (`Format::Flag`,
`Format::Int64`, `Format::Double`, `Format::String`) and state pushed to
WebView2 as RPC messages over a channel — `PlayerEvent::PropChange`.

Ours, by contrast (`useDirectOverlay.ts:108-169`, `lib.rs#mpv_status`):

- a `setInterval` every **500ms** in JS
- calling `mpv_status`, a **sync** Tauri command — which on Windows executes
  inside WebView2's callback, i.e. **on the UI thread**
- which issues ~**125 `mpv_get_property_string` calls per poll** on a real
  file (5 scalars, 5 per track, 2 per chapter, plus counts), each taking the
  `PLAYER` mutex, each allocating and copying a string
- every value **stringly-typed and re-parsed** every time
- including `track_list` and `chapter_list`, which are **static for a loaded
  file** and cannot change between polls

`mpv_observe_property` is not bound in `mpv.rs` at all. We do bind
`mpv_wait_event` and already run an event-loop thread — but only for the
**popout** instance, and only to catch `MPV_EVENT_SHUTDOWN`
(`mpv.rs:250-272`). The pattern exists in our own code; it just never reached
the in-app player.

## What this explains

Both of Adam's reported symptoms, from one cause:

**Jank during playback.** A sync command runs on the UI thread. 250
property reads a second, each taking a mutex the render path also wants,
is UI-thread work that scales with how rich the file is — which is why it
would bite VOD (a remux with 18 tracks and 14 chapters) far harder than live
TV (2 tracks, no chapters). *Unquantified: nobody has run `playerPerf()` yet.
See "Measure first".*

**Seek and scrub feel.** The clock only trues up every 500ms, so the scrubber
quantises to half-second steps and a keypress-driven seek visibly lags until
the next poll. `doSeek` already compensates with an optimistic local bump
(`TheaterOverlay.tsx`, "the poll trues it up within 500ms, but the bar
shouldn't lag the keypress") — that comment is the workaround for exactly
this. An observed `time-pos` fires at mpv's own cadence, so the bar can be
honest instead of guessing.

## Why this is far more contained than it sounds

**The frontend does not change.** `OverlayApi` is already push-shaped —
`onTime`, `onTracks`, `onChapters`, `onLoading`, `onMeta` all take a callback
and return an unsubscribe (`overlayApi.ts:59-70`). `TheaterOverlay` consumes
those subscriptions and knows nothing about where the values come from. Only
the **source** inside `useDirectOverlay` changes: a Tauri event listener
instead of a `setInterval`.

We also already listen for Tauri events from Rust (`tauri.ts:273`,
`popout-closed`), so the emit-from-Rust → `listen` in JS plumbing is a
pattern in the codebase rather than a new one.

That means the blast radius is: `mpv.rs` (bind `observe_property`, run an
event thread for the in-app player), `lib.rs` (emit), `useDirectOverlay.ts`
(subscribe instead of poll). ~1500 lines of chrome stay untouched.

## The properties worth observing

Replacing exactly what `mpv_status` returns today:

| Property | Format | Replaces |
|---|---|---|
| `time-pos` | double | the scrubber clock, at mpv's cadence |
| `duration` | double | ditto |
| `core-idle` | flag | `presenting` (first frame landed) |
| `eof-reached` | flag | `ended` |
| `idle-active` | flag | `ended` |
| `track-list/count` | int64 | a *trigger* to re-read the track list, not a per-poll re-read |
| `chapter-list/count` | int64 | same for chapters |

The last two are the big saving: instead of 5 reads per track twice a second
forever, read the list **once, when the count changes**. That alone removes
the overwhelming majority of the FFI traffic while keeping the data identical.

## Risks, and they are real

1. **`wait_event` threading is a live scar in this repo — but phase 1
   removes it.** `mpv.rs:267-311` documents that `terminate_destroy`
   concurrent with `wait_event` on the same handle is forbidden by libmpv,
   which is why the popout's watcher is that handle's *sole* destroyer. That
   hazard only exists while handles die. With one persistent handle (phase 1)
   the event thread outlives every stream and the race is structurally
   impossible — which is why the ordering changed. Attempting the event
   thread while still recreating handles per switch would be the single most
   dangerous thing in this plan; doing it after is routine.

1b. **The persistent handle has its own risk**: state that currently resets
   for free (`speed`, `aid`, `sid`) starts carrying across streams. Explicit
   resets on every `loadfile`, and a test that a 1.5x VOD does not make the
   next live channel play at 1.5x.

2. **The watchdog and the completion-vs-death guard are load-bearing and
   subtle.** `useDirectOverlay.ts:114-147` carries a long comment about why
   completion requires *positive proof* of a clock that reached the end —
   inverting it destroyed users' resume positions once already. `presenting`
   and `ended` currently come from the poll and drive the tune watchdog, the
   dead card, VOD failover, and Up Next. Any event-driven replacement must
   reproduce that logic exactly, and the tests for it must come first.

3. **Event coalescing.** `time-pos` observed at mpv's cadence may fire far
   more often than 2Hz. The UI must not re-render per event — throttle to
   one state update per frame on the JS side (the same fix v0.8.165 applied
   to the scrubber drag), or emit at a bounded rate from Rust.

4. **A dropped event is silent.** A poll is self-healing: miss one, the next
   corrects. An event stream that stalls leaves the UI frozen with no
   error. Keep a very slow safety poll (say 5s) as a backstop rather than
   removing polling entirely.

## Phase 0 RESULT, measured 2026-08-08 — and it kills most of this plan

Real machine, real VOD, 20s steady state, `await playerPerf()`:

```
  NATIVE  mpv_status (sync command, runs on the UI thread)
    calls              44
    property reads     3040   (69 per poll)
    avg                0.36ms   scalars 0.02ms · tracks 0.28ms · chapters 0.03ms
    max                0.64ms
    polls over 16ms    0
    UI-thread load     0.08% of one core

  VIDEO   frame drops 0 · vo delayed 0 · fps 23.98 · hwdec d3d11va

  WEBVIEW avg/p95/max  2.5ms / 4.0ms / 5.0ms · long tasks ≥50ms 0
```

**The jank argument is dead.** The poll costs 0.36ms average, 0.64ms worst,
**0.08% of one core**. Zero polls exceeded a 60Hz frame, zero frames dropped,
zero delayed frames, zero long tasks. The arithmetic that opened this plan —
250 property reads a second on the UI thread — was right about the count and
badly wrong about what it costs: those reads are roughly 5µs each.

Two things survive contact with the data, and one is new:

1. **Tracks really do dominate the poll**: 0.28ms of 0.36ms, 78%, exactly as
   predicted. But 78% of nothing is nothing. Re-reading a static track list
   twice a second is inelegant, not expensive. It is worth doing only as an
   ENABLER (below), never for its own sake.
2. **The expensive part is the IPC, not the work.** Native 0.36ms vs 2.5ms
   measured from JS: about **2.1ms of every call is Tauri round-trip and
   scheduling**, six times the actual mpv work. That reframes the whole
   thing — the cost is per-CALL, not per-property, so the lever is call
   frequency, not what each call reads.

### What this deletes

- **Phase 1b (the event thread): CUT.** It existed to remove UI-thread cost
  that does not exist. Building an mpv event loop, with the lifetime hazards
  that come with it, to reclaim 0.08% of a core would be indefensible.
- **Phase 2 (observe list counts): CUT as a goal**, kept only as the enabler
  described below.
- **Phase 4 (state via observers): CUT.** Same reason. The watchdog and the
  completion-vs-death guard are subtle, hard-won and currently correct;
  rewriting them against events buys nothing measurable.

### What survives, and it is much cheaper than what was planned

Only the CLOCK, and only for granularity, never for cost. The scrubber
quantises to 500ms because the poll does, and `doSeek` carries an optimistic
bump to paper over it.

**Since polling turns out to be nearly free, the fix is to poll the clock
faster — not to build an event loop.** Raising the tick to ~200ms costs
about 5 invokes/sec ≈ 12ms/sec ≈ 1.2% of a core, dominated entirely by IPC.
That is 2.5x smoother for a fraction of the risk of an event thread, and it
touches one constant instead of the whole native state path.

Phase 2's idea earns its place here and only here: at a faster tick, re-reading
the track and chapter lists every time would multiply the one part of the
native cost that is not trivial, so read them only when their counts change.

**Revised remaining work**: raise the poll rate, gate the list reads on their
counts, and re-measure. Nothing else in this plan should be built.

## Time to first frame, measured 2026-08-08

Separate question from the poll, and the one the user actually feels. The
instrumentation already existed (`InvertedPlayer.tsx:88`, console not
terminal). Three real opens:

    [mpv-timing] first frame 1343ms after open
    [mpv-timing] first frame 2852ms after open
    [mpv-timing] first frame 5349ms after open

Our synchronous work is ~0ms of that (`ready 0ms  queued 0ms`), so all of it
is mpv opening the URL, probing it, filling the cache and decoding.

**Read the VARIANCE, not the average.** A fixed probe cost shows up as a
consistent floor. 1.3s to 5.3s on comparable content is origin and network
variability — debrid links warming up — which no mpv option tunes away. Only
the ~1.3s floor is potentially ours, and only part of that is probing.

So `demuxer-lavf-probesize` / `analyzeduration` are NOT recommended: the
plausible prize is a few hundred ms off the floor, and the cost of being
wrong is format misdetection, which surfaces days later as "this file has no
audio now" on content nobody tested. Bad trade.

If it is ever revisited, the method is easy because the number prints on
every open: change ONE option, tune the same source ten times, compare the
FLOOR rather than the mean.

**Much bigger number, elsewhere:** the startup log shows a **100.4MB** HTTP
body (plus 7.4MB) from the provider — the channel list and EPG. That dwarfs
everything in this document and is not a player problem.

## Superseded: the original measurement gate

The v0.8.164 instrumentation exists precisely for this and **has never been
read**. Before any of this is built, on a real machine, playing a real file:

```
await playerPerf()
```

That gives `avgUs` split into scalars / tracks / chapters, `propReads` per
poll, UI-thread load, and mpv's own `frameDrops`. Two numbers decide how much
of this plan is worth doing:

- **If frame drops are zero and poll time is small**, the jank is elsewhere
  and only the seek-feel argument survives — which would make phase 3 alone
  the whole job.
- **If `tracksUs` + `chaptersUs` dominate `avgUs`**, phase 2 (observe the
  counts, re-read on change) captures most of the win for a fraction of the
  risk of a full event loop.

Do not build phase 1 before reading those numbers.

## Phases

- **Phase 0 — measure.** `playerPerf()` on a real VOD with many tracks, AND
  the `play_wid` teardown/create/loadfile split that is already printed once
  per open. Record both here. Gate: do the numbers justify each phase?
- **Phase 1 — one persistent handle.** Detailed below; it is bigger than one
  line because `wid` being init-only drags the child WINDOW into it too.
- **Phase 1b — the event thread.** Now routine: bind
  `mpv_observe_property`, spawn one `wait_event` thread alongside the
  now-permanent handle. Emit nothing yet; log only.
- **Phase 2 — the cheap win.** Observe `track-list/count` and
  `chapter-list/count`; re-read the lists only on change. Keep the 500ms poll
  for everything else. This is reversible, low-risk, and removes most of the
  FFI traffic on its own.
- **Phase 3 — the clock.** Observe `time-pos` / `duration`, emit to JS,
  subscribe in `useDirectOverlay`, coalesce to one update per frame. This is
  what fixes scrub feel. Delete the optimistic bump in `doSeek` only once the
  real clock is smooth enough to stand alone.
- **Phase 4 — state.** Move `core-idle` / `eof-reached` / `idle-active` to
  observers, and reproduce the watchdog and completion guard against them,
  tests first. Keep a 5s backstop poll (risk 4).

## Phase 1 in detail

`wid` is init-only, so a handle is bound to one HWND for life. Today
`inv::open` destroys and recreates that HWND on every play
(`inv.rs`: `close()` → `CreateWindowExW`), and `inv::close` destroys it
again. **A persistent handle therefore requires a persistent child window.**
The two have to stop churning together — this is the part that makes phase 1
bigger than "call loadfile instead".

The work, in order:

1. **Persist the child window.** `inv::open` creates it once and thereafter
   only repositions (`SetWindowPos`, which it already does). `inv::close`
   stops playback but leaves the window alive. Destroying it moves to app
   shutdown.
2. **Split `play_wid` into ensure + load.** *Ensure*: if `PLAYER` is empty,
   `create` → set options → `initialize`, once. *Load*: `loadfile <url>
   replace` on the existing handle. `reload_live()` (`mpv.rs`) is already
   exactly this and is proven in production — it is the template, not a new
   pattern.
3. **Reset per-file state on every load.** `speed` → 1, `aid`/`sid` → the
   remembered prefs or auto. Today these reset for free because the handle
   dies, and `TheaterOverlay.tsx:255` explicitly relies on that.
4. **Rework `stop`.** It is `terminate_destroy` today. For a normal switch it
   becomes mpv's `stop` command (unload the file, keep the instance); real
   destruction is reserved for app exit. **This is where the app-wide
   one-connection invariant now lives** — see risk below.
5. **Re-check the popout edges.** `play_wid` calls `stop_popout()`, and
   `popout_open` calls `inv::close()` to capture position and tear down.
   Both assumed a disposable in-app player; both need re-reading against a
   persistent one.

### The risk that decides whether this ships

**Does an unloaded-but-alive mpv still hold the provider connection?** The
one-connection invariant is not a style preference — the code says a
`max_connections=1` line "outright failed to tune" when two instances ran. If
mpv's `stop` command releases the socket, this is fine. If it keeps the
connection warm, every user on a single-connection line breaks the moment
they change channel, and phase 1 cannot ship as designed.

This is a factual question with a definite answer, and it must be settled
BEFORE the refactor, not discovered after. Cheapest test: persistent handle,
`stop`, then check the provider's active-connection count (Xtream panels
report it — `LiveGroup` already surfaces `active`/`max`, which is where the
sidebar's `n/m` badge comes from).

### What cannot be verified here

None of phase 1 is testable in this container: it is Windows-only, needs
libmpv and a real provider. The vitest suite does not reach `src-tauri` at
all. Verification is necessarily manual on Adam's machine — switch channels a
few hundred times, watch memory, watch the connection count, confirm no
stuck demuxer. Plan the change so each step is separately revertible.

## Sources

- [Stremio/stremio-shell `mpv.cpp`](https://github.com/Stremio/stremio-shell/blob/master/mpv.cpp)
- [Stremio/stremio-shell-ng](https://github.com/Stremio/stremio-shell-ng) — WebView2 + mpv + Rust
- [mpv client API](https://mpv.readthedocs.io/en/latest/api.html) — `mpv_wait_event`, timeout semantics

## Measured: where startup time actually goes (v0.8.194, real machine)

This plan asked how much of the ~1.3s first-frame floor was ours. `ttff()`
answers it now, and the answer is: almost none of it.

A 4K remux over debrid, resuming ~2h in, on a real connection:

| | cold | warm |
|---|---|---|
| first frame | 4880ms | 1700-2800ms |

The cold demux leg was 2736ms, and the theory was that libavformat's
stream probing was to blame: the file carries 71 tracks, and
`avformat_find_stream_info` walking all of them over a network source is a
plausible 2.7 seconds. It was tested and it is wrong.

`demuxer-lavf-analyzeduration`, one variable, both runs warm, same title,
same resume point:

| | analyzeduration=0 | analyzeduration=0.5 |
|---|---|---|
| demux | 1160ms | 2344ms |
| video | 1053ms | 397ms |
| frame | 0ms | 0ms |
| total | 2213ms | 2741ms |

Slower, and the demux leg moved the wrong way. `demuxer-lavf-probe-info=nostreams`
was also tried and came off again with a 130ms difference, so it is not the
lever either.

The reason no option helped: across four warm runs on IDENTICAL settings the
totals were 1730, 1863, 1839 and 2758ms. **Run-to-run spread is about a
second**, which is larger than any effect being looked for. One run per arm
cannot separate them, and the first pair that looked like a win was noise.

What the numbers do say:

- The cold/warm gap is the whole story. Startup here is how long the debrid
  host takes to answer, and it roughly halves once that host is warm. There
  is no demuxer option for that.
- `frame` is 0ms every time: once bring-up completes the picture moves within
  one 25ms poll. Decode and output cost nothing. `hwdec` resolves to
  `d3d11va`, `vo` is `gpu-next`.

**Do not re-run the analyzeduration/probesize experiment** without first
establishing the noise floor: several runs per arm, warm against warm. Any
future startup work should be aimed at the provider round trip, not at mpv.

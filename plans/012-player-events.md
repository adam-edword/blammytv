# 012: stop asking mpv, let it tell us

**Status: DESIGN, not started.** Written 2026-08-08 after benchmarking against
Stremio, which Adam named as the bar for player quality. The finding is
architectural and it explains both symptoms he reported — jank during
playback, and seeking/scrubbing feel — with one mechanism.

## The finding

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

1. **`wait_event` threading is a live scar in this repo.** `mpv.rs:267-311`
   documents it: `terminate_destroy` concurrent with `wait_event` on the same
   handle is forbidden by libmpv, so the popout's watcher thread is the
   handle's *sole* destroyer and `stop_popout` sends `quit` rather than
   destroying. The in-app player is created and destroyed on **every stream
   switch** (`play_wid` / `stop`), which is far more churn than the popout
   ever sees. Getting this wrong is a hard crash, not a glitch. This is the
   single hardest part and should be phase 1 on its own.

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

## Measure first

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

- **Phase 0 — measure.** `playerPerf()` on a real VOD file with many tracks.
  Record the numbers here. Gate: do the numbers justify the risk in risk 1?
- **Phase 1 — the event thread.** Bind `mpv_observe_property`, run a single
  `wait_event` thread for the in-app player, tied correctly to the handle
  lifecycle across stream switches. Emit nothing yet; log only. Prove it
  survives a few hundred channel switches without a crash.
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

## Sources

- [Stremio/stremio-shell `mpv.cpp`](https://github.com/Stremio/stremio-shell/blob/master/mpv.cpp)
- [Stremio/stremio-shell-ng](https://github.com/Stremio/stremio-shell-ng) — WebView2 + mpv + Rust
- [mpv client API](https://mpv.readthedocs.io/en/latest/api.html) — `mpv_wait_event`, timeout semantics

# Scope — in-app libmpv playback (Telly-grade theater)

Status: **proposal / not started.** This is the plan to match Desktop Telly's
picture quality in our theater/fullscreen player by embedding **libmpv**, while
keeping the smooth `<video>` mini-player.

## Why we need it

Measured, not guessed (via our own Stats for Nerds, same 4K channel):

| | BlammyTV (`<video>`) | Telly |
| --- | --- | --- |
| Decode | software-ish, **dropped frames** (now mostly fixed by the HEVC HW flag) | **d3d11va** hardware, 0 dropped |
| HDR | shown raw → **dark + flat** | **tone-mapped** on GPU → correct |
| Audio | downmixed to **AAC 2.0** | original **AC-3/E-AC-3 5.1** |

Telly's stats (`d3d11va`, A/V-sync, demuxer cache, 5.1 passthrough) are mpv's
own — it's **libmpv** under the hood, doing GPU decode + tone-map + scale in one
pipeline. A Chromium `<video>` can't do those three things. So the only real fix
is to do what Telly does: embed libmpv and render it *into the page* (so our HTML
controls still composite on top).

## The hard part: getting mpv's pixels into the page

In Electron a **native video window renders *above* the web page** ("airspace"),
so the naive `--wid` embed (what we tried early on → black/jank) can't host our
HTML overlays. The fix is mpv's **render API**, which hands us frames we draw
ourselves. Options:

- **A. SW render → canvas.** libmpv renders into a CPU buffer; we upload to a
  `<canvas>`. Simplest, but processing is CPU-side (libswscale/zimg) — **lower
  quality and no libplacebo GPU tone-map.** Not really "Telly-grade." Fallback only.
- **B. GL render → offscreen FBO → `glReadPixels` → WebGL canvas.** mpv runs its
  **full GPU pipeline (libplacebo: GPU decode, HDR tone-map, scaling)** into a GL
  texture we own; we read it back **at on-screen size** (not source 4K) and upload
  to a canvas. HTML overlays composite normally. Read-back cost is bounded by the
  *display* size, so 4K60 decode is cheap and we only move ~1080p of pixels. ✅ **Recommended v1.**
- **C. GL zero-copy (shared texture).** Same as B but share the texture straight
  into Chromium's GL context — no read-back. Best perf, but cross-context texture
  sharing isn't exposed by Electron and is fragile/undocumented. **v2 optimization.**
- **D. Two windows** (mpv window + transparent overlay window for controls). Real
  GPU, no copy, but window/z-order/focus/DPI/multi-monitor hell. Not preferred.

**Recommendation: B for v1** (full mpv quality, bounded read-back), **C later** if
read-back is a measurable bottleneck.

> Key realization: in the libmpv path, **mpv plays the source URL directly** — it
> has its own demux/decode/AC-3 handling, so the **ffmpeg→HLS transcode isn't
> needed for theater at all.** mpv also owns audio output (WASAPI), so surround
> "just works."

## Architecture

```
apps/desktop/native/mpv/        # new N-API addon (C++)
  - mpv_create + mpv_render_context_create (OpenGL, offscreen FBO via ANGLE/EGL)
  - load(url), command(play|pause|seek), setProperty(volume|…), getProperty(stats)
  - per-frame: render → glReadPixels(displaySize) → deliver RGBA (SharedArrayBuffer)
renderer (theater only):
  - <canvas> + a requestAnimationFrame loop that uploads the latest frame (WebGL)
  - HTML controls / Stats / show-content overlay it (normal z-index — no airspace)
```

- **Mini player stays `<video>`** (HLS transcode) — unchanged, smooth.
- **Theater = libmpv→canvas.** Entering theater tears down the `<video>`+transcode
  and starts libmpv on the source URL; leaving reverses it. (~1–2s handoff while
  mpv connects; acceptable.)
- **Controls re-wire to mpv** (`mpv_command` seek/pause, volume property). **Stats
  reads mpv properties** — actually richer than today (hwdec, A/V sync, cache,
  real codec) — i.e. we'd match Telly's panel too.
- **End-state option:** once libmpv is solid, it could replace `<video>` + the
  whole ffmpeg→HLS transcode *everywhere* (one engine, no transcode, native AC-3).
  Start theater-only to de-risk.

## Build / distribution impact (the real cost)

- Ship **`libmpv-2.dll`** (+ runtime deps) in the desktop bundle (Windows builds
  from the standard mpv/shinchiro releases). `libmpv` is **LGPL** — fine to ship.
- **Native addon build:** `cmake-js` (or node-gyp), MSVC toolchain, built against
  **Electron's ABI** (electron headers / `electron-rebuild`). New build step.
- Publish **prebuilt binaries** (`.node` per Electron version) so doot/CI don't
  need the C++ toolchain to run the app.
- `electron-builder`: bundle the `.node` + DLL.
- **Windows-first.** mac/Linux would each need their own libmpv + a build later.

## Risks

- **Native build/ABI complexity** — the biggest one. Mitigate with prebuilds.
- **Frame pacing** at 60fps (sync mpv's render-update callback to RAF; tearing/judder if sloppy).
- **Two playback engines** to keep coherent (mini ↔ theater handoff, no double audio).
- **Can't be tested headlessly** — needs Windows + libmpv + a GPU + a display. This
  is a screenshot-driven, on-your-machine build like the rest of the player.

## Phasing

1. **Spike (de-risk the toolchain).** Minimal addon: load libmpv, play a URL to a
   throwaway native window. Proves libmpv DLL + Electron-ABI build works on your box.
2. **GL render → canvas.** Get one frame on-screen *in the page* at display size;
   eyeball HDR/HEVC vs Telly. Wire play/pause.
3. **Theater integration.** Mode-switch from `<video>`, re-wire all controls +
   Stats to mpv, audio/surround, exit/Escape/fullscreen.
4. **Packaging + prebuilds + docs** so contributors/CI don't need the native toolchain.
5. *(Later)* GL zero-copy (Option C) if read-back is a perf issue; consider
   retiring the `<video>`/transcode path entirely.

## What I can and can't do

- I can write **all** of it — the C++ addon, the JS/React glue, the integration,
  the packaging config, and the docs.
- I **cannot build or verify** it in the cloud (Linux, no Windows libmpv, no GPU,
  no display). Every step needs a build + screenshot from your machine — same loop
  we've used for the player all along.
- **Suggested start: Phase 1 spike** — smallest thing that proves the libmpv +
  Electron-ABI native build works before we invest in the full integration.

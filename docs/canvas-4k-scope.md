# Scope — native-4K in-page canvas (smooth + seamless)

Status: **proposal.** Goal: render the in-page libmpv `<canvas>` at the
display's **native 4K** (3840×2160) while holding ~60fps, **without** the
native-window handoff — so fullscreen stays instant and in-page but is no longer
soft from the 1440p cap.

## Where we are

The desktop player is libmpv → `<canvas>` for mini/theater/fullscreen. We cap the
readback at **1440p** because true 4K dropped the canvas to **~38fps**.

Per-frame pipeline at 4K (measured on a 4090, 240Hz):

| stage | where | ~cost |
| --- | --- | --- |
| mpv render to FBO | addon WGL ctx (main thread) | ~2.4ms |
| `glReadPixels` GPU→CPU | addon WGL ctx, **synchronous stall** | ~5–6ms |
| hand Buffer to JS | N-API, zero-copy (contextIsolation off) | ~0 |
| `texSubImage2D` CPU→GPU | Chromium WebGL ctx (main thread) | ~10–15ms |
| draw + composite | Chromium | — |

≈26ms/frame → ~38fps. The native side is fine (~8ms); the wall is the **two
GPU↔CPU trips done synchronously on the renderer main thread**.

### Why two trips (and why not zero-copy)

The addon's WGL context and Chromium's ANGLE/WebGL context are separate, and
there is **no JS-reachable way to share a GPU texture between them**, so each
frame must round-trip through CPU memory: read back off our context, re-upload
into Chromium's. (Same reason true zero-copy-to-web is impossible — only the
native-window path avoids it.) Bandwidth isn't the hard limit (66MB/frame × 60 ≈
4GB/s, PCIe4 ≈ 32GB/s); the limits are the **synchronous stalls + memcpys +
main-thread contention**.

## Levers (in priority order)

1. **Async readback via PBO** — *native, highest value.*
   `glReadPixels` into a bound `GL_PIXEL_PACK_BUFFER` returns immediately (GPU
   DMAs into the PBO) instead of stalling. Double-buffer: frame N issues the
   readback into `pbo[n]`, and we map `pbo[n-1]` (GPU finished it last frame).
   Removes the ~5–6ms stall from the critical path; pipelines render(N) with
   readback(N-1). Adds 1 frame of latency. Cost: a memcpy out of the mapped PBO
   (or expose the mapped pointer to JS with managed lifetime).

2. **Async upload via WebGL2 unpack PBO** — *renderer.*
   Switch the canvas to **WebGL2**, upload the frame into a
   `PIXEL_UNPACK_BUFFER` then `texSubImage2D` from it, letting the driver DMA the
   texture upload instead of a blocking copy. The `bufferSubData` is still a
   CPU-side copy, so the win is overlap, not elimination — moderate.

3. **Adaptive resolution** — *renderer, pragmatic guarantee.*
   Render at native 4K, but if we miss the source fps, dynamically drop the
   readback size (4K → 1800p → 1440p) to hold 60, and climb back when there's
   headroom. Guarantees smoothness; quality floats to whatever sustains 60.

4. **OffscreenCanvas + Worker** — *biggest effort, best shot at locked 60.*
   Run mpv render+readback on the addon's own thread, deliver frames via a
   `SharedArrayBuffer`, and do the WebGL upload+draw in a **Web Worker** with
   `OffscreenCanvas` — taking the entire hot path **off the main thread** (so the
   rest of the UI never competes). Significant rewrite; the native→SAB handoff
   and fences need care.

## Realistic expectation

- **PBO readback + WebGL2 unpack PBO (levers 1+2):** likely **~45–55fps** at 4K
  — clearly better than 38, maybe not a locked 60.
- **+ adaptive res (3):** always-smooth, quality auto-tuned (e.g. holds 4K on
  calm scenes, dips to ~1800p under motion).
- **+ OffscreenCanvas worker (4):** best chance at a locked 4K60 in-page.

## Risks

- PBO map lifetime / GL fence correctness — mis-sync → torn or stale frames.
- WebGL2 + unpack-PBO path quirks in Chromium/ANGLE.
- Worker + `OffscreenCanvas` + native `SharedArrayBuffer` is complex and
  **untestable in the cloud** — every step is a Windows+GPU+screenshot loop.
- All native changes mean a `node-gyp` rebuild on each iteration.

## Phasing

1. Re-add a dev fps readout so each change is measurable.
2. **Native PBO async readback** (double-buffered). Measure.
3. **WebGL2 unpack-PBO async upload.** Measure.
4. If short of 60: **adaptive resolution** to guarantee smoothness.
5. *(Stretch)* OffscreenCanvas + Worker to move the hot path off the main thread.

Stop at the first phase that's "good enough" (sharp + smooth + seamless).

## Fallbacks (nothing at risk)

The working states stay intact while we experiment:
- **1440p cap** — guaranteed smooth + seamless, in-page (current default).
- **Native window + overlay** — guaranteed true 4K60 (with the ~1–2s handoff),
  already built and dormant; can be wired to an optional "max quality" toggle.

## What I can / can't do

- I can write all of it — the native PBO code, the WebGL2/worker glue, the
  adaptive logic.
- I **cannot measure or verify** any of it in the cloud (no Windows/GPU/4K
  display). Every phase needs a build + fps reading + screenshot from your box,
  same loop as the rest of the player.

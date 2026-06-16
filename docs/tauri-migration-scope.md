# Scope — migrate the shell to Tauri (Telly-grade native 4K60 + HDR)

Status: **proposal.** Telly is Tauri; this scopes what moving BlammyTV's desktop
shell from **Electron → Tauri** actually buys us, what it costs, and how to
de-risk it before committing.

## Why consider it

The in-page canvas tops out ~40fps at 4K (a **web-platform wall**: no way to hand
a GPU texture to `<canvas>` from JS, so pixels round-trip through the CPU). That
wall is identical in any webview — Tauri included. The native mpv surface path
avoids it and we have it working in Electron, but with warts:

- **~1–2s handoff** entering fullscreen (mpv reconnects),
- **HDR is lost** — we tone-map to SDR because a transparent Electron overlay
  composites in SDR,
- **occlusion / `d3d11-flip` / focus hacks** to stop the overlay dimming the video.

The thing Tauri unlocks (and Electron can't): **WebView2 composition hosting**.

## The actual unlock: WebView2 composition (DComp) hosting

On Windows, Tauri's webview is **WebView2**, which can render into a
**DirectComposition visual you own** instead of an opaque child window. That lets
us build one GPU visual tree:

```
DComp root
 ├─ mpv GPU surface  (bottom visual — true 4K60, native HDR, zero readback)
 └─ WebView2 visual  (transparent — React controls/EPG composite on top)
```

DWM composites them **on the GPU**. Result: **seamless native 4K60, real HDR
preserved, HTML controls on top, no readback, no airspace, no handoff, no
dimming hacks.** This is almost certainly how Telly does it. **Electron cannot
do this** — it wraps Chromium opaquely as a windowed view, which is exactly why
we needed the overlay-window + flip/SDR/occlusion workarounds.

> ⚠️ **This is the crux risk.** Composition hosting is **not** turnkey in
> Tauri/`wry` (they default to windowed WebView2). Getting mpv's DComp visual
> under a composition-hosted WebView2 likely means dropping to **raw WebView2 +
> DirectComposition via Rust FFI** (or patching `wry`). If this doesn't pan out,
> Tauri gives us **no advantage** over our Electron native path — so we prove
> this first (see Phasing).

## What ports almost as-is

- **The entire React app** (`apps/app`) — it's a Vite web app; Tauri serves any
  frontend. ~unchanged.
- **`packages/shared`** (zod schemas + mock) — unchanged.
- **`apps/server`** (Hono/Xtream mapper, holds the secrets) — keep running as a
  **Node sidecar** the Tauri app spawns (Tauri supports sidecar binaries). No
  rewrite needed initially; secrets stay server-side exactly as today.

## What gets rewritten

- **The shell:** `apps/desktop/electron/*.cjs` → **Rust** (`src-tauri/`): window
  creation, lifecycle, the DComp/WebView2 host.
- **The bridge:** `window.blammy.*` (preload IPC) → **Tauri commands**
  (`invoke('...')`) + events. `apps/app/src/lib/desktop.ts` is the single seam —
  reimplement its functions over `invoke`; most of the React app doesn't notice.
- **libmpv integration:** the C++ N-API addon → Rust, via a libmpv crate
  (`libmpv2`/`libmpv-sys`) or FFI to the same `libmpv-2.dll`. The
  **render-to-canvas path is deleted**; mpv renders to its native DComp surface.
- **Drop on desktop:** the ffmpeg→HLS transcode + `<video>` fallback (already
  mpv-only on desktop), the canvas/PBO code, the overlay-window hacks.
- **Build/dist:** Electron Builder → **Tauri bundler** (much smaller installers);
  bundle `libmpv-2.dll`; redo code-signing/update flow.

## Effort (rough, screenshot-driven — I can't test in the cloud)

| chunk | size |
| --- | --- |
| Tauri scaffold + serve the React app + Vite wiring | S |
| Port `desktop.ts` bridge → `invoke` commands/events | M |
| mpv in Rust (load, play, controls, properties) | M |
| **WebView2 composition host + mpv DComp visual** | **L / uncertain** |
| Sidecar the Hono server; secrets plumbing | S |
| Build, bundle the dll, signing, updater | M |

The **L/uncertain** row is the whole ballgame.

## Risks

- **Composition hosting may be hard/unsupported** in Tauri/`wry` → raw WebView2 +
  DComp FFI in Rust, which is advanced and undocumented for this use. If it
  fails, the migration buys nothing over Electron.
- **Rust + native + Windows + WebView2** is all untestable in the cloud — every
  step is a build+screenshot loop on your machine, like the libmpv work.
- **Two ecosystems of churn** during migration; the working Electron app stays as
  the fallback until Tauri reaches parity.
- mpv crate vs raw FFI, DLL bundling, HDR swapchain setup — each a small unknown.

## Phasing — **de-risk the unlock first**

1. **Spike (decides everything):** a throwaway Tauri app that does *only* the hard
   part — composition-hosted WebView2 with a **transparent page over an mpv DComp
   visual** playing a 4K HDR stream. If the video shows **bright/HDR, 4K60, with
   an HTML element composited on top, seamless** → the migration is worth it. If
   not → stop, stay on Electron.
2. Port the bridge (`desktop.ts` → `invoke`) and get the real React app running
   in Tauri against the sidecar server.
3. mpv controls + properties (play/pause/seek/volume, Stats from mpv props).
4. Wire the real theater/fullscreen onto the DComp surface; retire canvas.
5. Build/bundle/sign/update; cut over.

## Recommendation

Tauri is the **architecturally correct** way to match Telly *exactly* (same
stack), and it uniquely buys **seamless 4K60 + real HDR + clean compositing** —
things Electron structurally can't. But the payoff rides entirely on **WebView2
composition hosting**, which is the one genuinely uncertain piece.

So: **don't big-bang migrate.** Do the **Phase 1 spike** first — it's the same
"prove the scary unknown in isolation" move that made the libmpv work succeed. A
few build+screenshot cycles tells us if Tauri delivers the Telly-grade path. If
yes, commit to the migration; if no, we polish the Electron native path
(pre-warm for an instant handoff) and we've lost only the spike.

## Fallback (nothing at risk)

The Electron app keeps working throughout. If Tauri doesn't deliver, the Electron
native-window path (instant via pre-warm, SDR-tonemapped) is the floor, and the
1440p seamless canvas remains for in-page.

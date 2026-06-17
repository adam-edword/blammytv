# BlammyTV — Composition Player Integration Plan

Status: **architecture proven** (v0.0.165). Native mpv (flip-model, 4K60/HDR-capable)
renders in a child HWND; a transparent, composition-hosted WebView2 composites its
own pixels over it via a topmost DirectComposition target on the window. One window,
controls-on-video, zero CPU frame copies. This doc plans the path from that spike to
the real, shippable player.

## What's proven (the spike)

- `comp::mpv_child` — mpv embeds in a `WS_CHILD` window via `--wid`, **flip model**
  (default present). Bitblt (`d3d11-flip=no`) embeds **no video** — flip is required.
- `comp::theater` — flip-model mpv child + **topmost parent DComp target** hosting a
  transparent composition WebView2. Video shows through the webview's transparent
  regions; the webview's opaque regions (the control bar) float on top. ✅
- `webview_test` / `color_test` — the DComp + composition-WebView2 plumbing, isolated.

## The decisive codebase fact

`invoke()` is used **only** for our mpv/comp commands (all in `apps/app/src/lib/tauri.ts`).
Everything else — channels, EPG, stream resolution, config, admin — is **HTTP to the
Hono server** (`VITE_API_URL`). A webview that loads the app therefore needs **no Tauri
IPC** for data; it only needs a small bridge for **mpv control, window control, and
overlay input.** This is what makes the single-webview model cheap.

## Recommended end-state architecture — "single composition webview"

One window, three layers, bottom to top:

1. **mpv child HWND** (`--wid`, flip model) — the video plane. Sized to fill the window
   (fullscreen player) or to a sub-rect (embedded preview); see "mpv layer" below.
2. *(nothing in the middle — mpv is the background)*
3. **Composition WebView2** (transparent, full window) = **the entire BlammyTV app.**
   When browsing the guide it paints an opaque background (mpv hidden); when watching,
   the player view is transparent (mpv shows through). This *is* the UI — there is no
   separate "overlay" window.

Tauri still creates its default webview; we navigate it to `about:blank` / leave it
unused beneath, and put our composition webview on top. (Future: explore making Tauri
create the window without relying on its webview, or host the composition controller
through Tauri's own window so we inherit its event loop cleanly.)

### Why single-webview over the Electron-style two-window overlay

- **Data flow is untouched** — the app already gets everything via HTTP.
- **No meta-sync** — the guide and the player are the same document; no pushing
  `TheaterMeta` across a process boundary (the Electron overlay's `getMeta`/`onMeta`).
- **One transparent surface** — matches Telly; clean z-order, no second HWND to align.
- We still **reuse** the Electron overlay's interaction model (auto-hide,
  `[data-interactive]` click-through) — it just runs in the same document now.

## The bridge (replaces Electron `overlayApi` and Tauri `invoke` for mpv/window)

Inject a `window.blammy` shim into the composition webview via
`AddScriptToExecuteOnDocumentCreated`, backed by WebView2 `WebMessage`:

- **JS → Rust:** `window.chrome.webview.postMessage({type, ...})`. Rust handles
  `add_WebMessageReceived` and dispatches to mpv / window:
  - `play{url, rect?}`, `stop`, `setPause{paused}`, `setVolume{v}`, `setMute{m}`,
    `seek{delta}`, `setRect{rect}` (embedded preview position), `enterFullscreen`,
    `exitFullscreen`, `close`, `minimize`.
- **Rust → JS:** `PostWebMessageAsString(json)` for state mpv owns — position/duration
  ticks, playing/paused, EOF, errors — consumed by an `onMessage` listener.

`apps/app/src/lib/tauri.ts` becomes `lib/bridge.ts`: detect the bridge
(`"chrome" in window && window.chrome.webview`) and expose the same typed functions,
so component code (`NowPlaying`, `TheaterOverlay`) is unchanged.

## Input forwarding (composition webviews receive NO input automatically)

Subclass the window proc (host window, and/or the mpv child) and forward to the
`ICoreWebView2CompositionController`:

- `WM_MOUSE*` / `WM_POINTER*` → `SendMouseInput` / `SendPointerInput` (with correct
  client coords relative to the controller bounds).
- `WM_KEY*` / `WM_CHAR` → the controller's accelerator/key path
  (`ICoreWebView2Controller` already routes keyboard when it has focus; verify).
- Cursor: honor `add_CursorChanged` → `SetCursor`.
- **Click-through:** reuse the overlay model — the app marks live regions
  `[data-interactive]`; on `mousemove` it tells Rust via the bridge whether the cursor
  is over chrome. When it's *not*, we let the event fall through to mpv (foreground/OSD)
  instead of the webview, so non-chrome clicks don't get swallowed.

## mpv layer management (embedded preview vs fullscreen)

- **Fullscreen / theater:** mpv child fills the window; webview transparent over it.
- **Embedded preview** (the `NowPlaying` box): mpv child positioned/sized to the
  preview rect. The app sends `setRect` whenever the layout moves/resizes (the React
  side already knows the box geometry). On window resize, re-apply both the mpv child
  bounds and the webview controller bounds.
- Keep a single mpv instance; `play{url, rect}` (re)targets it.

## Lifecycle

- **Startup:** create window → create mpv child (hidden until first play) → create
  composition webview (full window) → navigate to the app URL (dev: `devUrl`; prod:
  `tauri://localhost`/custom protocol) → inject bridge → start input forwarding.
- **Resize / DPI:** re-bound mpv child + webview controller; webview handles its own
  DPI via `RasterizationScale`.
- **Teardown:** stop mpv (`terminate_destroy`), drop controller, drop DComp objects,
  destroy child window. Ensure ordering so DWM doesn't flash.
- **Exit:** wire window close → teardown → `app.exit`.

## HDR (post-MVP)

Electron forced SDR. With DComp we control the swapchain/visual; investigate an HDR
swapchain color space + mpv `--target-colorspace-hint` so true HDR survives to the
display. Spike separately once the player is functional.

## Milestones (each independently testable)

1. **Real UI over video.** Point the composition webview at the app `devUrl` with
   `?overlay=1` (or a new `?composited=1`) so `TheaterOverlay` renders transparent over
   live mpv. Visual only — no input yet. *Win: real controls floating over native video.*
2. **Bridge.** Inject `window.blammy`, wire `WebMessageReceived` → mpv. Replace
   `overlayApi`/`invoke` calls. *Win: buttons in the overlay actually drive mpv.*
3. **Input forwarding.** Window-proc → `SendMouseInput`/keyboard; click-through model.
   *Win: the overlay is clickable; mpv stays foreground elsewhere.*
4. **Whole-app composition.** Load the full app (not just the overlay) in the
   composition webview; opaque guide bg, transparent player view; retire the in-page
   `<video>`/canvas player and the temp test buttons. *Win: BlammyTV is the composition
   webview.*
5. **mpv layer geometry.** `setRect` for the embedded preview + resize handling.
6. **Lifecycle + exit.** Clean teardown, resize, close.
7. **Retire Tauri default webview** (navigate to blank / hide); reconcile event loop.
8. **HDR spike.**
9. Build / bundle / sign; ship libmpv-2.dll alongside the exe.

## Risks / unknowns

- **Flip-model MPO vs DComp z-order.** It composited correctly in the spike, but on some
  GPUs/drivers the video overlay plane can reorder vs the DComp surface. If the bar ever
  hides behind video, force MPO off or move mpv to a **DComp-owned composition swapchain
  via the libmpv render API** (GL/ANGLE→D3D11). That render-API path is the bulletproof
  fallback and the true endgame for HDR control; keep it in pocket.
- **Input focus** between mpv child, composition webview, and Tauri's default webview.
- **Keyboard routing** to the composition controller (may need explicit accelerator
  handling).
- **Tauri default webview** sitting unused beneath — wasteful; revisit in milestone 7.
</content>

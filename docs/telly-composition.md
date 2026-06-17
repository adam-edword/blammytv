# The Telly Way — composition-hosted webview over native mpv (Tauri/Windows)

Status: **pioneering spike.** Goal: mpv video rendered natively (true 4K60 + HDR,
zero readback) with the React UI composited **on top** via a transparent webview —
in one window, no airspace, no handoff. No known Windows precedent in Tauri/wry,
so we build it as a de-risking spike.

## Why the obvious paths don't work

- **Tauri/wry's webview is *windowed*** (a child HWND). A transparent windowed
  webview shows grey, not the content beneath it (wry #1540) — the airspace wall.
- **Canvas readback** caps ~40fps at 4K (the CPU round-trip we already measured).

The fix is **WebView2 composition (visual) hosting**: the webview becomes a
**DirectComposition visual** we place in a visual tree, so DWM composites it over
native content on the GPU.

## Architecture

```
Window (HWND)
 ├─ mpv child window (--wid)        ← native D3D11 video: true 4K60 + HDR
 └─ DComp target (topmost) on HWND
      └─ root visual
           └─ WebView2 RootVisualTarget visual   ← transparent: React controls
```

- **mpv** renders into a child HWND via `--wid` (windowed, dead-simple, full
  native quality + HDR). No GL↔D3D interop needed.
- **DirectComposition** target (`CreateTargetForHwnd(hwnd, topmost=TRUE)`) holds
  the webview's visual *above* the mpv child. The transparent webview lets the
  video show through where there are no controls.
- **WebView2** created via `CreateCoreWebView2CompositionController`, with
  `put_RootVisualTarget(dcomp_visual)` and a transparent default background,
  loading the React app (dev: localhost:1420).

> Alternative if `topmost` DComp won't composite over a child HWND: put mpv in
> its *own* DComp visual via a `CreateSwapChainForComposition` swapchain that mpv
> renders into through **WGL_NV_DX_interop** (GL texture → shared D3D11 texture).
> More work; only if the child-HWND route fails the spike.

## Dependencies (all already available)

- `webview2-com` — `ICoreWebView2CompositionController` (transitive Tauri dep).
- `windows` (0.61) — `Win32::Graphics::DirectComposition`, `Direct3D11`, `Dxgi`.
- `libloading` — mpv (already wired).

## The catches (known, real)

1. **Tauri's own webview is windowed** — we can't reuse it for this. We host our
   *own* composition WebView2. Open question: run the whole app in our custom
   composition webview (Tauri = Rust runtime + commands only), or keep Tauri's
   webview for non-player UI and a composition one for the player. Spike informs.
2. **Composition-hosted webviews get NO input automatically** — the host must
   forward mouse/keyboard via `SendMouseInput`/`SendPointerInput` from the window
   proc. Non-trivial but well-documented.
3. **All untestable in the cloud** — every step is a Windows build + screenshot,
   and this is unsafe COM/DComp Rust. Expect several cycles per step.

## Spike order (prove the unknown first)

1. **Compositing proof (no mpv yet):** in a window, a child HWND filled a solid
   colour + a composition WebView2 (transparent test page with a button) via a
   topmost DComp target. **Win =** the page floats over the colour, transparency
   shows the colour through, and the button takes clicks (input forwarding works).
2. **Swap colour → mpv** (`--wid` child). Win = mpv 4K60 HDR under the page.
3. **Load the real React app** in the composition webview; wire mpv controls over
   the existing `invoke` bridge.
4. **Reconcile with Tauri** — lifecycle, commands, the non-player chrome, build.

## Fallback

If the spike stalls, the **dual-window overlay** (mpv borderless window +
transparent non-focusable Tauri window on top — the proven Electron recipe)
gives a working Tauri player at the same quality we already shipped. Nothing
lost; the Electron build remains the floor throughout.

# @blammytv/mpv-native — libmpv addon (Phase 1 spike)

Proves that **libmpv** links + loads against **Electron's ABI** and can play a
stream, before we build the render-to-canvas integration. See
[`docs/libmpv-scope.md`](../../../../docs/libmpv-scope.md) for the full plan.

For the spike, `play(url)` lets **mpv open its own window** (GPU decode + HDR
tone-map + scaling) so we can eyeball that 4K/HEVC/HDR looks like Telly. Once
that's confirmed, Phase 2 swaps `force-window` for the render API into a canvas.

This is **Windows-first** and intentionally **not** a workspace package — it has
its own toolchain + vendored libmpv, so it won't drag the C++ build into CI.

## Prerequisites (Windows)

- **Visual Studio 2022** with the *Desktop development with C++* workload (MSVC + Windows SDK).
- **Python 3** (for `node-gyp`).
- The **libmpv dev package** — `mpv-dev-x86_64-*.7z` from
  <https://sourceforge.net/projects/mpv-player-windows/files/libmpv/>.

## One-time libmpv setup

From the extracted `mpv-dev` package, populate `vendor/` (it's git-ignored):

```
vendor/
  include/mpv/*.h        <- copy the package's include\mpv\*.h
  lib/mpv.lib            <- generated import lib (see below)
```

Generate the MSVC import lib from the package's `mpv.def`, in an
**x64 Native Tools Command Prompt for VS 2022**:

```bat
lib /def:mpv.def /out:vendor\lib\mpv.lib /machine:x64
```

Keep the runtime DLL handy — you'll copy `libmpv-2.dll` next to the built addon
(step 3).

## Build

```bash
cd apps/desktop/native/mpv
pnpm install                 # node-addon-api + node-gyp
# match --target to your installed Electron (npx electron -v):
pnpm rebuild                 # node-gyp rebuild against Electron headers
```

Then make the runtime DLL loadable by the addon:

```bat
copy path\to\libmpv-2.dll build\Release\
```

The compiled addon lands at `build/Release/mpv_addon.node`.

## Test it

1. Run the app: `pnpm desktop`.
2. Play a channel, click the preview to enter **theater**.
3. Click the temporary **MPV** button in the control bar.

An mpv window should open and play the source directly. If it's smooth + bright
where our `<video>` was dropping/dark — the spike's a success and we move to
Phase 2 (render into the page).

## Troubleshooting

- **`mpv_create() failed` / module won't load** — `libmpv-2.dll` isn't next to
  `mpv_addon.node` (copy it into `build/Release/`), or it's the wrong arch.
- **ABI / `NODE_MODULE_VERSION` mismatch** — rebuild with `--target` matching
  your exact Electron version (`npx electron -v`).
- **`mpv.lib` not found** — generate it from `mpv.def` (above) into `vendor/lib/`.

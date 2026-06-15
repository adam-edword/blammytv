# @blammytv/desktop

The Windows (Electron) shell. It loads the BlammyTV web app with **web security
off**, so the renderer can call the Xtream API and play remote live streams
**directly** — no CORS, no stream proxy. This is what makes live playback work
on the desktop.

## Dev

Run the stack, then launch the shell (it loads the Vite dev server):

```powershell
pnpm dev:all                      # backend + app (terminal 1)
pnpm --filter @blammytv/desktop start   # the desktop window (terminal 2)
```

Or all-in-one (waits for the dev server, then opens the window):

```powershell
pnpm desktop
```

Pair (e.g. `ABC234`), add your Xtream playlist in Settings → Playlists, then
click the preview box in Live TV to start a channel.

## Package a Windows installer

```powershell
pnpm --filter @blammytv/desktop build:win
```

Builds the app (relative base), copies it into `renderer/`, and runs
electron-builder to produce an installer under `release/`.

## Notes

- `.ts` live feeds are demuxed with mpegts.js in the renderer; on a desktop CPU
  that's fine. (A native ExoPlayer-style path would only matter on low-power TV
  hardware.)
- Going fully standalone — moving the Xtream adapter into the renderer and
  storing playlists locally so no backend process is needed — is the planned
  next step.

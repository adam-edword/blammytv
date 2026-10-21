<p align="center">
  <img width="2486" height="878" alt="BlammyTV" src="https://github.com/user-attachments/assets/05a1e521-e280-4fe5-ba67-8b4c5d16b0ca" />
</p>

<p align="center">
  <b>Finally, an elegant media hub.</b><br />
  Watch live TV, movies, shows and sports in one free app for Windows.<br />
  Add your own playlists, AIOStreams or Jellyfin server.
</p>

<p align="center">
  <a href="https://github.com/adam-edword/blammytv/releases/latest"><b>Download</b></a> ·
  <a href="https://eddtv.org/">Website</a> ·
  <a href="https://docs.eddtv.org/">Docs</a>
</p>

---

BlammyTV is just a player. It doesn't come with any channels, shows or
streams. You add your own.

## Download

1. Get `BlammyTV_<version>_x64-setup.exe` from the
   [latest release](https://github.com/adam-edword/blammytv/releases/latest).
   Windows 10 and 11, 64-bit.
2. Run it. The app is code-signed, but Windows still warns about a new app
   until enough people have installed it. If it says it protected your PC,
   click **More info**, then **Run anyway**.
3. Add a source: an Xtream login, an M3U playlist, a Stalker portal,
   AIOStreams or your own Jellyfin server.
   [How to add each one](https://docs.eddtv.org/sources/).

It updates itself. When a new version is out, press **Install** in the header
or in **Settings → App → Updates**.

## What it does

- **Live TV with a real guide.** Every channel you add lands in one guide.
  See what's on now and next, scroll a whole day ahead, star the channels you
  watch most, and hide the folders you never open.
- **Multi-View.** Several channels at once, in a grid or with one big. The
  sound follows the tile you pick, and live scores run along the bottom.
- **Sports.** Today's games for the leagues, teams and conferences you follow,
  with the channels showing them. Click a game to watch it. NFL RedZone is one
  click when two or more games are on.
- **Movies and shows.** Your Xtream provider's library, AIOStreams and
  Jellyfin on one home page, with Continue Watching. Keep what you've watched
  in sync with Trakt, and track anime on MyAnimeList.
- **Native video playback.** Everything plays in mpv, built in. Surround
  sound, Skip Intro, Up Next, and audio and subtitle languages you pick once.
- **Your colors.** Any accent color, in dark or light mode, or follow Windows.

## Your data

There's no account and nothing to sign up for. Your sources stay on your PC,
sign-ins are saved in Windows Credential Manager, and the app talks straight
to your providers. [Where your data goes](https://docs.eddtv.org/how-it-works/)
lists every service it contacts.

## Building from source

A pnpm monorepo. The app is React and TypeScript in a Tauri shell
(`apps/app`), with the native side in Rust (`apps/app/src-tauri`) and mpv
loaded from `libmpv-2.dll`.

```bash
pnpm install
pnpm dev          # the interface in a browser, at http://localhost:1420
pnpm typecheck
pnpm lint
pnpm test
```

The full desktop app (`pnpm tauri dev`, from `apps/app`) needs Windows, Rust
with the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), and
three files the build bundles, fetched once:

```powershell
node scripts/fetch-libmpv.mjs   # needs 7-Zip
node scripts/fetch-ffmpeg.mjs
node scripts/fetch-vulkan.mjs
```

[Building](https://docs.eddtv.org/contributing/building/) and
[`CONTRIBUTING.md`](./CONTRIBUTING.md) have the rest. Releases, signing and the
update manifest are in [`RELEASING.md`](./RELEASING.md) and
[`SIGNING.md`](./SIGNING.md).

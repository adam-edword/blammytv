<p align="center">
  <img src="https://i.imgur.com/92ugObX.png" alt="blammytv" />
</p>

<p align="center">
  A self-contained desktop client for live TV &amp; on-demand: Xtream Codes for IPTV, AIOStreams (+ debrid) for movies &amp; shows.
</p>

---

## Download & install (Windows)

1. **Download** the latest installer from the [**Releases page**](https://github.com/adam-edword/blammytv/releases/latest): grab `BlammyTV_<version>_x64-setup.exe` under *Assets*.
2. **Run it.** Windows SmartScreen will say *"Windows protected your PC"* because the build isn't code-signed, click **More info → Run anyway**.
3. **On first launch,** sign in to your **AIOStreams**: type its address and approve the code it shows. A manifest URL still works instead.
4. **For live TV (optional):** add your Xtream playlist under **Settings → Sources** (server URL + username + password). It's kept separate from your AIOStreams setup.

From there the app **checks for updates** when it starts. A new version installs when you press **Install**, in the header or in **Settings → App → Updates**. Each person uses their own AIOStreams URL; nothing is shared.

## What it is

BlammyTV is a free Windows player for live TV and on-demand. Live channels come from Xtream Codes panels; movies and shows resolve on demand through AIOStreams + debrid. There's a full EPG guide, a "now playing" hero, and a native libmpv player that does 4K60.

It's **self-contained**: there's no server to run. The app builds its own catalog on-device from your AIOStreams manifest URL and your Xtream playlists, fetching directly from the Rust side so it isn't blocked by browser CORS. Sideload-only (store review isn't worth the hassle). The goal is **boomer-proof**: anyone can open it and watch.

## What you get

- **Live TV**: an EPG time-grid with a live "now" indicator, category rails, quality badges (4K / HDR / FHD parsed from channel names), and a "now playing" hero that previews whatever programme card you hover.
- **Movies & shows**: a browsable VOD layout backed by AIOStreams; title detail, artwork, and ranked playable sources resolve on demand. Titles with missing metadata fall back to Stremio's free **Cinemeta**.
- **Native player**: a native libmpv player on Windows for 4K60, with mini / theater / fullscreen / pop-out modes.
- **Self-updating**: it checks GitHub Releases when it starts, and a new version installs when you press Install.
- **Profile and theme**: a cosmetic profile (name + avatar), recolorable accent, light/dark theme, and a squircle UI, all stored on-device.

## How it works

**Self-contained, on-device.** There's no backend. On first launch you paste your **AIOStreams manifest URL**; the app fetches that manifest through a small Rust HTTP command (so CORS doesn't apply) and builds a local catalog of movies, shows, and the featured carousel. Add **Xtream playlists** in Settings and it builds the live-TV guide the same way: querying each panel's `player_api` JSON + XMLTV EPG directly. It all assembles into the in-memory **config blob** the UI renders.

Everything you configure lives in **localStorage** on the device:

- **AIOStreams**: your manifest URL (it embeds your debrid/provider config, so treat it as a secret).
- **Playlists**: your Xtream sources (server URL + username + password), kept entirely separate from AIOStreams.
- **Appearance**: accent color, light mode, carousel sources, and "hide channels with no info".
- **Profile**: a cosmetic name + avatar.

> **Security:** your AIOStreams URL, debrid keys, and Xtream credentials never leave the device. They're only used to fetch directly from the providers. Keep your AIOStreams URL private; it's effectively a password.

## Project structure

pnpm monorepo with a single app (for now).

| Package | What it does |
| --- | --- |
| `apps/app` | The React client (Vite + TS), organized by feature: `src/app` (shell + header), `src/features/{live,stream,discover,settings}`, `src/ui` (shared primitives), `src/lib` (utilities), `src/styles` (design tokens + base). Wrapped in a Tauri shell (`apps/app/src-tauri`, Rust) for the Windows build, with the native libmpv player and the self-updater. |

## Getting started

**Prerequisites:** Node 22+ and pnpm 10+ (plus the Rust toolchain and the WebView2 runtime for the desktop build).

```bash
pnpm install

pnpm dev          # web client only (apps/app) at http://localhost:1420: demo data, fast hot-reload
pnpm typecheck    # typecheck every package
pnpm lint         # eslint (flat config)
pnpm test         # vitest across packages
pnpm build        # build all packages
```

`pnpm dev` runs the frontend in a browser, great for UI work, but live TV and real AIOStreams need the native layer. For the real thing, from `apps/app`:

```bash
pnpm tauri dev    # the full desktop app: native player + on-device AIOStreams/Xtream
pnpm tauri build  # produce the signed Windows installer + self-update artifacts
```

Cutting and publishing a release (signing keys, `latest.json`, GitHub Releases) is documented in [`RELEASING.md`](./RELEASING.md). CI runs typecheck + lint + test on every PR to `main` (`.github/workflows/ci.yml`).

## Design notes

The Live tab is an EPG frame: a "now playing" hero with a live mini-player, a source/folder sidebar, and a time-grid guide with a live "now" indicator. Styling is plain CSS (no Tailwind), driven by design tokens extracted from the Figma file into `apps/app/src/styles/tokens.css`, a black theme built on `#0f0f0f` surfaces and the `#c22727` red family. The "Stack Sans" typeface is self-hosted (bundled via Fontsource in `apps/app/src/fonts.ts`), with a system-font fallback in the `--font-headline` / `--font-text` variables.

The desktop player is native **mpv** (loaded at runtime from `libmpv-2.dll`). It renders into a child window for 4K60, parked at the **bottom** of the window's z-order, underneath the transparent React webview, which paints everything else and cuts a clip-path hole where the video shows through (the arrangement Desktop Telly uses). One window, controls-on-video, no readback, and the settings panel opens *over* a still-playing stream. See `apps/app/src-tauri/src/inv.rs`.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for conventions.

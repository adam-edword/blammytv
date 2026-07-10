<p align="center">
  <img src="https://i.imgur.com/cK8Atzh.png" alt="blammytv" />
</p>

<p align="center">
  An elegant, premium IPTV and Stremio player. Bring your own playlists and AIOStreams manifest and enjoy all your content in one beautiful app.<br/>
  <sub>Windows desktop · native libmpv playback · no server to run</sub>
</p>

---

> **Disclaimer: bring your own content.** BlammyTV is a **player application only**. It does not provide, host, sell, or link to any content, channels, playlists, streams, or subscriptions, and it ships with none built in. You must supply your own sources (your own M3U playlists, Xtream Codes credentials, Stalker portal accounts, and AIOStreams manifest) obtained from providers you have the legal right to use. You are solely responsible for the content you access with it; the developers have no affiliation with, and no control over, any provider.

---

## Download & install (Windows)

1. **Download** the latest installer from the [**Releases page**](https://github.com/adam-edword/blammytv/releases/latest): grab `BlammyTV_<version>_x64-setup.exe` under *Assets*.
2. **Run it.** Windows SmartScreen will say *"Windows protected your PC"* because the build isn't code-signed. Click **More info → Run anyway**. (It's an unsigned indie app, not malware.)
3. **For movies & shows:** open **Settings → AIOStreams** and paste your AIOStreams manifest URL.
4. **For live TV:** add your sources under **Settings → Playlists**: Xtream Codes (server URL + username + password), M3U playlists, or Stalker/MAG portals. Kept entirely separate from your AIOStreams setup.

From there the app **updates itself**: new versions install on launch, or on demand from **Settings → Updates**. Each person uses their own sources; nothing is shared.

## What it is

<p align="center">
  <img src="https://i.imgur.com/UT5p0x5.jpeg" alt="btv preview" />
</p>

BlammyTV is a streaming *client* built for one job: making live TV and on-demand feel effortless in a single app. It plays **your** sources: live channels from the IPTV credentials you add (Xtream Codes panels, M3U playlists, Stalker portals), movies and shows resolved through **your** AIOStreams manifest + debrid accounts. The app itself contains and provides no content whatsoever. What it brings is the experience: a full EPG guide, a "now playing" hero with a live mini-player, and a native libmpv player that does real 4K60 and HDR.

It's **self-contained**: there's no server to run and no account to create. The app builds its catalog on-device from your sources, fetching directly from the Rust side so it isn't blocked by browser CORS. Sideload-only (store review isn't worth the hassle), and the whole design goal is a **boomer-proof** experience: simple enough that anyone can pick it up and just watch, no manual required.

## What you get

- **Live TV with a real guide.** An EPG time-grid with a live "now" indicator, a source/folder sidebar with Playlist / Favorites / Recents modes, quality badges (4K / HDR / FHD parsed from channel names), and a "now playing" hero that live-previews whatever guide cell you hover. Hardened for huge playlists (tested against 90 MB-scale providers), with per-source fault isolation, so one broken playlist never sinks the others.
- **Three live source types.** Xtream Codes (`player_api` + XMLTV EPG), plain M3U playlists, and Stalker/MAG portals (full handshake, genres, EPG, and per-play link resolution).
- **Movies & shows.** A browsable VOD hub backed by AIOStreams: title detail, artwork, seasons and episodes, and ranked playable sources resolved on demand. Continue-watching with resume points, watched marks, an Up Next card, and skip-intro (mpv chapter heuristics, upgraded to exact community-sourced intervals from AniSkip for anime). Titles with missing metadata fall back to Stremio's free **Cinemeta**.
- **A player that doesn't compromise.** Native libmpv on Windows for true 4K60 and HDR, with mini / theater / fullscreen / pop-out (PiP) modes, audio & subtitle track menus, automatic failover between sources, and a stats overlay.
- **Self-updating.** New versions install on launch from GitHub Releases (or on demand from Settings).
- **Personal & local.** Recolorable accent, light/dark theme, UI scale, corner style, startup tab, clock format, adult-content filter, all stored on-device.

## How it works

**Self-contained, on-device.** There's no backend. Paste your **AIOStreams manifest URL** in Settings and the app fetches the manifest through a small Rust HTTP command (so CORS doesn't apply) and builds a local catalog of movies, shows, and the featured carousel. Add **live sources** the same way: Xtream panels are queried via their `player_api` JSON + XMLTV EPG, M3U playlists are parsed directly, and Stalker portals get the full MAG handshake. It all assembles into the in-memory catalog the UI renders.

Everything you configure lives in **localStorage** on the device:

- **AIOStreams**: your manifest URL (it embeds your debrid/provider config, so treat it as a secret) and which catalogs feed the hero slider.
- **Playlists**: your Xtream / M3U / Stalker sources and per-source folder visibility, kept entirely separate from AIOStreams.
- **Customize**: accent color, theme, UI scale, corners, clock, startup tab, adult filter, and more.
- **Watch state**: favorites, recents, continue-watching progress, and watched marks.

> **Security:** your AIOStreams URL, debrid keys, and IPTV credentials never leave the device; they're only used to fetch directly from the providers. Keep your AIOStreams URL private; it's effectively a password.

## Status

> **v0.3.x: Live TV and VOD both shipped; Discover is next.**

The app was rebuilt from the ground up against the "IPTV EPG Redesign" Figma file, on top of the battle-tested native layer (the libmpv player, Schannel TLS fetches, the self-updater). **v0.2.0** completed live TV (Xtream, M3U, and Stalker sources, the native player, popout); **v0.3.0** shipped the Stream tab (AIOStreams movies & shows, continue watching, skip intro). The **Discover** tab is a placeholder for now. Current work targets **v0.4.0**.

## Project structure

pnpm monorepo with a single app (for now).

| Path | What it is |
| --- | --- |
| `apps/app` | The React client (Vite + TS), organized by feature: `src/app` (shell + header), `src/features/{live,stream,discover,settings}`, `src/data` (the Xtream / Stalker / AIOStreams / Cinemeta adapters), `src/ui` (shared primitives), `src/lib` (utilities), `src/styles` (design tokens + base). |
| `apps/app/src-tauri` | The Tauri v2 (Rust) shell for the Windows build: the native libmpv player (`inv.rs`, `mpv.rs`), Rust-side HTTP (Windows Schannel TLS), and the self-updater. |
| `scripts/` | Fake Xtream / M3U / Stalker / AIOStreams fixtures and end-to-end verification scripts, plus `release.ps1`. |
| `website/` | The landing page. The client itself also deploys to GitHub Pages as a browser demo (mock data; the native layer is Windows-only). |
| `releases/` | `latest.json` updater manifests for published releases. |

## Getting started

**Prerequisites:** Node 22+ and pnpm 10+ (plus the Rust toolchain and the WebView2 runtime for the desktop build).

```bash
pnpm install

pnpm dev          # web client only (apps/app) at http://localhost:1420 (demo data, fast hot-reload)
pnpm typecheck    # typecheck every package
pnpm lint         # eslint (flat config)
pnpm test         # vitest across packages
pnpm build        # build all packages
```

`pnpm dev` runs the frontend in a browser, which is great for UI work, but real playback and live sources need the native layer. For the real thing, from `apps/app`:

```bash
pnpm tauri dev    # the full desktop app: native player + on-device sources
pnpm tauri build  # produce the signed Windows installer + self-update artifacts
```

Cutting and publishing a release (signing keys, `latest.json`, GitHub Releases) is documented in [`RELEASING.md`](./RELEASING.md). CI runs typecheck + lint + test on every PR to `main` (`.github/workflows/ci.yml`).

## Design notes

The Live tab is an EPG frame: a "now playing" hero with a live mini-player, a source/folder sidebar, and a time-grid guide with a live "now" indicator. Styling is plain CSS (no Tailwind), driven by design tokens extracted from the Figma file into `apps/app/src/styles/tokens.css`: a black theme built on `#0f0f0f` surfaces and the `#c22727` red family, with every accent shade derived from a single `--accent`. The "Stack Sans" typeface is self-hosted (bundled via Fontsource in `apps/app/src/fonts.ts`), with a system-font fallback in the `--font-headline` / `--font-text` variables.

The desktop player is the interesting bit: native **mpv** (loaded at runtime from `libmpv-2.dll`) renders into a child window for true 4K60, parked at the **bottom** of the window's z-order, underneath the transparent React webview, which paints everything else and cuts a clip-path hole where the video shows through (the arrangement Desktop Telly uses). One window, controls-on-video, no readback, and the settings panel opens *over* a still-playing stream. Anything drawn over the video portals into the shell's chrome layer. See `apps/app/src-tauri/src/inv.rs`.

Fetches happen Rust-side through **reqwest on Windows Schannel** (the same TLS stack as curl and Edge). Some Cloudflare-fronted providers 403 rustls's distinct TLS fingerprint even with browser-identical headers, and Schannel ships with Windows so the bundle stays self-contained.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for conventions.

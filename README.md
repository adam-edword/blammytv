<p align="center">
  <img src="https://i.imgur.com/92ugObX.png" alt="blammytv" />
</p>

<p align="center">
  A self-contained desktop client for live TV &amp; on-demand — Xtream Codes for IPTV, AIOStreams (+ debrid) for movies &amp; shows.<br/>
  Windows sideload, <strong>"boomer-proof"</strong> UX, designer-focused UI.
</p>

---

## Download & install (Windows)

1. **Download** the latest installer from the [**Releases page**](https://github.com/adam-edword/blammytv/releases/latest) — grab `BlammyTV_<version>_x64-setup.exe` under *Assets*.
2. **Run it.** Windows SmartScreen will say *"Windows protected your PC"* because the build isn't code-signed — click **More info → Run anyway**. (It's an unsigned indie app, not malware.)
3. **On first launch,** paste your **AIOStreams manifest URL** when prompted — that's all you need to start watching movies & shows.
4. **For live TV (optional):** add your Xtream playlist under **Settings → Playlists** (server URL + username + password). It's kept separate from your AIOStreams setup.

From there the app **updates itself** — new versions install on launch, or via **Settings → Updates → Check for updates**. Each person uses their own AIOStreams URL; nothing is shared.

## What it is

BlammyTV is a streaming client built for one job: making live TV and on-demand feel effortless. Live channels come from Xtream Codes panels; movies and shows resolve on demand through AIOStreams + debrid. There's a full EPG guide, a "now playing" hero, and a native libmpv player that does real 4K60.

It's **self-contained** — there's no server to run. The app builds its own catalog on-device from your AIOStreams manifest URL and your Xtream playlists, fetching directly from the Rust side so it isn't blocked by browser CORS. Sideload-only (store review isn't worth the hassle), and the whole design goal is a **boomer-proof** experience: simple enough that anyone can pick it up and just watch, no manual required.

## What you get

- **Live TV with a real guide** — an EPG time-grid with a live "now" indicator, category rails, quality badges (4K / HDR / FHD parsed from channel names), and a "now playing" hero that previews whatever programme card you hover.
- **Movies & shows** — a browsable VOD layout backed by AIOStreams; title detail, artwork, and ranked playable sources resolve on demand. Titles with missing metadata fall back to Stremio's free **Cinemeta**.
- **A player that doesn't compromise** — a native libmpv composition player on Windows for true 4K60, with mini / theater / fullscreen / pop-out modes.
- **Self-updating** — new versions install on launch from GitHub Releases (or on demand from Settings).
- **Personal & local** — a cosmetic profile (name + avatar), recolorable accent, light/dark theme, UI scale, and a squircle UI — all stored on-device.

## Status

> **v0.2.x — a working alpha.**

Live TV (Xtream) and movies & shows (AIOStreams) are wired end-to-end, and the app self-updates from GitHub Releases. The **Discover** tab is still a placeholder, and on-screen **search** isn't wired up yet. Everything is managed in-app — there's no separate web UI.

## How it works

**Self-contained, on-device.** There's no backend. On first launch you paste your **AIOStreams manifest URL**; the app fetches that manifest through a small Rust HTTP command (so CORS doesn't apply) and builds a local catalog of movies, shows, and the featured carousel. Add **Xtream playlists** in Settings and it builds the live-TV guide the same way — querying each panel's `player_api` JSON + XMLTV EPG directly. It all assembles into the in-memory **config blob** the UI renders.

Everything you configure lives in **localStorage** on the device:

- **AIOStreams** — your manifest URL (it embeds your debrid/provider config, so treat it as a secret).
- **Playlists** — your Xtream sources (server URL + username + password), kept entirely separate from AIOStreams.
- **Customize** — accent color, UI scale, light mode, carousel sources, and "hide channels with no info".
- **Profile** — a cosmetic name + avatar.

> **Security:** your AIOStreams URL, debrid keys, and Xtream credentials never leave the device — they're only used to fetch directly from the providers. Keep your AIOStreams URL private; it's effectively a password.

## Project structure

pnpm monorepo.

| Package | What it does |
| --- | --- |
| `packages/shared` | The `ConfigBlob` types + zod schemas the UI renders against, plus a bundled mock blob for demo mode. |
| `apps/app` | The React client (Vite + TS): the `Live TV \| Stream \| Discover` tabs, the EPG guide, and the in-app + theater player. Wrapped in a Tauri shell (`apps/app/src-tauri`, Rust) for the Windows build, with the native libmpv composition player and the self-updater. |

## Getting started

**Prerequisites:** Node 22+ and pnpm 10+ (plus the Rust toolchain and the WebView2 runtime for the desktop build).

```bash
pnpm install

pnpm dev          # web client only (apps/app) at http://localhost:1420 — demo data, fast hot-reload
pnpm typecheck    # typecheck every package
pnpm lint         # eslint (flat config)
pnpm test         # vitest across packages
pnpm build        # build all packages
```

`pnpm dev` runs the frontend in a browser on **demo data** (the bundled mock blob from `packages/shared`) — great for UI work, but live TV and real AIOStreams need the native layer. For the real thing, from `apps/app`:

```bash
pnpm tauri dev    # the full desktop app — native player + on-device AIOStreams/Xtream
pnpm tauri build  # produce the signed Windows installer + self-update artifacts
```

Cutting and publishing a release (signing keys, `latest.json`, GitHub Releases) is documented in [`RELEASING.md`](./RELEASING.md). CI runs typecheck + lint + test on every PR to `main` (`.github/workflows/ci.yml`).

## Design notes

The Live tab is an EPG frame: a "now playing" hero, a category rail, and a time-grid guide with a live "now" indicator. Styling is plain CSS (no Tailwind), driven by design tokens in `apps/app/src/styles.css` — a desaturated dark theme, squircle corners (`corner-shape`), and a recolorable accent. The "Stack Sans" typeface is self-hosted (bundled via Fontsource in `apps/app/src/fonts.ts`), with a system-font fallback in the `--font-headline` / `--font-text` variables.

The desktop player is the interesting bit: native **mpv** (loaded at runtime from `libmpv-2.dll`) renders into a child window for true 4K60, and a transparent composition-hosted **WebView2** (the React control overlay) is composited over it with **DirectComposition** — one window, controls-on-video, no readback. See `apps/app/src-tauri/src/comp.rs`.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for conventions.

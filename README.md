<p align="center">
  <img src="https://i.imgur.com/DajrQUR.png" alt="blammytv" />
</p>

<p align="center">
  A lovely IPTV &amp; AIOStreams client — Xtream Codes for live TV, AIOStreams for movies &amp; shows.<br/>
  Sideload-only, <strong>"boomer-proof"</strong> UX, designer-focused UI.
</p>

---

## What it is

blammytv is a streaming client built for one job: making live TV and on-demand feel effortless. Live channels come from Xtream Codes panels; movies and shows resolve on demand through AIOStreams + debrid. There's a full EPG guide, a "now playing" hero, and a native player that does real 4K60.

It's sideload-only — getting an app like this through store review isn't worth the hassle — and the whole design goal is a **boomer-proof** experience: simple enough that anyone can pick it up and just watch, no manual required.

## What you get

- **Live TV with a real guide** — an EPG time-grid with a live "now" indicator, category rails, and a "now playing" hero.
- **Movies & shows on demand** — resolved through AIOStreams + debrid.
- **A player that doesn't compromise** — a native libmpv composition player on Windows for true 4K60, with mini / theater / fullscreen / pop-out modes.
- **Nothing to configure on the couch** — pair once with a share code and start watching.

## Status

> **v0.1.0 — early, but real.**

Work in progress. The web config UI isn't built yet and the backend is only partial. By default `apps/app` renders a validated **mock** config blob from `packages/shared`, so you can run and develop the client standalone today. Pointing it at a real backend is a one-function change in `apps/app/src/lib/config.ts` (set `VITE_API_URL`).

## How it works

The backend is the single source of truth, and the apps are **dumb terminals**:

- a device pairs with a **share code** on first launch,
- it pulls a **config blob** and just renders it,
- there are no settings screens on-device — all config (stream URLs, debrid keys, channel/group visibility, ordering, favorites) lives in a web UI.

The share-code entry is the only thing you ever type on-device. Secrets never reach the client: the backend resolves debrid keys and Xtream credentials, and only ever hands the device playable stream URLs.

## Project structure

pnpm monorepo.

| Package | What it does |
| --- | --- |
| `packages/shared` | The config-blob + share-code types / zod schemas (plus a mock blob). The contract every client renders against. |
| `apps/app` | The React client (Vite + TS): pairing, the `Live TV \| Stream \| Discover` tabs, the EPG guide, and the in-app + theater player. Wrapped in a Tauri shell (`apps/app/src-tauri`) for the sideloaded Windows build, with a native libmpv composition player for true 4K60. |
| `apps/server` | The backend (Hono): resolves Xtream credentials and maps panels → the config blob. |

## Getting started

**Prerequisites:** Node 22+ and pnpm 10+.

```bash
pnpm install

pnpm dev          # run the web client (apps/app) on http://localhost:1420
pnpm dev:all      # run the server + web client together
pnpm typecheck    # typecheck every package
pnpm lint         # eslint (flat config)
pnpm test         # vitest across packages
pnpm build        # build all packages
```

CI runs typecheck + lint + test on every PR to `main` — see `.github/workflows/ci.yml`.

## Design notes

The Live tab is an EPG frame: a "now playing" hero, a category rail, and a time-grid guide with a live "now" indicator. Styling is plain CSS (no Tailwind), driven by design tokens in `apps/app/src/styles.css`. The "Stack Sans" typeface is self-hosted (bundled via Fontsource in `apps/app/src/fonts.ts`), with a system-font fallback in the `--font-headline` / `--font-text` variables.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for conventions and a walkthrough on adding a new app (e.g. a Next.js client).

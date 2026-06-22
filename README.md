# blammytv

react-based iptv client supporting xtream codes (iptv) + debrid for tv/movies. sideload-only, since app stores will be a pain to get published on — both of us are fine with that. north star: "boomer-proof" ux, simple enough that anyone can use it.

## architecture

the backend is the single source of truth; the apps are **dumb terminals**. a
device pairs with a share code, pulls a config blob on load, and just renders it.
there are no settings screens on-device — all config (stream urls, debrid keys,
channel/group visibility, ordering, favorites) lives in a web ui. the one allowed
on-device input is the share-code entry on first launch.

secrets never reach the client: the backend resolves debrid keys / xtream
credentials and only ever hands the device playable stream urls.

## repo layout

pnpm monorepo:

| package | what |
| --- | --- |
| `packages/shared` | the config-blob + share-code types/zod schemas (+ a mock blob) — the contract every client renders |
| `apps/app` | the React client (Vite + TS): pairing, `Live TV \| Stream \| Discover` tabs, the EPG guide, and the in-app + theater video player. Wrapped by a Tauri shell (`apps/app/src-tauri`) for the sideloaded Windows app, with a native libmpv composition player for true 4K60 |
| `apps/server` | the backend (Hono): resolves xtream credentials and maps panels → the config blob |

> the web config ui isn't built yet, and the backend is partial. by default
> `apps/app` renders a validated **mock** config blob (from `packages/shared`);
> pointing it at the real backend is a one-function change in
> `apps/app/src/lib/config.ts` (set `VITE_API_URL`).

## develop

requires node 22+ and pnpm 10+.

```bash
pnpm install
pnpm dev          # run the web client (apps/app) on http://localhost:1420
pnpm dev:all      # run the server + web client together
pnpm typecheck    # typecheck every package
pnpm lint         # eslint (flat config)
pnpm test         # vitest across packages
pnpm build        # build all packages
```

CI runs typecheck + lint + test on every PR to `main` (`.github/workflows/ci.yml`).
new contributors: see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for conventions and a
guide to adding a new app (e.g. a Next.js one).

the Live tab is built from the EPG Figma frame: a "now playing" hero, a category
rail, and a time-grid guide with a live "now" indicator. it's plain CSS (no
Tailwind) using design tokens in `apps/app/src/styles.css`. the "Stack Sans" fonts
are self-hosted (bundled via Fontsource in `apps/app/src/fonts.ts`), with a
system-font fallback in the `--font-headline` / `--font-text` variables.

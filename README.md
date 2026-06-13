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
| `packages/shared` | the config-blob + share-code types/zod schemas — the contract every client renders |
| `apps/app` | the React client (Vite + TS, Tauri-ready): pairing screen, `Live TV \| Series \| Movies` tabs, EPG guide, loading skeletons |

> the backend config API and the web config ui are not built yet. `apps/app`
> currently renders a validated **mock** config blob (see
> `apps/app/src/lib/mockConfig.ts`); swapping in the real backend is a one-function
> change in `apps/app/src/lib/config.ts`.

## develop

requires node 22+ and pnpm 10+.

```bash
pnpm install
pnpm dev          # run the client (apps/app) on http://localhost:1420
pnpm typecheck    # typecheck all packages
pnpm build        # build all packages
```

the Live tab is built from the EPG Figma frame: a "now playing" hero, a category
rail, and a time-grid guide with a live "now" indicator. it's plain CSS (no
Tailwind) using design tokens in `apps/app/src/styles.css`. the "Stack Sans" fonts
from the design aren't bundled yet — there's a system-font fallback in the
`--font-headline` / `--font-text` variables.

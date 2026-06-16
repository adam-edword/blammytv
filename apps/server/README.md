# @blammytv/server

The BlammyTV backend — the single source of truth. The apps are dumb terminals
that render the `ConfigBlob` this server hands them. Secrets (Xtream
credentials, the per-user aiostreams manifest URL, debrid keys) live here and
never reach the device.

## Run

```sh
pnpm --filter @blammytv/server dev     # tsx watch, http://localhost:8787
# or
PORT=9000 pnpm --filter @blammytv/server start
```

Point the app at it by building with `VITE_API_URL`:

```sh
VITE_API_URL=http://localhost:8787 pnpm --filter @blammytv/app dev
```

With no `VITE_API_URL`, the app runs in **demo mode** and serves the bundled
seed (this is what the GitHub Pages showcase uses).

## Endpoints

- `GET /health` → `{ ok: true }`
- `GET /config` → the device's `ConfigBlob`, authenticated by the share code
  (`Authorization: Bearer <code>`). Validated against `@blammytv/shared`'s
  `ConfigBlobSchema` before it's sent.

## Roadmap

1. **Pairing + `/config`** (this milestone) — serves a seeded blob.
2. **Xtream** — live channels + EPG.
3. **aiostreams** — Stream catalogs/metadata + on-demand source resolution
   (`/meta/:id`, `/sources/:id`).
4. **Web config UI** — where users enter their Xtream creds + aiostreams
   manifest and manage favorites / hidden groups.

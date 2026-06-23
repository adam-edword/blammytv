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

All but `/health` require the device's share code (`Authorization: Bearer <code>`).

- `GET /health` → `{ ok: true }`
- `GET /config` → the device's `ConfigBlob` (live ← Xtream, VOD ← AIOStreams),
  validated against `@blammytv/shared`'s `ConfigBlobSchema` before it's sent.
- `GET /vod/:type/:id` → `{ item }` — on-demand title detail (synopsis, cast,
  and seasons/episodes for series). `type` is `movie` | `series`.
- `GET /sources/:type/:id` → `{ sources }` — on-demand ranked playable sources
  for a title (`tt123`) or episode (`tt123:1:2`).
- `GET|POST|PATCH|DELETE /admin/sources…` → manage Xtream playlists.

## VOD (AIOStreams)

VOD is a single, decoupled Stremio-protocol connection — set
`BLAMMY_AIOSTREAMS_URL` (see `.env.example`) to your AIOStreams manifest URL.
Browse catalogs + metadata come from it; playable sources are resolved
on-demand when a title is opened (the config blob stays small and the secret
manifest never reaches the device). With it unset, the Stream tab serves the
bundled demo catalog.

## Roadmap

1. **Pairing + `/config`** ✅ — serves the blob.
2. **Xtream** ✅ — live channels + EPG.
3. **aiostreams** 🚧 — VOD catalogs/metadata + on-demand source resolution
   (server side done; app-side Stream tab wiring next).
4. **Web config UI** — where users enter their Xtream creds + aiostreams
   manifest and manage favorites / hidden groups.

# contributing

welcome! this is a **pnpm monorepo**. the high-level architecture (a
**self-contained** desktop client — Xtream Codes for live TV, AIOStreams + debrid
for movies/shows, a native libmpv player) is in the [README](./README.md) — worth
reading first.

## prerequisites

- **node 22+** and **pnpm 10+** (`corepack enable` will get you the pinned pnpm)
- everything installs from the root: `pnpm install`
- the native Windows app additionally needs the **Rust toolchain** + the Tauri
  prerequisites and a local `libmpv-2.dll` — see [RELEASING.md](./RELEASING.md).

## the loop

| command | what |
| --- | --- |
| `pnpm dev` | web/dev client (`apps/app`) on http://localhost:1420 |
| `pnpm tauri dev` | the full native desktop app (Windows; from `apps/app`) |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm lint` | eslint (flat config, `eslint.config.mjs`) |
| `pnpm test` | vitest across packages |
| `pnpm build` | build everything |

`pnpm <cmd>` at the root fans out across the workspace, so a new package that
defines `typecheck` / `lint` / `test` is picked up automatically — including by CI.

## conventions

- **branches & PRs** — branch off `main`, open a PR back into `main`. CI
  (`.github/workflows/ci.yml`) runs typecheck + lint + test on every PR; keep it
  green.
- **the app is self-contained and on-device** — live TV comes from the user's
  playlists, VOD from their AIOStreams manifest, both fetched via the Rust layer.
  domain types live next to the feature that owns them (`apps/app/src/features/*`).
- **secrets live on-device, and never get committed.** the AIOStreams manifest URL
  (which embeds debrid keys) and Xtream credentials are stored in the user's
  `localStorage` and read by the Rust layer at request time — they are *not*
  baked into the build or sent anywhere we don't control. never commit
  credentials, `.env` files, or the updater signing key (only the **public**
  minisign key belongs in the repo).
- **style is enforced, not argued** — `eslint.config.mjs` + `tsconfig.base.json`
  (strict, no unused locals/params). run `pnpm lint` / `pnpm typecheck` before a PR.
- **tests** — pure logic gets a `*.test.ts` next to it (see `apps/app/src/lib`).

## adding a new app (e.g. a Next.js app)

the workspace globs `apps/*` (`pnpm-workspace.yaml`), so a new `apps/web/` joins
automatically — no registration needed. a few things to wire up:

1. **tsconfig.** extend the repo base so strictness/casing stay consistent, then
   layer Next's needs on top:

   ```jsonc
   // apps/web/tsconfig.json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": { "jsx": "preserve", "plugins": [{ "name": "next" }] }
   }
   ```

2. **scripts.** give `apps/web/package.json` a `typecheck`, `lint`, and `test`
   script so the root commands and CI cover it for free:

   ```jsonc
   "scripts": {
     "dev": "next dev",
     "build": "next build",
     "typecheck": "tsc --noEmit",
     "lint": "next lint",
     "test": "vitest run"
   }
   ```

3. **eslint.** the flat config is organized per-area. add an `apps/web/**` block
   (with `@next/eslint-plugin-next` if you want Next's rules); until then, the base
   TS + React rules already apply. keeping `pnpm lint` at 0 is the bar.

4. **native build deps.** pnpm blocks dependency build scripts by default. if a
   Next dep needs one (e.g. `sharp`), add it to `onlyBuiltDependencies` in
   `pnpm-workspace.yaml` (where `esbuild` already lives).

that's it — `pnpm install`, the SessionStart hook, and CI all extend to the new
package without further setup.

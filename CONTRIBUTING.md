# contributing

welcome! this is a **pnpm monorepo**. the high-level architecture (dumb-terminal
clients, backend-owned config, secrets stay server-side) is in the
[README](./README.md) — worth reading first.

## prerequisites

- **node 22+** and **pnpm 10+** (`corepack enable` will get you the pinned pnpm)
- everything installs from the root: `pnpm install`

## the loop

| command | what |
| --- | --- |
| `pnpm dev` | web client (`apps/app`) on http://localhost:1420 |
| `pnpm desktop` | full desktop app (server + app + electron) |
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
- **the contract lives in `packages/shared`** — config-blob + share-code types and
  zod schemas. clients only ever render a **validated** config blob; if you change
  the shape, change it here so every client (and the mock) stays in sync.
- **secrets never reach a client.** debrid keys / xtream credentials are resolved
  server-side; clients only get playable URLs. don't add on-device config inputs
  (the share code is the one allowed exception) and don't commit credentials.
- **style is enforced, not argued** — `eslint.config.mjs` + `tsconfig.base.json`
  (strict, no unused locals/params). run `pnpm lint` / `pnpm typecheck` before a PR.
- **tests** — pure logic gets a `*.test.ts` next to it (see `apps/app/src/lib`,
  `apps/server/src/xtream/mapper.test.ts`).

## adding a new app (e.g. a Next.js app)

the workspace globs `apps/*` and `packages/*` (`pnpm-workspace.yaml`), so a new
`apps/web/` joins automatically — no registration needed. a few things to wire up:

1. **share the contract.** import `@blammytv/shared` for the config-blob types,
   zod schemas, and the mock. it's published as **raw TypeScript** (`exports` →
   `src/index.ts`), so Next won't transpile it out of the box — add it to
   `transpilePackages` in `next.config`:

   ```js
   // apps/web/next.config.mjs
   export default { transpilePackages: ["@blammytv/shared"] };
   ```

2. **tsconfig.** extend the repo base so strictness/casing stay consistent, then
   layer Next's needs on top:

   ```jsonc
   // apps/web/tsconfig.json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": { "jsx": "preserve", "plugins": [{ "name": "next" }] }
   }
   ```

3. **scripts.** give `apps/web/package.json` a `typecheck`, `lint`, and `test`
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

4. **eslint.** the flat config is organized per-area. add an `apps/web/**` block
   (with `@next/eslint-plugin-next` if you want Next's rules); until then, the base
   TS + React rules already apply. keeping `pnpm lint` at 0 is the bar.

5. **native build deps.** pnpm blocks dependency build scripts by default. if a
   Next dep needs one (e.g. `sharp`), add it to `onlyBuiltDependencies` in
   `pnpm-workspace.yaml` (where `esbuild` and `electron` already live).

that's it — `pnpm install`, the SessionStart hook, and CI all extend to the new
package without further setup.

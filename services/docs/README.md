# BlammyTV docs

The documentation site at **docs.eddtv.org**. Astro + Starlight, built to
static HTML and served from an nginx container. Same shape as
`services/site`, with a build step in front of it.

## Local preview

```sh
cd services/docs
npm ci
npm run dev        # → http://localhost:4321
```

Or the real container, exactly as it runs in production:

```sh
docker build -t blammytv-docs services/docs
docker run --rm -p 8081:80 blammytv-docs   # → http://localhost:8081
```

## Why this is not a pnpm workspace member

`services/docs` is excluded in `pnpm-workspace.yaml` and carries its own
`package-lock.json`. Astro's ~360-package dependency tree has nothing to do
with the app, and folding it into the root lockfile would slow every
developer's install and every CI run for a site that deploys on its own.
The Docker build context is this folder only, so the root lockfile would not
be reachable from it anyway.

The cost of that choice: **CI does not build the docs**, because CI runs
`pnpm -r` over the workspace. A broken docs build surfaces at deploy time
instead. Run `npm run build` here before pushing.

## Writing

Pages live in `src/content/docs/`, one Markdown file per page. The sidebar is
**not** inferred from the filesystem. It's declared in `astro.config.mjs`,
so a new page needs an entry there or it will build but never be linked.

Starlight's components (`Card`, `CardGrid`, `Aside`, `Steps`, `Tabs`,
`LinkCard`, `FileTree`) are available in `.mdx` pages. Plain `.md` gets the
`:::note` / `:::tip` / `:::caution` / `:::danger` callout syntax without any
imports, which covers most of what a page needs.

### What does not go on this site

Public documentation only. `plans/`, `HANDOFF.md`, `RELEASING.md`,
`SIGNING.md`, the audit reports and anything describing `services/keybox`
internals stay in the repository. The rule of thumb: publish architecture that
answers a **user's** question, not architecture that answers ours.

## Theme

`src/styles/blammytv.css` maps Starlight's custom properties onto the brand
tokens from `services/site/index.html` and the Stack Sans faces the marketing
site already ships. The six `.woff2` files in `public/fonts/` are copies of
the ones in `services/site/assets/`, duplicated deliberately because the
Docker build context is scoped to this folder and cannot reach across to
`services/site`.

## Deploy (Coolify)

Deployed from the **`docs`** branch as a Dockerfile resource.

| Setting             | Value           |
| ------------------- | --------------- |
| Build Pack          | Dockerfile      |
| Branch              | `docs`          |
| Base Directory      | `services/docs` |
| Dockerfile Location | `Dockerfile`    |
| Port                | `80`            |
| Health check path   | `/health`       |
| Domain              | `docs.eddtv.org`|

**Write on `main`, then fast-forward `docs` from it. Never commit to `docs`
directly.** The `website` branch is the cautionary tale: three commits landed
on it and nowhere else, so for months the live marketing site's content
existed only on a deploy branch and `main`'s copy was stale.

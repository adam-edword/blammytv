# BlammyTV docs

The documentation site at **docs.eddtv.org**. Next.js + Fumadocs + Tailwind 4,
exported to static HTML and served from an nginx container. The look is
[shadcn/ui's docs](https://ui.shadcn.com/docs), built from the same code (see
`THIRD_PARTY_NOTICES.md`). Same deploy shape as `services/site`, with a build
step in front of it.

## Local preview

```sh
cd services/docs
npm ci
npm run dev        # → http://localhost:3000
```

The dev server hot-reloads pages, and search works in it.

The exported site, served the way production serves it:

```sh
npm run build                          # writes out/
python3 -m http.server -d out 8080     # → http://localhost:8080
```

Or the real container, exactly as it runs in production:

```sh
docker build -t blammytv-docs services/docs
docker run --rm -p 8081:80 blammytv-docs   # → http://localhost:8081
```

`python3 -m http.server` doesn't serve `404.html` for a missing page. nginx
does.

## Why this is not a pnpm workspace member

`services/docs` is excluded in `pnpm-workspace.yaml` and carries its own
`package-lock.json`. Next's ~330-package dependency tree has nothing to do with
the app, and folding it into the root lockfile would slow every developer's
install and every CI run for a site that deploys on its own. The Docker build
context is this folder only, so the root lockfile would not be reachable from
it anyway.

The cost of that choice: **CI does not build the docs**, because CI runs
`pnpm -r` over the workspace. A broken docs build surfaces at deploy time
instead. Run `npm run build` here before pushing. It type-checks the site too.

## Writing

Pages are `.mdx` files in `content/docs/`, one per page. The path is the URL:
`content/docs/sources/xtream.mdx` is `/sources/xtream/`, and a folder's
`index.mdx` is the folder's own URL. Every page needs a `title` and a
`description` in its frontmatter:

```mdx
---
title: Xtream Codes
description: Connect an Xtream Codes panel.
---
```

**The sidebar order is declared, not inferred.** Each folder has a `meta.json`
with its group label and the order of its pages, by file name without the
extension:

```json
{
  "title": "Sources",
  "pages": ["index", "xtream", "m3u"]
}
```

A page missing from `pages` is left out of the sidebar. New top-level folders
go in `content/docs/meta.json`. Group labels are in Title Case.

Pages are MDX, so a literal `{`, `}` or `<` in prose needs backticks or an
escape (`\{`). Inside a code fence it's fine.

Components available in any page: `Callout` (`variant="warning"` for the
amber one), `Steps` and `Step`, `Kbd`, `Button`, `Alert`, `AlertTitle`,
`AlertDescription`, `Link` and `LinkedCard`. They're listed at the bottom of
`mdx-components.tsx`, which is also where to add more.

```mdx
<Callout title="Heads up">

Markdown works in here, with a blank line on each side of it.

</Callout>
```

Search is full-text and built at deploy time (`app/search.json/route.ts`
writes `out/search.json`), so a new page is searchable once it's built.

### What does not go on this site

Public documentation only. `plans/`, `HANDOFF.md`, `RELEASING.md`,
`SIGNING.md`, the audit reports and anything describing `services/keybox`
internals stay in the repository. The rule of thumb: publish architecture that
answers a **user's** question, not architecture that answers ours.

## Theme

The chrome is shadcn/ui's docs, unchanged: its neutral palette, spacing and
light and dark modes. Only the logo, name, nav links, footer text and content
are ours. The colour tokens are in `app/globals.css`, the article styles in
`app/typeset.css`, and the components under `registry/new-york-v4/ui/` are
shadcn's own.

Fonts are Geist and Geist Mono from the `geist` package, bundled at build time
rather than fetched from Google.

## Deploy (Coolify)

Deployed from the **`docs`** branch as a Dockerfile resource. **A push
doesn't deploy it**: after pushing `docs`, hit **Redeploy** on the resource
in Coolify (2026-10-21, the first Next.js build sat until a manual one).
`/version.txt` shows the build time of what's live.

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

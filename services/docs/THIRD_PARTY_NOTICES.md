# Third-party notices

The docs site at docs.eddtv.org uses the look, layout and components of
[shadcn/ui's documentation site](https://ui.shadcn.com/docs). The files below
are copied from it, in most cases trimmed to what a docs site needs, with the
logo, name, navigation, footer and content changed to BlammyTV's.

Source: https://github.com/shadcn-ui/ui, `apps/v4`, commit
`ba1503c64472b82256d9de95e2e62c5901a38e8b`.

## Files derived from shadcn/ui

| Here | From (`apps/v4/`) |
| --- | --- |
| `app/layout.tsx` | `app/layout.tsx` and `app/(app)/layout.tsx` |
| `app/[[...slug]]/layout.tsx` | `app/(app)/docs/layout.tsx` |
| `app/[[...slug]]/page.tsx` | `app/(app)/docs/[[...slug]]/page.tsx` |
| `app/globals.css` | `app/globals.css` |
| `app/typeset.css` | `app/(app)/(typeset)/typeset.css` |
| `app/shadcn-tailwind.css` | `dist/tailwind.css` from the `shadcn` npm package, version 4.22.1 |
| `components/callout.tsx` | `components/callout.tsx` |
| `components/command-menu.tsx` | `components/command-menu.tsx` |
| `components/copy-button.tsx` | `components/copy-button.tsx` |
| `components/docs-sidebar.tsx` | `components/docs-sidebar.tsx` |
| `components/docs-toc.tsx` | `components/docs-toc.tsx` |
| `components/github-link.tsx` | `components/github-link.tsx` |
| `components/icons.tsx` | `components/icons.tsx` |
| `components/main-nav.tsx` | `components/main-nav.tsx` |
| `components/mobile-nav.tsx` | `components/mobile-nav.tsx` |
| `components/mode-switcher.tsx` | `components/mode-switcher.tsx` |
| `components/site-footer.tsx` | `components/site-footer.tsx` |
| `components/site-header.tsx` | `components/site-header.tsx` |
| `components/theme-provider.tsx` | `components/theme-provider.tsx` |
| `hooks/use-meta-color.ts` | `hooks/use-meta-color.ts` |
| `lib/config.ts` | `lib/config.ts` |
| `lib/docs-sidebar-scroll.ts` | `lib/docs-sidebar-scroll.ts` |
| `lib/highlight-code.ts` | `lib/highlight-code.ts` |
| `lib/page-tree.ts` | `lib/page-tree.ts` |
| `lib/source.ts` | `lib/source.ts` |
| `mdx-components.tsx` | `mdx-components.tsx` |
| `source.config.ts` | `source.config.ts` |
| `postcss.config.mjs`, `tsconfig.json` | the same files |
| `registry/new-york-v4/ui/*.tsx` | `registry/new-york-v4/ui/` (alert, button, command, dialog, input, kbd, popover, separator, sheet, sidebar, skeleton, spinner, tooltip) |
| `registry/new-york-v4/hooks/use-mobile.ts` | `registry/new-york-v4/hooks/use-mobile.ts` |

Everything else in this folder is BlammyTV's own: the content, `app/not-found.tsx`,
`app/robots.ts`, `app/sitemap.ts`, `app/search.json/route.ts`, `lib/fonts.ts`,
`next.config.mjs` and the Docker and nginx files.

## shadcn/ui license

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

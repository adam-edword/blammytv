# `src/components/ui` is shadcn's, not ours

Everything under `ui/` is **generated**, by:

```
cd apps/app && npx shadcn@latest add button dialog popover dropdown-menu tooltip
```

It reads `components.json` at the app root, writes into `src/components/ui/`,
and imports `cn` from `@/lib/utils`. Both paths are already wired: the `@/*`
alias is in `vite.config.ts` and `tsconfig.json`, and the runtime packages
it needs (Radix, `class-variance-authority`, `clsx`, `tailwind-merge`,
`lucide-react`) are already installed, so `add` will not have to fetch them.

## Edit them freely, but know what you are giving up

That is the whole shadcn model: the code lands in the repo and belongs to
us. Re-running `add` for the same component **overwrites the file**, so a
component that has been edited should either be left alone or copied out
from under `ui/` first. Prefer passing `className` at the call site over
editing the generated file: `cn()` is built so a caller's utility wins.

## They are Tailwind-only on purpose

A generated component uses stock Tailwind classes (`bg-background`,
`rounded-md`). Those resolve because `styles/theme.css` republishes the
app's tokens into Tailwind's namespace, so `bg-surface` and `text-muted`
reach the real palette and follow the user's picked accent. Reach for the
app's names, not the stock scale.

They land in `@layer components`, below `utilities` and above `app` (see
`styles/index.css`), which is what lets a call-site utility override a
component's own styling while the component still overrides the app's older
selectors.

## Preflight is OFF

shadcn's components are written expecting Tailwind's Preflight reset, and
this app does not load it: `base.css` already answered every question
Preflight answers, differently and on purpose. In practice the generated
components are fine without it, because they set what they need
explicitly. The place it shows up is bare `<ul>`, `<h1>`-`<h6>` and
`<button>` inside a generated component, which inherit the app's base
styles rather than Preflight's. Check those, and fix them in the component
rather than by switching Preflight on: turning it on is a whole-app change
with its own screenshot pass, and `styles/index.css` explains what it would
move.

# old/themes

The whole Themes feature, parked out of the build at v0.9.58.

Adam's call, mid-redesign: *"i think we should remove themes for now for this
redesign build. it's just complicating things and would be easier to not have
to worry about."*

He was right about the complicating. A theme pack pins `--bg`, `--surface`,
`--border` and the text tiers at the same specificity from a file imported
**after** `tokens.css`, so any pack silently outranks the base palette. That
is exactly what made v0.9.57's shadcn palette invisible until the default pack
moved, and it would have gone on happening for every token the redesign
touched.

## Nothing here is in the build

`old/` is outside `apps/app`, so it is on no tsconfig include path and is not
compiled. `eslint.config.mjs` ignores it. The three stylesheets are not
imported by `styles/index.css`. These files reference modules that have moved;
they are a record, not code.

| File | Was |
|---|---|
| `app/ThemesModal.tsx` | `apps/app/src/features/settings/ThemesModal.tsx` |
| `app/themePacks.ts` + `.test.ts` | same directory |
| `app/license.ts` + `.test.ts` | same directory — the Themes Pass |
| `styles/themes.css` | `apps/app/src/styles/themes.css` |
| `styles/packs.css` | the four free packs |
| `styles/intense-packs.css` | Terminal, Kawaii, Dither, Streamy |
| `scripts/verify-themes.mjs` | 18 checks |
| `scripts/verify-intense-themes.mjs` | 30 checks |
| `scripts/verify-license.mjs` | 13 checks |

## What went with it, that is not in this folder

Three things lived inside the modal rather than beside it, so removing the
modal removed them. Their code is still in the app, unreferenced:

- **The accent picker.** `accent.ts` keeps `ACCENT_PRESETS`, `applyAccent`,
  `clearAccent`, `saveCustomAccent` and the rest; nothing renders them. The
  app runs on `--accent` from `tokens.css`, which is shadcn's `primary`.
- **The Aurora easter egg.** `isAuroraUnlocked` / `unlockAurora` /
  `applyAurora` are intact and `main.tsx` still honours a stored
  `accent-style: aurora`, so anyone who already unlocked it keeps it. There is
  no way to unlock it now. Its CSS stays in `ui.css` and `tokens.css`,
  deliberately: it paints nothing without `data-accent-style="aurora"`, and
  cutting interleaved rules out of those two files by hand is how v0.9.52 ate
  a closing brace.
- **Onboarding's accent step.** Reduced to the clock chip. The swatches were
  the one place left that could set an accent, and with no picker to change it
  afterwards that made onboarding a one-way door.

## Also still live, and not ours to remove

`services/keybox` is the license server for the Themes Pass. It is a deployed
service and this change does not touch it; the app simply no longer calls it.
`scripts/fake-keybox.mjs` (its test double) is also still here, now unused by
any harness.

`services/site` still markets the Themes Pass. If Themes is not coming back,
that copy is a separate decision on a separate surface.

## Putting it back

1. `git mv` each file to the "Was" column above.
2. Re-add the three `@import`s to `styles/index.css` — **`packs.css` and
   `intense-packs.css` go immediately after `tokens.css`**, `themes.css` after
   `settings.css`. The order is what makes a pack able to override a token.
3. `App.tsx`: restore the `themesOpen` state, the `ThemesModal` render, and
   the `onOpenThemes` prop through `SettingsModal` to `CustomizeTab`.
4. `CustomizeTab.tsx`: the `.themes-launch` Button, and `saveThemePack` /
   `applyThemePack` in `reset`.
5. `main.tsx`: `applyThemePack(loadThemePack())` and `applyInstalledPacks()`.
6. `Onboarding.tsx`: the swatch radiogroup, and its check in
   `scripts/verify-onboarding.mjs`.
7. `scripts/verify-discover.mjs`: the Aurora easter-egg walk at the end.
8. Drop `old/**` from `eslint.config.mjs`'s ignores if the folder empties.

Every one of those sites carries a comment naming this folder, so
`grep -rn "old/themes" apps/app/src scripts` finds the full list.

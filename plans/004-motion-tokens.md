# 004 — Motion tokens: shared easing curves and duration tiers

- **Status**: DONE (wave A) — executor notes: vod-panel-in tokenized to `var(--dur-panel) var(--ease-out)` (superseded by plan 003's full conversion); deliberately left unmigrated: live.css sidebar chrome 200ms, mode-label-in (choreographed with the mode rail), stream.css scrim/hold 250–300ms (plan-007 territory), toggle track 220ms (plan-005 pairing), ambient loops. Tilt pair at 300/300 pending its feel-gate.
- **Commit**: 018a8f4
- **Severity**: HIGH
- **Category**: Cohesion & tokens
- **Estimated scope**: tokens.css + mechanical sweep of 11 stylesheets + 1 TSX value

## Problem

`apps/app/src/styles/tokens.css:63` defines exactly one motion token (`--spring`), used by exactly one rule (`live.css:114-115`). Everything else is hand-typed and has drifted:

- 120ms / 140ms / 150ms are used interchangeably for the same hover/color job — sometimes inside one rule: `live.css:367-370` transitions `opacity 150ms, border-color 120ms, background 120ms`.
- `player.css` is the only file using seconds notation (`0.12s`, `0.2s`, `0.25s` at player.css:262/286/339/402/435/460/624/716) for the same-tier values.
- The two expand-caret rotations differ for no reason: `.live-group__caret` 180ms (`live.css:233`) vs `.playlist-row__expand` 220ms (settings.css).
- Entrance-grade curves are ad-hoc: `cubic-bezier(0.4, 0, 0.2, 1)` (Material standard) on the thumbs, `cubic-bezier(0.3, 0.05, 0.2, 1)` on the vod panel, bare `ease` on most entrances — all too weak for deliberate motion.
- Two over-budget UI durations: genre-card art fade `450ms ease` (`discover.css:54`) and poster hover shadow `450ms ease` (`stream.css:329`), the latter hand-matched to react-parallax-tilt `transitionSpeed={650}` (`StreamScreen.tsx:1712`) with no shared source of truth (the comment there already disagrees with the CSS value).

## Target

Add to `tokens.css` (below `--spring`, matching its comment style):

```css
/* Motion. Strong curves (built-in ease/linear are too weak for deliberate
   motion); durations in three tiers — hover/color, entrances/popovers,
   panels/drawers. UI stays under 300ms; boot/onboarding/welcome are exempt
   surfaces and keep their own timing. */
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
--dur-hover: 140ms;
--dur-enter: 200ms;
--dur-panel: 260ms;
```

Then a mechanical migration with these mappings (hover/color/filter/opacity transitions on interactive rest states):

| Current | Becomes |
| --- | --- |
| `120ms ease`, `140ms ease`, `150ms ease`, `0.12s ease` | `var(--dur-hover) ease` (bare `ease` is correct for hover/color — keep it) |
| `0.2s ease`, `0.25s ease` (player chrome fades) | `var(--dur-enter) ease` |
| entrance transitions/animations using bare `ease` or the Material curve | `var(--ease-out)` at their existing tier |
| caret rotations 180ms / 220ms | both `var(--dur-enter) var(--ease-in-out)` (on-screen morph) |
| `discover.css:54` `genre-art-in 450ms ease` | `250ms var(--ease-out)` |
| `stream.css:329` `box-shadow 450ms ease` + `StreamScreen.tsx:1712` `transitionSpeed={650}` | `box-shadow 300ms ease` + `transitionSpeed={300}` — **feel-gated, see verification** |

Explicitly NOT migrated: boot.css and onboarding.css and the welcome animation (exempt delight surfaces); the hero slide 650ms (`stream.css:58/93` — deliberate cinematic move with hand-tuned glow choreography at stream.css:104-113); `--spring` users; the header rail glide (`base.css:466-480` — documented deliberate); ChipTabs/Toggle thumbs (plan 005 owns them).

## Repo conventions to follow

- Token comment style: see `tokens.css:61-62` (`--spring`'s comment) — explain intent, pair with usage guidance.
- Sweep style: this repo prefers exact, per-rule edits over blanket find-replace — each `transition:` line keeps its property list, only durations/curves change.

## Steps

1. `styles/tokens.css` — add the six tokens after `--spring` (line 78).
2. Sweep `styles/live.css`, `stream.css`, `settings.css`, `ui.css`, `base.css`, `discover.css`, `themes.css`, `player.css`, `packs.css`, `intense-packs.css` applying the mapping table. `grep -n "transition\|animation:" <file>` per file; skip the NOT-migrated list.
3. `styles/player.css` — while sweeping, convert all seconds notation to ms tokens (repo-wide consistency).
4. `styles/discover.css:54` — `animation: genre-art-in 250ms var(--ease-out);`.
5. `styles/stream.css:329` + `features/stream/StreamScreen.tsx:1712` — apply the 300ms pair; update the stale comment near stream.css:329 so CSS, TSX, and comment agree.
6. Consistency check: `grep -rn "cubic-bezier" apps/app/src/styles/ | grep -v "tokens.css\|boot.css\|onboarding.css\|base.css"` — remaining hits should be only plan-005 territory (ui.css thumbs) and the hero slide (stream.css:58/93).

## Boundaries

- Do NOT alter which properties transition — timing and curves only (steps 4–5 excepted as specified).
- Do NOT touch boot.css, onboarding.css, welcome, the hero slide pair, the header rail, or `--spring` call sites.
- Do NOT invent additional tokens beyond the six.
- If a value at a cited line differs from this plan (drift since 018a8f4), STOP and report.

## Verification

- **Mechanical**: `pnpm --filter @blammytv/app lint` + `typecheck`; step-6 grep is clean; `grep -rn "0\.[0-9]\+s ease" apps/app/src/styles/player.css` returns nothing.
- **Feel check**:
  - Hovers across Live/Stream/Settings feel unchanged (140ms vs 120/150ms is imperceptible — if anything reads slower, flag it).
  - Both expand carets (Live sidebar group, Settings playlist row) now rotate identically.
  - Discover genre art: entrance reads crisp, not sluggish; art still crossfades over the old art (the keyframe's content is untouched).
  - **Poster tilt gate**: hover on/off across a row of posters at both old (650/450) and new (300/300) values. The new pair must keep the float feel with a snappier settle; the shadow must never keep animating after the tilt has settled. If 300 feels cheap, try 350/350 — but CSS and TSX must land on the SAME number, and the comment must state it.
- **Done when**: greps are clean, the caret pair matches, and the tilt gate has an explicit pass.

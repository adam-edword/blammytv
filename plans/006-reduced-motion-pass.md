# 006 — Close the reduced-motion gaps

- **Status**: TODO
- **Commit**: 018a8f4
- **Severity**: HIGH (one gap is a near-fullscreen slide) / rest MEDIUM-LOW
- **Category**: Accessibility
- **Estimated scope**: 5 CSS files + 1 TSX line

## Problem

Reduced motion is handled in ~10 places but audited gaps remain. Principle (playbook): fewer and gentler, **not zero** — keep opacity/color feedback, drop position changes.

1. **Hero carousel slide (the big one)** — `apps/app/src/styles/stream.css:58` and `:93`: `.shero__track` / `.shero__glowtrack` slide a near-full-width, ~80vh region 650ms on every advance **including an 8s auto-advance** (`StreamScreen.tsx:1473`). No gate anywhere in stream.css covers them (the file's only gate, line 1184, covers `.vod-panel`).
2. **Programmatic smooth scroll** — `StreamScreen.tsx:1318`: MediaRow arrows call `scrollBy({ behavior: "smooth" })` with no branch; Chromium does NOT auto-disable programmatic smooth scrolling under reduced motion.
3. **Hover lifts ungated** — genre cards `discover.css:41/44` (`translateY(-3px)`), continue-watching cards `stream.css:382-384`, "More like this" cards `stream.css:549/552`, theme cards `themes.css:246-248` (themes.css has zero PRM blocks), accent swatches `settings.css:273` (settings.css has zero PRM blocks).
4. **Specificity defeat** — `base.css:602` (`.update-chip--busy .update-chip__dot { animation: update-dot-spin … }`) out-specifies the gate at `base.css:609-610` (`.update-chip__dot { animation: none; }`), so the busy dot still spins under reduced motion. (base.css:484-490 documents the same class of bug being fixed once before — media queries add no cascade weight.)
5. **Over-nuked gate** — `stream.css:1184-1188` kills the vod-panel entrance entirely (`animation: none`), making a full-height panel hard-cut in. Plan 003 fixes this as part of its conversion; if 003 is not run, apply its reduced-motion block standalone.

## Target

Per-site, movement dropped, feedback kept:

```css
/* stream.css — hero: crossfade the glow, snap the position */
@media (prefers-reduced-motion: reduce) {
  .shero__track, .shero__glowtrack { transition: none; }
  /* .shero__glowbox img opacity transitions (lines 108-113) stay — they're
     the fade that keeps the change comprehensible */
}
```

```tsx
/* StreamScreen.tsx:1318 — target */
el.scrollBy({
  left: delta,
  behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth",
});
```

Hover lifts: gate only the transform, keep filter/color/shadow hovers:

```css
@media (prefers-reduced-motion: reduce) {
  .genre-card:hover { transform: none; }
}
```

Specificity fix in base.css — match the offender's specificity inside the existing gate:

```css
/* base.css:609-610 — target */
@media (prefers-reduced-motion: reduce) {
  .update-chip, .update-chip__dot,
  .update-chip--busy .update-chip__dot { animation: none; }
}
```

## Repo conventions to follow

- Existing gate placement: end-of-section or end-of-file `@media` blocks (see `base.css:484-490` — including its comment about source order beating media queries; keep new gates AFTER the rules they override).
- The StreamScreen already samples this media query twice (`StreamScreen.tsx:1483, 1702`) — follow that inline `window.matchMedia` idiom.

## Steps

1. `styles/stream.css` — add the hero gate (after line 113's glow rules); add `.continue-card:hover` and `.stream-detail` "more like this" card `:hover { transform: none; }` gates to the file-end PRM block (extend the block at 1184).
2. `features/stream/StreamScreen.tsx:1318` — the behavior branch as above.
3. `styles/discover.css` — extend an existing PRM block (there are two, lines 64/129) with the genre-card hover gate.
4. `styles/themes.css` — new file-end PRM block: theme-card art and pill-seg hover transforms → none. (Skip if plan 002 already created this block; extend it instead.)
5. `styles/settings.css` — same: accent-swatch hover scale → none. (Coordinate with 002's block if present.)
6. `styles/base.css:609-610` — add the `.update-chip--busy .update-chip__dot` selector to the existing gate.
7. If plan 003 is NOT being run: apply its PRM block to `.vod-panel` (opacity-only fade instead of `animation: none`) — see plan 003's target for the exact rules.

## Boundaries

- Do NOT remove hover feedback wholesale — only `transform` moves; brightness/color/shadow hovers stay.
- Do NOT gate press feedback from plan 001 (a 160ms scale dip is feedback, not decoration — the playbook keeps it).
- Do NOT touch boot/onboarding/welcome (they already check reduced motion in JS: `BootScene.tsx:108`, `welcome.ts:56`, `Onboarding.tsx:160`).

## Verification

- **Mechanical**: `pnpm --filter @blammytv/app typecheck` + `lint`.
- **Feel check** — DevTools Rendering panel → emulate `prefers-reduced-motion: reduce`:
  - Stream hero: advancing (arrow or auto) repositions instantly; the glow still crossfades; nothing slides.
  - MediaRow arrows: content jumps instantly, no glide.
  - Genre/continue/theme cards: hover still brightens/shadows, nothing lifts.
  - Trigger an update install (or force `--busy`): the dot does NOT spin.
  - Turn emulation OFF: everything above animates again exactly as before.
- **Done when**: with reduced motion emulated, `grep`-level audit finds no ungated transform transition on hover surfaces in the five CSS files, and the busy dot is still.

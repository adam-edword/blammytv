# 002 — Give every overlay, popover, and chip a real entrance

- **Status**: TODO
- **Commit**: 018a8f4
- **Severity**: HIGH
- **Category**: Missed opportunity / Physicality & origin
- **Estimated scope**: 5 CSS files, ~10 sites, no TSX changes

## Problem

Overlay surfaces across the app mount in a single frame — no motion connects them to their trigger or softens their arrival over playing video:

- `apps/app/src/styles/settings.css:5-34` — `.modal-backdrop` / `.settings`: the Settings card (portaled by `SettingsModal.tsx:42-49`) teleports in. Same for the Themes card (`themes.css`, `ThemesModal`).
- `apps/app/src/styles/player.css:672` — `.track-menu` (audio/subtitle/speed popovers, conditionally rendered at `TheaterOverlay.tsx:1055/1107/1140`): appears/vanishes in one frame, anchored `right: 0; bottom: calc(100% + 10px)` above its button, no `transform-origin`.
- `apps/app/src/styles/settings.css:313` — `.accent-popover` (color picker, anchored `top: calc(100% + 10px); right: 0`): pops in, no origin.
- `apps/app/src/styles/settings.css:838` — `.chip-select__menu` (portaled dropdown positioned from the add-button's rect): pops in, no origin.
- `apps/app/src/styles/player.css:828` — `.skip-chip`: mounts in one frame over video the user is watching.
- `apps/app/src/styles/stream.css:1003` — `.upnext-mini` (380px glass card): teleports into the corner mid-credits.
- `player.css:751` — `.stats-overlay`: pops in/out over video.
- `apps/app/src/app/UpdateChip.tsx:41-52` + `base.css` — the update chip materializes fully-formed in the header.
- `apps/app/src/styles/base.css:373` — `.header__searchinput` reveals with a pure opacity fade, no spatial cue that it emerges from its chip.

Closing stays instant on purpose: the playbook's asymmetric-timing rule — deliberate phases animate, the system's response snaps. **This plan adds entrances only.** (The VOD source panel's exit is the exception, handled separately in plan 003.)

## Target

Pure CSS via `@starting-style` (WebView2 is Chromium 139+ per the comment at `tokens.css:56-59` — safe). Pattern, using the settings card as the model:

```css
/* target — settings.css */
.settings {
  /* …existing declarations… */
  transform-origin: top right; /* the card floats at top-right, under the gear */
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);
}
@starting-style {
  .settings {
    opacity: 0;
    transform: scale(0.97) translateY(-8px);
  }
}
```

Never `scale(0)`; entrances start at `scale(0.9–0.97)` + `opacity: 0`. Trigger-anchored popovers scale **from their trigger** via `transform-origin`; the centered Themes card is a modal and correctly uses center origin. `var(--ease-out)` = `cubic-bezier(0.23, 1, 0.32, 1)` (token from plan 004; inline the literal if 004 hasn't run).

Per-site values:

| Site | transform-origin | @starting-style transform | duration |
| --- | --- | --- | --- |
| `.settings` | `top right` | `scale(0.97) translateY(-8px)` | 200ms |
| Themes card (`.themes-card` root in themes.css) | center (default — modal, exempt) | `scale(0.97)` | 200ms |
| `.track-menu` | `bottom right` | `scale(0.95) translateY(4px)` | 150ms |
| `.accent-popover` | `top right` | `scale(0.95) translateY(-4px)` | 150ms |
| `.chip-select__menu` | `top left` | `scale(0.95) translateY(-4px)` | 150ms |
| `.skip-chip` | — (no scale) | `translateY(8px)` + opacity | 200ms |
| `.upnext-mini` | `bottom right` | `scale(0.97) translateY(12px)` | 260ms |
| `.stats-overlay` | — | `translateY(-6px)` + opacity | 150ms |
| `.update-chip` | `top center` | `scale(0.9) translateY(-4px)` | 260ms (rare, may be soft) |
| `.header__searchinput` | — | keep opacity fade, add `translateX(-6px)` | keep 150ms |

Each site also gets a local reduced-motion override that keeps the opacity fade and drops the movement:

```css
@media (prefers-reduced-motion: reduce) {
  .settings { transition: opacity 200ms var(--ease-out); }
  @starting-style { .settings { transform: none; } }
}
```

## Repo conventions to follow

- Existing entrance exemplar (keyframe style, do NOT copy the mechanism — transitions + `@starting-style` retarget cleanly, keyframes restart): `stream.css:1172-1183` (`vod-panel-in`) shows the app's translate+fade entrance taste and its reduced-motion gate at `stream.css:1184-1188`.
- Comments: one line stating the non-obvious constraint only (see `settings.css:2-4`).
- The backdrop `.modal-backdrop` has no dim by design (`settings.css:3-4`) — do not add a background fade to it; animate the cards, not the backdrop.

## Steps

1. `styles/settings.css` — add `transform-origin`, `transition`, and `@starting-style` blocks to `.settings` (values from table), `.accent-popover`, `.chip-select__menu`; add the reduced-motion overrides (settings.css currently has zero `prefers-reduced-motion` blocks — put one combined block at the end of the file).
2. `styles/themes.css` — same treatment for the Themes modal card root (find the card container rule near the top of the file; it's the large centered card the `ThemesModal` renders). Combined reduced-motion block at end of file (themes.css also currently has none).
3. `styles/player.css` — `.track-menu`, `.skip-chip`, `.stats-overlay` per the table, plus reduced-motion additions in the file's existing pattern.
4. `styles/stream.css` — `.upnext-mini` per the table; extend the existing reduced-motion block at `stream.css:1184`.
5. `styles/base.css` — `.update-chip` per the table (its rule block is around `base.css:578-593`); `.header__searchinput` (base.css:373): change `transition: opacity 150ms ease;` to include `transform 150ms var(--ease-out)` and add `@starting-style { transform: translateX(-6px); }`… note this input reveals via `opacity` on hover/focus of a *mounted* element, not a mount — so implement as: `.header__searchchip:focus-within .header__searchinput { transform: translateX(0); }` with base state `transform: translateX(-6px)`, transitioning both. No `@starting-style` needed at this one site.
6. Sweep check: `grep -n "@starting-style" apps/app/src/styles/*.css` — every site in the table (except the search input) appears exactly once.

## Boundaries

- Do NOT touch TSX files (all sites are conditional renders; `@starting-style` fires on insertion without JS).
- Do NOT add exit animations (asymmetric timing is deliberate; plan 003 owns the one exception).
- Do NOT animate `.modal-backdrop` itself.
- Do NOT touch `.vod-panel` (plan 003 owns it).
- If a cited selector has moved or been renamed, STOP and report.

## Verification

- **Mechanical**: `pnpm --filter @blammytv/app lint`; visually confirm no site lost its existing box-shadow/backdrop-filter (transitions added, declarations otherwise untouched).
- **Feel check**: DevTools → Animations panel at 10% speed:
  - Settings card grows from the top-right (toward the gear), not from center.
  - Track menu grows upward from its button (bottom-right origin).
  - Chip-select menu grows downward from the add button (top-left origin).
  - Skip chip and Up Next drift up into place over playing video — no pop.
  - Close any of them: instant. That asymmetry is correct — do not "fix" it.
  - Rendering panel → emulate `prefers-reduced-motion: reduce`: everything still fades in, nothing moves or scales.
- **Done when**: all ten sites enter with motion, all close instantly, and reduced-motion keeps fade-only entrances.

# Motion improvement plans

Output of the `improve-animations` audit at commit `018a8f4` (2026-07-22). The full
verified findings table is in [audit-report.md](audit-report.md) — 71 findings that
survived adversarial verification, out of 77 raised. The execution rollout (waves,
feel-gates, risks) is in [OP-PLAN.md](OP-PLAN.md).

Each plan is self-contained: an executor with zero context can run one end-to-end.
Run with `improve-animations execute <plan>` or hand to any agent.

## Plans

| Plan | Title | Severity | Status |
| --- | --- | --- | --- |
| [001](001-press-feedback.md) | Add press feedback to every pressable surface | HIGH | DONE (wave B) |
| [002](002-overlay-popover-entrances.md) | Give every overlay, popover, and chip a real entrance | HIGH | DONE (wave B; feel-gate = the @starting-style WebView2 smoke test) |
| [003](003-vod-source-panel-transitions.md) | Make the VOD source panel interruptible, with a real exit | MEDIUM | TODO |
| [004](004-motion-tokens.md) | Motion tokens: shared easing curves and duration tiers | HIGH | DONE (wave A) |
| [005](005-thumb-physics.md) | Unify sliding-thumb physics; Toggle off layout properties | HIGH | DONE (wave A; feel-gate: ChipTabs thumb 300→380ms per Adam — spring kept, on watch) |
| [006](006-reduced-motion-pass.md) | Close the reduced-motion gaps | HIGH | TODO |
| [007](007-hold-to-clear-progress.md) | Hold-to-clear: show the hold's progress | MEDIUM | TODO |

## Recommended execution order & dependencies

1. **004 (tokens) first** — 001, 002, 003, 005 reference `--ease-out` / `--ease-drawer` /
   `--spring` pairings. (Each plan inlines the literal values as a fallback, so any
   order *works*, but tokens-first avoids literal-then-tokenize churn.)
2. **001 (press feedback)** and **002 (entrances)** next, either order — independent files
   mostly, both touch settings.css/themes.css reduced-motion blocks (whichever runs
   second extends the block the first created).
3. **003 (vod panel)** and **005 (thumbs)** any time after 004 — independent.
4. **006 (reduced motion) second-to-last** — it sweeps for gaps and coordinates with
   blocks created by 001/002/003; running it last-but-one catches everything.
5. **007 (hold-to-clear)** any time — independent delight item.

## Not planned (deliberately)

- The header Live↔Stream rail glide (`base.css:466-480`) — raised three times, twice
  overturned: comments document it as deliberate. The surviving performance point
  (max-width is a layout property) is real but the layout re-centering *is the design*;
  revisit only with a Performance trace showing actual dropped frames.
- The hero carousel's 650ms slide and glow choreography — deliberate cinematic move
  (its reduced-motion gap IS planned, in 006).
- The boot scene, onboarding, and welcome animation — sanctioned delight surfaces.
- Table-only findings (Plan `—` in the report): real but lower leverage — e.g. Discover
  search result-collapse (#2 in the report, needs a state-management decision about
  keeping stale results visible), Settings→Themes hand-off, settings tab-content swap,
  view navigation crossfades, tooltip replay on the folded rail, guide star feedback,
  update-chip custom-property spin. Ask for a plan for any of these and it can be
  written from the report row.

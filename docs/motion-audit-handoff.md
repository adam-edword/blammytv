# Motion-audit handoff — for the 0.7.0 polish-audit session

Written 2026-07-22 by the motion-audit session (the `improve-animations`
workstream). You are the other half of this cycle: your P3/P1 polish work and
this motion work now share `blammytv-0.7.0-push`. This file is everything you
need to not collide with, duplicate, or undo the motion workstream.

## What the motion workstream is

A full motion/animation audit of the app (Emil Kowalski bar): 77 findings
raised by a 10-auditor fan-out, 71 surviving adversarial verification, turned
into 7 self-contained implementation plans plus an operational rollout.

- `plans/audit-report.md` — all 71 verified findings, file:line, + 6 rejected
- `plans/001-…007-*.md` — the plans (each executable by a zero-context agent)
- `plans/OP-PLAN.md` — the three-wave rollout, feel-gates, risks
- `plans/README.md` — index + status column (kept current)

## State as of this handoff (v0.6.2, all branches pushed)

- **Wave A is LANDED** (plans 004 + 005), merged into `blammytv-0.7.0-push`
  at `f4479e3`, then your branch became the shared working branch. The
  `claude/app-animation-audit-r5wy85` branch is synced to the same commits
  and retired — new motion waves land directly on `blammytv-0.7.0-push`.
- Wave A contents: **motion tokens in tokens.css** (see below), the
  120/140/150ms + seconds-notation drift migrated across ten stylesheets,
  both expand carets unified, genre-art entrance tightened, Toggle thumb
  converted from `left` to `transform` on `--spring`, ChipTabs thumb moved
  to the mode-rail's spring family (its `left`/`width` mechanism kept — the
  ResizeObserver width-tracking is load-bearing, documented in plan 005).
- **Wave A's human feel-gate has NOT run yet.** Two decisions pend with Adam:
  poster-tilt pair A/B (see "Where our audits touched"), and the toggle
  spring duration (260ms shipped; "toggle 220" is the trim command).

## Binding for any CSS you write from now on

Wave A introduced motion tokens in `apps/app/src/styles/tokens.css` (~line 80):

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
--dur-hover: 140ms;   /* hover/color/filter/opacity */
--dur-enter: 200ms;   /* entrances, small popovers */
--dur-panel: 260ms;   /* panels, drawers */
```

- **Use the tokens, not literals**, for any new transition/animation. The
  repo-wide invariant after wave A: the only hand-typed `cubic-bezier` left
  in `styles/` is the hero slide pair (`stream.css:58/93`, deliberate).
- **Do not add `:active` press rules or overlay entrance animations** — that
  is wave B (plans 001 + 002), landing app-wide with one consistent pattern.
  Hand-adding them piecemeal now creates collisions.
- Exempt surfaces (never migrate/re-time): boot.css, onboarding.css, the
  welcome animation, the hero slide + glow choreography, the header rail
  glide (`base.css` — documented deliberate), `--spring` call sites.

## Where our audits touched (merge resolutions you should know)

Resolved in `f4479e3`, principle "your structure, our motion values":

1. **`pack-card` block** (settings.css): your P3a dead-code deletion won;
   the motion migration inside it was discarded with it.
2. **`source-tools` recipe** (settings.css): your dedup'd shared selector
   kept, with `var(--dur-hover)` applied inside it.
3. **Poster tilt** — the one open question between our audits. Your
   `b243bb5` re-tuned shadow/tilt to 450/650 with a documented rationale
   ("the shadow leads, the lean settles into it"); the motion audit's
   verified finding proposes a matched 300/300 (both halves exceed the
   300ms hover budget; the shadow outlives the tilt on hover-out). The
   merge KEPT your 450/650. Adam A/Bs both at the wave-A feel-gate — do
   not re-tune this knob until that verdict lands (recorded in plan 004).

## Queue (motion side — no action needed from you)

- Wave A feel-gate: Adam, ~3 min + the two decisions above.
- Wave B (001 press feedback + 002 overlay entrances): ready, runs on
  Adam's go. Its first gate check doubles as the `@starting-style`
  WebView2 smoke test.
- Wave C (003 VOD panel interruptibility, 006 reduced-motion sweep,
  007 hold-to-clear progress).
- Parked wave-D candidates (table-only findings): Discover search
  result-collapse (needs a product call), Settings→Themes hand-off,
  settings tab-content swap, view-navigation crossfades, tooltip replay,
  guide star feedback, update-chip spin.

## Coordination protocol

- Motion waves land directly on `blammytv-0.7.0-push`, one commit + one dev
  bump each (three frontend files only, per RELEASING.md).
- If your work must touch a transition/animation, use the tokens and note it
  in your commit message so the motion session can reconcile plan statuses.
- Versioning: branch is at dev v0.6.2; Adam briefly bumped to 0.7.0 and
  reverted (`6ad29ec`/`0e812e4`) — ignore that pair. Cargo.toml +
  tauri.conf.json jump only in the release commit.

# Op plan — executing the motion audit

- **Scope**: plans 001–007 (`plans/`), audited at `018a8f4`, report in [audit-report.md](audit-report.md)
- **Written**: 2026-07-22 on `claude/app-animation-audit-r5wy85`
- **Principle**: three waves, one commit + one dev version bump each, a feel-gate on Adam's
  machine between waves. Small diffs, fast landings, revert-one-commit rollback.

## Why waves instead of seven sequential plans

Every feel-check needs Adam to pull and hot-reload (the container can't run Tauri+mpv, so
no motion here can be *felt*, only reasoned about). Seven round-trips is six too many.
The plans batch into three waves whose internal pieces don't interact, ordered so the
foundation (tokens) lands before everything that references it — same dependency order as
[README.md](README.md), just compressed.

## The waves

### Wave A — foundations (plans 004 + 005)

Motion tokens + duration/curve migration; Toggle transform conversion; thumb spring
unification. **Expected feel change: almost none** — that's the gate criterion.

- **Executor**: subagent in an isolated worktree per plan (both are mechanical sweeps with
  exact mappings — the plan files are written for zero-context executors). Main session
  reviews both diffs against the plans before landing.
- **Diff size**: ~11 CSS files, timing values only + ~10 lines ui.css + 1 TSX value.
- **Version**: dev bump (root+app package.json + version.ts only, per RELEASING.md).
- **Feel-gate checklist (Adam, ~3 min)**:
  1. Sweep hovers across Live / Stream / Settings — nothing should feel different.
  2. Both expand carets (Live sidebar group, Settings playlist row) rotate identically.
  3. Flip toggles fast — spring settle, retargets mid-flight, `--sm` lands on its old spot.
  4. Settings tabs + header rail — thumb settles like the Live mode rail; header search
     focus still drags the thumb onto the morphing chip.
  5. **Decision point**: poster tilt at 300/300 (plan 004 step 5) — keep, trim to 350/350,
     or revert to 650/450. Say which.
  6. **Decision point**: toggle at 260ms `--spring` — if the overshoot reads cute-but-slow,
     say "toggle 220" and it lands as a trim commit.

### Wave B — the feel change (plans 001 + 002)

Press feedback everywhere + entrances for all ten overlay/popover/chip sites. This is the
headline: the app starts acknowledging touch and things arrive instead of appearing.

- **Executor**: subagent per plan in a worktree (many small independent rule additions);
  main session reviews with the review-animations bar — special attention to
  transform-origins (each popover must grow from its trigger) and the two documented
  exceptions (`.accent-custom .accent-swatch` gets no press; `.modal-backdrop` gets no fade).
- **Diff size**: ~9 CSS files of `:active` rules; ~5 CSS files of `@starting-style` blocks. No TSX.
- **Feel-gate checklist (Adam, ~5 min)**:
  1. **First**: open Settings — the card must scale in from the top-right. If it teleports,
     `@starting-style` isn't firing in the shipped WebView2 → stop, report the WebView2
     version, wave B reverts pending a fallback (`data-mounted` pattern per the playbook).
  2. Click-and-hold a guide cell, a chip tab, the primary button — dip, hold, spring back.
  3. Track menu (audio/subtitles) grows up from its button; chip-select menu grows down.
  4. Poster card press during hover-tilt — no judder (plan 001 step 5 has the fallback;
     judder = say so, fallback lands as a trim).
  5. Close anything — instant. Correct, not a bug.
  6. DevTools → reduce-motion emulation: entrances become pure fades, presses still dip.

### Wave C — behavior + coverage (plans 003 + 006 + 007)

VOD source panel interruptible open/close; reduced-motion gap sweep; hold-to-clear
progress bar.

- **Executor**: **003 hands-on in the main session** (it rewires `panelOpen` state through
  every call site — close-on-pick must not delay playback start; that's a judgment call,
  not a sweep). 006 and 007 to worktree subagents.
- **Diff size**: StreamScreen.tsx (~30 lines) + stream.css; 5 CSS files of PRM gates + 1 TSX
  line; ~25 lines for the holdbar.
- **Feel-gate checklist (Adam, ~4 min)**:
  1. Open/close/spam the source panel — slides both ways, reverses mid-flight, picking a
     source starts playback with zero added delay.
  2. Hold a Continue Watching card — accent bar fills over exactly 1s; release at half —
     quick retreat, no snap.
  3. Reduce-motion emulation: hero advance snaps (glow still fades), row arrows jump,
     nothing lifts on hover, update-chip busy dot is still. Emulation off: all of it moves again.

## Mechanics

- **Branch**: waves land on `claude/app-animation-audit-r5wy85`, one commit per wave
  (executor diffs squashed into it). Adam feel-checks by pulling this branch; merge to the
  default branch after wave C passes — or per-wave if preferred, say which.
- **Verification before each landing**: `pnpm --filter @blammytv/app typecheck && pnpm lint`
  plus each plan's grep checks. Executor diffs get read in full — agent findings/output are
  never landed unreviewed (working agreement).
- **Rollback**: one wave = one commit → `git revert <sha>` undoes a wave cleanly. Trims from
  feel-gates land as small follow-up commits, never amendments, so the history shows what
  the gate changed.
- **Status tracking**: each plan file's `Status:` line flips TODO → DONE (or
  DONE_WITH_CONCERNS + note) as part of its wave's commit; README table follows.

## Risks

| Risk | Wave | Mitigation |
| --- | --- | --- |
| `@starting-style` unsupported in the shipped WebView2 | B | Gate check #1 is literally this; fallback pattern named in the plan; revert is one commit |
| Press scale fights react-parallax-tilt's inline transform | B | Plan 001 step 5 carries the fallback; gate check #4 watches it |
| Panel close-state delays playback-on-pick | C | 003 done hands-on; the pick path sets `closing` and starts playback simultaneously — verify in gate #1 |
| Merge conflicts with the polish audit (other chat) touching the same CSS | all | Land motion waves first (small, fast); polish work rebases on top. If polish results arrive mid-wave, cross-check overlapping files before its changes land |
| Layout cost of ChipTabs left/width is real jank | A | Not changed blind — plan 005 records a trace on Adam's machine; FLIP conversion only if the trace shows it |

## Parked (from the report's `—` rows) — and what unparks them

- **Discover search result-collapse (report #2, HIGH)**: needs a product decision — keep
  stale results visible while the new query runs (recommended) vs. blur-mask the swap.
  One sentence from Adam unparks it into a plan.
- **Settings→Themes hand-off, settings tab-content swap, Stream view navigation
  crossfades**: park until wave B has settled — entrances change how these seams read.
- **Tooltip replay on the folded rail, guide star feedback, update-chip
  custom-property spin, header rail max-width**: polish-tier; batch into a wave D on
  request after C.

## Cost & effort

Wave A ≈ two executor runs + review (small). Wave B ≈ two executor runs + careful review
(the biggest review). Wave C ≈ one hands-on session + two small executor runs. Every wave
is comfortably a single session; the whole rollout is ~3 sessions plus Adam's ~12 minutes
of feel-gates.

## Kickoff

Say **"run wave A"** (or B/C to reorder at your own risk — A first is strongly
recommended). Each wave ends with the standard report: what landed, gate checklist,
and the one-line pull instruction.

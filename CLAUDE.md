# BlammyTV — working agreements

## Don't guess — be confident before committing to an option

No guessing. Before committing to an approach or making a code change, be
genuinely confident it's the right call. If you're not sure, work it out in chat
first — questions, back-and-forth, weighing real options — and land on a decision
you can defend before touching code. A wrong guess that ships costs far more than
a few extra messages. Hold an opinion and state it; don't hedge your way into a
change you're not actually sure about.

This is the spine of everything below: when the mechanism isn't obvious, get the
data (next section); when it's a judgment call, reason it to confidence or ask
(Confusion Protocol). Either way, decide before you build.

## Confirm with data before significant changes

Before a non-trivial code change to explain or fix a behavior, **confirm the
cause with real data — don't assume.** Add a diagnostic (log the actual state,
read the real values, reproduce the signal) and let the data drive the fix.

Two models from this project:
- HDR brightness: instead of asserting "it's HDR," we logged mpv's actual colour
  pipeline (`gamma=pq`, `primaries=bt.2020`, `sig-peak=4.9`) and proved it.
- The AIOStreams 403: identical headers but `curl` got 200 while the app got 403,
  which pointed at the TLS handshake (fingerprint), not the headers. Switching to
  the Windows-native TLS stack fixed it. The data picked the fix.

Applies to anything where the mechanism isn't obvious from the code: rendering/
colour/HDR, timing/races, native/OS behavior, performance, networking. Small,
obvious edits don't need a ceremony; uncertain or significant ones do.

## Confusion Protocol

On high-stakes ambiguity — two plausible architectures, a request that
contradicts an existing pattern, a destructive op with unclear scope, or missing
context that would change the approach — STOP. Name the ambiguity in one
sentence, present 2-3 options with real trade-offs (not a fake spread), and ask.
Don't guess on architectural decisions. Doesn't apply to routine, obvious changes.

## Search before building

1. **Tried-and-true** — is there a standard library or pattern for this? Use it.
2. **New-and-popular** — a newer library with real traction? Evaluate it.
3. **First-principles** — does the conventional approach actually apply? If our
   case is genuinely different, document WHY before writing custom code.

Default to Layer 1. Don't reinvent what a library already does. Simplest vanilla
tech wins — no framework-of-the-month, no clever abstractions for hypothetical
reuse. When a task matches an installed Claude Code skill (security review,
design review, etc.), use the skill instead of re-implementing.

## Delegation — orchestrate by task shape, not by default

Standing permission to run subagents/workflows underneath the main session — no
need to ask first — **when the task shape actually benefits:**

- **Research & evaluation** — comparing libraries, studying how other apps solve
  a problem. Parallel readers, synthesize on top.
- **Broad audits** — security review, perf sweep, dead-code hunt. Fan out by
  dimension, adversarially verify findings, report only what survives.
- **Fresh-eyes review before a release** — a reviewer agent's lack of our
  context is a feature: it can't rationalize our decisions.
- **Big mechanical sweeps** — migrations, renames, test backfill, where the
  work-list is known and the items are independent.

**Stay hands-on for surgical, diagnostic, context-heavy work** — the
measure→fix→retest loop that most changes here are. Accumulated context is the
asset: the v0.1.106 disk cache caught a StrictMode race only because the same
head fixed it in v0.1.104. Subagents start blank — briefing them on a one-file
fix costs more than it buys.

Delegation never dilutes the agreements above: agent findings get verified
before acting on them, and the main session owns the synthesis, the decision,
and the commit.

## Completion status

End every task with one of:
- **DONE** — all steps complete, evidence for every claim, ready to merge.
- **DONE_WITH_CONCERNS** — complete, but with issues worth knowing; list each with
  severity and a proposed follow-up.
- **BLOCKED** — can't proceed; state what's blocking and what was tried.
- **NEEDS_CONTEXT** — missing info; state exactly what's needed.

"Partially done" isn't a status. Honesty about incompleteness beats pretending.

## After every task — commit, push, report what to restart

1. **Commit and push.** Stage, write a clear message, push. Don't wait to be asked.
2. **Say what to restart — one line, terminal-ready.** End with a single line I
   can act on without thinking, in exactly this shape:
   - Frontend-only (hot-reloads): `Pushed v0.x.x — `git pull` to hot reload`
   - Native/Rust (needs rebuild): `Pushed v0.x.x — `git pull` and `pnpm tauri dev`, needs rebuild`

   Use the real version number, pick the line that matches the change, and give
   the exact commands. If nothing needs restarting, say that instead.

## Safety

- Never commit secrets. If `.env` is touched, verify `.gitignore` before committing.
- Never run `rm -rf`, `git reset --hard`, `git push --force`, or similar
  destructive ops without explicit confirmation.
- Never skip pre-commit hooks with `--no-verify`. If a hook fails, fix the cause.
- Never commit binaries or compiled outputs to the repo.
- Before anything that touches a published artifact (a release, the live repo's
  default branch), state what you're about to do and wait for confirmation.

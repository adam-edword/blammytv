# BlammyTV: working agreements

## Don't guess: be confident before committing to an option

No guessing. Before committing to an approach or making a code change, be
genuinely confident it's the right call. If you're not sure, work it out in chat
first (questions, back-and-forth, weighing real options) and land on a decision
you can defend before touching code. A wrong guess that ships costs far more than
a few extra messages. Hold an opinion and state it; don't hedge your way into a
change you're not actually sure about.

This is the spine of everything below: when the mechanism isn't obvious, get the
data (next section); when it's a judgment call, reason it to confidence or ask
(Confusion Protocol). Either way, decide before you build.

## Confirm with data before significant changes

Before a non-trivial code change to explain or fix a behavior, **confirm the
cause with real data. Don't assume.** Add a diagnostic (log the actual state,
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

## Checking the Rust from a Linux box

**`node scripts/check-rust.mjs`.** That script already existed and already
solved this; read its header before writing anything new about it. It
targets `x86_64-pc-windows-gnu`, which compiles the real `cfg(windows)`
branches (`inv.rs` is `#![cfg(windows)]` and would otherwise compile to
nothing), checks `--all-targets`, and verifies its own prerequisites. About
30 seconds warm.

Two dead ends, so nobody re-walks them: the host target dies in `gdk-sys`
(GTK dev packages, and the apt index 404s), and the MSVC target gets as far
as `ring` wanting the Windows CRT headers. Neither is worth fighting.

For lint, the script has no equivalent, so run it directly:

```
cd apps/app/src-tauri && cargo clippy --target x86_64-pc-windows-gnu
```

Baseline is **9 warnings**, all of them the libmpv symbol transmutes at
`mpv.rs:89-103`. Anything else is yours. (`grep -c "^warning:"` says 10 —
the tenth is cargo's own "generated 9 warnings" summary line.)

It is a TYPE check, not a build: it will not catch a linker problem or
anything about libmpv's runtime behaviour. It does catch every signature
mistake, which is the class that has reached users' rebuilds before.

`cargo fmt --check` is NOT a gate here: the repo has pre-existing drift in
`build.rs` and `frontend.rs`. Check that your own regions are clean and
leave the rest alone.

## Running the headless harnesses

**`pnpm verify`** (`node scripts/verify-all.mjs`). It starts the five fake
servers on the ports the harnesses hard-code, starts vite on 4173, runs every
`verify-*.mjs`, and prints a board. `pnpm verify discover nav` filters by
name; `KEEP=1` leaves the servers up afterwards.

Baseline is **22/22 harnesses clean, 331 checks**. If playwright-core is not
installed, point `PW_FROM` at somewhere that can require it.

Read the board's STATUS column, not just the tick counts. **CRASH is the
one that matters.** A failing check is loud; a harness that throws at check
12 of 40 still prints eleven green ticks above the stack trace and the other
twenty-eight leave no trace at all. That is how six of them rotted for
months without anyone noticing, including two whose entire subject had
stopped being exercised.

Watch for checks that pass VACUOUSLY, too. verify-stalker read 2/4 while
the portal served nothing: the two that "passed" were negative assertions
("the adult genre is dropped"), and an empty page drops everything.

## Confusion Protocol

On high-stakes ambiguity: two plausible architectures, a request that
contradicts an existing pattern, a destructive op with unclear scope, or missing
context that would change the approach. STOP. Name the ambiguity in one
sentence, present 2-3 options with real trade-offs (not a fake spread), and ask.
Don't guess on architectural decisions. Doesn't apply to routine, obvious changes.

## Search before building

1. **Tried-and-true**: is there a standard library or pattern for this? Use it.
2. **New-and-popular**: a newer library with real traction? Evaluate it.
3. **First-principles**: does the conventional approach actually apply? If our
   case is genuinely different, document WHY before writing custom code.

Default to Layer 1. Don't reinvent what a library already does. Simplest vanilla
tech wins: no framework-of-the-month, no clever abstractions for hypothetical
reuse. When a task matches an installed Claude Code skill (security review,
design review, etc.), use the skill instead of re-implementing.

## Writing style

Applies to everything you produce: chat replies, docs, commit messages, code
comments, UI copy.

- **No em dashes.** Not as an aside, not as a pause, not as a dramatic
  reveal. Use a comma, a colon, brackets, or two sentences. Fixing one means
  rewriting the sentence, not swapping the character for a hyphen.
- **Write plainly.** Short declaratives beat long balanced ones. Contractions
  are fine. Say the thing and stop.
- **Cut the tells.** "It's not just X, it's Y". "Worth knowing/noting/doing".
  "That said". "Here's the thing". Portentous one-line paragraphs used as a
  drumbeat. Everything in threes. Piling on "genuinely", "actually",
  "precisely", "simply".
- **Don't oversell.** No "by far the most common", no "the single biggest
  reason", unless there's a number behind it.
- **Chat replies: lead with the outcome, then stop.** The commit message and
  the diff are the record. Don't restate them in chat afterwards, don't
  recap what I just watched you do, and don't produce a summary table
  unless I ask for one or the shape genuinely needs one. Say what changed,
  what's still open, and what I have to do. Surprises and decisions I own
  are worth the words; narration is not.

The house voice is the site's FAQ copy in `services/site/index.html`: "Yup."
"Nope." "None." Direct, second person, no throat-clearing. Match that.

## Delegation: orchestrate by task shape, not by default

Standing permission to run subagents/workflows underneath the main session (no
need to ask first) **when the task shape actually benefits:**

- **Research & evaluation**: comparing libraries, studying how other apps solve
  a problem. Parallel readers, synthesize on top.
- **Broad audits**: security review, perf sweep, dead-code hunt. Fan out by
  dimension, adversarially verify findings, report only what survives.
- **Fresh-eyes review before a release**, a reviewer agent's lack of our
  context is a feature: it can't rationalize our decisions.
- **Big mechanical sweeps**: migrations, renames, test backfill, where the
  work-list is known and the items are independent.
- **Repo archaeology**: what shipped between two versions, which callers of
  X exist, what the history says about Y. Dozens of greps and log reads to
  produce a short list, and the intermediate output is worthless once the
  list exists. The v0.9.0 changelog survey was this shape and got done in
  the main session, which is what made that session long.

**Ask for pointers, not prose.** A subagent's summary is lossy, and the
detail it drops is usually the detail worth writing down: "42 tab stops to
1", "3.5MB re-parsed per tab flip". Have it come back with commit SHAs, file
paths and line numbers, then read the few that matter directly. Delegate the
FINDING, never the quoting: anything that ends up in a changelog, a commit
message or a doc gets read first-hand before it is written down.

**Stay hands-on for surgical, diagnostic, context-heavy work**: the
measure→fix→retest loop that most changes here are. Accumulated context is the
asset: the v0.1.106 disk cache caught a StrictMode race only because the same
head fixed it in v0.1.104. Subagents start blank. Briefing them on a one-file
fix costs more than it buys.

Delegation never dilutes the agreements above: agent findings get verified
before acting on them, and the main session owns the synthesis, the decision,
and the commit.

## Completion status

End every task with one of:
- **DONE**: all steps complete, evidence for every claim that can be
  evidenced from here, ready to merge. Say plainly in the body what you
  couldn't check and why; don't downgrade the status for it.
- **DONE_WITH_CONCERNS**: complete, but with issues worth knowing; list each with
  severity and a proposed follow-up.
- **BLOCKED**: can't proceed; state what's blocking and what was tried.
- **NEEDS_CONTEXT**: missing info; state exactly what's needed.

"Partially done" isn't a status. Honesty about incompleteness beats pretending.

## After every task: commit, push, report what to restart

1. **Commit and push.** Stage, write a clear message, push. Don't wait to be asked.
2. **Say what to restart: one line, terminal-ready.** End with a single line I
   can act on without thinking, in exactly this shape:
   - Frontend-only (hot-reloads): `Pushed v0.x.x, `git pull` to hot reload`
   - Native/Rust (needs rebuild): `Pushed v0.x.x, `git pull` and `pnpm tauri dev`, needs rebuild`

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

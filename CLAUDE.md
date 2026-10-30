# BlammyTV: working agreements

## Don't guess: be confident before committing to an option

No guessing. Before committing to an approach or making a code change, be
genuinely confident it's the right call. If you're not sure, work it out in chat
first (questions, back-and-forth, weighing real options) and land on a decision
you can defend before touching code. A wrong guess that ships costs far more than
a few extra messages. Hold an opinion and state it; don't hedge your way into a
change you're not actually sure about.

**A rebuild is never a cost.** Recompiling the app (`pnpm tauri dev`) is
not a reason to prefer frontend over native: weigh each on what it does for
the app. Adam, on the HEVC options (v0.9.111): "again rebuild should never
be a deterrent". The size and risk of a REFACTOR still counts ("that should
be a deterrent").

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
`mpv.rs:172-186`. Anything else is yours. (`grep -c "^warning:"` says 10 —
the tenth is cargo's own "generated 9 warnings" summary line.)

It is a TYPE check, not a build: it will not catch a linker problem or
anything about libmpv's runtime behaviour.

**The stream proxy's tests run here for real** (mvproxy.rs and
mvconvert.rs, HEVC conversion through an actual ffmpeg included), and so
do Trakt's and MAL's (trakt.rs and mal.rs, against fakes) and multi-view's
sound listener and jitter buffer (mvaudio.rs; its cpal output, mvaudio_out.rs,
needs a device and is type-checked only) and AIOStreams' Jellyfin side
(aiojf.rs, against a fake) and a Jellyfin server's own client (jf.rs, against a fake) and the header a Jellyfin stream asks mpv to send (mpvheader.rs) and the player settings' checks (mpvprefs.rs) and the dead-link probe (mpvopen.rs, against local servers) and the Vulkan loader's order (mpvvulkan.rs) and About's versions and update notes (about.rs) and the log's read-back (logtail.rs) and the settings file's checks (settingsfile.rs) and a playlist's User-Agent (mpvagent.rs) and the external subtitles' rules (mpvsubs.rs) and the recorder (rec.rs, the real ffmpeg against a fake provider) and VLC's launch and poller (vlc.rs, against fakes) and live TV's disk cache (mpvcache.rs), from a host crate that includes the files as they
are:

```
curl -sSL https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz | tar xJ -C /tmp
cd scripts/mvproxy-host && BLAMMYTV_FFMPEG=/tmp/ffmpeg-master-latest-linux64-gpl/bin/ffmpeg cargo test
```

Baseline 457 tests (1.0.34): 52 for the proxy (35 mvproxy, 17 mvconvert), 3 for mpvurl, 15 for Trakt, 17 for MAL, 22 for mvaudio, 47 for AIOStreams' Jellyfin side (aiojf.rs), 62 for a Jellyfin server's own client (jf.rs), 6 for the header a Jellyfin stream asks mpv to send (mpvheader.rs), 16 for mpvprefs, 21 for mpvopen, 9 for mpvvulkan, 8 for about, 16 for logtail, 14 for settingsfile, 10 for mpvagent, 8 for mpvsubs, 89 for rec, 30 for vlc, 12 for mpvcache. On CI the Windows job runs the same tests with the
bundled ffmpeg (`scripts/fetch-ffmpeg.mjs`), on the CPU path: no GPU there. It does catch every signature
mistake, which is the class that has reached users' rebuilds before.

`cargo fmt --check` is NOT a gate here: the repo has pre-existing drift in
`build.rs` and `frontend.rs`. Check that your own regions are clean and
leave the rest alone.

## Running the headless harnesses

**`pnpm verify`** (`node scripts/verify-all.mjs`). It starts the five fake
servers on the ports the harnesses hard-code, starts vite on 4173, runs every
`verify-*.mjs`, and prints a board. `pnpm verify discover nav` filters by
name; `KEEP=1` leaves the servers up afterwards.

Baseline is **85/85 harnesses clean, 2872 checks** (1.0.37), or one
fewer: verify-cw-sources' last check only runs when the catalog is still
loading at the click; the script says so and it is not a failure. verify-kit
(plan 019) has one section per shared primitive, so a later change that
undoes one fails there. If playwright-core is not installed, point `PW_FROM` at somewhere
that can require it. verify-fetchvulkan needs 7-Zip (CI has it): without
it that one reads `0✓ 1✗` and the total is 2849.

It refuses to start if anything is already on one of its ports, and that
refusal is load-bearing: a leftover `vite preview` on 4173 binds first, our
vite dies on `--strictPort`, and the suite runs green against a stale dist.
Kill the squatter rather than working around the message. `KEEP=1` is the
usual way to leave one behind.

Don't edit `apps/app/src` while it runs. It serves the working tree through
vite's dev server, so an edit reloads whatever page a harness has open:
v0.10.62's full run read one CRASH and two FAILED from edits mid-run, all
three clean on a re-run.

Read the board's STATUS column, not just the tick counts. **CRASH is the
one that matters.** A failing check is loud; a harness that throws at check
12 of 40 still prints eleven green ticks above the stack trace and the other
twenty-eight leave no trace at all. That is how six of them rotted for
months without anyone noticing, including two whose entire subject had
stopped being exercised.

Watch for checks that pass VACUOUSLY, too. verify-stalker read 2/4 while
the portal served nothing: the two that "passed" were negative assertions
("the adult genre is dropped"), and an empty page drops everything.

**For a change that must not move a pixel** (a token move, a dead-code
sweep): `node scripts/screens.mjs capture <dir>` before and after, then
`compare <before> <after>`. Fifteen scenes in both themes, byte-identical
between two runs of one tree, plus every colour the stylesheets declare
resolved to pixels, which covers hovers, errors and the player. About ten
minutes a capture; `ONLY=guide,stream` for fewer. It uses the board's
ports, so not while the board runs.

**Harnesses stay offline.** This container can't reach Cinemeta, ESPN or
TMDB (each fails in about 250ms), and CI can. So a harness that leaves one
unstubbed passes here and leans on the live service on CI. verify-discover's
search did, and failed three CI runs when Cinemeta was slow. Abort or
fulfill every external host with `page.route`, as verify-armed does.

**Enter a tab with `goTo(page, dest)`** (`scripts/nav-settle.mjs`), not a
bare click on `[data-dest=…]` straight after load. The nav capsule slides
its tabs ~260px into place at launch, and a click in that window lands
where the tab was: a gap, the BlammyTV mark, another tab. verify-mvsound
lost a CI run to it (v0.9.117): the page sat on the Guide, no error.
`goTo` waits for the tab to hold still with nothing moving in the capsule,
then checks the click took.

## CI

`.github/workflows/ci.yml` runs on every push to every branch: typecheck,
lint and unit tests; `pnpm verify` (the board above), as two jobs at once,
"pnpm verify (1/2)" and "(2/2)", each every other harness (`SHARD=k/n`,
v0.11.37: one job had reached 45m55s of its 50); and on `windows-latest`,
`cargo test` plus clippy held to the 9-warning baseline. The board's
baseline is the two slices' boards added together.
That Windows job is the only place the Rust tests run at all. A push that
turns it red is yours to fix before the next one.

## What to run before a push

Not the whole board. CI runs all of it on every push, so a full local run
before each one doubled every version's wait and bought nothing CI doesn't
(Adam, v0.9.127: "feels like these are taking the longest by far").

- **A small tweak** (copy, a CSS value, a one-line fix): `pnpm typecheck`,
  `pnpm lint` and the unit test file it touches, then push. CI runs the
  rest. Adam (1.0.18): "for changes that small i dont think we need to run
  tests on all the things".
- **Anything bigger:** `pnpm typecheck`, `pnpm lint`, `pnpm test`. About two minutes.
- **The harnesses the change touches:** `pnpm verify <name>`, new checks
  included.
- **A native change:** `node scripts/check-rust.mjs`, clippy, and the host
  crate's tests, as above.
- **Mutations only where a check could pass vacuously:** a negative
  assertion ("the arrow doesn't seek"), or a check on something that might
  never have happened (verify-mvline's failed playlist passed on an empty
  page). One or two per change. A check that measures a real result (a
  width, a count, a rect sent to mpv) doesn't need one.
- **An interrupted mutation run leaves its mutation in the file.** The
  runner restores in a `finally`, and a killed process never gets there:
  v0.9.127 shipped `next = w` where `next = w - 24` belonged, and ← on the
  theater's edge did nothing. After one, `git diff` every file it touched
  before committing.
- **The full board locally** only for changes that reach across the app (a
  shared component, App-level wiring) and before a merge to main.

Then push, and read CI's board when it lands. Red is still yours before
the next push.

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

## Ponytail: on for every session

Follow the `ponytail` skill at the default level (full) for all work. A
SessionStart and a SubagentStart hook (`.claude/hooks/ponytail.mjs`) inject it
into every session and every builder, so it doesn't depend on the skill
matching. If you don't see "PONYTAIL MODE ACTIVE" in your context, load the
skill yourself. Adam can switch it with `/ponytail lite|ultra` or turn it off
with "stop ponytail".

It sits under everything above, not over it: data before a fix, the gates, and
the Confusion Protocol still apply, and the skill's own "never cut" list covers
the tests those gates need.

One collision, and this file wins it. Ponytail ends a reply with a line on what
you skipped and any risk. Don't add that as a second trailer. Fold it into the
"What to look for" block under "Flag what you could not check", and keep the
restart line last.

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
- **End every reply with what to look for.** Above the restart line, a short
  "What to look for" block: where to click, and what should be different
  when I get there. This is not narration and not a recap of the diff. It is
  the part I cannot get from the commit, because you looked at the running
  app and I have not yet.
  - **Name the screen and the path to it.** "Settings → Appearance → Stream,
    the Hero Slider Sources field", not "the combobox".
  - **Say what changed AND what should not have.** A conversion that also
    quietly moved something is the failure I most want to catch early, so
    tell me what should look identical.
  - **Flag what you could not check from there.** Anything that needs real
    video, a Windows build, a real addon, or my actual library. Say it
    plainly rather than letting a green board imply you covered it.
  - **Call out judgement calls I might overrule**, with a sentence on why
    you chose that way, so disagreeing is one message and not an
    investigation.
  - Keep it a few bullets. If a change genuinely has nothing to see (a
    harness fix, a comment repair), say that in one line instead of
    inventing something.

The house voice is the site's FAQ copy in `services/site/index.html`: "Yup."
"Nope." "None." Direct, second person, no throat-clearing. Match that.

### Words in the app: follow Apple and Microsoft

Every word a user reads in the app (labels, notes, buttons, empty states,
errors, onboarding) follows Apple's and Microsoft's own writing guides, using
whatever of them can be reached. Adam (0.12): "Microsoft and apples copy is
very good & we should make a rule to follow them". The sources:

- Apple, Human Interface Guidelines → Writing:
  https://developer.apple.com/design/human-interface-guidelines/writing
  (the page renders by script; its text is at
  `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/writing.json`,
  which this container can fetch).
- Apple, WWDC22 "Writing for interfaces":
  https://developer.apple.com/videos/play/wwdc2022-10037
- Microsoft Writing Style Guide, its top 10 tips first:
  https://learn.microsoft.com/style-guide/top-10-tips-style-voice
  (blocked from this container; read it where it can be reached, or search).

What they agree on, and what this app holds to:

- **Read it aloud.** Both say it. If you wouldn't say it to someone next to
  you, rewrite it. "Off shows a button instead." fails: nobody talks like that.
- **A setting's label does the work.** Make the label clear enough that it
  needs nothing under it. Add a note only when the label can't carry it, and
  then say what the setting does when it's ON; people infer the opposite
  (Apple's own rule, its Handwashing Timer example). Never describe Off.
- **Fewer words, plain ones.** Cut every word that isn't needed. No jargon: a
  word that needs a note to explain it is the wrong word ("failover").
- **Buttons are verbs**, and never cute ("Send", not "Let's do it!").
- **No "we"** ("Unable to load content", not "We're having trouble loading
  this content"), and "your" only where it's needed ("Favorites", not "Your
  Favorites").
- **Empty states say what to do next**, with a button to do it where there
  can be one, not a menu path to go and find.
- **Errors sit next to the problem**, don't blame, and say how to fix it.
  No "oops".
- **Title Case for everything that isn't a full sentence** (Adam, 0.12):
  labels, buttons, titles, headings, tabs, menu items, chips, tooltips, and
  an aria-label that is shown on screen too. Apple's title style: capitalize
  every word except articles (a, an, the), "and" and "or", and prepositions
  of four letters or fewer (at, by, for, from, in, into, of, off, on, onto,
  to, up, via, with), unless the preposition is part of a verb phrase ("Sign
  In", "Turn On", "Starting Up the Computer"). The first and last word are
  always capitalized. No period. A full sentence is sentence case and ends
  with a period. Source:
  https://developer.apple.com/library/archive/documentation/FinalCutProX/Conceptual/FxPlugHIG/TextStyleGuidelines/TextStyleGuidelines.html
- **Contractions are fine. Put the most important thing first.**

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

**Bigger changes: Sonnet builds, the main session plans and checks.**
Adam, v0.11.0: it's cheaper. Anything past a small tweak goes to the
builder, Sonnet (`.claude/agents/sonnet.md`, on the Sonnet model). A small
tweak is one or two files, a few lines and nothing new to test (copy, a CSS
value, a one-line fix with its check): those stay here, because briefing
one costs more than it buys.

- **Here, first:** the diagnosis and its data (Confirm with data), the
  decision (Confusion Protocol), and the brief.
- **The brief carries what the builder can't know.** The decision and why;
  the earlier fixes and Adam's calls it must not undo, with their versions;
  the files; the checks to add and the mutations that prove them; the
  gates. Subagents start blank. Built as written, the v0.10.76 odds plan
  would have dropped Adam's hidden team stations (v0.10.73) and let a
  hidden game feed lead the card again, and only the history caught it.
- **There:** the code, its tests and harness checks, the gates. It stops
  and reports when the code, a test or the history disagrees with the
  brief, and never edits a test to make it pass.
- **Here, after:** read the whole diff, re-run the gates and the touched
  harnesses, then version, commit, push and report. Nothing it says is
  taken on trust, same as a finding.
- **One thing on the working tree at a time.** No board run here while the
  builder works: it edits `apps/app/src` and needs the same ports.

**Diagnosis stays hands-on**: the measure→fix→retest loop that most
changes here are. Accumulated context is the asset: the v0.1.106 disk cache
caught a StrictMode race only because the same head fixed it in v0.1.104.
The builder gets that context through the brief, or not at all.

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

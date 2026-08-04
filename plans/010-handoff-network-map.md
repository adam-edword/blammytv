# Handoff: the curated network map (plan 010)

> **CONSUMED in v0.8.149.** The map shipped as `networkMap.ts`. The three
> decisions below were settled without Adam, because the session that picked
> this up could not reach him; what was decided and why is written up under
> **#41 in `plans/010-sports.md`**, which is the file to read now. This one
> is kept as the record of where the job started, not as instructions.

Written 2026-08-04 at the end of a long session, for a fresh one. Adam has
picked this as the next piece of work.

## Where things stand

- Branch `blammytv-0.8.0-push`, at **v0.8.148**, everything pushed, tree
  clean. 536 tests pass; typecheck, lint and build are all green.
- Plan 010 is the 0.9.0 headline. Read `plans/010-sports.md` first: it has
  the full item list, a "Shipped, and off the list" ledger, closed
  decisions, and the phase 0 gate this job comes out of.
- The last stretch (v0.8.119 to v0.8.148) was fast and wide: the fetch
  inversion, the league picker, the racing adapter, tournaments, the draw
  screen, the reach past the window, and light mode. A fresh-eyes review of
  that stretch is on the list and is arguably overdue.

## The job

**Ship a curated map from broadcaster names to the leagues that have none.**

This was phase 0's own fallback, kept on the shelf because the gate passed.
It is back on the table because of what #27 measured.

### Why, in one table

Measured 2026-08-03/04 across the whole 151 league catalog: **1,539 games,
32 carrying a broadcast name at all. 2.1%.**

| sport | games with a broadcast name |
|---|---|
| basketball | 4/4, 100% |
| golf | 3/3, 100% |
| baseball | 19/23, 83% |
| soccer | 6/47, 13% |
| tennis | 0/1462, 0% |

The matcher is not the bottleneck. For most of the catalog the source hands
us nothing to match on, so no amount of matcher tuning moves the number.
The full write up is under item #27 in `plans/010-sports.md`.

### The target list

Leagues measured at 0% that people plausibly follow:

- **tennis/atp and tennis/wta**, 0 of 1,462 matches. The whole sport.
- **Non-US soccer**: `soccer/arg.1`, `soccer/col.1`, `soccer/ven.1`,
  `soccer/bol.1`, `soccer/par.1`, `soccer/swe.1`, and both
  `soccer/uefa.champions_qual` and `soccer/uefa.europa_qual`.

Compare with what does work, to see the pattern: `baseball/mlb` at 83%,
`basketball/wnba` and `soccer/concacaf.leagues.cup` at 100%. It is US
rights. The phase 0 gate tested NFL, MLB and the Premier League, which are
exactly the leagues with coverage, so the long tail was never seen.

### What "the map" means

Phase 0 described it as: a hand maintained table shipped with the app,
saying which network carries a given league in the US. Rights are stable
within a season and there are not many of them, so it is one PR per season,
it is auditable, and it degrades honestly.

The shape to decide (this is the first real decision, see below): the map is
probably league to network names, feeding the SAME matcher the real
broadcasts feed, rather than a second matching path. That would make it a
fallback source of `broadcasts` rather than a fallback source of `channels`,
which keeps one join and one confidence model.

## Where the code is

- `apps/app/src/features/sports/espn.ts` maps `broadcasts` off the wire.
  `orderedBroadcasts` decides which feed a card headlines with.
- `apps/app/src/features/sports/matcher.ts` is the join itself:
  `indexChannels`, `matchGame`, `matchEvent`, `CARD_CONFIDENCE`.
- `apps/app/src/features/sports/carriage.ts` turns the result into the one
  line a card shows. Note the wording changed in v0.8.145 to "Couldn't find
  a matching channel", which is deliberately weaker than the old "Not on
  your channels": see below.
- `apps/app/src/features/sports/useGames.ts` `withChannels` is where games
  and the channel catalog are joined, memoised on both.

## Decisions to make with Adam before building

1. **Where the map plugs in.** As synthetic `broadcasts` on the game (one
   join, one confidence model) or as a separate lookup after the matcher
   misses. The first is recommended above but it is not settled.
2. **How the card should say it.** A guessed network is not the same claim
   as one the source stated. The card currently has no way to express "this
   league is normally on X" as distinct from "this game is on X". Adam has
   been clear that honesty about what we know is the house style.
3. **Whether a 0% league should say so.** There is a truthful and cheap
   message available: "we have no broadcast data for this league", which is
   different from "we looked and missed". Cheaper than the map and worth
   considering first, possibly alongside it.

## Ground rules that bit during this stretch

- **Confirm with data before a non-trivial change.** Every good call in the
  last thirty versions came from measuring first, and every wrong one came
  from reasoning about a payload instead of fetching it.
- **The rig is `apps/app/harness/sports.html`.** It has `?state=loading`,
  `?state=error`, `?state=empty` and `?state=next` switches, real slates for
  five team leagues plus F1 and tennis, and a stand in bar for the app
  header. That header bar exists because a screen that is only wrong inside
  the app shell looked perfect in the rig, and shipped.
- **Chromium in this container cannot reach espncdn or ESPN.** Crests and
  league marks render blank; `curl` works, the browser does not. Do not read
  a blank mark as a bug.
- **Read exit codes individually.** A pipe masks them, and that shipped a
  failing test once.
- **Version bumps touch three files**: `package.json`,
  `apps/app/package.json`, `apps/app/src/lib/version.ts`. Not
  `tauri.conf.json`, which stays 0.8.0.
- No em dashes in user facing copy, docs or plans. Code comments are exempt.

## Open items not in this job

Needing Adam: the golf card (#10, golf currently renders zero cards and the
shape is a real decision), a wide tournament card (#39), and the suspended
match pip, which shows a live dot next to the word "Suspended".

Not needing Adam: #29 and #30 (perf, the board re-resolves channels on every
tick), #15 (backoff and cache), and the fresh eyes review of the stretch.

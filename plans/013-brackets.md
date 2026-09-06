# 013: Brackets, or a tournament you can see the shape of

- **Status**: **DESIGN, not started.** Nothing is built. The data was probed
  live on 2026-09-06 and every number below is measured; the open questions
  at the bottom want answering before code.
- **Severity**: LOW (feature, not a defect)
- **Category**: Live TV / sports
- **Estimated scope**: one adapter change, one new screen, one entry point.
  Single session for the NCAA shape; the other two are their own sessions.
- **Origin**: Adam, 2026-09-06, asking for "a plan for a playoffs or scores
  mini tab to see the brackets of a tournament or conference", alongside the
  four board changes that shipped in v0.9.47.

## Problem

The board answers "what is on today". It cannot answer "who plays who next",
and in a knockout that second question is most of the interest. A bracket is
the one sports object whose whole value is its SHAPE: sixteen results in a
list tell you less than four lines on a page.

Today the app throws the shape away twice over. `competition.notes[0]`
carries "Men's Basketball Championship - East Region - 1st Round" and lands
on `Fixture.note`, a string on one card. `competition.series` carries a live
playoff series (how many wins each side has, how long the series is) and
`espn.ts:896` keeps only its English summary and drops the numbers.

## The data, probed 2026-09-06

Everything needed is on endpoints the app already speaks. Three shapes, and
they are genuinely different, which is the reason this is a plan and not a
ticket.

### 1. Single-elimination tree: NCAA tournament

`GET .../basketball/mens-college-basketball/scoreboard?dates=YYYYMMDD&groups=100`

Twelve date asks covered the whole 2025 tournament: **67 games, and all 67
carried a seed on both sides** (`competitors[].curatedRank.current`, 1 to 16).
`competitions[].type.abbreviation` is `TRNMNT`. `notes[0].headline` parses on
` - ` into region and round with no ambiguity:

```
First Four 4 · 1st Round 32 · 2nd Round 16 · Sweet 16 8 · Elite 8 4
Final Four 2 · National Championship 1
South Region 17 · Midwest 16 · East 16 · West 15 · (3 with no region)
```

The three without a region are the Final Four and the final, which have none.
This is a complete 68-team bracket for twelve requests, and it is the shape
worth building first.

### 2. Series ladder: NBA, NHL

`competitions[].series`, already downloaded on every playoff game:

```json
{ "type": "playoff", "totalCompetitions": 7, "completed": false,
  "summary": "TOR leads series 2-0",
  "competitors": [{ "id": "21", "wins": 2 }, { "id": "26", "wins": 0 }] }
```

The nodes of this tree are best-of-sevens, so each one needs a **win count,
not a score**. `wins` and `totalCompetitions` are exactly that and are
currently discarded. Measured on 2025-05-07: both NHL games carried a full
series object.

### 3. Week ladder: NFL

`GET .../football/nfl/scoreboard?dates=2024&seasontype=3&week=N`

`notes[0].headline` is "AFC Wild Card Playoffs". Round comes from `week`,
conference from the note. Thirteen games over four weekends, no seeding grid
and no regions: this is the flattest of the three and the least improved by
being drawn as a tree.

### The CFP is a trap worth naming

College football's playoff parses, but its round names are **sponsored**:

```
College Football Playoff First Round Presented by Allstate
College Football Playoff Quarterfinal at the Vrbo Fiesta Bowl
College Football Playoff National Championship Presented by AT&T
```

And the same date carries ordinary bowls ("StaffDNA Cure Bowl") that are not
in the bracket at all. So the CFP needs its own note parsing and its own
inclusion rule, and it will break the year a sponsor changes. Do not fold it
in with the NCAA basketball shape on the grounds that both are
single-elimination.

## What has to change in the adapter

Small, and it is the same change for all three:

- **`espn.ts:420-428` builds the URL from `dates` alone.** A bracket needs
  `seasontype`, `week` and `groups`. That is the one structural edit, and it
  wants doing carefully: the response cache is keyed on the full URL
  (`espn.ts:437`), so new params are new cache entries, which is correct and
  free.
- **`RawCompetition.series` keeps only `summary`.** Add `completed`,
  `totalCompetitions` and `competitors[].wins`, and carry them onto the model
  as a `Series` rather than a sentence.
- **`notes[0].headline` needs a parser**, not a passthrough. Round and region
  are two facts inside one string and each bracket family writes it
  differently.

`Competitor.rank` already lands (v0.9.47), and for a tournament it IS the
seed, which is the field a bracket draws first.

## Where it lives, which is the open question

Three readings, materially different work, and this is what wants answering
before anything is written:

1. **A card on the board that opens full-screen**, the way a tournament card
   already opens `TournamentDraw` (`SportsScreen#openTournament`). Cheapest,
   reuses a mode that exists, and puts the bracket where the games are.
2. **A mode on the sports sidebar**, beside Leagues / Teams / Confs. Findable
   out of season, which the card is not, and out of season is when people
   look at brackets.
3. **A fourth Live TV tab.** Most discoverable, most expensive, and hardest
   to justify for something that is dead ten months a year.

`TournamentDraw.tsx:12-25` argues at length for **a list over a grid**, and it
is right about tennis: a real day at the National Bank Open was 39 matches
across 10 courts and peaked at 89. A 68-team bracket has the opposite problem.
It is small, fixed, and its whole value is the shape. So this is the one place
in the feature where a grid beats a list, and the plan should say that out
loud rather than inherit the tennis reasoning by proximity.

## Standings, which is adjacent and cheap

`GET https://site.api.espn.com/apis/v2/sports/football/nfl/standings` returns
conference → division → table, verified 2026-09-06. It is **the only place pro
conference and division data exists**. The scoreboard carries none, which is
why v0.9.47's conference filter is college-only. If standings ever land, that
filter extends to the pro leagues for free.

## Why not now

**Seasonality is the argument, and it is a real one.** A bracket view is dead
from April to March. Before the grid is worth drawing, somebody has to answer
what the screen says in July: last season's bracket, the next tournament's
date, or nothing at all. And "nothing at all" is a tab that is empty most of
the year, which is the exact thing plan 010 #17 refused to ship for the
Channels tab.

## Verification, when it happens

- Fixtures from the real captures, pruned like `cfb-scoreboard.json`: one
  full NCAA region, one live NBA series, one NFL playoff weekend.
- The parser is the risk, so it is where the unit tests go: every round name
  in the table above, the three region-less games, and a sponsored CFP note.
- A headless harness only once the screen exists. `verify-sports-days.mjs` is
  the model.

# 010: Sports: a hub for what is on right now

- **Status**: IN PROGRESS. Phases 0, 1, 2 and 4 done; phase 3 most of the
  way. **The join works and the rail plays: a game is now one click from
  a picture.** Next is filters (phase 5).
- **Severity**: MEDIUM (feature, not a defect)
- **Category**: Live TV / sports
- **Estimated scope**: a schedule source, a matcher against the user's own
  channels, one new screen, and a filter surface. Multi-session.
- **Origin**: Adam, 2026-07-12 ("a Sports tab in Live TV", no design). Picked
  as the 0.9.0 headline 2026-07-27 after looking at ScoreBox.
- **Decided with Adam, 2026-07-27**: US first. All the major US leagues, plus
  the global competitions people here actually watch (Premier League, F1).
  Modelled on ScoreBox's cross-reference, not on a scores app.

## Problem

Sports is a large part of why anyone keeps an IPTV subscription, and it is
the thing this app is worst at.

Finding a game today means knowing which network has it, then finding that
network yourself among ~1900 channels named things like `US| ESPN2 HD`. The
app knows your channels. It knows the guide. It has no idea that Chiefs vs
Bills is a thing that exists, so it cannot help.

Every other part of BlammyTV took a pile of raw provider data and gave it a
shape a person recognises. Live TV turned a flat channel list into folders
and a guide. Stream turned an addon manifest into posters and rows. Sports
is the same move applied to the one category that is still raw.

## Target

**A hub whose objects are GAMES, not channels.**

```
┌──────────────────────────────────────────────────────────┐
│  [All] [NFL] [NBA] [Premier League] [F1]      ← filters   │
├──────────────────────────────────────────────────────────┤
│  LIVE                                                     │
│  ┌──────────────────────────────────────────────────┐    │
│  │ ● 3rd 07:22   KC 21 - 17 BUF                     │    │
│  │   CBS  ·  your channels: US| CBS HD, CBS East 4K │    │
│  └──────────────────────────────────────────────────┘    │
│  UP NEXT TODAY                                            │
│  ┌──────────────────────────────────────────────────┐    │
│  │ 4:25 PM   Chelsea v Arsenal        Premier League│    │
│  │   USA Network  ·  your channels: USA HD          │    │
│  └──────────────────────────────────────────────────┘    │
│  FINISHED                                                 │
└──────────────────────────────────────────────────────────┘
```

- **Live first, then upcoming today, then finished.** The question the screen
  answers is "what can I watch right now", so anything else is secondary.
- **Each card carries the channels of YOURS that are showing it.** That is
  the whole feature. A fixture with no channel behind it is a listing; a
  fixture with a channel behind it is one click from playing.
- **Several channels is normal and good.** A game on three of your channels
  gives you three chances at one that is not buffering, which is the same
  idea as the VOD source rail and should reuse its language.
- **Filter by league and team.** The hub opens on what you follow.

## Phase 0: the gate

**The question: can we get, for free and without a key, a schedule that says
WHICH NETWORK is carrying each game in the US?**

Fixtures and scores are easy and several sources have them. Broadcast
assignment is the rare field, and it is the one this design turns on. Without
it there is no join, and the feature degrades to a scores app that cannot
play anything, which is not worth building.

Four requirements, and a candidate has to meet all four:

- **R1 Coverage**: NFL, NBA, MLB, NHL, NCAA football and basketball, MLS,
  Premier League, Champions League, F1.
- **R2 Broadcast data**: the US network per fixture.
- **R3 No shipped key.** BlammyTV is a distributed binary; a key inside it is
  extractable, and most providers' terms forbid it outright.
- **R4 No server of ours.** This app has never had a backend. Adding one is a
  real decision with a bill, an uptime obligation and a privacy surface, and
  it should be made deliberately rather than smuggled in as an implementation
  detail of a sports tab.

| Candidate | R1 | R2 | R3 | R4 | Verdict |
| --- | --- | --- | --- | --- | --- |
| **ESPN undocumented JSON** | Yes, 20+ sports | **Believed yes** (`broadcasts` per event) | Yes, keyless | Yes | **The only candidate that clears all four on paper.** |
| TheSportsDB | Yes | Weak/absent | No ($9/mo key) | Yes | Fails R2 and R3 |
| API-Football (api-sports) | Football strong, others are separate subscriptions | No | No | Yes | Fails R1, R2, R3 |
| football-data.org | 12 competitions, football only | No | No | Yes | Fails R1, R2 |
| Sportradar / SportsDataIO | Yes | Yes | No | No | Enterprise pricing, needs a proxy |

**The gate test, and it is small:**

1. `GET https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
2. `GET https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard`
3. In each, look for `events[].competitions[].broadcasts`. Record how many
   events have it populated, and what the values look like.
4. Repeat for F1 (`racing/f1`) and one NCAA endpoint, which are the two most
   likely to be shaped differently.

**Pass** (broadcast populated for most US-rights fixtures): build phase 1
against ESPN behind an adapter interface.

### Result: PASS, run 2026-07-26

| League | Events | Carrying a broadcast name | Values |
| --- | --- | --- | --- |
| NFL | 16 | **16/16** | NBC, FOX, CBS, Netflix |
| MLB | 15 | **15/15** | MLB.TV, MASN, Peacock, Marquee Sports Net, SNY |
| Premier League | 1 | **1/1** | USA Net |
| NBA | 2 | 0/2 | (out of season) |
| NHL | 7 | 0/7 | (out of season) |

41 events mapped across the five leagues, 0 missing a crest, 0 missing a
team colour. Two findings beyond the gate itself:

- **The names are matchable.** They are broadcaster names, not codes, and a
  game carries the national feed plus a regional one per side, so the
  matcher gets several chances per game rather than one.
- **F1 is confirmed as its own shape**: one event with **22 competitors**
  and no home/away. It stays out of the league registry until it has a
  card. Everything else here is two-sided.

Also settled: CORS is open (`access-control-allow-origin: *`), so the
adapter runs in the webview and needs no Rust round-trip. Real responses
are checked in beside the adapter, pruned to the paths it reads.

**Fail or thin**, in preference order:

- **A curated network map shipped with the app.** Rights are stable within a
  season and there are not many of them: Premier League is on USA/NBC/Peacock,
  NFL national windows are CBS/FOX/NBC/ESPN/Prime. A hand-maintained table
  covers the common case, is auditable, and costs one PR per season. Less
  magic than it looks, and it degrades honestly.
- **Bring your own key**, with a keyed provider for anyone who wants full
  coverage. Zero cost, zero terms risk, and most users will never do it, so
  it is a supplement and not a plan.
- **Our own aggregation service.** Correct, durable, and a different project.
  If we get here, stop and re-plan rather than drifting into running a backend.

Those three stay on the shelf. The gate passed, so none of them is needed
now, and they are kept because the endpoint is undocumented and could still
close on us.

## The join, which is the hard part

```
fixture.broadcasts[] ──→ network names ──→ your channel list
       "CBS"                              "US| CBS HD", "CBS East 4K"
```

Nobody's playlist names channels the way a schedule names networks. The
matcher is the feature, and it is pure logic, so it is the part that gets
tests before it gets a screen.

### One side of it, harvested 2026-07-27

The gate run only proved the field was populated. This run asks what is
actually IN it, so the matcher can be written against the real vocabulary
rather than against four names we happened to see.

Eleven in-season league-days pulled (most leagues are out of season in late
July, so the dates were chosen to land on real fixtures): **95 events, and
95 of them carry at least one broadcast name.** 92 distinct names, checked
in verbatim as `fixtures/broadcast-names.json` with the league, market and
media type each was seen under. That file is the corpus the matcher's tests
get written against.

**Settled: `broadcasts[].names` is the right field to read.** There is a
second list, `geoBroadcasts[]`, and it looked richer. Compared across all 95
events it adds exactly one name we do not already have (`ERADM`, ESPN Radio,
which is unwatchable and unwanted) and it loses two we do (`MLB.TV`,
`NBA League Pass`). The adapter stays as it is.

The names fall into five shapes, and each one is a rule:

| Shape | Examples | What the matcher does |
| --- | --- | --- |
| National networks | FOX, CBS, NBC, ABC, ESPN | The whole point. These are in everyone's playlist and they are what a token match is for. |
| Streaming-only | MLB.TV, ESPN+, Peacock, Netflix, Prime Video, NBA League Pass, Hulu, `Twins.TV`, `Mavs.com` | **Will never match a channel and must not be tried.** Roughly a third of the corpus. A game on these only is honestly "not on your channels". |
| Regional sports nets | FanDuel SN SE, NBC Sports BA, Sportsnet LA, MASN, NESN, MSG | Heavily abbreviated and the hardest case. `FanDuel SN` alone appears with 11 different suffixes. |
| Local call signs | `KTVD-TV (My20)`, `WKYC 3`, `KUSA-TV (9NEWS)`, `WBFS` | Call sign plus a channel number, sometimes a brand in brackets. Needs the brackets stripped before anything else. |
| Radio | ERADM | Dropped. Only reachable via `geoBroadcasts`, which we do not read. |

Three traps the corpus already shows:

- **ESPN is not internally consistent about case.** `Peacock` comes back
  typed `STREAMING` on one game and `Streaming` on another. Fold case on
  both sides before comparing anything.
- **Names collide across leagues.** `MSG` is both an NBA and an NHL feed,
  `NBC` appears under three leagues, `FanDuel SN DET` under three. The
  matcher's key is the network name and nothing else, which is what makes a
  taught correction hold everywhere, but it means league cannot be used to
  disambiguate a name.
- **Punctuation is load-bearing and inconsistent**: `ESPN+`, `MASN2`,
  `MAS+`, `Space City Home (Alt.)`, `Spectrum Sports Net +`. A normalizer
  that strips `+` turns `ESPN+` into `ESPN`, which is the streaming service
  masquerading as the cable channel, which is exactly the ESPN/ESPNU class
  of false positive this plan already warns about.

### The other side, dumped 2026-07-27

Adam's own channels, via `scripts/dump-channel-names.js`, checked in as
`fixtures/channels.json`: **1,875 channels across 22 folders**, names and
folders only, no urls. Measured against the 92 ESPN names above, counting
only the 60 that are not streaming-only and could therefore ever match:

| Matcher | Reachable broadcasters matched |
| --- | --- |
| Normalize + exact token set | 16/60 (27%) |
| ...plus alias expansion | 25/60 (42%) |
| ...**as shipped, false positives removed** | **24/60 (40%)** |

The last row is lower than the one above it on purpose. Allowing a network
name to be a SUBSET of a channel's name reached 27 names, and three of
those were wrong: `NBC` was matching NBC Sports Bay Area, Boston and eight
more, `Sportsnet` was matching eighteen channels, and `ESPN` was matching
an event listing called "NBA Las Vegas Summer League 2026 - ESPN". Every
one of the 24 that remain has been checked by hand and is right. A wrong
channel is worse than no channel, and this is that rule costing three
points.

Alias expansion is ESPN's abbreviations against a playlist's full words:
`NFL Net` to `NFL Network`, `MLBN` to `MLB Network`, `NBC Sports BA` to
`NBC Sports Bay Area`, `SN` to `Sports Network`, `SportsNet PIT` to
`SportsNet Pittsburgh`. That is 15 points available in code and nothing
else is, which is the point of measuring before writing it.

**The remaining 35 misses are not an algorithm problem, and this is the
finding that matters.** They split cleanly:

- **National broadcast networks**: ABC, USA Net, Universo, Tele, TVA. These
  carry most of the NFL, NBA and Premier League national windows. None of
  them is in the catalog at all.
- **Regionals and local call signs**: 11 `FanDuel SN` feeds, 9 call signs
  (`KNTV`, `WKYC 3`, `KUSA-TV (9NEWS)`), `MSG2`, `MASN2`, `Root Sports NW`,
  `Spectrum Sports Net`. No channel carries them.

**Why they are absent: the catalog is 9% of the provider.** The load logs
240 categories and 20,548 streams; 1,875 channels survive, because
`droppedCategories` removes every hidden category and hiding a folder hides
its content, not just its sidebar row. 218 of 240 categories are hidden, and
the general-entertainment folders that carry ABC and USA Network are among
them.

So the matcher's ceiling is set by which categories are un-hidden, not by
how clever it is. **That is an open decision, recorded below, and it should
be settled before the matcher is written**, because it changes what the
matcher searches.

### Performance, measured

Resolving a board is games times networks times channels, and on a 20,548
channel catalog the naive loop takes **3.7 seconds**. An inverted index from
word to channels makes it **4.7ms**, because every word of a network's name
must be present and so the rarest of them rules out almost everything before
any comparison happens. The index costs 100ms to build, once per catalog,
memoised on the LiveData object.

| | 1,875 channels | 20,548 channels |
| --- | --- | --- |
| build the index, once | 13.6ms | 100.2ms |
| resolve 42 games | **2.1ms** | **4.7ms** |
| resolve 42 games, no index | 286ms | 3,681ms |

### The second join: channels that name the FIXTURE

**Found 2026-07-27, by asking why Telly showed five sources for a game we
showed none for.** Adam's provider carries a channel per out-of-market
game:

```
MLB 05 | Arizona Diamondbacks at Pittsburgh Pirates HOME 27 Jul 06:40 PM ET
```

There is no broadcaster in that string, so the network matcher is
structurally blind to it however good it gets. Matching the TEAMS finds it,
and finds the RIGHT thing: ESPN listed that game as being on MLB.TV, the
out-of-market package, and this channel is that package's feed of that
game.

Measured on a real slate, before and after: **4 of 12 of today's MLB games
found a channel by network alone; 12 of 12 find one once fixtures are
matched.**

What Telly does instead is map `MLB.tv` to any channel containing "MLB",
which returned MLB Network, The MLB Channel, MLB Channel, US: MLB and
Tubi: MLB. That is a worse answer wearing a confident face: MLB.TV is the
out-of-market package and MLB Network is a national cable channel, and
ESPN named the former precisely BECAUSE the game was not nationally
televised. Those five are mostly not showing it.

The rule is deliberately the opposite of the network matcher's. There,
extra words are suspicious because they distinguish sibling channels; here
they are the date, the feed number and which booth it is, so they are
expected and ignored. Both clubs must be named, which no other fixture can
accidentally satisfy, and the date must agree because two clubs play three
nights running and these channels rotate daily. Read in US Eastern, which
is the clock the provider stamps them with.

### Decided: matches are scored, not just accepted

**Adam, 2026-07-27, after seeing Telly's picker.** The matcher was binary
and deliberately strict, so everything it returned was high confidence by
construction and a score would have been decoration. Scoring is worth
having only because it lets DOUBTFUL matches be shown instead of dropped.

That reads against this plan's own rule, "prefer showing fewer, surer
matches", so the line is drawn differently rather than moved:

- **Rejected**, whatever else agrees: anything carrying a qualifier the
  network name does not. ESPN 2, ESPN U, NESN Plus, Bein Sports Xtra are
  not doubtful, they are definitively other channels.
- **Scored**: everything else, from how the match was made. 100 the names
  agree; 90 agreed on a trailing acronym; 85 the channel only carried shelf
  words; 40 it shares the name but carries words that might mean another
  feed. Minus 15 wherever one of our own aliases was needed, because that
  is our claim rather than either side's.

The rule the plan was protecting is that a wrong channel must not be
presented as right. A 40% row in a rail is not that.

**The card and the rail read the same list differently.** A card counts
only matches at 70 or better, so "Live on 3 channels" stays a promise. The
rail shows everything with its score visible, which is the one place doubt
can be stated rather than hidden.

Measured over the corpora: 25 of ESPN's names now find something, 24 of
them card-worthy. The one addition is `Rangers Sports Network` finding
`US: Texas Rangers Sports Network` at 40%, a correct match strict mode was
throwing away. `NBC` returns 10 rows, 1 card-worthy and 9 doubtful, which
is the Telly-shaped list and exactly what the score is for.

### Decided: the rail goes wide, the card stays narrow

**Adam, 2026-07-27: "more to choose from is always preferred when sources
go awry."** An operational argument rather than an aesthetic one, and it
is right: IPTV streams die mid-game, so a rail with five imperfect options
beats one with two perfect ones that have both gone dark. Being wrong is
recoverable when the score says so; having nothing left to try is not.

So a third tier, the BRAND of a product name: `MLB.TV` reaches `MLB
Network` through `MLB`, at 30. This is what Telly does for every match, and
it is usually the wrong channel for a reason we can state: a schedule
naming the out-of-market package is telling you the game is not on the
national one. It is offered anyway, last, with its odds on it.

Only names shaped like a service (`X.TV`, `X.com`) may shorten, so an
ordinary broadcaster cannot quietly lose a word. And the guess stays a
guess however cleanly the short name fits: the doubt is in having dropped
`.TV`, not in what is left.

Measured on today's real slate, per game: 5 to 9 rail rows, of which 2 to 5
are card-worthy. Diamondbacks at Pirates went from zero rows to five, the
top two being the actual per-game feeds.

### Decided: what the matcher searches

**Adam, 2026-07-27: hidden folders count, but only as a fallback.** If
anything in a VISIBLE folder carries the game, that is the whole answer and
the hidden ones are never mentioned. Only when nothing visible carries it do
they appear. Decided per game, not per network: a game on FOX and MASN with
only MASN visible offers MASN alone.

The reasoning is which case each choice serves. The common case is that a
folder was hidden precisely so it would stop being seen, and the rare case
is the Sunday where the only copy of a game is inside one. Ranking hidden
channels below visible ones in a single list would serve the rare case by
spoiling the common one; a fallback serves the rare case and is invisible
the rest of the time.

**This needed a pipeline change, because hidden channels never used to
exist.** `mapStreams` drops them at load, and that rule stands for the
guide. They now come back on a separate list, `LiveData.hidden`, which the
sports matcher is the only reader of: the guide, sidebar, search,
favourites and recents all read `channels` and see exactly what they did
before.

**One trap, found by a test that failed for the right reason.**
`droppedCategories` returns the user's hidden folders and the categories
the ADULT FILTER hid, added together. Reusing that set would have made the
sports hub a way around the adult filter. `mapHiddenStreams` therefore
starts from the user's own list and subtracts the adult categories back
out, and a test holds it there.

## Where it lives

**Live TV gains a rail: `Guide | Sports`**, mirroring Stream's `Home ·
Discover · Library`.

Not a Live sidebar mode: those are filters over one guide, and this is a
different screen with a different object. Not a third top-level section
either: it tunes live channels, it belongs to that world, and the app just
spent 0.8.0 establishing "two worlds, each with its own tabs" in the header
and in Settings. Sports is a tab of the Live world.

## Data model sketch

```ts
interface Fixture {
  id: string;               // source id, namespaced by provider
  league: LeagueKey;        // "nfl" | "epl" | "f1" | …
  start: Date;
  state: "pre" | "live" | "final";
  /** Competitors. Two for team sports; F1 is a session, see Risks. */
  home?: Competitor;
  away?: Competitor;
  name: string;             // "Chelsea v Arsenal", or "Miami Grand Prix"
  detail?: string;          // "3rd 07:22", "FT", "Lights out 2:00 PM"
  score?: { home: number; away: number };
  /** Network names as the SOURCE calls them, never normalized in place. */
  broadcasts: string[];
}

/** Resolved at render time against the live channel list, never stored:
 * playlists change under us and a stale channel id plays the wrong thing. */
interface Carriage {
  fixture: Fixture;
  channels: Channel[];      // ordered best-quality first
  taught?: boolean;         // came from a user correction
}
```

## Phases

1. **DONE.** **Source adapter + the gate.** One module behind an interface,
   answering "give me today's fixtures for these leagues". Verified against
   the real endpoints. Deliberately throwaway-able.
   `espn.ts`, five leagues, three real responses as fixtures, 12 tests.
2. **DONE.** **The matcher, tests first.** `matcher.ts` against both real
   corpora, wired through `catalog.ts` and `withChannels`. Cards carry real
   channels. Measured end to end on a real MLB slate: Cubs v Pirates finds
   three, Nationals v Phillies finds MASN and NBC Sports Philadelphia.
3. **MOSTLY DONE.** **The hub, read only.** Cards, sections, no tuning.
   Proves the shape. Today as a row in kick-off order, centred on whatever
   is on now, plus a grid per day for three days. Three card sizes, one per
   job: wide for the row, small for the grids, a compact line for finished
   games. Still to come: the filters below, and a way to reach further than
   three days.
4. **DONE.** **Tuning.** Click a channel, play it. The existing player path
   reused whole rather than reimplemented: `resolveStreamUrl` for the URL,
   `InvertedPlayer` for the hole, `useDirectOverlay` + `TheaterOverlay` for
   the chrome. The theater is the third host of that stack and behaves like
   the other two, which is the point.

   Two things it does that the others do not, both because the subject here
   is a GAME rather than a channel: switching game stops playback (a Cubs
   feed under a Blue Jays matchup is worse than silence), and the chrome's
   title line is the fixture rather than the EPG's "MLB Baseball".

   The failover language from the VOD source rail is NOT here. The rail
   already shows every match with its confidence, so choosing another feed
   is picking a different row rather than pressing "next source"; whether
   the dead-stream card should also step down the rail on its own is a
   separate question and is not answered yet.
5. **Filters.** Leagues and teams, persisted, hub opens on what you follow.
6. **Polish.** Empty states (no leagues followed, nothing on today, no
   channels matched), refresh cadence, reduced motion.

**The order changed, deliberately.** Phase 3 was built before phase 2
against real ESPN data with `channels: []` on every game, because the cards
had a lot of design in them and a screen you can look at is worth more than
a matcher you cannot see. The cost of that choice is that the hub currently
promises carriage it cannot deliver, which is why every surface that would
name a channel says what it actually knows instead ("On FOX", "Not on your
channels", and the theater's own empty rail).

## Risks and scars

- **An undocumented endpoint can change or close without warning.** Its JSON
  must never reach the UI: adapter in, `Fixture` out. If it dies, we swap one
  module rather than rewriting a screen.
- **A wrong channel is worse than no channel.** Someone tuning the wrong game
  loses trust in the whole tab. Prefer showing fewer, surer matches, and make
  the correction path obvious.
- **Live scores tempt a fast poll.** Be conservative, back off hard when the
  tab is not visible, and never poll while the user is watching something.
  This is a free endpoint we do not own; behave like a guest.
- **Blackouts.** A network carrying a game nationally may not carry it in the
  user's market. We cannot know this. The UI should not promise more than
  "this network has it".
- **F1 is not two teams.** Sessions (practice, qualifying, sprint, race) do
  not fit a home/away shape. Model it as a named session or the F1 rows will
  be full of empty scoreboards.
- **Timezones and DST.** Everything renders in local time from an absolute
  instant. Never format a date on the source's terms.
- **Rights change between seasons**, so a shipped network map is a
  maintenance commitment with a date on it. Say so in the file itself.
- **Constants that must agree belong together.** The v0.8.1 guide cache bug
  came from a retention window and a cache age living in different files with
  nothing linking them. Refresh cadence, cache age and staleness thresholds
  here get one module.

## Verification

- The gate: a recorded count of how many fixtures per league carry broadcast
  data. **This is the number the whole plan rests on and it belongs in this
  file once known.**
- The matcher, against a real playlist: no false positives on the ESPN/ESPNU
  class of near-name, and a recorded hit rate per league.
- A fixture with no matching channel renders honestly and does not look broken.
- A taught correction survives a restart and applies to the next game on that
  network.
- Nothing polls while playback is running.
- Opening the tab with no leagues followed explains itself.

## What is left, as of v0.8.102

Written from the plan, the code and the sessions that built it. Grouped by
area rather than by phase, because the phases stopped describing the work
once racing arrived.

**[ ]** not started, **[~]** partly there, **[?]** blocked or undecided.

Two items gate a lot of the rest: **A1** (a real racing adapter) clears
five TEMPORARY markers and makes all of section A easier, and **D1** (the
fetch inversion) is what turns a 151 league catalog from a list into a
feature.

---

### A. Racing

#### A1. A real racing adapter [~]

`race.ts` is a second front door: it fetches F1 on its own and joins
nothing. The board still knows only about `Game`.

- Add racing to the source list in `espn.ts`, keyed by catalog path
  (`racing/f1`) rather than by the hand written `LeagueKey`.
- **Decide the model first.** `Game` is home and away. A session is an
  ordered field. Either `Game` grows a variant, or `fetchGames` returns two
  collections. This same decision decides B1 (golf), so make it once.
- Move `toBoard`, `nextUp`, `toWeekend` and `toSessions` across, keeping
  their 14 tests.
- `useGames` returns racing alongside team games, so `SportsScreen` stops
  calling `useRaces` and stops special casing `day === days[0]`.
- Delete the five TEMPORARY blocks (`SportsScreen` x3, `race.ts`,
  `RaceCard`, `WeekendCard`).

#### A2. Sessions on their own days [ ]

Every racing card lands at the head of *today's* grid whatever day it is.

- Give `Race` a real `start: Date` instead of a preformatted `time`.
- Run it through `onDay()` like a game, so it lands on the right grid.
- **Decide where the weekend card goes.** It spans three days, so it has no
  single grid. Probably today, or the day before FP1.

#### A3. The other five racing leagues [?]

IndyCar, three NASCAR series and NHRA carry no `circuit` and no
`address.country`. No country, no flag, no track art.

- **Decide what fills the big name slot.** The only identifier is the event
  name, up to 44 characters ("NASCAR O'Reilly Auto Parts Series at
  Daytona"). Options: the event name shortened, the venue if it turns up
  under another key, or the series.
- `shortPlace` codes past 8 characters through a country table, so an event
  name falls to the three letter guess and gives "CLA" for "Clash at Bowman
  Gray". Non country places need their own path.
- The card already handles a missing flag and missing art, so nothing there
  needs to change.
- NHRA returned **0 events** for 2026. Check whether it is ever populated
  before building for it.

#### A4. Drop finished practice from the board [ ]

A Sunday would otherwise carry FP1, FP2, FP3 and Qual, all dimmed, above
the race.

- A predicate in the adapter, not in the card.
- **Decide the rule.** Hide finished practice once the race has run? Hide it
  on race day? Keep the most recent only?

#### A5. The lap total [?]

- Confirmed absent: a search of every key in a finished Grand Prix for lap,
  team or constructor returns nothing. `status.period` is a lap NUMBER.
- `lapTotal()` parses ESPN's status text as a best effort and is
  **unverified**, because F1 is not running and `sports.core.api` plus
  `site.web.api` both answer HTTP 000 from the dev sandbox.
- On a real machine during a live session: dump `status.type.detail` and
  `shortDetail` and see whether a total is in there.
- Also confirm `status.period` really is the CURRENT lap when live. It is
  only known to be the final lap count when finished.
- If the text has no total: choose between a per circuit table (24 numbers,
  a maintenance commitment) and dropping the total.

#### A6. Racing in the wide row [ ]

`GameCard` is a two sided fixture and a session has no sides.

- Either a wide race card, or racing stays out of "Today's Games" and
  appears only in the grids.
- `nowish()` picks the anchor off `state`, so it already copes.

#### A7. Racing in the theater [ ]

- `matchGame` keys off team names. A race has none, so it needs a path
  keyed on the series ("Formula 1", "F1") reusing `matchNetwork`.
- `autoPlay` and `nextSource` should then work unchanged.
- **Hit rate unknown.** Needs the same real playlist test the five team
  leagues got.

#### A8. Sprint session names [ ]

`SS` and `SR` arrive with only the abbreviation and no expanded name. A
label map in the adapter. Low risk, five minutes.

---

### B. Other sport shapes

Measured once over 484 events: only two sports need a card that does not
exist.

#### B1. The golf card [ ]

Five leagues. A leaderboard: an ordered field scored to par, which is
neither a fixture nor a podium.

- Probe a real golf event first. The payload shape has been classified but
  never read in detail.
- Needs: position, score to par, round, holes through, and the cut.
- Shares the race card's "ordered field" instinct, but the numbers are a
  different kind (to par and thru, not laps and places).
- Blocked behind A1's model decision.

#### B2. Tennis extraction [ ]

Two sided with proper `homeAway`, so the existing card works. The problem
is only where the matches live.

- They are nested at `event.groupings[].competitions[]`, and `toGames`
  reads `event.competitions[]`.
- Add a grouping aware branch to the adapter. No card work.

#### B3. UFC and MMA sides [ ]

Bouts are at `event.competitions[]` with `order` and `winner` but **no
`homeAway`**.

- **Pick a rule** for which fighter is the home side (order 1?) and verify
  it against real cards.
- `result.ts`'s `loser()` reads scores; a bout has `winner` instead, so
  that needs a branch.

#### B4. Re-run the shape classification [ ]

The 484 event sweep predates the 151 league catalog. Repeat it once D1
changes what gets fetched.

---

### C. The sidebar

#### C1. Real icons for the three tabs [ ]

`SportsSidebar.tsx` uses `TvIcon`, `StarIcon` and `RecentsIcon` as
placeholders for Leagues, Teams and Channels. Three real ones needed.

#### C2. The Channels tab [?]

A stub note today. **Undecided what it lists.** Candidates: the sports
channels in your playlist, the channels matched to today's board, or the
place corrections get taught (H1).

#### C3. Persist sidebar collapse [ ]

Live TV's sidebar likely already has the pattern to copy.

#### C4. Full club rosters [ ]

`clubPool` is `raw.flatMap(d => d.games)`, so the team list is only clubs
the board happened to load, and a club cannot be followed out of season.

- Fetch `/teams` per followed league, cache it.
- Feed the sidebar from that instead of from the board.
- Unblocks D3.

#### C5. The two step league picker [ ]

The data is done and the UI is not. `leagues.ts` already exports `SPORTS`,
`ALL_LEAGUES`, `searchSports` and `searchLeagues` over 151 leagues in 14
sports.

- A sports grid, then that sport's leagues as tiles, with search.
- The league tile component already exists.

#### C6. Search within teams [ ]

---

### D. Follows and the fetch

#### D1. The fetch inversion [ ]

The biggest remaining piece. Follows are a **filter** over five hardcoded
leagues; they should be the **fetch list** over the catalog.

- `fetchLeague` takes a catalog path rather than a `LeagueKey`.
- `LEAGUE_NAMES` and `LEAGUE_LOGOS` come from the catalog instead of the
  two hand kept tables.
- `Game.leagueKey` becomes the catalog path. That is a **stored data
  change**: `follows.teamKey` builds `${leagueKey}:${id}`, so existing
  follows need migrating or they silently stop matching.
- **Decide the empty state.** Fetching 151 leagues is not an option, so no
  follows needs a default set. This is what makes E1 (onboarding) matter.

#### D2. Rate and concurrency [ ]

`fetchGames` runs `Promise.all` over five. Twenty or more wants a
concurrency cap, backoff and a cache. The plan's own words: this is a free
endpoint we do not own, behave like a guest.

#### D3. Team follows out of season [ ]

Depends on C4.

---

### E. Onboarding

#### E1. First run [ ]

Adam's call: prompt for quick setup with presets, or full personalization.
Nothing built. Today an empty follows store shows the whole board, which is
a fair placeholder but is not onboarding, and it stops working the moment
D1 lands.

- Detect first run (empty follows plus an explicit flag, not empty alone).
- The screen itself.
- Write through to `follows.ts`.
- `scripts/verify-onboarding.mjs` exists, so there is an onboarding pattern
  elsewhere in the app to match.

#### E2. The preset packs [ ]

The presets themselves, which is a content decision as much as a code one.

---

### F. The board

#### F1. Reach past three days [ ]

`DAYS = 3` in `useGames.ts`. The grid shape already works per day, so this
is paging or a date picker rather than new layout.

#### F2. Empty states [~]

"Nothing on for what you follow" exists. Missing: no leagues followed
(which D1 makes reachable), and no channels matched.

#### F3. One module for cadence and staleness [ ]

The plan's own scar: the v0.8.1 guide cache bug came from a retention
window and a cache age living in different files with nothing linking them.
`REFRESH_MS = 90_000` currently sits alone in `useGames.ts`.

#### F4. Polling during playback [?]

**On the plan's risk list and not honoured.** The poll pauses on
`document.hidden` only. Opening the theater does not unmount `useGames`, so
it keeps polling while you watch, deliberately, because the theater header
re-reads the refreshed board to keep the score moving.

That is a trade someone chose, so it wants a decision: keep the live score
and amend the plan, or freeze the board while watching and let the header
go stale.

#### F5. Reduced motion over the new cards [ ]

The race and weekend cards read `REDUCED_MOTION` for tilt and glare.
Nothing else about them has been checked against it.

---

### G. The theater

- **[x] Failover down the rail.** Done: `nextSource`, eight tests. The phase
  list's open question is answered.
- **[ ] G1. What the rail shows for a race.** Depends on A7.

---

### H. Channels and matching

#### H1. The taught correction path [ ]

On the plan's verification list ("a taught correction survives a restart
and applies to the next game on that network") and not built. Possibly the
answer to C2.

#### H2. Record the hit rate per league [ ]

The plan says this number belongs in this file. It is not here. Needs a run
against a real playlist, per league, recorded with a date.

#### H3. Blackout honesty [ ]

Never promise more than "this network has it". Mostly a copy review of
every surface that names a channel.

#### H4. Date the rights map [ ]

Rights change between seasons, so a shipped network map is a maintenance
commitment. Say so in the file itself.

---

### I. Housekeeping

- **[ ] I1.** Two 0.8.0 hand checks needing a real machine: clear history
  arming and timeout, and the save picker's arrow keys.
- **[ ] I2.** Merge `blammytv-0.8.0-push` into main. Waiting on Adam.
- **[ ] I3.** Clear the five TEMPORARY markers. All go with A1.

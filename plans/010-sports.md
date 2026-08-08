# 010: Sports: a hub for what is on right now

- **Status**: IN PROGRESS. **The join works, the rail plays, racing is a
  first-class league rather than a side door, and all 151 leagues are
  reachable by clicking.** Nothing gates the rest; what is left is breadth
  (golf, fighting), depth (the theater, corrections) and onboarding.
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
## What is left, as of v0.8.121

Written from the plan, the code and the sessions that built it. Grouped by
area rather than by phase, because the phases stopped describing the work
once racing arrived.

**One flat count, 1 to 36** (2026-08-03). It used to be lettered by area,
which meant reading an item required knowing the filing system first. The
number is the only handle now; the group headings are just where to look.
Roughly ordered, in that the first two unblock the most and 33 to 35 are
chores, but 3 through 32 are grouped rather than ranked. Anything numbered
past 35 arrived after the count and is at the end rather than in place, so
nothing already written down moves.

**Nothing gates the rest any more.** #1 shipped and took #3, #4's live gate
and the five TEMPORARY markers with it; #2 shipped and opened the catalog.

**A number is retired when its item ships, and never reused.** Gaps in the
list are normal and mean something got done; the ledger at the end says
which. Renumbering to close a gap would move every label that is already
in someone's head, which is the exact thing the letters used to do.

**[ ]** not started, **[~]** partly there, **[?]** blocked or undecided.

A shipped item STAYS IN PLACE marked **[x]**, with what it decided,
because that reasoning is most useful next to the items it constrains. The
ledger at the end is the quick index, and it also carries the older
letter-era labels so a name that vanished can still be looked up.

---

### The three that opened it up

#### 1. A real racing adapter [x] v0.8.127

`race.ts` was a second front door: its own fetch, its own cache, its own
hook, joining nothing. Racing is a followed league like any other now.

- **The model is a discriminated union**, decided from coupling rather
  than taste. `Fixture` keeps home and away, `Field` carries entrants, and
  everything the board runs on lifts into the base they share. Only 9
  files read a side, 13 sites in all, and `matcher.ts`, `day.ts` and
  `autoplay.ts` read none: the day bucketing, the channel matching and the
  autoplay never cared. Two collections would have forked all of those.
- `fetchLeague` dispatches on the path's sport segment, so `racing/f1` is
  one more entry in the fetch list and gets the same gate and the same
  per-day request as everything else.
- **`racing/f1` joined DEFAULT_LEAGUES.** Its absence was never a
  preference: Adam's brief named it from the start and it sat out because
  it had no card. It has one.
- The five TEMPORARY blocks are gone, and so is the staged live session.

#### 3. Sessions on their own days [x] v0.8.127

Fell out of #1 rather than needing its own work, and the reason is a
measurement. Asked for a date inside a race weekend, the endpoint answers
with the WHOLE weekend, all five sessions, each carrying its own date;
asked for a date outside one it answers with nothing:

  ?dates=20260821  ->  FP1, SS, SR, Qual, Race
  ?dates=20260822  ->  the same five
  ?dates=20260819  ->  no events

So the board asks three times, gets the same five back three times, and
`onDay` files each one. Verified in the rig: FP1 and FP2 today, FP3 and
Qual tomorrow, the race the day after, and the live session alone in the
row.

**The weekend card has no place on a three-day board**, which is the one
thing this cost. It is the shape for the days BEFORE a weekend starts, and
those days answer with no events, so the earliest racing can appear is the
day of FP1 by which point it has already broken into sessions.
`WeekendCard` and `toWeekend` are kept with their tests and rendered by
the race rig; they come back with #36.

#### 2. The league picker [x] v0.8.128

**Was the gating item.** The fetch inversion made a followed league a
fetched league over 151, and the sidebar offered five tiles, so nothing
anyone could click reached the other 146. This is the door.

Adam's layout, and the split is the argument: favourites as TILES up top,
everything else as a single COLUMN under a rule, reading like the guide's
source selector. A tile is expensive (a mark big enough to recognise at a
glance) and worth it for the handful you watch; 146 of them is a wall you
scroll rather than a list you scan.

- **Search filters both halves.** Adam's question was whether keyword
  filtering could work across them, and it does: `searchLeagues` now
  matches the SPORT as well as the league, so "hockey" keeps the NHL in
  the grid and puts the other three hockey leagues in the column. Every
  term has to match, so "german soccer" narrows rather than widens.
- **Remove is two clicks.** The tile's ✕ arms and expands into "Remove
  from Favorites" over the whole tile, with the four second forget that
  Settings' playlist delete already uses. Covering the tile rather than
  sitting across its top, because the sentence is wider than the 118px
  tile and spilled into its neighbour.
- **The heart is the guide's hide-eye SLOT and the guide star's
  TREATMENT**, which are two different files and both deliberate. The box
  is `.live-folder__hide`'s; the icon is the star's three-state rainbow
  (ghost at rest, gradient ring on hover), not the mode rail's plain
  outline, which is what the first pass copied and Adam caught. The star's
  gradient coordinates are `userSpaceOnUse`, so they are rescaled from its
  17-unit box into the heart's 24 rather than copied; copying them would
  have run the whole ramp across the middle third and left both ends flat.
- **The column is grouped by sport**, alphabetically. Adam's, and the
  numbers make it: 107 of the 151 are futbol, so one flat list buries the
  other 44 inside a wall. Alphabetical rather than the catalog's
  biggest-first, because biggest-first puts those 107 ahead of everything
  else. Headings are sticky, since forty rows in you have forgotten which
  list you are inside; they take the PANEL's colour rather than --bg,
  which is what made them read as a dark band.
- **Soccer is FÚTBOL**, Adam's call, display only: `key` stays "soccer"
  because it is the catalog path, the fetch URL and half of every stored
  league id. Both spellings and the old word all still search.

  One side effect worth knowing, and it is not obviously worth fixing.
  Alphabetically "Soccer" sat 11th of 14, so only 3 of the other 44
  leagues were behind its wall. "Fútbol" sorts 6th, which puts 25 of them
  behind it. Strict alphabetical is still the right default because it is
  PREDICTABLE — a rule like "the biggest group goes last" makes the one
  sport you cannot guess the position of the one with most leagues — but
  if the scroll ever annoys, that rule is the fix.
- Rows are `.live-folder` inside `.live-folder-row`, which is how they get
  the name's fade scrim for free.

Left, and it is small: this is a grouped list rather than the two-step
sports-grid-then-leagues the item originally described. With search
matching sport names and the column already grouped, a step that only
picks a sport buys less than it costs.

---

### Racing

#### 4. Racing in the wide row [x] v0.8.122-125

**The card is built and signed off.** `WideRaceCard` sits in the row at
GameCard's exact footprint (783.84 x 276.9, radius 63.9, same body grid
and foot), with the field down the reading side, the lap in the middle and
the country over the track art.

What it shows is the ceiling rather than a choice: ESPN gives four fields
per entrant and `statistics` is empty on all 22 competitors in every
session, so position and driver is all there is. It carries the CHANNEL
too, which was not on the original list and had to be, because the row's
job is getting you watching. F1 sessions really do carry a broadcast
("Apple TV", correct for 2026).

Five rounds of Adam's notes are in the file's own comments. The two worth
carrying: a LAP COUNT IS NOT A SCORE, so it sits at status size where the
fixture card's "Final" sits and not in the 52px scoreline slot; and the
field reads with the LAP rather than with the country, because those two
are what the card reports and the country is the label on it.

The live gate landed with #1: `rowItems` filters the row to fixtures plus
fields that are running, so a finished practice session drops to the grid
and a live qualifying hour earns the row.

#### 5. Racing in the theater [ ]

- `matchGame` keys off team names. A race has none, so it needs a path
  keyed on the series ("Formula 1", "F1") reusing `matchNetwork`.
- `autoPlay` and `nextSource` should then work unchanged.
- **Hit rate unknown.** Needs the same real playlist test the five team
  leagues got.

#### 6. Drop finished practice from the board [ ]

A Sunday would otherwise carry FP1, FP2, FP3 and Qual, all dimmed, above
the race.

- A predicate in the adapter, not in the card.
- **Decide the rule.** Hide finished practice once the race has run? Hide it
  on race day? Keep the most recent only?

#### 7. The other five racing leagues [?]

IndyCar, three NASCAR series and NHRA carry no `circuit` and no
`address.country`. No country, no flag, no track art.

- **Decide what fills the big name slot.** Probed: the venue is inside the
  event name, and taking what follows the last " at " or " of " fires on
  111 of 116 events and drops the longest from 60 characters to 31. The 5
  it skips ("Daytona 500", "Indianapolis 500", "Duel #1") are already right.
- 62 of 116 are still over 8 characters, so `shortPlace`'s country coding
  cannot help: a venue has no three letter code. This needs its own display
  path, but it starts from 31 characters rather than 60.
- What the raw names measure, since that is what the display path has to
  survive:

  | League | Events | Name length |
  |---|---|---|
  | IndyCar | 18 | 16 to 40 |
  | NASCAR Cup | 40 | 7 to 50 |
  | NASCAR O'Reilly | 33 | **41 to 60** |
  | NASCAR Truck | 25 | 28 to 39 |

  52 distinct venues across all of it. `name` equals `shortName` on every
  event, so there is no shorter one being ignored.
- The card already handles a missing flag and missing art, so nothing there
  needs to change.
- NHRA returned **0 events** for 2026. Check whether it is ever populated
  before building for it.

#### 8. The lap total [?]

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

#### 9. Sprint session names [?]

Blocked on a layout call, not on effort. Measured at the board's narrowest
315px track:

| Labels | Result |
|---|---|
| `SS` / `SR` | fits, country clears the schedule by 17.7px |
| `SPRINT` / `SPRINT` | country 4.3px past the card's padding |
| `SPRINT QUAL` / `SPRINT RACE` | country **overlaps the schedule by 9.9px** |

The expansions ship on the row's tooltip today, which costs no width.
Printing them on the card needs a layout change first, which is Adam's.

---

### Sports that need a card that does not exist

Measured once over 484 events, then again over all 151 leagues: **89% of
the catalog needs no new card.** The work is confined to Golf (5 leagues)
and Fighting (2).

| Count | Shape | Meaning |
|---|---|---|
| 134 | `team` | Two sides with `homeAway`. The existing card handles them. |
| 4 | `field` | An ordered field: F1, NASCAR-PREMIER, PGA, LPGA. |
| 2 | `grouped` | Nested under `groupings`: ATP, WTA. Shipped v0.8.103. |
| 2 | `twoSided` | Two sides, no `homeAway`: UFC and **PFL**. |
| 6 | `unknown` | Racing and golf leagues whose current event is `pre`, so it carries no competitors. They are `field` out of season. |
| 3 | `empty` | No events at all right now. |

#### 10. The golf card [x] v0.8.159

Five leagues. A leaderboard: an ordered field scored to par, which is
neither a fixture nor a podium. Probed against a finished tournament (RBC
Heritage, 82 competitors):

- `order` is leaderboard position; `score` is to par as a STRING (`"-19"`,
  `"E"`); `linescores` are the rounds (`65,63,68,70`).
- `winner` is **undefined**, unlike UFC. Position 1 is the winner.
- `athlete.flag` is present, so the mark works the way racing's does.
- `statistics` is empty on every competitor.
- Fields are 82 to 147 deep, so a card shows a top few, exactly like a
  podium.

**Structurally this is the race card with a different number**, which the
build confirmed: golf maps to `Field`, not a fifth kind, and the board's
day bucketing, follow filter, matcher and memoisation all took it unchanged.

**Re-probed 2026-08-04 across all five leagues**, and the earlier notes hold
with two corrections that changed the design:

- **There is no par and no course.** Adam's first mock had "PAR 73" in the
  corner; a walk of every key in the payload finds no course object at all.
  The corner says **THRU** instead — which is not given either, but IS
  derivable: every round nests its 18 holes and the played ones are the
  ones with a score. It is also the better use of the corner, being the one
  number that moves while you watch.
- **Before the first tee there is no leaderboard.** LPGA, the DP World Tour
  and the Champions Tour return ZERO competitors while an event is `pre`,
  and the PGA and LIV return the whole field tied on "E". So `pre` carries
  no entrants at all and the card has its own face for it.

**Two faces, both Adam's.** Running or finished: league and THRU across the
top, then five rows of position, flag, name and score to par. Upcoming: the
tour's mark, the date range, the tournament name.

Five rows rather than racing's three, because a podium is a result and a
leaderboard is a standing — the top three of 144 does not say who is in it.

**The mark is the only art golf has.** Four image URLs exist in the whole
payload and two are DraftKings logos, so there is no course photo, no venue
image and no per-event art. The tour mark comes from the CATALOG rather
than the response, because a league between seasons answers 200 with no
`leagues` block at all.

Score stays a STRING ("-25", "E") — golf's own unit, and nothing we should
be doing arithmetic on. No caption code: a golf scoreboard captions by
country, and inventing three letters for Hideki Matsuyama would be writing
a caption nobody uses, so `Entrant.code` became optional.

Left: no WIDE card, so a live leaderboard is filtered off Today's Games and
lives in the grid — the same holding position tournaments are in (#39).
`harness/golf.html` renders all four faces off the real captures.

**Also found, and not fixed**: ESPN writes Golf Channel as `"Golf Chnl"`,
which matches nothing, while the dump carries `US: Golf Channel`. One
`WORDS` entry away, exactly the shape of `net` to `network`.

#### 11. UFC, MMA and PFL sides [ ]

Probed 42 events, 24 with finished bouts, 300 decided bouts.

- `homeAway` on **0** of them. Confirmed absent, not merely unreliable.
- `order` and `winner` on all of them.
- **`order` does not mean anything beyond listing sequence.** Order 1 won
  **167 of 300** decided bouts, 55.7%, a coin flip. So it cannot stand in
  for "home" or for "favourite": picking order 1 as the first side is a
  display convention only, and `winner` is what decides the result.
- `result.ts`'s `loser()` reads scores; a bout has `winner` instead, so
  that needs a branch.
- Two leagues, not one. The plan only ever mentioned UFC.

#### 12. Re-run the shape classification [ ]

The 484 event sweep predates the catalog, and the 151 league sweep predates
the fetch inversion. Any of those leagues can now be fetched, so the sweep can be repeated
against what people actually follow rather than against everything.

---

### The sidebar, follows and the fetch

#### 13. Full club rosters [ ]

`clubPool` is `raw.flatMap(d => d.games)`, so the team list is only clubs
the board happened to load, and a club cannot be followed out of season.

- Fetch `/teams` per followed league, cache it.
- Feed the sidebar from that instead of from the board.
- Unblocks #16.

#### 14. Search within teams [ ]

#### 15. Backoff and a cache [ ]

The concurrency half shipped in v0.8.120: a module-wide gate caps ESPN at
six requests in flight across every league and all three days.

Left is the other half of "behave like a guest": backoff on failure, and a
cache so a board that was read 30 seconds ago is not read again. See #24,
which is the same instinct about cadence living in one place, and which
becomes actionable the moment this adds a second timing constant.

#### 16. Team follows out of season [?]

Depends on #13. A club can only be followed while it happens to be on the
board, because that is where the club list comes from.

#### 17. The Channels tab [?]

A stub note today, and **undecided what it lists.** Candidates: the sports
channels in your playlist, the channels matched to today's board, or the
place corrections get taught (#26).

Its rail icon is the one placeholder left (Live's `RecentsIcon`). Leagues
and Teams got real marks in v0.8.116, so this is one icon, and it is not
worth drawing before the tab knows what it is.

---

### Onboarding

#### 18. First run [ ]

Adam's call: prompt for quick setup with presets, or full personalization.
Nothing built.

No longer load-bearing, which is a change from a week ago. The fetch
inversion decided that
an empty follows store fetches the default five, so first run is a full
board rather than an empty screen asking to be configured. This is now an
improvement to reach for rather than a hole to plug.

- Detect first run (empty follows plus an explicit flag, not empty alone).
- The screen itself.
- Write through to `follows.ts`.
- `scripts/verify-onboarding.mjs` exists, so there is a pattern to match.

#### 19. The preset packs [ ]

The presets themselves, which is a content decision as much as a code one.

---

### The board

#### 20. Reach past three days [ ]

`DAYS = 3` in `useGames.ts`. The grid shape already works per day, so this
is paging or a date picker rather than new layout.

#### 21. The missing empty state [ ]

"Nothing on for what you follow" exists. Missing: a board where games
resolved to no channels at all.

"No leagues followed" is NOT a state to write, and that is settled: the
fetch inversion
decided an empty store means the default five, so there is no screen with
nothing on it to explain.

#### 22. Reduced motion over the new cards [ ]

The race and weekend cards read `REDUCED_MOTION` for tilt and glare.
Nothing else about them has been checked against it.

#### 23. Polling during playback [?]

**On the plan's own risk list and not honoured.** The poll pauses on
`document.hidden` only. Opening the theater does not unmount `useGames`, so
it keeps polling while you watch, deliberately, because the theater header
re-reads the refreshed board to keep the state moving.

That is a trade someone chose, so it wants a decision: keep it and amend
the plan, or freeze the board while watching and let the header go stale.

#### 24. One module for cadence and staleness [?]

The plan's own scar: the v0.8.1 guide cache bug came from a retention
window and a cache age living in different files with nothing linking them.

Not actionable yet, and saying so is the point. `REFRESH_MS = 90_000` is
still the only timing constant in the feature, and a module for one value
is indirection rather than a scar fix. It becomes real when #15 lands a
backoff delay and a cache age beside it.

---

### The theater, channels and matching

#### 25. What the rail shows for a race [ ]

Depends on #5.

#### 26. The taught correction path [ ]

On the plan's verification list ("a taught correction survives a restart
and applies to the next game on that network") and not built. Possibly the
answer to #17.

#### 27. Record the hit rate per league [x]

The plan says this number belongs in this file. It is not here. Needs a run
against a real playlist, per league, recorded with a date.

**Measured 2026-08-03/04, across the whole catalog: 1,539 games, of which
32 carry a broadcast name at all. 2.1%.**

That number is the finding. The matcher was never the bottleneck — for most
of the catalog the source hands us nothing to match on:

| sport | games with a broadcast name |
|---|---|
| basketball | 4/4, 100% |
| golf | 3/3, 100% |
| baseball | 19/23, 83% |
| soccer | 6/47, 13% |
| **tennis** | **0/1462, 0%** |

Tennis is categorically empty: not one of 1,462 matches carries a
`broadcasts` or `geoBroadcasts` entry. Non-US soccer is the same story a
league at a time — arg.1, col.1, ven.1, bol.1, par.1, swe.1 and both UEFA
qualifying rounds are all 0%, while Concacaf's Leagues Cup is 6/6.

The pattern is US rights. The phase 0 gate tested NFL, MLB and the Premier
League and got 16/16, 15/15 and 1/1 — and those are exactly the leagues
with coverage. Expanding to 151 brought in a long tail the gate never saw.

So "Couldn't find a matching channel" is honest far more often than it is
our failure, which is the reverse of what was assumed when #27 was written.
What it changes:

- Tuning the matcher would move almost nothing. The work is upstream.
- A per-league "we have no broadcast data for this league" is a truthful
  and cheap thing the card could say instead, and it is a different message
  from "we looked and missed". **Tried in v0.8.149 and REJECTED in
  v0.8.152.** It is truthful and it is not the viewer's question. Adam:
  "people don't care that ESPN didn't have a channel listed, just if it
  links to their EPG or not." Saying the source came back empty explains
  our plumbing to someone who only wants to know whether they can press it,
  and it costs the honesty it was meant to buy, because "no broadcast data"
  reads as "no broadcast". See #42.
- The curated network map on the shelf from phase 0 is worth revisiting for
  exactly the leagues at 0%. **Done in v0.8.149, see #41.**

#### 28. Blackout honesty [ ]

Never promise more than "this network has it". Mostly a copy review of
every surface that names a channel.

---

### Performance

Measured items from the audit sweeps, none applied.

#### 29. LiveScreen's favourites memo [ ]

`favorites.map(id => channels.find(...))`, which is 20.8ms at 500
favourites on a 20k catalog. Wants a Map. `recents` does the same thing on
the line below.

#### 30. The board re-resolves channels every tick [ ]

`SportsScreen` re-runs `withChannels` over all days on every 90 second
refresh, about 19ms of matcher work for days that did not change. The games
themselves are already carried forward by identity (`keepStable`); the
matcher work is not.

#### 31. Window the grids [?]

`.sports__grid` is not windowed, and neither is Stream Home. A perf sweep
measured `react-parallax-tilt` registering a `resize` listener per instance
that reads geometry then writes the glare element's size, interleaved. At
400 mounted cards that is 30ms per resize event; at 1000 it is 154ms. Reads
alone are 1.8ms, so it is entirely the write.

The cheap fix is `glareEnable={false}`, which removes the sheen Adam
explicitly asked to keep, so the real fix is windowing. Needs a decision on
how much that is worth.

#### 32. Code splitting [?]

Measured, and it is a tidiness change rather than a performance one: lazy
loading Sports, Settings, Themes, Onboarding, Discover and Library cuts the
main chunk 523 to 349 kB, but V8 compile only moves 10.2ms to 7.7ms, and
because updates ship as a tar.gz of `dist/` the update download gets about
9 kB BIGGER.

The honest reasons to do it are that 63.9 kB of F1 circuit art stops being
retained for people who never open Sports, and the >500 kB warning goes
away truthfully. Decide on those terms or not at all.

---

### Housekeeping

- **[ ] 33.** Two 0.8.0 hand checks needing a real machine: clear history
  arming and timeout, and the save picker's arrow keys.
- **[ ] 34.** Merge `blammytv-0.8.0-push` into main. Waiting on Adam.
- **[ ] 35.** Clear the five TEMPORARY markers. All go with #1.

---

### Added after the list was numbered

#### 36. A narrowed board reaches to the next event [x]

Adam's, 2026-08-03, and it is a better answer than any of the three
options it was offered against.

The home board shows today plus two days, and that is right for a board
answering "what is on". It is wrong the moment you narrow it: follow only
F1 in August and the board is empty for eighteen days; follow only the NBA
in summer and it is empty for two months. The old racing code hid this by
pinning the weekend card to today, which is a lie about where it belongs.

**The rule: when the board is narrowed and the window holds nothing, show
that league's next event on its real date instead of showing nothing.**

Cheap, and confirmed against the live endpoint on 2026-08-03. The bare
scoreboard call with no `dates` parameter already answers "what is next"
for any league, which espn.ts has documented all along ("a league between
matchdays hands back its NEXT one, which can be a month away"):

| league | bare scoreboard answers |
|---|---|
| MLB | today, 8 events |
| NFL | 2026-08-07 |
| EPL | 2026-08-21 |
| F1 | 2026-08-21, which matches the season calendar |
| NHL | 2026-09-19 |
| NBA | 2026-10-03, two months out |

So it is one extra request per followed league, no new endpoint, and it
works for every sport rather than being a racing special case.

- Only when narrowed. An unfiltered board reaching two months ahead would
  be answering a question nobody asked.
- Its own heading, because a fixture in October is not "Today".
- Overlaps #20 (reach past three days) and probably supersedes half of it:
  this is the reason someone wants a longer board, arrived at from the
  other end.

**Shipped v0.8.137.** Adam again, from the other end: "if there's ANYTHING
on the schedule for a sport you've favorited, it should show up in the
grid." Only the leagues that came back empty are asked, so the cost is
bounded by how many things you follow. The window paints first and the
reached days append after, since a league with nothing to say should not
hold up the board.

One gap left, and it is the team half: following a club whose league is
playing produces games, so nothing reaches ahead, and a board narrowed to
one club can still be empty while its league is mid-season. Rare, because
a club that plays at all plays inside three days most weeks, but real.

#### 38. Opening a tournament shows its draw [x]

The tournament card counts a day's matches and cannot show them. It
already HOLDS them — `Tournament.matches` is the day's fixtures, fully
mapped, scored in sets with doubles pairs named — so this is a screen
rather than a fetch.

What it needs deciding: whether it is the theater (it is not a thing you
watch, it is a list) or a panel over the board, and whether the draws
("Men's Singles", "Women's Doubles") are tabs or headings. 39 matches is
a lot for one list and the draw split is the obvious way to cut it.

Until it exists the card is deliberately not clickable, the same rule the
race cards follow.

#### 39. A wide tournament card, or a rule that keeps it off the row [ ]

Today's Games is a row of 783.84px cards and the tournament card is the
grid's 315px. A live tournament let onto the row rendered at 315x276.9
between neighbours at 783.84x276.9, which reads as a broken card rather
than a small one, so tournaments are filtered off the row for now.

That is a holding position, not an answer. A tournament with four matches
on court IS one of the things on now, and the row is where "on now" is
answered. The question for Adam is what the wide version says with the
room: the four live matches by name, the leaders, or just the tournament
bigger.

#### 41. The curated network map [x] v0.8.149

Phase 0's own fallback, taken off the shelf because #27 measured what the
gate never saw. `networkMap.ts`: a league to network table, consulted only
where the source said nothing at all.

- **It feeds the SAME matcher.** The map's names go through `matchGame`
  exactly as the schedule's do, clear the same `CARD_CONFIDENCE` bar and
  arrive as the same `Match` objects. One join, one confidence model. The
  alternative, a second lookup with its own scoring, would have forked the
  rail as well as the card.
- **A guess is worded, not scored down.** This was the real decision, and
  the deduction approach is broken rather than merely worse: the doubt about
  a map row is about CARRIAGE, not about which channel we named, and a
  score cannot carry it. Deduct 30 from an exact 100 and it lands on the 70
  bar by arithmetic accident; deduct enough to actually mean "this is a
  guess" and every presumed match falls under the bar and the card goes
  silent, which is where we started. So `presumedOnly` rides on the game and
  the card says "Usually found on X" where a stated one says "Live on X". No live
  pip either: the dot is the card's shorthand for "on, right here, now".
- **The gate was an EMPTY `broadcasts`, and is now an empty RESULT** (v0.8.156,
  see #44). It shipped requiring that the schedule had named nobody at all,
  on the MLB.TV argument: a schedule naming a particular feed is telling
  you the game is not on the ordinary one, so talking over "On Peacock"
  with a league-wide guess is how a confident wrong answer gets made. That
  argument is still true and was answering a different question — it
  assumed the guess would REPLACE what the source said, which it need not.
- **A mapped league with no matching channel still names the network**:
  "Usually found on Win Sports", the same courtesy "On Peacock" already
  extends.
- **"Couldn't find a matching channel" was wrong about itself** and that
  fell out of reading the branch. It is only reachable with an empty
  broadcasts list, because a non-empty one is answered above it, so it was
  describing a search that never ran, to most of the catalog. Became "No
  channel listed for this game", which was wrong in the other direction and
  was reworded again in v0.8.152. See #42.

Measured against the live boards of 2026-08-04 and Adam's real 1,875
channel dump:

| league | before | after |
|---|---|---|
| tennis/atp | 13 cards, no answer | 13 x "Usually found on US: Tennis Channel" |
| tennis/wta | 20 cards, no answer | 20 x "Usually found on US: Tennis Channel" |
| uefa.champions_qual | 8 cards, no answer | 8 x "Usually found on US: CBS Sports Network" |
| soccer/col.1 | 3 cards, no answer | 3 x "Usually found on Win Sports" (no channel) |
| baseball/mlb | 15 cards, 10 tuned | unchanged, which is the point |

Rows shipped: both tennis tours (with the four Grand Slams as exceptions,
since ESPN has three of them and Roland Garros sits with TNT and NBC), both
UEFA qualifying rounds, `soccer/arg.1` and `soccer/col.1`.

**Left, and deliberately**: `soccer/ven.1`, `soccer/bol.1`, `soccer/par.1`
and `soccer/swe.1`. All four measured at 0% and all four belong on the list
on the merits; none could be verified to the standard the other rows were,
and a guessed row is exactly the confident wrongness the file exists to
avoid. They need someone who can check.

**Also left**: the tournament CARD shows no carriage line at all, so on the
board itself a tennis card still says nothing. The draw screen behind it
now answers, because it already resolved carriage against the tournament.
Putting a line on the card is a layout call, so it is Adam's. See #39,
which is the same card wanting the same kind of decision.

#### 42. The carriage line stops describing the world [x] v0.8.152

Four wordings have stood in the no-channel slot and the first three all
claimed something about reality this app has never been able to see:

| Wording | Version | What it actually claimed |
|---|---|---|
| "Not on your channels" | to v0.8.144 | the playlist does not have it |
| "Couldn't find a matching channel" | v0.8.145 | a search ran and missed |
| "No channel listed for this game" | v0.8.149 | nothing anywhere has it |
| "Could not link channel" | v0.8.152 | we could not link it |
| **(nothing — the pill says it)** | **v0.8.154** | **same, without a sentence** |

v0.8.149's was mine and it fixed the wrong half. Reaching that branch means
an EMPTY broadcasts list, so nothing was ever searched for, and saying so
felt more honest than implying a failed search. Adam, reading it back: it
"still implies there isn't a channel in the entire EPG that has these
games, not that it couldn't be linked... we can't really know that."

**Two rules came out of it, and they point the same way.**

*Only claim what we have evidence for.* The schedule naming no broadcaster
is a fact about ESPN's payload, not about a 20,000 channel playlist, so
nothing whatever follows from it about what the provider carries. A
sentence about our own linking cannot be wrong.

*And say it in the viewer's terms, not ours.* Adam: "people don't care that
ESPN didn't have a channel listed, just if it links to their EPG or not."
The three-way distinction behind this line — no broadcast name, a name we
could not match, a name we matched — is real and is entirely OUR business.
The viewer has one question, and it is binary: can I press this. So the
line answers that and does not explain itself. It is also why the
per-league "no broadcast data for this league" idea from #27 is dead rather
than pending.

A test holds the rule rather than the string, over every route to an empty
channel list: none of them may match `/not on|no channel|nothing|
unavailable/i`. That is what stops a fifth rewording from quietly
reintroducing the first one's claim.

Adam's too, in the same pass: the map's phrasing is **"Usually found on
X"** rather than "Usually on X", in both the pressable and the
not-pressable case. It reads as a statement about where the league lives
generally, which is the claim actually being made. Measured before taking
it, since it is the longest string the slot ever holds: 302px against a
697px budget on the wide card.

#### 43. The couldn't-link pill [x] v0.8.153, widened v0.8.154

Adam, reading the branch table for #42: "for espn no link, I wonder if we
can add a tiny little pill badge with a triangle ! in it... so it would say
'On Paramount+ [triangle COULDN'T LINK]'".

The gap it closes is a grammar collision. Every version of the carriage
line except one names a CHANNEL you can press; "On Paramount+" names a
BROADCASTER and is a dead end, and the two sentences are identical in shape
with only a dimmed colour between them. Dimming is what the slot already
uses for four different states, so it cannot carry this one on its own.

- **Widened to EVERY state with no channel behind it, v0.8.154.** Adam:
  "maybe we add that same badge wherever we can't link a channel? instead
  of just text." It shipped narrow — only the sentence that names a
  broadcaster — and that was wrong for #42's own reason: whether ESPN
  happened to populate a field decided whether the viewer got a badge,
  which is our plumbing deciding their answer. The predicate is now
  `channels.length === 0`, full stop. Still off while the catalog is
  loading (nothing has been looked up yet) and off on a finished game (the
  foot swaps the whole line out for when it started).
- **Which retired a sentence.** With the pill on every unlinked state,
  "Could not link channel" became the caption to its own icon, so
  `carriageText` returns "" there and the pill is the whole line. The two
  functions now split the answer cleanly: `carriageText` says WHERE the
  game is when anything knows, `carriageUnlinked` says whether you can act
  on it. One string trying to carry both is what produced four wordings in
  eight versions.
- **A predicate in `carriage.ts`, not a flag on the game.** It is derivable
  from what is already there, and that file is where the meaning of this
  line lives; a second home for it is the drift the module exists to
  prevent.
- **No warning colour**, which is the rule directly above it in the
  stylesheet still holding: "no match is a real state, not an error: dim
  it, do not shout." The chip is the card's own ink at low alpha, so it
  stays achromatic and inverts in light mode for free.
- **Solid rather than outlined, v0.8.155**, Adam's. Its text lifts off the
  0.5 the dimmed line uses, because it now sits on a lighter ground than
  the card: sampled from the RENDERED pixels in both themes, 7.8:1 dark
  and 6.5:1 light. Worth measuring that way rather than compositing it by
  hand, which gave 1.05:1 for light mode — the card's own
  `backgroundColor` is not what ends up behind the chip.
- **The label is optically centred, not box centred.** Uppercase has no
  descenders but the line box still reserves the space, so measured on the
  real pill the ink sat 4.4px below the top edge and 6.6px above the
  bottom. A pixel moved from the bottom padding to the top brings it to
  4.4/4.6. The icon was already centred and did not want the shift, so it
  carries a compensating -1px/+1px margin pair.
- **Shared by the wide cards and the tournament draw's header**, which is
  the only other place this line appears. On a tennis match, where nothing
  is known, the pill is the entire answer.
- **It goes into the accessible name too**, as words. It is an 11px icon
  and a small label, so without that a screen reader hears "on Paramount
  plus" and nothing about the dead end.

Measured on a real wide card: the pill is 109x19 with 28px of foot to
spare, and it clears the venue on the left.

**The question underneath this one is now answered, in #44.** The pill
labelled the dead end rather than removing it; the map now fills it.

#### 44. The map fills a dead end, not just a gap [x] v0.8.156

The open half of #43, and Adam's call once he had the branch table in front
of him.

The map used to run only where the schedule named NOBODY. So a game ESPN
put on Paramount+, with no Paramount+ in the playlist, showed "On
Paramount+" and a couldn't-link pill — while the map sat there knowing the
league also lives on CBS Sports Network, which IS in the playlist. A
pressable channel was being lost to an unpressable fact.

**What changed is one condition**: the gate is an empty RESULT rather than
an empty `broadcasts`. What made that safe is that the guess no longer
replaces anything:

> ON PARAMOUNT+ · USUALLY FOUND ON US: CBS SPORTS NETWORK

The MLB.TV rule the old gate was built on is still true — a schedule
naming a particular feed is telling you the game is not on the ordinary
one — and it is still being honoured, because the feed it named is still
the first thing the card says. It was only ever an argument against
REPLACING the source, and nobody had asked whether both could fit. They
fit: 421px against a 696px budget on the wide card.

Adam's reason, which is #42's rule one level up: "people don't care that
ESPN didn't have a channel listed, just if it links to their EPG or not."
It is also the call he already made for the theater rail — "more to choose
from is always preferred when sources go awry."

Measured against the live boards and the real 1,875 channel dump:

| ESPN says | before | after |
|---|---|---|
| nothing | Usually found on US: CBS Sports Network | unchanged |
| "Paramount+" | On Paramount+, nothing pressable | On Paramount+ · Usually found on US: CBS Sports Network |
| "TUDN" | On TUDN, nothing pressable | On TUDN · Usually found on US: CBS Sports Network |
| "CBS Sports Network" | On US: CBS Sports Network | unchanged, the map never runs |

Unmapped leagues are untouched by construction: MLB still resolves 10 of
15 and never consults the map, because it has no row.

A stated broadcast that RESOLVES is still the whole answer and still not
flagged as a guess. That is the rule the fall-through did not touch, and
it has its own test now so the next change cannot quietly take it.

#### 45. The fresh-eyes audit of v0.8.119-156 [~] v0.8.157

Thirty-eight versions had landed with no review. Five reviewers were run in
parallel, one per dimension, each with no prior context — deliberately, so
they could not rationalise a decision by remembering why it was made. Every
finding below was then re-verified against the code before anything moved.

**What came back CLEAN, which is worth recording**: timezone and DST across
the whole feature, discriminated-union narrowing, effect teardown, reduced
motion (v0.8.148's audit really did close it), accessible names, narrow-window
layout, and `matcher.ts` NOT being O(games x networks x channels) — the token
index means the 20,000 channel catalog never appears in a per-tick cost.

**TIER 1, fixed in v0.8.157.** Eight defects, all user-visible:

| # | defect | fix |
|---|---|---|
| 1 | A doubleheader claimed BOTH feeds: `matchEvent` read the day and never the time the provider stamps. Traced, both legs returned both channels at 100 | `sameDay` became `sameSlot`, +-90 min |
| 2 | A visible 40% guess suppressed an exact hidden match, then was itself dropped by the card's 70 bar — no channel at all while the viewer owned one | `preferVisible`, decided at the CARD bar |
| 3 | `matchEvent` never reads `hidden`, so a muted folder could LEAD the card, saying "Live on 2 channels" with no mention | one partition over the whole join, in the card AND the rail |
| 4 | The tournament draw was 39 focusable buttons that did nothing, entered with focus on `<body>` | `disabled` when nothing can open them; focus moves to the back button |
| 5 | Escape behind an open Settings closed the modal AND the draw underneath it, or the modal and a playing stream | `lib/modalOpen.ts` |
| 6 | The row never centred on a tennis day: `nowish` has no kind narrowing and returned a Tournament, which the row excludes | anchor comes from `rowItems` |
| 7 | Racing reach-ahead was dead from the last race to 1 January — `?dates=2026` returns a year that has already run | a rolling 12-month range, confirmed against the live endpoint |
| 8 | "Nothing scheduled yet" was asserted while the fetch was still in flight | the effect resets `state`/`days` when the fetch list changes |

Two of these were found by tests that were themselves wrong: the slate test
shared one `start` across three games the dump stamps at different times,
which is how the doubleheader bug stayed green.

#### 46. The identity chain is three layers deep and none of it fires [x] v0.8.163

Measured, not theorised. `keepStable` preserves the raw game object across a
tick — proven — and then:

- `SportsScreen` calls `withChannels(d.games)` on the RAW list every time,
  and raw games always carry `channels: []`, so its `unchanged` check can
  never match for any card that FOUND a channel. New object, every tick.
- `openGame`/`openTournament` are plain arrows, so `React.memo` fails on
  `onOpen` before it looks at `game`. `react-parallax-tilt` is a
  `PureComponent` whose `children` is a new element each render, so it
  re-runs `renderFrame` and rewrites ~5 inline styles per card to identical
  values.
- `RaceCard` and `WeekendCard` are not memoised at all, though
  `WideRaceCard`'s comment claims every card is.

This is the "584 DOM mutations and an 86ms long task" `keepStable`'s own
docstring measured, still being paid in full.

**Fixed in v0.8.163**, all three layers. `useCallback` with empty deps on
both openers; `memo()` on the two cards that never had it; and a WeakMap of
raw game to resolved game, keyed per catalog, so the same raw object
resolves to the same answer. The last one is the real repair: the
`unchanged` check could not work where the app calls it, only where the
tests did. Four tests now run the PIPELINE'S order — raw in, keepStable
between — and assert identity both ways, including that a moved score and a
rebuilt catalog still produce a new object.

`fitText`'s mount path went with it: one coalesced flush per commit instead
of one per card, on a MICROTASK rather than a frame so the "never painted at
the wrong size" guarantee survives. Verified over 208 fitted names, none
overflowing.

**Still open here**: the tennis draw mapped twice per tick, 33ms measured.
That one needs `toGames` to know the board's date window, which is an API
change rather than a fix. Also here: the tennis draw is mapped in full TWICE per tick (610
matches -> 20 cards, **33ms measured** on the real payloads), and `fitText`'s
mount path is O(N^2) forced layouts because `flushAll` walks every registered
group from inside each card's `useLayoutEffect`.

#### 47. Light mode was never re-measured [x] v0.8.163

The theme flip changed `--card-ink` but kept the alpha ramps tuned against
the dark card, and alpha compositing is not symmetric. Sampled from rendered
pixels:

| element | light | bar |
|---|---|---|
| finished-card meta (league, abbr, record) | **1.9:1** | 4.5 |
| the draw's section counts | **1.8:1** | 4.5 |
| the clear-filter count | **2.0:1** | 4.5 |
| the wide card's whole meta layer | 3.7-4.3:1 | 4.5 |

`sports.css`'s own header claims "ZERO real contrast failures" — that audit
only ever ran against the dark card.

**Fixed in v0.8.163**, all four, and the finished card was the interesting
one: reducing the veil could NOT fix it. Even at 0.22 the meta only reached
2.89:1, because a uniform overlay compresses the text and the card together
and the text starts at half ink. It took both — the veil down to 0.4 AND
full ink on the 12px text under it — which lands 5.09:1 light and 7.07:1
dark while the card still visibly recedes.

Measured after, from rendered pixels:

| element | before (light) | after (light) | after (dark) |
|---|---|---|---|
| finished-card meta | 1.88:1 | **5.09:1** | 7.07:1 |
| the draw's section counts | 1.82:1 | **5.71:1** | 7.98:1 |
| `.gamecard__league` | 3.69:1 | **8.05:1** | 5.37:1 |
| `.gamecard__venue` | 4.29:1 | **8.05:1** | 6.20:1 |

The wide card's ramps are lifted in LIGHT ONLY, since dark already cleared
the bar and raising it there would brighten what was already right. Also here: every crest is ESPN's
`500-dark` inverted mark in both themes, which is light-on-white in light
mode (needs one screenshot on a real network to size), and 36 of 128 cards
are `disabled` with `cursor: default` as their entire treatment.

#### 48. The harness is outside `tsc` and eslint [x] v0.8.158

`tsconfig.json` is `"include": ["src"]` and lint is `eslint src`, so a whole
directory of dev-server entry points is checked by nothing. Consequences
already shipped: `harness/theater.tsx` imports `LEAGUES`, deleted in
v0.8.120, so the rig is a blank page; `harness/race.tsx` still RENDERS but
sets five properties that no longer exist on `Field`, so the empty-podium
case it was built to prove silently shows five drivers. One line of config
prevents the class.

Filed with it: dead code (three heart icons orphaned in v0.8.141,
`sessionName`, `.sports__note`, `export type { Day }`), the Escape guard
written twice and already diverging, the couldn't-link pill markup
duplicated where #43 claims it is shared, and plan bookkeeping — #22 shipped
but marked open, #35 stale in both directions, #27's ledger row off by one
version, #40's blocker landed 19 commits ago.

#### 40. The empty board says when the next one is [ ]

Shipped in v0.8.135: the four no-cards states are a proper composition
now, and the narrowed one names what you follow and offers the way out.

What it still cannot say is the useful thing. "PGA, NBA and 3 more have
nothing scheduled over the next three days" is honest and slightly
useless; "the NBA is back on 3 October" is the answer. That is #36 from
the other end, and the data is one bare scoreboard call per followed
league, already confirmed against the live endpoint.

When #36 lands, this note becomes the next date per followed league and
the empty board stops being a dead end.

---

## Shipped, and off the list

Kept short on purpose. The reasoning lives in the commit messages; this is
here so a label that vanished can be looked up.

| Was | Item | Landed |
|---|---|---|
| B2 | Tennis extraction: matches under `groupings`, sets rather than games, doubles pairs from `roster` | v0.8.103 |
| C3 | Sidebar collapse persists | v0.8.105 |
| C1 (part) | Real Leagues and Teams rail icons | v0.8.116 |
| A8 (part) | Sprint session names on the row tooltip | v0.8.116 |
| G (part) | Failover down the rail: `nextSource`, eight tests | v0.8.11x |
| A10 (part) | `TheaterOverlay` rAF-coalesced hover, gated on the player | v0.8.11x |
| - | Contrast: six sports selectors raised to clear 4.5:1 | v0.8.119 |
| - | Roving tabindex in `RowScroller`: 42 tab stops to 1 | v0.8.119 |
| **D1** | **The fetch inversion.** Follows are the fetch list over the 151 league catalog; `LEAGUES`, `LEAGUE_NAMES` and `LEAGUE_LOGOS` deleted; `leagueKey` is the catalog path; legacy keys migrated on read; a six-request gate | v0.8.120 |
| A13 | Records, playoff series, occasion notes and wire one-liners: four fields that were already being downloaded and thrown away | v0.8.121 |
| **2** | **The league picker.** Favourites as tiles, the other 146 as a column, one search over both that matches sport names, two-click remove, the guide's heart slot | v0.8.128 |
| **1, 3** | **The racing adapter.** `Game` split into `Fixture` and `Field`, `race.ts` deleted, racing on the normal fetch path and on its real days, `racing/f1` in the defaults, five TEMPORARY blocks cleared | v0.8.127 |
| **4** | **The wide race card.** GameCard's footprint, five drivers, lap, circuit art, carriage. Plus `CardFoot`/`carriageText` extracted and tested, and a `shortPlace` width budget | v0.8.122-125 |
| - | The Leagues rail icon: three splayed blades on a plinth, filled | v0.8.122 |
| - | League marks up twice, 16 to 26 on rows and 34 to 48 on tiles, with the row height held at 36px | v0.8.132-133 |
| **37** | **The wide board.** An empty follow store asks for all 151 leagues over today and tomorrow instead of six; a tournament collapses to one card a day instead of its whole draw; the 90 second tick re-polls only the leagues that answered | v0.8.134 |
| **40** (part) | **The empty board.** One grey line became four states: a skeleton at the board's own geometry while it loads, and a mark, headline, note and way out when there is nothing. The narrowed one names what you follow | v0.8.135 |
| - | The skeleton's breath is a colour, not an opacity, so it stops fading toward the page's own black | v0.8.136 |
| **36** | **The board reaches past its window.** A followed league with nothing in the next three days is asked what is NEXT, and gets its own dated heading on the grid. No new endpoint: the bare scoreboard already answers it | v0.8.137 |
| - | A reached-ahead race weekend folds into ONE `WeekendCard` on race day, instead of five session cards under three dated headings. `Weekend` became the union's fourth kind | v0.8.138 |
| - | A followed racing league reaches for its whole remaining SEASON, not just the next round, and everything reached ahead lands in one "Coming up" section | v0.8.139 |
| **27** | **Broadcast coverage measured per league.** The join's ceiling is the INPUT, not the matcher: see the table under #27 | v0.8.147 |
| **41** | **The curated network map.** `networkMap.ts` fills the leagues the source says nothing about, through the same matcher; a guess is worded ("Usually found on X") rather than scored down; "Couldn't find a matching channel" reworded (twice, see #42) | v0.8.149 |
| **42** | **The carriage line stops describing the world.** "Could not link channel": the only claim the app has evidence for. Plus "Usually found on X" for the map, and a test that holds the rule rather than the string | v0.8.152 |
| **43** | **The couldn't-link pill.** "On Paramount+" names a broadcaster, not a channel, so it says so: a muted pill with a warning triangle, on every state with no channel behind it, replacing the sentence where nothing is known | v0.8.153-154 |
| **44** | **The map fills a dead end.** A source network that matches nothing now falls through to the map, keeping both: "On Paramount+ · Usually found on US: CBS Sports Network" | v0.8.156 |
| **45** | **The fresh-eyes audit**, five parallel reviewers over v0.8.119-156. Tier 1's eight user-visible defects fixed; #46-48 carry the rest | v0.8.157 |
| **10** | **The golf card.** A leaderboard as a `Field`: five rows of position, flag, name and score to par, THRU derived from the nested holes, and an upcoming face carrying the tour mark and date range. No par anywhere in the payload | v0.8.159 |
| **46, 47** | **The identity chain and light mode.** Three layers of memoisation made to fire, `fitText`'s mount path made linear, and four contrast failures the theme flip left behind | v0.8.163 |
| **38** | **Opening a tournament.** A tournament card opens its day's draw: live, upcoming, results, with a draw filter, per-set scores and courts. Also split SUSPENDED from postponed, which the screen exposed | v0.8.140 |

## Closed decisions

Things that came off the list because the answer is no, or because the
answer is "not yet, and here is what would change that".

- **Preact is not an option**, though it is the biggest single item in the
  bundle at 130 kB. Its `StrictMode` is a no-op, and this codebase relies
  on StrictMode double-invoke to surface races: both the v0.1.106 disk
  cache race and this hub's own autoplay race were caught that way.
- **Sprint names cannot be printed on the card as written** (#9): measured,
  the country overlaps the schedule by 9.9px. Tooltip shipped instead.
- **There IS a rights map now** (was H4, reopened and closed the other way in
  v0.8.149). It was closed as "no such file exists" and #27's measurement is
  what made one worth writing. `networkMap.ts` carries the maintenance
  commitment and its review date in its own header, which is what the item
  actually asked for. `matcher.ts`'s `BRANDS` is still brand-name
  normalisation and still not a carriage table; the two are separate on
  purpose.
- **A cadence module is indirection today** (#24, kept on the list as
  blocked rather than deleted, because #15 will make it real).
- **Soccer's `form` string** ("LWWWW", 16 of 182 events) is not going on
  the card. Soccer carries a record too, so form would be a second concept
  for one sport. `leaders` and `odds` are their own decisions and nobody
  has made them.

## Left for Adam

- `website/shots/guide-src.jpg` and `theater-src.jpg`, 1.76 MB, plainly the
  uncompressed masters of two shots that are used. Whether sources live in
  git is a decision, not a cleanup.
- `mpv_blur` is dead by every grep, and `HANDOFF.md` and `ROADMAP.md` both
  say to keep it. Left alone. `mpv.rs`'s comment naming it as the live
  caller was stale and now names `mpv_frost` too.

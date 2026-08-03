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

#### 10. The golf card [ ]

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

**Structurally this is the race card with a different number.** Blocked
behind #1's model decision.

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

#### 27. Record the hit rate per league [ ]

The plan says this number belongs in this file. It is not here. Needs a run
against a real playlist, per league, recorded with a date.

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

#### 36. A narrowed board reaches to the next event [ ]

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

## Closed decisions

Things that came off the list because the answer is no, or because the
answer is "not yet, and here is what would change that".

- **Preact is not an option**, though it is the biggest single item in the
  bundle at 130 kB. Its `StrictMode` is a no-op, and this codebase relies
  on StrictMode double-invoke to surface races: both the v0.1.106 disk
  cache race and this hub's own autoplay race were caught that way.
- **Sprint names cannot be printed on the card as written** (#9): measured,
  the country overlaps the schedule by 9.9px. Tooltip shipped instead.
- **There is no rights map to date** (was H4). `matcher.ts`'s `BRANDS` is
  brand-name normalisation, not a carriage table. The item was "say in the
  file that a shipped rights map is a maintenance commitment", and there is
  no such file. It comes back if one is ever written.
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

# 010: Sports: a hub for what is on right now

- **Status**: PLANNED. **Phase 0 is a decision gate**, see below: everything
  downstream depends on one field existing in one payload.
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

**Do not write phase 1 until this is answered.** The blocked sandbox could not
verify it (network policy denies that host), so it needs one browser tab on a
machine that can reach it.

## The join, which is the hard part

```
fixture.broadcasts[] ──→ network names ──→ your channel list
       "CBS"                              "US| CBS HD", "CBS East 4K"
```

Nobody's playlist names channels the way a schedule names networks. The
matcher is the feature, and it is pure logic, so it is the part that gets
tests before it gets a screen.

- **Normalize both sides.** Strip country prefixes (`US|`, `USA:`), quality
  suffixes (`HD`, `FHD`, `4K`, `1080`), separators, and the unicode lookalikes
  providers love (`ᴴᴰ`). `extractQuality` and the emoji handling already in
  the Live pipeline do part of this; extend rather than duplicate.
- **Match on the normalized token set**, not on substring containment.
  Substrings are how "ESPN" matches "ESPNU" and puts the wrong game on screen.
- **Several matches is a success, not an ambiguity.** Show them all, ordered
  by quality, exactly like the source rail.
- **Zero matches is honest.** "No channel of yours is carrying this" beats a
  guess. Offer a search box into the channel list so the user can look.
- **A wrong match must be correctable, and the correction must stick.** Store
  it keyed by NETWORK, not by fixture: teaching the app once that `CBS` means
  `US| CBS HD` should hold for every CBS game forever. This is also the
  graceful degradation path if broadcast data is thin.

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

1. **Source adapter + the gate.** One module behind an interface, answering
   "give me today's fixtures for these leagues". Verified against the real
   endpoints. Deliberately throwaway-able.
2. **The matcher, tests first.** Network name to channel list, against a real
   playlist snapshot as a fixture file. No UI. This is where the feature is
   won or lost and it is testable without a screen.
3. **The hub, read only.** Cards, sections, no tuning. Proves the shape.
4. **Tuning.** Click a channel, play it. Reuse the existing player path and
   the failover language from the VOD source rail.
5. **Filters.** Leagues and teams, persisted, hub opens on what you follow.
6. **Polish.** Empty states (no leagues followed, nothing on today, no
   channels matched), refresh cadence, reduced motion.

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

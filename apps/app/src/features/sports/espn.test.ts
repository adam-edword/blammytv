import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAGUES,
  dedupe,
  espnDate,
  fetchBoard,
  fetchGames,
  toGames,
} from "./espn";
import { isFixture, isTournament } from "./model";
import epl from "./fixtures/epl-scoreboard.json";
import mlb from "./fixtures/mlb-scoreboard.json";
import nfl from "./fixtures/nfl-scoreboard.json";
import atp from "./fixtures/atp-scoreboard.json";
import playoff from "./fixtures/nba-playoff-scoreboard.json";

/**
 * The mapping, against real responses.
 *
 * The fixtures were fetched on 2026-07-26 and pruned to the paths espn.ts
 * reads; every value in them is verbatim. That is the point: these assert
 * on the source's actual words ("Bot 11th", "MASN", the crest URLs), so a
 * shape change upstream fails here rather than on a card.
 */

/** The catalog paths the fixtures were captured from. `toGames` takes a
 * path now rather than a row from a table of five (D1), so this is only
 * here to keep the call sites reading as league names. */
const PATHS: Record<string, string> = {
  mlb: "baseball/mlb",
  nfl: "football/nfl",
  nhl: "hockey/nhl",
  epl: "soccer/eng.1",
};
const league = (key: string) => PATHS[key];

/**
 * `toGames`, narrowed to the two-sided games.
 *
 * The mapper returns the union now: a grouped event summarises its whole
 * draw into one tournament card a day rather than expanding to its matches.
 * Every suite below this line is about fixtures and says so, which is also
 * the assertion — a fixture league that started coming back as something
 * else would empty these rather than quietly pass.
 */
const played = (raw: Parameters<typeof toGames>[0], path: string) =>
  toGames(raw, path).filter(isFixture);

describe("toGames", () => {
  it("maps a live game, its clock and its score", () => {
    const games = played(mlb, league("mlb"));
    const live = games.find((g) => g.state === "live")!;

    expect(live.league).toBe("MLB");
    expect(live.sport).toBe("baseball");
    // ESPN's own words: only it knows baseball says this.
    expect(live.status).toBe("Bot 11th");
    expect(live.home.name).toBe("Baltimore Orioles");
    expect(live.home.shortName).toBe("Orioles");
    expect(live.home.abbr).toBe("BAL");
    expect(live.away.score).toBe(3);
    expect(live.home.score).toBe(2);
    expect(live.venue).toBe("Oriole Park at Camden Yards");
  });

  it("carries the media the card paints with", () => {
    const live = played(mlb, league("mlb")).find((g) => g.state === "live")!;
    // No leading hash: the wash sets --team from this directly.
    expect(live.home.color).toMatch(/^[0-9a-f]{6}$/);
    expect(live.home.logo).toMatch(/^https:\/\/a\.espncdn\.com\//);
    expect(live.away.logo).toMatch(/^https:\/\/a\.espncdn\.com\//);
    // The inverted mark, for the badge on a near-black card.
    expect(live.home.logo).toContain("/500/");
    expect(live.home.logoDark).toBe(live.home.logo!.replace("/500/", "/500-dark/"));
  });

  it("leaves logoDark unset when the path has no size to swap", () => {
    const odd = {
      leagues: [{ abbreviation: "MLB" }],
      events: [
        {
          ...mlb.events[0],
          competitions: [
            {
              ...mlb.events[0].competitions[0],
              competitors: mlb.events[0].competitions[0].competitors.map((c) => ({
                ...c,
                team: { ...c.team, logo: "https://example.test/crest.png" },
              })),
            },
          ],
        },
      ],
    };
    const [game] = played(odd, league("mlb"));
    expect(game.home.logo).toBe("https://example.test/crest.png");
    expect(game.home.logoDark).toBeUndefined();
  });

  it("maps all three of ESPN's states", () => {
    const games = played(mlb, league("mlb"));
    expect(games.map((g) => g.state).sort()).toEqual(["final", "live", "pre"]);
    expect(games.find((g) => g.state === "final")!.status).toBe("Final");
  });

  it("trims how a final got there, keeping only that it is over", () => {
    const overtime = (detail: string) => ({
      leagues: [{ abbreviation: "MLB" }],
      events: [
        {
          ...mlb.events[0],
          competitions: [
            {
              ...mlb.events[0].competitions[0],
              status: { type: { state: "post", shortDetail: detail } },
            },
          ],
        },
      ],
    });
    expect(played(overtime("Final/11"), league("mlb"))[0].status).toBe("Final");
    expect(played(overtime("Final/OT"), league("nfl"))[0].status).toBe("Final");
    expect(played(overtime("Final"), league("mlb"))[0].status).toBe("Final");
    // Anything else the post state carries survives.
    expect(played(overtime("Postponed"), league("mlb"))[0].status).toBe(
      "Postponed",
    );
  });

  it("drops why a live game is stopped, keeping where it is up to", () => {
    const delayed = (detail: string) => ({
      leagues: [{ abbreviation: "MLB" }],
      events: [
        {
          ...mlb.events[0],
          competitions: [
            {
              ...mlb.events[0].competitions[0],
              status: { type: { state: "in", shortDetail: detail } },
            },
          ],
        },
      ],
    });
    expect(played(delayed("Delayed, Top 1st"), league("mlb"))[0].status).toBe(
      "Top 1st",
    );
    expect(played(delayed("Rain Delay, Bot 3rd"), league("mlb"))[0].status).toBe(
      "Bot 3rd",
    );
    // The clock on its own is untouched, whatever shape the sport gives it.
    expect(played(delayed("Bot 7th"), league("mlb"))[0].status).toBe("Bot 7th");
    expect(played(delayed("45'+2"), league("epl"))[0].status).toBe("45'+2");
    // Nothing behind the comma to keep: the delay is all that is known.
    expect(played(delayed("Delayed"), league("mlb"))[0].status).toBe("Delayed");
  });

  it("gives an unstarted game the local kick-off time, not ESPN's", () => {
    // Soccer's own shortDetail here is the useless "Scheduled".
    const [game] = played(epl, league("epl"));
    expect(game.state).toBe("pre");
    expect(game.status).toMatch(/^\d{1,2}:\d{2}(AM|PM)$/);
    expect(game.league).toBe("Premier League");
    expect(game.home.name).toBe("Arsenal");
    expect(game.away.shortName).toBe("Coventry");
  });

  it("flattens and de-duplicates the broadcasts the matcher will use", () => {
    const live = played(mlb, league("mlb")).find((g) => g.state === "live")!;
    expect(live.broadcasts).toContain("MASN");
    expect(new Set(live.broadcasts).size).toBe(live.broadcasts.length);

    const [game] = played(nfl, league("nfl"));
    expect(game.broadcasts.length).toBeGreaterThan(0);
  });

  it("namespaces ids by source and league", () => {
    const [game] = played(nfl, league("nfl"));
    expect(game.id).toMatch(/^espn-football\/nfl-\d+$/);
  });

  it("drops an event it cannot draw instead of throwing", () => {
    const broken = {
      leagues: [{ abbreviation: "MLB" }],
      events: [
        { id: "1", date: "2026-07-26T17:35Z", competitions: [{}] }, // no sides
        { id: "2", date: "not a date", competitions: nfl.events[0].competitions },
        {}, // nothing at all
      ],
    };
    expect(played(broken, league("mlb"))).toEqual([]);
  });

  it("survives a payload with no events at all (out of season)", () => {
    expect(played({ events: [] }, league("nhl"))).toEqual([]);
    expect(played({}, league("nhl"))).toEqual([]);
  });
});

describe("espnDate", () => {
  it("formats from local parts, zero-padded", () => {
    expect(espnDate(new Date(2026, 6, 26))).toBe("20260726");
    expect(espnDate(new Date(2026, 0, 5))).toBe("20260105");
    expect(espnDate(new Date(2026, 11, 31))).toBe("20261231");
  });

  it("takes the local day, not the UTC one", () => {
    // 11pm on the 26th somewhere west of Greenwich is the 27th in UTC.
    // Whose Tuesday it is comes from the person asking.
    const late = new Date(2026, 6, 26, 23, 30);
    expect(espnDate(late)).toBe("20260726");
  });
});

/**
 * Tennis, which is the one sport whose matches are not where every other
 * sport puts them.
 *
 * The fixture is a real ATP board, pruned to the paths the adapter reads:
 * one tournament, `competitions` empty, two groupings with three matches
 * each. On the live board that same event carried 121.
 */
describe("toGames over a tennis tournament", () => {
  const league = "tennis/atp";
  /** The tournaments the fixture maps to, one per day it plays on. */
  const days = () => toGames(atp, league).filter(isTournament);

  it("summarises the draw instead of expanding it", () => {
    // THE WHOLE POINT, and it is a measurement rather than a taste: one
    // real WTA event carries 447 matches over a fortnight, and across the
    // catalog for two days tennis was 256 of 304 cards. A tournament is one
    // thing on a schedule, so it gets one card a day.
    const games = toGames(atp, league);
    expect(atp.events[0].competitions).toHaveLength(0);
    expect(games.every(isTournament)).toBe(true);
    // The matches did not vanish, they moved down a level.
    expect(days().flatMap((t) => t.matches)).toHaveLength(3);
  });

  it("carries the tournament's own name, which a fixture gets from its sides", () => {
    for (const t of days()) expect(t.title).toBeTruthy();
  });

  it("keys the card on the EVENT, so atp and wta fold into one", () => {
    // Measured on a real board: all 405 of ATP's match ids were among
    // WTA's 447, same tournaments, same men's and women's draws. A path in
    // the id would have drawn every tennis card twice.
    for (const t of days()) {
      expect(t.id).not.toContain("tennis/atp");
      expect(t.id).toContain("espn-tournament-tennis-");
    }
  });

  it("splits by DAY, so a fortnight does not file under its opening Monday", () => {
    // onDay buckets by local date. One summary of the whole event would
    // carry the first match's date and vanish for the other thirteen days.
    const stamps = days().map((t) => t.start.toDateString());
    expect(new Set(stamps).size).toBe(stamps.length);
    for (const t of days()) {
      expect(Number.isNaN(t.start.getTime())).toBe(false);
      // Every match it counts really is on the day it claims.
      for (const m of t.matches) {
        expect(m.start.toDateString()).toBe(t.start.toDateString());
      }
    }
  });

  it("takes its state from the MATCHES, never from the event", () => {
    // Measured 2026-08-03: the National Bank Open runs to 2026-08-14 and
    // its event status already read STATUS_FINAL with completed: true.
    for (const t of days()) {
      const playing = t.matches.filter((m) => m.state === "live").length;
      const expected =
        playing > 0
          ? "live"
          : t.matches.some((m) => m.state !== "final")
            ? "pre"
            : "final";
      expect(t.state).toBe(expected);
    }
  });

  it("scores a match in SETS, not in games won", () => {
    // 6-3, 4-6, 2-6 is one set to two. Adding the games up would say 12-15,
    // which is not a tennis score at all. Still mapped per match: the
    // tournament changed the altitude, not the mapping.
    const g = days().flatMap((t) => t.matches)[0];
    expect([g.home.score, g.away.score].sort()).toEqual([1, 2]);
  });

  it("names a DOUBLES pair, which has no athlete at all", () => {
    // 37 of 175 matches on the live board are doubles. They drop `athlete`
    // and carry a roster instead, and reading only `athlete` left every one
    // of them blank.
    const pair = days()
      .flatMap((t) => t.matches)
      .find((g) => g.home.name.includes("/"));
    expect(pair).toBeDefined();
    expect(pair!.home.name).toContain("/");
    expect(pair!.away.name).toContain("/");
  });

  it("scores a whitewash as ZERO, not as nothing", () => {
    // Straight sets means the loser won none, and none is a score. Running
    // the count through `|| undefined` blanked every one of these.
    const g = days()
      .flatMap((t) => t.matches)
      .find((x) => x.home.score === 0 || x.away.score === 0);
    expect(g).toBeDefined();
    const loser = g!.home.score === 0 ? g!.home : g!.away;
    expect(loser.score).toBe(0);
    expect(loser.score).not.toBeUndefined();
  });

  it("reads the competitor from athlete rather than team", () => {
    const g = days().flatMap((t) => t.matches)[0];
    expect(g.home.name).toBeTruthy();
    // A country flag stands in for the crest an individual does not have.
    expect(g.home.logo ?? "").toContain("http");
    // Derived, because an athlete carries no abbreviation of its own.
    expect(g.home.abbr).toMatch(/^[A-Z]{1,3}$/);
  });

  it("gives every match its own id, under the tournament", () => {
    const ids = days().flatMap((t) => t.matches.map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("dedupe folds the same event served by two leagues", () => {
  it("merges the paths rather than picking one", () => {
    // atp sorts before wta, so picking the first would hide every combined
    // tournament from someone following only the WTA — half the draw sheet.
    const both = dedupe([
      ...toGames(atp, "tennis/atp"),
      ...toGames(atp, "tennis/wta"),
    ]);
    expect(both).toHaveLength(toGames(atp, "tennis/atp").length);
    for (const t of both.filter(isTournament)) {
      expect(t.keys.sort()).toEqual(["tennis/atp", "tennis/wta"]);
    }
  });

  it("leaves fixtures alone, whose ids already carry their league", () => {
    const games = [...toGames(mlb, PATHS.mlb), ...toGames(epl, PATHS.epl)];
    expect(dedupe(games)).toHaveLength(games.length);
  });
});

describe("toGames leaves single match events exactly as they were", () => {
  it("keeps the id it always had, with no suffix", () => {
    // Ids are React keys and the row's scroll anchor. Tennis must not
    // rename every game in the app.
    const league = PATHS.epl;
    for (const g of played(epl, league)) {
      expect(g.id).toMatch(/^espn-soccer\/eng\.1-\d+$/);
    }
  });
});

describe("a game that was never played", () => {
  /** ESPN files a postponement as state "post" with a 0-0 line. */
  const postponed = () => ({
    leagues: [{ abbreviation: "MLB" }],
    events: [
      {
        id: "401800000",
        date: "2026-07-28T23:10Z",
        competitions: [
          {
            status: {
              type: {
                state: "post",
                completed: false,
                detail: "Postponed",
                shortDetail: "Postponed",
              },
            },
            competitors: [
              { homeAway: "home", score: "0", team: { id: "1", displayName: "Mets", abbreviation: "NYM" } },
              { homeAway: "away", score: "0", team: { id: "2", displayName: "Braves", abbreviation: "ATL" } },
            ],
          },
        ],
      },
    ],
  });

  it("is not a result", () => {
    // It used to map straight to `final` and draw as a finished nil-nil
    // draw: dimmed, collapsed into a compact line, beaten by nobody.
    const g = played(postponed(), PATHS.mlb)[0];
    expect(g.state).not.toBe("final");
    expect(g.state).toBe("pre");
  });

  it("says why, rather than showing a kick-off time that is no longer true", () => {
    const g = played(postponed(), PATHS.mlb)[0];
    expect(g.status).toBe("Postponed");
  });

  it("still treats a completed game as final", () => {
    const done = postponed();
    done.events[0].competitions[0].status.type = {
      state: "post",
      completed: true,
      detail: "Final",
      shortDetail: "Final",
    };
    const g = played(done, PATHS.mlb)[0];
    expect(g.state).toBe("final");
  });
});

describe("fetchGames asks for what it is given", () => {
  /** Stands in for the wire, recording every URL and answering empty. */
  const record = async (run: () => Promise<unknown>) => {
    const seen: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = ((url: string) => {
      seen.push(url);
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as never;
    try {
      await run();
    } finally {
      globalThis.fetch = real;
    }
    return seen;
  };

  it("requests exactly the paths in the list, in the catalog's own words", async () => {
    // The whole of D1 from the wire's side: five hardcoded leagues became
    // whatever is followed, and a path is a URL with no lookup in between.
    const seen = await record(() =>
      fetchGames(["tennis/atp", "mma/ufc"]),
    );
    expect(seen).toEqual([
      "https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard",
      "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard",
    ]);
  });

  it("falls back to the defaults when handed nothing", async () => {
    const seen = await record(() => fetchGames([]));
    expect(seen).toHaveLength(0);
    const fallback = await record(() => fetchGames());
    expect(fallback).toHaveLength(DEFAULT_LEAGUES.length);
    for (const path of DEFAULT_LEAGUES)
      expect(fallback.some((u) => u.includes(`/${path}/`))).toBe(true);
  });
});

describe("fetchBoard says which paths are worth asking again", () => {
  /**
   * The wire, answering differently per league.
   *
   * `has` gets one MLB game, `empty` gets a 200 with no events (a league
   * between seasons, which on any given day is most of the catalog), and
   * `dead` throws.
   */
  const wire = async (run: () => Promise<unknown>) => {
    const real = globalThis.fetch;
    globalThis.fetch = ((url: string) => {
      if (url.includes("/dead/")) return Promise.reject(new Error("boom"));
      if (url.includes("/has/")) {
        return Promise.resolve({ ok: true, json: async () => mlb });
      }
      return Promise.resolve({ ok: true, json: async () => ({ events: [] }) });
    }) as never;
    try {
      return await run();
    } finally {
      globalThis.fetch = real;
    }
  };

  it("keeps the leagues that had something on", async () => {
    const out = await wire(() => fetchBoard(["a/has", "b/empty", "c/empty"]));
    expect((out as { answered: string[] }).answered).toEqual(["a/has"]);
  });

  it("keeps a league that FAILED, so one bad response is not permanent", async () => {
    // The reason this returns a list instead of the caller deriving one
    // from the games: a league that threw contributed no game to read a
    // path back off, so it would be dropped and never asked again for the
    // rest of the session.
    const out = await wire(() => fetchBoard(["a/has", "b/dead", "c/empty"]));
    expect((out as { answered: string[] }).answered).toEqual(["a/has", "b/dead"]);
  });

  it("is the saving the wide board rests on", async () => {
    // Measured across the real catalog on 2026-08-03: 151 leagues answered,
    // 20 had anything on. Polling all of them every 90 seconds is ~100
    // requests a minute at an endpoint we do not own.
    const paths = ["a/has", ...Array.from({ length: 150 }, (_, i) => `x${i}/empty`)];
    const out = (await wire(() => fetchBoard(paths))) as { answered: string[] };
    expect(paths).toHaveLength(151);
    expect(out.answered).toHaveLength(1);
  });
});

describe("the request gate", () => {
  it("never puts more than six requests on the wire at once", async () => {
    // It used to be five leagues, structurally. The fetch list is now
    // whatever is followed times three days, so a keen follower could put
    // sixty requests up in one frame at a free endpoint we do not own.
    let open = 0;
    let peak = 0;
    const real = globalThis.fetch;
    globalThis.fetch = (() => {
      open++;
      peak = Math.max(peak, open);
      return new Promise((resolve) =>
        setTimeout(() => {
          open--;
          resolve({ ok: true, json: async () => ({}) });
        }, 1),
      );
    }) as never;
    try {
      const paths = Array.from({ length: 30 }, (_, i) => `sport/l${i}`);
      // Three days at once, the way the board actually loads.
      await Promise.all([
        fetchGames(paths),
        fetchGames(paths),
        fetchGames(paths),
      ]);
    } finally {
      globalThis.fetch = real;
    }
    expect(peak).toBeLessThanOrEqual(6);
    // And it did not simply serialise: a board that loads one league at a
    // time over twenty leagues is a board you watch fill in.
    expect(peak).toBe(6);
  });
});

describe("fetchGames on a total outage", () => {
  it("distinguishes an outage from a quiet day", async () => {
    // allSettled never rejects, so every league failing used to arrive as
    // an empty board and the screen said "Nothing on today" at a dead
    // connection. One league failing must still degrade quietly.
    const real = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as never;
    try {
      await expect(fetchGames()).rejects.toThrow();
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("broadcast ordering", () => {
  /** CLE @ CIN really does carry all three of these. */
  const threeFeeds = (order: { market: string; name: string }[]) => ({
    leagues: [{ abbreviation: "MLB" }],
    events: [
      {
        id: "401810000",
        date: "2026-07-28T23:10Z",
        competitions: [
          {
            status: { type: { state: "pre", completed: false } },
            broadcasts: order.map((b) => ({ market: b.market, names: [b.name] })),
            competitors: [
              { homeAway: "home", team: { id: "1", displayName: "Reds", abbreviation: "CIN" } },
              { homeAway: "away", team: { id: "2", displayName: "Guardians", abbreviation: "CLE" } },
            ],
          },
        ],
      },
    ],
  });
  const mlb = () => PATHS.mlb;

  it("puts the national feed first whatever order it arrived in", () => {
    // The card prints broadcasts[0] as "On X". That was decided by the
    // order the payload happened to use, not by which feed is neutral.
    const scrambled = threeFeeds([
      { market: "away", name: "CLEGuardians.TV" },
      { market: "home", name: "Reds.TV" },
      { market: "national", name: "MLB.TV" },
    ]);
    expect(played(scrambled, mlb())[0].broadcasts[0]).toBe("MLB.TV");
  });

  it("still offers both regional feeds, in home then away order", () => {
    // A regional feed is a real way to watch the game. It just should not
    // be the headline.
    const g = played(
      threeFeeds([
        { market: "national", name: "MLB.TV" },
        { market: "home", name: "Reds.TV" },
        { market: "away", name: "CLEGuardians.TV" },
      ]),
      mlb(),
    )[0];
    expect(g.broadcasts).toEqual(["MLB.TV", "Reds.TV", "CLEGuardians.TV"]);
  });

  it("keeps unlabelled feeds, after the ones we can place", () => {
    const g = played(
      threeFeeds([
        { market: "", name: "Some Regional" },
        { market: "national", name: "FOX" },
      ]),
      mlb(),
    )[0];
    expect(g.broadcasts).toEqual(["FOX", "Some Regional"]);
  });
});

/**
 * The four things that were already in every response and were being
 * thrown away (plan 010).
 *
 * The fixture is a real NBA playoff board from 2026-04-20, pruned to the
 * paths espn.ts reads. Playoffs because that is the one day of the year
 * when all four are populated at once: a regular-season game has records
 * and a preview and no series, and an August board has neither.
 */
describe("what the source already sends", () => {
  const NBA = "basketball/nba";

  it("takes the season record, not the home or road split", () => {
    const [g] = played(playoff, NBA);
    expect(g.home.record).toBe("52-30");
    expect(g.away.record).toBe("46-36");
  });

  it("draws no record at all before a season has one", () => {
    // 202 of 312 competitors on a real August board are 0-0, because the
    // NFL, college football and the Premier League have not kicked off.
    // "0-0" under a team name is noise dressed as information.
    const zeroed = (summary: string) => ({
      leagues: [{ abbreviation: "NBA" }],
      events: [
        {
          ...playoff.events[0],
          competitions: [
            {
              ...playoff.events[0].competitions[0],
              competitors: playoff.events[0].competitions[0].competitors.map(
                (c) => ({ ...c, records: [{ type: "total", summary }] }),
              ),
            },
          ],
        },
      ],
    });
    expect(played(zeroed("0-0"), NBA)[0].home.record).toBeUndefined();
    expect(played(zeroed("0-0-0"), NBA)[0].home.record).toBeUndefined();
    // A zero that is part of a real record still counts.
    expect(played(zeroed("10-0"), NBA)[0].home.record).toBe("10-0");
    expect(played(zeroed("0-10"), NBA)[0].home.record).toBe("0-10");
  });

  it("prefers the series state to the round, because it says more", () => {
    // Both are there on every one of these games. "East 1st Round - Game 2"
    // tells you what "CLE leads series 2-0" tells you and then stops.
    const games = played(playoff, NBA);
    expect(games.map((g) => g.note)).toEqual([
      "CLE leads series 2-0",
      "Series tied 1-1",
      "Series tied 1-1",
    ]);
  });

  it("falls back to the occasion where there is no series", () => {
    const noSeries = {
      leagues: [{ abbreviation: "NBA" }],
      events: [
        {
          ...playoff.events[0],
          competitions: [
            { ...playoff.events[0].competitions[0], series: undefined },
          ],
        },
      ],
    };
    expect(played(noSeries, NBA)[0].note).toBe("East 1st Round - Game 2");
  });

  it("says nothing on an ordinary game rather than inventing an occasion", () => {
    expect(played(mlb, league("mlb"))[0].note).toBeUndefined();
  });

  it("carries the wire's one-liner, which is a sentence and not a label", () => {
    const [g] = played(playoff, NBA);
    expect(g.headline).toBe(
      "Mitchell scores 30, Harden adds 28 as Cavaliers beat Raptors 115-105 for 2-0 series lead",
    );
    // Long enough that it can only be a tooltip.
    expect(g.headline!.length).toBeGreaterThan(60);
  });
});

describe("what the reach asks for", () => {
  const seen = async (run: () => Promise<unknown>) => {
    const urls: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = ((url: string) => {
      urls.push(url);
      return Promise.resolve({ ok: true, json: async () => ({ events: [] }) });
    }) as never;
    try {
      await run();
    } finally {
      globalThis.fetch = real;
    }
    return urls;
  };

  it("asks a racing league for its SEASON, which is 25 rounds", async () => {
    // Adam, on the bare call returning one lonely Grand Prix: "shouldn't
    // there be more than just NED? like the rest of the schedule should be
    // showing". Measured 2026-08-03: `?dates=2026` returns all 25 rounds,
    // 152 KB gzipped, 12 of them still ahead.
    const [url] = await seen(() => fetchBoard(["racing/f1"], { ahead: true }));
    expect(url).toMatch(/\/racing\/f1\/scoreboard\?dates=\d{4}$/);
  });

  it("asks everything else for its NEXT event only", async () => {
    // A season is affordable for a 25 round calendar and not for a team
    // league: the same question would be 1,230 NBA games or 2,430 MLB ones.
    const [url] = await seen(() =>
      fetchBoard(["basketball/nba"], { ahead: true }),
    );
    expect(url).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
    );
  });

  it("still asks for a DAY when given one, racing included", async () => {
    // `ahead` only changes the question when there is no date. A window
    // call must stay a window call or the board would draw a season on it.
    const [url] = await seen(() =>
      fetchBoard(["racing/f1"], { date: new Date(2026, 7, 21) }),
    );
    expect(url).toMatch(/\?dates=20260821$/);
  });
});

describe("suspended is not postponed", () => {
  /** Both arrive as `post` with `completed: false`. Only one has a score. */
  const stopped = (linescores: { value: number }[]) => ({
    leagues: [{ abbreviation: "ATP" }],
    events: [
      {
        id: "1",
        date: "2026-08-03T17:00Z",
        competitions: [
          {
            date: "2026-08-03T17:00Z",
            status: {
              type: { state: "post", completed: false, shortDetail: "Suspended" },
            },
            competitors: [
              { homeAway: "home", athlete: { id: "a", displayName: "Berrettini" }, linescores },
              { homeAway: "away", athlete: { id: "b", displayName: "Navone" }, linescores },
            ],
          },
        ],
      },
    ],
  });

  it("keeps a true postponement as unstarted", () => {
    // Nothing on the line: it has not been played, so it reads as one that
    // has not happened yet. This is the baseball case the rule was for.
    expect(played(stopped([]), PATHS.mlb)[0].state).toBe("pre");
  });

  it("treats a part-played match as unfinished, not unstarted", () => {
    // Four real matches sat under "Upcoming" carrying 3-6, 1-0. A fixture
    // that has not happened does not have a scoreline.
    const g = played(stopped([{ value: 6 }, { value: 1 }]), "tennis/atp")[0];
    expect(g.state).toBe("live");
    // ESPN's own word survives either way, so the card still says why.
    expect(g.status).toBe("Suspended");
  });
});

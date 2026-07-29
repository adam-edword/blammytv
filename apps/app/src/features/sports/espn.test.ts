import { describe, expect, it } from "vitest";
import { LEAGUES, espnDate, fetchGames, toGames } from "./espn";
import epl from "./fixtures/epl-scoreboard.json";
import mlb from "./fixtures/mlb-scoreboard.json";
import nfl from "./fixtures/nfl-scoreboard.json";
import atp from "./fixtures/atp-scoreboard.json";

/**
 * The mapping, against real responses.
 *
 * The fixtures were fetched on 2026-07-26 and pruned to the paths espn.ts
 * reads; every value in them is verbatim. That is the point: these assert
 * on the source's actual words ("Bot 11th", "MASN", the crest URLs), so a
 * shape change upstream fails here rather than on a card.
 */

const league = (key: string) => LEAGUES.find((l) => l.key === key)!;

describe("toGames", () => {
  it("maps a live game, its clock and its score", () => {
    const games = toGames(mlb, league("mlb"));
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
    const live = toGames(mlb, league("mlb")).find((g) => g.state === "live")!;
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
    const [game] = toGames(odd, league("mlb"));
    expect(game.home.logo).toBe("https://example.test/crest.png");
    expect(game.home.logoDark).toBeUndefined();
  });

  it("maps all three of ESPN's states", () => {
    const games = toGames(mlb, league("mlb"));
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
    expect(toGames(overtime("Final/11"), league("mlb"))[0].status).toBe("Final");
    expect(toGames(overtime("Final/OT"), league("nfl"))[0].status).toBe("Final");
    expect(toGames(overtime("Final"), league("mlb"))[0].status).toBe("Final");
    // Anything else the post state carries survives.
    expect(toGames(overtime("Postponed"), league("mlb"))[0].status).toBe(
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
    expect(toGames(delayed("Delayed, Top 1st"), league("mlb"))[0].status).toBe(
      "Top 1st",
    );
    expect(toGames(delayed("Rain Delay, Bot 3rd"), league("mlb"))[0].status).toBe(
      "Bot 3rd",
    );
    // The clock on its own is untouched, whatever shape the sport gives it.
    expect(toGames(delayed("Bot 7th"), league("mlb"))[0].status).toBe("Bot 7th");
    expect(toGames(delayed("45'+2"), league("epl"))[0].status).toBe("45'+2");
    // Nothing behind the comma to keep: the delay is all that is known.
    expect(toGames(delayed("Delayed"), league("mlb"))[0].status).toBe("Delayed");
  });

  it("gives an unstarted game the local kick-off time, not ESPN's", () => {
    // Soccer's own shortDetail here is the useless "Scheduled".
    const [game] = toGames(epl, league("epl"));
    expect(game.state).toBe("pre");
    expect(game.status).toMatch(/^\d{1,2}:\d{2}(AM|PM)$/);
    expect(game.league).toBe("Premier League");
    expect(game.home.name).toBe("Arsenal");
    expect(game.away.shortName).toBe("Coventry");
  });

  it("flattens and de-duplicates the broadcasts the matcher will use", () => {
    const live = toGames(mlb, league("mlb")).find((g) => g.state === "live")!;
    expect(live.broadcasts).toContain("MASN");
    expect(new Set(live.broadcasts).size).toBe(live.broadcasts.length);

    const [game] = toGames(nfl, league("nfl"));
    expect(game.broadcasts.length).toBeGreaterThan(0);
  });

  it("namespaces ids by source and league", () => {
    const [game] = toGames(nfl, league("nfl"));
    expect(game.id).toMatch(/^espn-nfl-\d+$/);
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
    expect(toGames(broken, league("mlb"))).toEqual([]);
  });

  it("survives a payload with no events at all (out of season)", () => {
    expect(toGames({ events: [] }, league("nhl"))).toEqual([]);
    expect(toGames({}, league("nhl"))).toEqual([]);
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
  const league = { key: "atp", sport: "tennis", path: "tennis/atp" } as never;

  it("finds the matches under groupings, where competitions is empty", () => {
    const games = toGames(atp, league);
    expect(atp.events[0].competitions).toHaveLength(0);
    expect(games).toHaveLength(3);
  });

  it("gives every match its own id", () => {
    // One event, six matches. Without a suffix they would all collide on
    // the event id and React would render one card.
    const ids = toGames(atp, league).map((g) => g.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("scores a match in SETS, not in games won", () => {
    // 6-3, 4-6, 2-6 is one set to two. Adding the games up would say 12-15,
    // which is not a tennis score at all.
    const g = toGames(atp, league)[0];
    // 3-6, 6-4, 6-2 is two sets to one, not 15 games to 12.
    expect([g.home.score, g.away.score].sort()).toEqual([1, 2]);
  });

  it("names a DOUBLES pair, which has no athlete at all", () => {
    // 37 of 175 matches on the live board are doubles. They drop `athlete`
    // and carry a roster instead, and reading only `athlete` left every one
    // of them blank.
    const pair = toGames(atp, league).find((g) => g.home.name.includes("/"));
    expect(pair).toBeDefined();
    expect(pair!.home.name).toContain("/");
    expect(pair!.away.name).toContain("/");
  });

  it("scores a whitewash as ZERO, not as nothing", () => {
    // Straight sets means the loser won none, and none is a score. Running
    // the count through `|| undefined` blanked every one of these.
    const g = toGames(atp, league).find(
      (x) => x.home.score === 0 || x.away.score === 0,
    );
    expect(g).toBeDefined();
    const loser = g!.home.score === 0 ? g!.home : g!.away;
    expect(loser.score).toBe(0);
    expect(loser.score).not.toBeUndefined();
  });

  it("reads the competitor from athlete rather than team", () => {
    const g = toGames(atp, league)[0];
    expect(g.home.name).toBeTruthy();
    // A country flag stands in for the crest an individual does not have.
    expect(g.home.logo ?? "").toContain("http");
    // Derived, because an athlete carries no abbreviation of its own.
    expect(g.home.abbr).toMatch(/^[A-Z]{1,3}$/);
  });

  it("dates a match by the MATCH, not by the tournament", () => {
    // A tournament runs a week. Taking the event date would file every
    // match in the draw under its opening day.
    const games = toGames(atp, league);
    const days = new Set(games.map((g) => g.start.toDateString()));
    expect(days.size).toBeGreaterThanOrEqual(1);
    for (const g of games) expect(Number.isNaN(g.start.getTime())).toBe(false);
  });
});

describe("toGames leaves single match events exactly as they were", () => {
  it("keeps the id it always had, with no suffix", () => {
    // Ids are React keys and the row's scroll anchor. Tennis must not
    // rename every game in the app.
    const league = LEAGUES.find((l) => l.key === "epl")!;
    for (const g of toGames(epl, league)) {
      expect(g.id).toMatch(/^espn-epl-\d+$/);
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
    const g = toGames(postponed(), LEAGUES.find((l) => l.key === "mlb")!)[0];
    expect(g.state).not.toBe("final");
    expect(g.state).toBe("pre");
  });

  it("says why, rather than showing a kick-off time that is no longer true", () => {
    const g = toGames(postponed(), LEAGUES.find((l) => l.key === "mlb")!)[0];
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
    const g = toGames(done, LEAGUES.find((l) => l.key === "mlb")!)[0];
    expect(g.state).toBe("final");
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

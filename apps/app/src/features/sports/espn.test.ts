import { describe, expect, it } from "vitest";
import { LEAGUES, toGames } from "./espn";
import epl from "./fixtures/epl-scoreboard.json";
import mlb from "./fixtures/mlb-scoreboard.json";
import nfl from "./fixtures/nfl-scoreboard.json";

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
  });

  it("maps all three of ESPN's states", () => {
    const games = toGames(mlb, league("mlb"));
    expect(games.map((g) => g.state).sort()).toEqual(["final", "live", "pre"]);
    expect(games.find((g) => g.state === "final")!.status).toBe("Final");
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

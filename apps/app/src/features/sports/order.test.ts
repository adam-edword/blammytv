import { describe, expect, it } from "vitest";
import type { Fixture } from "./model";
import { inReadingOrder } from "./order";

const game = (leagueKey: string) =>
  ({ leagueKey, home: { name: "Notre Dame" }, away: { name: "Miami" } }) as unknown as Fixture;

describe("inReadingOrder", () => {
  it("puts the visitors first where the sport says 'at'", () => {
    for (const key of ["football/college-football", "football/nfl", "basketball/nba", "baseball/mlb", "hockey/nhl"]) {
      const g = inReadingOrder(game(key));
      expect([g.home.name, g.away.name], key).toEqual(["Miami", "Notre Dame"]);
    }
  });
  it("keeps the home side first everywhere else", () => {
    for (const key of ["soccer/eng.1", "rugby/premiership", "tennis/atp"]) {
      const g = inReadingOrder(game(key));
      expect([g.home.name, g.away.name], key).toEqual(["Notre Dame", "Miami"]);
    }
  });
  it("leaves the game it was given alone", () => {
    const g = game("football/nfl");
    inReadingOrder(g);
    expect(g.home.name).toBe("Notre Dame");
  });
});

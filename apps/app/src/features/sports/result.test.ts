import { describe, expect, it } from "vitest";
import { loser } from "./result";
import type { Competitor, Fixture, GameState } from "./model";

/**
 * Who lost, and more importantly when we are allowed to say so.
 *
 * This drives real paint: the losing side is desaturated, set in a light
 * weight and dropped 2px. Getting it wrong mid-game would both be a lie and
 * flicker on every score change, so the "only when final" rule is the point
 * of most of these.
 */

const side = (score?: number): Competitor => ({
  name: "Team",
  abbr: "T",
  score,
});

const game = (state: GameState, home?: number, away?: number): Fixture => ({
  kind: "fixture" as const,
  id: "g",
  sport: "soccer",
  league: "Premier League",
  leagueKey: "epl",
  state,
  start: new Date(2026, 6, 26, 15),
  status: "",
  home: side(home),
  away: side(away),
  broadcasts: [],
  channels: [],
});

describe("loser", () => {
  it("names the beaten side of a finished game", () => {
    expect(loser(game("final", 3, 1))).toBe("away");
    expect(loser(game("final", 1, 3))).toBe("home");
  });

  it("says nothing while the game is still on", () => {
    // Behind is not beaten. Draining the colour out of a team trailing in
    // the third would be wrong and would flicker when they equalised.
    expect(loser(game("live", 0, 2))).toBeUndefined();
    expect(loser(game("live", 2, 0))).toBeUndefined();
  });

  it("says nothing before it starts", () => {
    expect(loser(game("pre"))).toBeUndefined();
    // A 0-0 that has not kicked off is not a draw.
    expect(loser(game("pre", 0, 0))).toBeUndefined();
  });

  it("has no loser in a draw", () => {
    expect(loser(game("final", 2, 2))).toBeUndefined();
    expect(loser(game("final", 0, 0))).toBeUndefined();
  });

  it("says nothing when a score is missing", () => {
    // The adapter leaves score undefined rather than guessing zero, so a
    // final with half a score must not declare a winner off one number.
    expect(loser(game("final", 3, undefined))).toBeUndefined();
    expect(loser(game("final", undefined, 3))).toBeUndefined();
    expect(loser(game("final"))).toBeUndefined();
  });

  it("treats a real zero as a score, not as missing", () => {
    expect(loser(game("final", 0, 1))).toBe("home");
    expect(loser(game("final", 1, 0))).toBe("away");
  });
});

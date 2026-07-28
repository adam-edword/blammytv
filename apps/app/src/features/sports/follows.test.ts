import { describe, expect, it } from "vitest";
import {
  asFollows,
  gameTeamKeys,
  isFollowed,
  teamKey,
  toggleLeague,
  toggleTeam,
} from "./follows";
import { LEAGUES, toGames } from "./espn";
import mlb from "./fixtures/mlb-scoreboard.json";
import nfl from "./fixtures/nfl-scoreboard.json";

const league = (key: string) => LEAGUES.find((l) => l.key === key)!;
const none = { leagues: [], teams: [] };

describe("teamKey", () => {
  it("is league-scoped, because source ids are numbered per league", () => {
    // Real ids from the real captures. Unprefixed, two leagues' number 1
    // would be the same follow.
    const [mlbGame] = toGames(mlb, league("mlb"));
    const [nflGame] = toGames(nfl, league("nfl"));
    expect(teamKey(mlbGame.leagueKey, mlbGame.home)).toMatch(/^mlb:\d+$/);
    expect(teamKey(nflGame.leagueKey, nflGame.home)).toMatch(/^nfl:\d+$/);
    expect(teamKey("mlb", { id: "1" })).not.toBe(teamKey("nfl", { id: "1" }));
  });

  it("declines a competitor with no id rather than inventing one", () => {
    // Happens in a pruned fixture, not a real response. Better to lose the
    // follow control on that club than to key it on something that moves.
    expect(teamKey("mlb", {})).toBeNull();
  });
});

describe("gameTeamKeys", () => {
  it("gives both sides of a real game, distinctly", () => {
    const keys = gameTeamKeys(toGames(mlb, league("mlb"))[0]);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("isFollowed", () => {
  const game = toGames(mlb, league("mlb"))[0];

  it("matches on the league", () => {
    expect(isFollowed(game, { leagues: ["mlb"], teams: [] })).toBe(true);
    expect(isFollowed(game, { leagues: ["nhl"], teams: [] })).toBe(false);
  });

  it("matches on either club", () => {
    const [home, away] = gameTeamKeys(game);
    expect(isFollowed(game, { leagues: [], teams: [home] })).toBe(true);
    expect(isFollowed(game, { leagues: [], teams: [away] })).toBe(true);
    expect(isFollowed(game, { leagues: [], teams: ["mlb:99999"] })).toBe(false);
  });

  it("is false on an empty store, so nothing is followed by default", () => {
    expect(isFollowed(game, none)).toBe(false);
  });
});

describe("toggles", () => {
  it("add, then remove, on each half independently", () => {
    const one = toggleLeague(none, "mlb");
    expect(one).toEqual({ leagues: ["mlb"], teams: [] });
    expect(toggleLeague(one, "mlb").leagues).toEqual([]);

    const two = toggleTeam(one, "mlb:16");
    expect(two).toEqual({ leagues: ["mlb"], teams: ["mlb:16"] });
    expect(toggleTeam(two, "mlb:16").teams).toEqual([]);
  });

  it("does not mutate what it was given", () => {
    const before = { leagues: ["mlb"], teams: [] };
    toggleLeague(before, "nhl");
    expect(before.leagues).toEqual(["mlb"]);
  });
});

describe("asFollows", () => {
  it("takes the good case through", () => {
    expect(asFollows({ leagues: ["mlb"], teams: ["mlb:16"] })).toEqual({
      leagues: ["mlb"],
      teams: ["mlb:16"],
    });
  });

  it("survives anything else, because this runs on the first paint", () => {
    expect(asFollows(undefined)).toEqual(none);
    expect(asFollows("mlb")).toEqual(none);
    expect(asFollows({ leagues: "mlb" })).toEqual(none);
    // Partly good is kept partly: a bad half should not cost the good one.
    expect(asFollows({ leagues: ["mlb", 7, null], teams: undefined })).toEqual({
      leagues: ["mlb"],
      teams: [],
    });
  });
});

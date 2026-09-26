import { describe, expect, it } from "vitest";
import { fillFrom, gameLabel, liveWithChannels, mergeLeagues, scoreLine } from "./mvGames";
import type { Fixture, Game } from "../sports/model";

const game = (
  id: string,
  opts: Partial<Fixture> & { ch?: string; teamId?: string } = {},
): Fixture => ({
  kind: "fixture",
  id,
  sport: "football",
  league: "NFL",
  leagueKey: "football/nfl",
  state: "live",
  start: new Date(2026, 8, 25, 20),
  status: "3rd 07:22",
  broadcasts: ["ESPN"],
  channels: opts.ch === undefined ? [{ id: `c:${id}`, name: "ESPN" }] : opts.ch ? [{ id: opts.ch, name: "X" }] : [],
  home: { name: "Kansas City", shortName: "Chiefs", abbr: "KC", score: 24, id: opts.teamId ?? `h${id}` },
  away: { name: "Buffalo", shortName: "Bills", abbr: "BUF", score: 17, id: `a${id}` },
  ...opts,
});

const none = { leagues: [], teams: [], conferences: [] };

describe("liveWithChannels", () => {
  it("keeps what is on now and has a channel", () => {
    const games: Game[] = [
      game("1"),
      game("2", { state: "pre" }),
      game("3", { state: "final" }),
      game("4", { ch: "" }),
    ];
    expect(liveWithChannels(games).map((g) => g.id)).toEqual(["1"]);
  });
});

describe("fillFrom", () => {
  it("fills as far as the line allows, and skips what is already in", () => {
    const live = [game("1"), game("2"), game("3")];
    expect(fillFrom(live, new Set(["c:1"]), 1, none).map((g) => g.id)).toEqual(["2"]);
    expect(fillFrom(live, new Set(), 5, none)).toHaveLength(3);
    expect(fillFrom(live, new Set(), 0, none)).toEqual([]);
  });

  it("puts what you follow first", () => {
    const live = [game("1"), game("2", { teamId: "99" })];
    const follows = { leagues: [], teams: ["football/nfl:99"], conferences: [] };
    expect(fillFrom(live, new Set(), 1, follows).map((g) => g.id)).toEqual(["2"]);
  });

  it("puts your team ahead of your leagues, and your leagues ahead of the rest", () => {
    const live = [
      game("1", { leagueKey: "hockey/nhl" }),
      game("2"),
      game("3", { leagueKey: "soccer/eng.1", teamId: "363" }),
    ];
    const follows = { leagues: ["football/nfl", "soccer/eng.1"], teams: ["soccer/eng.1:363"], conferences: [] };
    expect(fillFrom(live, new Set(), 3, follows).map((g) => g.id)).toEqual(["3", "2", "1"]);
  });

  it("counts a channel once, however many games it carries", () => {
    const live = [game("1", { ch: "espn" }), game("2", { ch: "espn" }), game("3")];
    expect(fillFrom(live, new Set(), 3, none).map((g) => g.id)).toEqual(["1", "3"]);
  });
});

describe("the words", () => {
  it("names the game the way a listing does", () => {
    expect(gameLabel(game("1"))).toBe("Bills at Chiefs");
  });

  it("reads the score like a bug, and only the matchup before the start", () => {
    expect(scoreLine(game("1"))).toBe("BUF 17 – 24 KC");
    expect(scoreLine(game("1", { state: "pre" }))).toBe("BUF at KC");
  });
});

describe("mergeLeagues (plan 018, P5)", () => {
  const nfl = (id: string, score = 0) =>
    game(id, { home: { name: "Kansas City", shortName: "Chiefs", abbr: "KC", score, id: `h${id}` } });
  const epl = (id: string) => game(id, { leagueKey: "soccer/eng.1", league: "Premier League" });
  const mlb = (id: string) => game(id, { leagueKey: "baseball/mlb", league: "MLB" });
  const ids = (gs: readonly Game[]) => gs.map((g) => g.id);

  it("answers the asked leagues afresh, where they sat, and keeps the rest", () => {
    const prev = [mlb("m1"), nfl("n1", 3), nfl("n2"), epl("e1")];
    const out = mergeLeagues(prev, [nfl("n1", 10)], ["football/nfl"]);
    expect(ids(out)).toEqual(["m1", "n1", "e1"]);
    expect((out[1] as Fixture).home.score).toBe(10);
  });

  it("a league that answers nothing loses its games; one new to the list goes last", () => {
    const prev = [nfl("n1"), epl("e1")];
    expect(ids(mergeLeagues(prev, [mlb("m1")], ["football/nfl", "baseball/mlb"]))).toEqual(["e1", "m1"]);
  });
});

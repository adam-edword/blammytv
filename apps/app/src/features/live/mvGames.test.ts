import { describe, expect, it } from "vitest";
import { fillFrom, gameLabel, keepFailed, liveChannels, liveWithChannels, mergeLeagues, scoreLine } from "./mvGames";
import { indexChannels } from "../sports/matcher";
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

  it("skips a game already on the grid, whichever of its feeds is there (MV2)", () => {
    // Game 1 has two feeds, the best first. The grid has it on the second.
    const feeds = [
      { id: "c:1a", name: "ESPN" },
      { id: "c:1b", name: "ESPN 2" },
    ];
    const live = [game("1", { channels: feeds }), game("2")];
    expect(fillFrom(live, new Set(["c:1b"]), 3, none, new Set(["1"])).map((g) => g.id)).toEqual(["2"]);
    // Not a game id the grid doesn't hold.
    expect(fillFrom(live, new Set(["c:1b"]), 3, none, new Set(["9"])).map((g) => g.id)).toEqual(["1", "2"]);
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

  it("a league whose request failed keeps the games it had, where they sat (MV6)", () => {
    const prev = [mlb("m1"), nfl("n1", 3), nfl("n2"), epl("e1")];
    // MLB answered; the NFL's request threw; the Premier League answered with nothing on.
    const out = mergeLeagues(prev, [mlb("m2")], ["baseball/mlb", "football/nfl", "soccer/eng.1"], ["football/nfl"]);
    expect(ids(out)).toEqual(["m2", "n1", "n2"]);
    expect((out[1] as Fixture).home.score).toBe(3);
  });
});

describe("keepFailed (MV6, the full look)", () => {
  const nfl = (id: string, score = 0) =>
    game(id, { home: { name: "Kansas City", shortName: "Chiefs", abbr: "KC", score, id: `h${id}` } });
  const epl = (id: string) => game(id, { leagueKey: "soccer/eng.1", league: "Premier League" });
  const ids = (gs: readonly Game[]) => gs.map((g) => g.id);

  it("a league whose request failed keeps the games it had, after the fresh ones", () => {
    const prev = [nfl("n1", 3), epl("e1")];
    const out = keepFailed(prev, [epl("e2")], ["football/nfl"]);
    expect(ids(out)).toEqual(["e2", "n1"]);
    expect((out[1] as Fixture).home.score).toBe(3);
  });

  it("with nothing failed it is the fresh look as it came", () => {
    const fresh = [epl("e2")];
    expect(keepFailed([nfl("n1")], fresh, [])).toBe(fresh);
  });

  it("a league that answered nothing, or was not asked, is not brought back", () => {
    // The NFL answered with nothing on; baseball is no longer on the list.
    const prev = [nfl("n1"), game("m1", { leagueKey: "baseball/mlb" })];
    expect(ids(keepFailed(prev, [epl("e2")], ["soccer/eng.1"]))).toEqual(["e2"]);
  });
});

describe("liveChannels (v0.10.9)", () => {
  const catalog = indexChannels([{ id: "p:1", name: "US: ESPN HD", quality: "HD" }]);
  // As ESPN hands them over: no channels yet.
  const raw = (id: string, opts: Partial<Fixture> = {}) => game(id, { ch: "", ...opts });

  it("finds channels for the live games only; the rest go through untouched", () => {
    // Hours either side: three ESPN games at one kick-off would split its
    // odds three ways and keep it off all three cards (sharing.ts).
    const pre = raw("2", { state: "pre", start: new Date(2026, 8, 25, 23) });
    const done = raw("3", { state: "final", start: new Date(2026, 8, 25, 16) });
    const out = liveChannels([raw("1"), pre, done], catalog);
    expect(out[0].channels.map((c) => c.id)).toEqual(["p:1"]);
    expect(out[1]).toBe(pre);
    expect(out[2]).toBe(done);
  });

  it("splits a network's odds over the day's live games at one kick-off", () => {
    // Two live ESPN games at 8: neither card can claim ESPN (45 each).
    const out = liveChannels([raw("1"), raw("2")], catalog);
    expect(out.map((g) => [g.channels.length, g.shared])).toEqual([
      [0, { espn: 2 }],
      [0, { espn: 2 }],
    ]);
  });

  it("a new score on the same game reuses the answer rather than matching again", () => {
    const [a] = liveChannels([raw("1", { home: { name: "Kansas City", shortName: "Chiefs", abbr: "KC", score: 24, id: "h1" } })], catalog);
    const [b] = liveChannels([raw("1", { home: { name: "Kansas City", shortName: "Chiefs", abbr: "KC", score: 31, id: "h1" } })], catalog);
    expect((b as Fixture).home.score).toBe(31);
    // The same array: the answer was kept, not worked out again.
    expect(b.channels).toBe(a.channels);
  });

  it("a game whose broadcasts change is matched again", () => {
    const [a] = liveChannels([raw("5")], catalog);
    const [b] = liveChannels([raw("5", { broadcasts: ["ABC"] })], catalog);
    expect(a.channels.map((c) => c.id)).toEqual(["p:1"]);
    expect(b.channels).toEqual([]);
  });

  it("with no catalog yet, says the channels are pending, as the board does", () => {
    expect(liveChannels([raw("1")], null)[0].channelsPending).toBe(true);
  });
});

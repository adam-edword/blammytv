import { beforeEach, describe, expect, it } from "vitest";
import { filterSports, loadMvScores, rowGames, saveMvScores, setSport } from "./mvScores";
import { league } from "../sports/leagues";
import type { Fixture, Game } from "../sports/model";

const game = (id: string, leagueKey: string, opts: Partial<Fixture> = {}): Fixture => ({
  kind: "fixture",
  id,
  sport: leagueKey.split("/")[0],
  league: leagueKey,
  leagueKey,
  state: "live",
  start: new Date(2026, 8, 26, 20),
  status: "3rd 07:22",
  broadcasts: ["ESPN"],
  channels: [],
  home: { name: "Home", abbr: "HOM", score: 1, id: `h${id}` },
  away: { name: "Away", abbr: "AWY", score: 0, id: `a${id}` },
  ...opts,
});

describe("rowGames", () => {
  it("keeps what is live, in leagues not hidden, each league's games together", () => {
    const games: Game[] = [
      game("1", "football/nfl"),
      game("2", "baseball/mlb"),
      game("3", "football/nfl"),
      game("4", "football/nfl", { state: "final" }),
      game("5", "football/college-football"),
      game("6", "baseball/mlb", { state: "pre" }),
    ];
    const ids = rowGames(games, new Set(["football/college-football"])).map((g) => g.id);
    // NFL came first, so its two lead; MLB's one after; college hidden; the
    // final and the one not started yet are not in the row.
    expect(ids).toEqual(["1", "3", "2"]);
  });

  it("shows games with none of your channels too: the row is scores, not what you can tune", () => {
    expect(rowGames([game("1", "football/nfl", { channels: [] })], new Set()).map((g) => g.id)).toEqual(["1"]);
  });
});

describe("filterSports", () => {
  it("offers the sports of the leagues asked for, with only those leagues", () => {
    const asked = ["football/nfl", "baseball/mlb", "football/college-football"];
    const got = filterSports(asked);
    expect(got.map((s) => s.sport.key).sort()).toEqual(["baseball", "football"]);
    const football = got.find((s) => s.sport.key === "football")!;
    expect(football.leagues.map((l) => l.path).sort()).toEqual(["football/college-football", "football/nfl"]);
  });

  it("ignores a path the catalog doesn't know", () => {
    expect(league("nope/none")).toBeUndefined();
    expect(filterSports(["nope/none"])).toEqual([]);
  });
});

describe("setSport", () => {
  const football = filterSports(["football/nfl", "football/college-football"])[0].leagues;

  it("off hides every league of the sport, and keeps the others' state", () => {
    const hidden = setSport(["baseball/mlb"], football, false).sort();
    expect(hidden).toEqual(["baseball/mlb", "football/college-football", "football/nfl"]);
  });

  it("on shows every league of the sport again", () => {
    expect(setSport(["football/nfl", "baseball/mlb"], football, true)).toEqual(["baseball/mlb"]);
  });
});

describe("the saved setting", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  it("is off with nothing hidden until set, and round-trips", () => {
    expect(loadMvScores()).toEqual({ on: false, hidden: [] });
    saveMvScores({ on: true, hidden: ["football/nfl"] });
    expect(loadMvScores()).toEqual({ on: true, hidden: ["football/nfl"] });
  });
});

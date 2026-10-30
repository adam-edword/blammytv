import { describe, expect, it } from "vitest";
import { channelCards, followsAny, gamesOfSport, homeGames, playable, sportsToday } from "./liveData";
import type { Channel, LiveData, Programme } from "../live/model";
import type { Recording } from "../recordings/store";
import { toGames } from "../sports/espn";
import { isFixture } from "../sports/model";
import cfb from "../sports/fixtures/cfb-scoreboard.json";
import mlb from "../sports/fixtures/mlb-scoreboard.json";

const at = (h: number, m = 0) => new Date(2026, 8, 24, h, m);
const prog = (title: string, from: Date, to: Date): Programme => ({ title, start: from, end: to });
const chan = (id: string): Channel => ({ id, name: `Channel ${id}`, quality: null, folderId: "f", archiveDays: 0 });
const live = (programmes: Record<string, Programme[]>, ids = Object.keys(programmes)): LiveData =>
  ({
    groups: [],
    channels: ids.map(chan),
    programmes: new Map(Object.entries(programmes)),
  }) as LiveData;

describe("channelCards", () => {
  const data = live({
    a: [prog("News", at(20), at(21)), prog("Film", at(21), at(23))],
    b: [prog("Later", at(22), at(23))],
    c: [],
  });

  it("gives each channel what is on, what is next and how far through it is", () => {
    const [a] = channelCards(["a"], data, at(20, 15));
    expect(a.channel.id).toBe("a");
    expect(a.now?.title).toBe("News");
    expect(a.next?.title).toBe("Film");
    expect(a.pct).toBeCloseTo(0.25);
  });

  it("keeps the order asked for", () => {
    expect(channelCards(["c", "a", "b"], data, at(20)).map((c) => c.channel.id)).toEqual(["c", "a", "b"]);
  });

  it("has no bar when nothing is airing, and still says what comes", () => {
    const [b] = channelCards(["b"], data, at(20));
    expect(b.now).toBeNull();
    expect(b.pct).toBeNull();
    expect(b.next?.title).toBe("Later");
  });

  it("keeps a channel with no guide, as a card with nothing on it", () => {
    const [c] = channelCards(["c"], data, at(20));
    expect(c).toMatchObject({ now: null, next: null, pct: null });
  });

  it("drops an id the catalog no longer has, and everything without a catalog", () => {
    expect(channelCards(["gone", "a"], data, at(20)).map((c) => c.channel.id)).toEqual(["a"]);
    expect(channelCards(["a"], null, at(20))).toEqual([]);
    expect(channelCards([], data, at(20))).toEqual([]);
  });

  it("is at the start of the next programme when the last one ends", () => {
    const [a] = channelCards(["a"], data, at(21));
    expect(a.now?.title).toBe("Film");
    expect(a.pct).toBe(0);
  });
});

describe("homeGames", () => {
  const games = [...toGames(mlb, "baseball/mlb"), ...toGames(cfb, "football/college-football")];
  const none = { leagues: [], teams: [], conferences: [] };

  it("is only what you follow", () => {
    const got = homeGames(games, { ...none, leagues: ["baseball/mlb"] }, false);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((g) => g.leagueKey === "baseball/mlb")).toBe(true);
  });

  it("is nothing when nothing is followed: Home does not take the board's every league", () => {
    expect(homeGames(games, none, false)).toEqual([]);
  });

  it("holds fixtures only", () => {
    expect(homeGames(games, { ...none, leagues: ["baseball/mlb", "football/college-football"] }, false).every(isFixture)).toBe(true);
  });

  it("keeps a college game only if ranked, when Ranked Only is on, and leaves the pros alone", () => {
    const follows = { ...none, leagues: ["baseball/mlb", "football/college-football"] };
    const all = homeGames(games, follows, false);
    const ranked = homeGames(games, follows, true);
    expect(ranked.length).toBeLessThan(all.length);
    expect(ranked.filter((g) => g.leagueKey === "baseball/mlb")).toHaveLength(all.filter((g) => g.leagueKey === "baseball/mlb").length);
  });
});

describe("followsAny", () => {
  it("is true for a league, a club or a conference, and false for none", () => {
    expect(followsAny({ leagues: [], teams: [], conferences: [] })).toBe(false);
    expect(followsAny({ leagues: ["a"], teams: [], conferences: [] })).toBe(true);
    expect(followsAny({ leagues: [], teams: ["a:1"], conferences: [] })).toBe(true);
    expect(followsAny({ leagues: [], teams: [], conferences: ["a:1"] })).toBe(true);
  });
});

describe("playable", () => {
  const rec = (id: string, status: Recording["status"], startedAt: number): Recording =>
    ({ id, status, startedAt, channel: "c", programme: null, playlistId: "p", endedAt: null, path: "", bytes: 1, reason: null, buffer: false }) as Recording;

  it("is the recordings that finished, in the order given", () => {
    const list = [rec("run", "recording", 5), rec("a", "done", 4), rec("sch", "scheduled", 3), rec("b", "partial", 2), rec("fail", "failed", 1), rec("miss", "missed", 0)];
    expect(playable(list).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("stops at the cap", () => {
    const many = Array.from({ length: 30 }, (_, i) => rec(`r${i}`, "done", 100 - i));
    expect(playable(many)).toHaveLength(20);
    expect(playable(many, 3).map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
  });
});

describe("Today's Games by sport", () => {
  const games = [...toGames(mlb, "baseball/mlb"), ...toGames(cfb, "football/college-football")];
  const all = homeGames(games, { leagues: ["baseball/mlb", "football/college-football"], teams: [], conferences: [] }, false);

  it("holds only that sport's games: baseball's are not football's", () => {
    const baseball = gamesOfSport(all, "baseball");
    const football = gamesOfSport(all, "football");
    expect(baseball.length).toBeGreaterThan(0);
    expect(football.length).toBeGreaterThan(0);
    expect(baseball.every((g) => g.leagueKey === "baseball/mlb")).toBe(true);
    expect(football.every((g) => g.leagueKey === "football/college-football")).toBe(true);
    expect(baseball.length + football.length).toBe(all.length);
  });

  it("is every game with no sport named, and with one that has no games today", () => {
    expect(gamesOfSport(all)).toEqual(all);
    expect(gamesOfSport(all, "hockey")).toEqual(all);
  });

  it("lists the sports with games, in the catalog's order, with their counts and the app's names", () => {
    const got = sportsToday(all);
    expect(got.map((s) => s.key).sort()).toEqual(["baseball", "football"]);
    expect(got.find((s) => s.key === "football")?.name).toBe("American Football");
    expect(got.reduce((n, s) => n + s.count, 0)).toBe(all.length);
    expect(sportsToday([])).toEqual([]);
  });
});

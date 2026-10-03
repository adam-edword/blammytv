import { describe, expect, it } from "vitest";
import { sameShared, sharing } from "./sharing";
import type { Fixture } from "./model";

const game = (id: string, broadcasts: string[], start: Date): Fixture => ({
  kind: "fixture",
  id,
  sport: "football",
  league: "NFL",
  leagueKey: "football/nfl",
  state: "pre",
  start,
  status: "1:00 PM",
  home: { name: "Home", abbr: "HOM" },
  away: { name: "Away", abbr: "AWY" },
  broadcasts,
  channels: [],
});
const at = (h: number, m = 0) => new Date(2026, 9, 4, h, m);

describe("sharing", () => {
  it("counts the games on each network inside the window, this one included", () => {
    const board = [
      game("a", ["CBS"], at(13)),
      game("b", ["CBS", "NFL+"], at(13)),
      game("c", ["CBS"], at(14, 59)),
      game("d", ["FOX"], at(13)),
    ];
    const share = sharing(board);
    expect(share(board[0])).toEqual({ cbs: 3 });
    expect(share(board[1])).toEqual({ cbs: 3 });
    // FOX has one game: nothing to say.
    expect(share(board[3])).toBeUndefined();
  });

  it("leaves out games 2.5 hours or more away, either side", () => {
    // NFL's 1:00 and 4:25 slots, and an ESPN doubleheader 2.5 hours apart.
    const board = [
      game("early", ["CBS"], at(13)),
      game("late", ["CBS"], at(16, 25)),
      game("first", ["ESPN"], at(19, 30)),
      game("second", ["ESPN"], at(22)),
    ];
    const share = sharing(board);
    expect(board.map((g) => share(g) ?? null)).toEqual([null, null, null, null]);
  });

  it("matches networks by their normalized names", () => {
    const board = [game("a", ["FS1"], at(19)), game("b", ["FS 1"], at(19))];
    expect(sharing(board)(board[0])).toEqual({ "fs 1": 2 });
  });

  it("counts a game once, however many times the board lists it", () => {
    const b = game("b", ["CBS"], at(13));
    const board = [game("a", ["CBS"], at(13)), b, b];
    expect(sharing(board)(board[0])).toEqual({ cbs: 2 });
  });

  it("answers for networks a game doesn't list, counting itself on it", () => {
    // The curated map's fallback asks about a league's usual network.
    const board = [game("a", [], at(13)), game("b", ["Tennis Channel"], at(13))];
    expect(sharing(board)(board[0], ["Tennis Channel"])).toEqual({ "tennis channel": 2 });
  });
});

describe("sameShared", () => {
  it("compares by content", () => {
    expect(sameShared(undefined, undefined)).toBe(true);
    expect(sameShared({ cbs: 4 }, { cbs: 4 })).toBe(true);
    expect(sameShared({ cbs: 4 }, { cbs: 3 })).toBe(false);
    expect(sameShared({ cbs: 4 }, undefined)).toBe(false);
    expect(sameShared({ cbs: 4 }, { cbs: 4, fox: 2 })).toBe(false);
  });
});

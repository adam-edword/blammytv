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

  it("shares inside two hours and not at it: 119 apart do, 120 don't", () => {
    // ESPN's college basketball runs every two hours, and a two-hour
    // doubleheader doesn't share; 4:05 and 4:25 (NFL's late slot) do.
    const apart = (min: number) => {
      const board = [game("a", ["ESPN"], at(19)), game("b", ["ESPN"], at(19, min))];
      return board.map((g) => sharing(board)(g) ?? null);
    };
    expect(apart(119)).toEqual([{ espn: 2 }, { espn: 2 }]);
    expect(apart(120)).toEqual([null, null]);
    const late = [game("a", ["CBS"], at(16, 5)), game("b", ["CBS"], at(16, 25))];
    expect(late.map((g) => sharing(late)(g))).toEqual([{ cbs: 2 }, { cbs: 2 }]);
  });

  it("does not count a game that is over, for the others", () => {
    const over = { ...game("done", ["ESPN"], at(19)), state: "final" as const };
    const board = [over, game("live", ["ESPN"], at(19, 30))];
    const share = sharing(board);
    // The live game has the channel to itself.
    expect(share(board[1])).toBeUndefined();
    // The finished one still gets its own answer, as before: itself and the
    // live game beside it.
    expect(share(over)).toEqual({ espn: 2 });
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

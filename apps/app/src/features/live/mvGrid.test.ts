import { describe, expect, it } from "vitest";
import {
  arrive,
  swapToFront,
  stepSound,
  addPick,
  cellsFor,
  fullReason,
  leftLine,
  meterLine,
  removePick,
  replacePick,
  roomOn,
  searchChannels,
  type Pick,
  countKey,
  lineFor,
  settledOn,
  goneFrom,
  gameOver,
  SETTLED_AFTER_MS,
  GAME_KEEP_MS,
  GAME_MAX_MS,
} from "./mvGrid";
import type { Channel, LiveData } from "./model";

const pick = (id: string): Pick => ({ channelId: id, label: id.toUpperCase() });

describe("cellsFor", () => {
  it("opens on a single place to add the first", () => {
    expect(cellsFor(0)).toBe(1);
  });
  it("is exactly the streams after that: a lone stream fills the stage, with no place beside it", () => {
    expect(cellsFor(1)).toBe(1);
    expect(cellsFor(2)).toBe(2);
    expect(cellsFor(3)).toBe(3);
    expect(cellsFor(4)).toBe(4);
  });
});

describe("roomOn", () => {
  // Adam's line: three connections.
  const line = (active: number) => ({ max: 3, active });

  it("leaves what the limit leaves", () => {
    expect(roomOn(line(1), 1, true)).toEqual({ max: 3, elsewhere: 0, used: 1, left: 2 });
    expect(roomOn(line(3), 3, true).left).toBe(0);
  });

  it("counts a stream on another device against it, once the count has settled", () => {
    const r = roomOn(line(3), 2, true);
    expect(r.elsewhere).toBe(1);
    expect(r.left).toBe(0);
  });

  it("blames nobody else while the panel is still catching up", () => {
    // The grid just closed a tile; the panel still counts it.
    const r = roomOn(line(3), 2, false);
    expect(r.elsewhere).toBe(0);
    expect(r.left).toBe(1);
  });

  it("never goes past four, whatever the line allows", () => {
    expect(roomOn({ max: 10, active: 4 }, 4, true).left).toBe(0);
  });

  it("offers up to four when the provider reports no limit", () => {
    expect(roomOn(null, 2, true)).toEqual({ max: null, elsewhere: 0, used: 2, left: 2 });
  });

  it("does not go negative when the count lags behind the grid", () => {
    // A tile just opened and the panel has not counted it yet.
    expect(roomOn(line(1), 2, true).elsewhere).toBe(0);
  });
});

describe("the words", () => {
  it("meters the whole line first, as the Guide's pill does", () => {
    expect(meterLine(roomOn({ max: 3, active: 2 }, 2, true))).toBe("2 of 3 streams in use");
    // Two here, one on another device: three in use on the line.
    expect(meterLine(roomOn({ max: 3, active: 3 }, 2, true))).toBe(
      "3 of 3 streams in use · 1 elsewhere",
    );
    expect(meterLine(roomOn(null, 1, true))).toBe("1 stream");
  });

  it("does not count a stream the grid just closed as elsewhere", () => {
    // Closed a tile a moment ago; the panel still counts it.
    expect(meterLine(roomOn({ max: 3, active: 3 }, 2, false))).toBe("2 of 3 streams in use");
  });

  it("says why Add is off, and nothing while it is on", () => {
    expect(fullReason(roomOn({ max: 3, active: 1 }, 1, true))).toBeNull();
    expect(fullReason(roomOn({ max: 3, active: 3 }, 3, true))).toBe("Your line allows 3");
    expect(fullReason(roomOn({ max: 3, active: 3 }, 2, true))).toBe(
      "Your line allows 3, and 1 is in use elsewhere",
    );
    expect(fullReason(roomOn(null, 4, true))).toBe("Four is the most multi-view shows");
  });

  it("counts what is left in the picker", () => {
    expect(leftLine(roomOn({ max: 3, active: 1 }, 1, true))).toBe("2 more fit on your line");
    expect(leftLine(roomOn({ max: 3, active: 2 }, 2, true))).toBe("1 more fits on your line");
    expect(leftLine(roomOn({ max: 3, active: 3 }, 3, true))).toBe("Your line is full");
  });
});

describe("picks", () => {
  const room = roomOn({ max: 3, active: 1 }, 1, true);

  it("adds at the end, never twice, never past the room", () => {
    expect(addPick([pick("a")], pick("b"), room).map((p) => p.channelId)).toEqual(["a", "b"]);
    expect(addPick([pick("a")], pick("a"), room)).toHaveLength(1);
    const full = roomOn({ max: 3, active: 3 }, 3, true);
    expect(addPick([pick("a"), pick("b"), pick("c")], pick("d"), full)).toHaveLength(3);
  });

  it("replaces in place, and refuses a channel already in the grid", () => {
    const list = [pick("a"), pick("b"), pick("c")];
    expect(replacePick(list, "b", pick("x")).map((p) => p.channelId)).toEqual(["a", "x", "c"]);
    expect(replacePick(list, "b", pick("c"))).toBe(list);
  });

  it("removes by id", () => {
    expect(removePick([pick("a"), pick("b")], "a").map((p) => p.channelId)).toEqual(["b"]);
  });
});

describe("arrive", () => {
  const ids = (a: ReturnType<typeof arrive>) => (a.kind === "add" ? a.picks.map((p) => p.channelId) : a.kind);

  it("joins the grid you left, at the end, while the line has room", () => {
    expect(ids(arrive([pick("a"), pick("b")], pick("x"), roomOn({ max: 3, active: 2 }, 2, true)))).toEqual([
      "a",
      "b",
      "x",
    ]);
  });
  it("is only the sound when it is already there, full or not", () => {
    const list = [pick("a"), pick("b"), pick("c")];
    expect(arrive(list, pick("b"), roomOn({ max: 3, active: 3 }, 3, true)).kind).toBe("here");
  });
  it("asks for a tile when the line is full, or at four", () => {
    const three = [pick("a"), pick("b"), pick("c")];
    expect(arrive(three, pick("x"), roomOn({ max: 3, active: 3 }, 3, true)).kind).toBe("full");
    const four = [...three, pick("d")];
    expect(arrive(four, pick("x"), roomOn(null, 4, true)).kind).toBe("full");
  });
  it("counts a stream elsewhere against the room", () => {
    const two = [pick("a"), pick("b")];
    expect(arrive(two, pick("x"), roomOn({ max: 3, active: 3 }, 2, true)).kind).toBe("full");
  });
  it("always takes it into an empty grid, where there is no tile to choose", () => {
    expect(ids(arrive([], pick("x"), roomOn({ max: 2, active: 2 }, 0, true)))).toEqual(["x"]);
  });
});

describe("searchChannels", () => {
  const ch = (id: string, name: string, number?: number): Channel => ({
    id,
    name,
    number,
    quality: null,
    folderId: "f",
    archiveDays: 0,
  });
  const live: LiveData = {
    groups: [],
    programmes: new Map(),
    channels: [
      ch("1", "US: Cartoon Network", 209),
      ch("2", "US: Cartoon Network West", 210),
      ch("3", "CNN", 20),
      ch("4", "Channel 209 Extra", 5),
    ],
  };

  it("matches any part of the name, case aside", () => {
    expect(searchChannels(live, "cartoon").map((c) => c.id)).toEqual(["1", "2"]);
    expect(searchChannels(live, "CNN").map((c) => c.id)).toEqual(["3"]);
  });

  it("puts a channel whose number it is first", () => {
    expect(searchChannels(live, "209").map((c) => c.id)).toEqual(["1", "4"]);
  });

  it("returns nothing for nothing, and stops at the limit", () => {
    expect(searchChannels(live, "  ")).toEqual([]);
    expect(searchChannels(live, "n", 2)).toHaveLength(2);
  });
});

describe("swapToFront", () => {
  const p = (id: string) => ({ channelId: id, label: id });
  it("swaps the chosen tile into the big spot, and nothing else moves", () => {
    const out = swapToFront([p("a"), p("b"), p("c"), p("d")], "c");
    expect(out.map((x) => x.channelId)).toEqual(["c", "b", "a", "d"]);
  });
  it("leaves the list alone when it is already first or not there", () => {
    const list = [p("a"), p("b")];
    expect(swapToFront(list, "a")).toBe(list);
    expect(swapToFront(list, "zz")).toBe(list);
  });
});

describe("stepSound", () => {
  const ids = ["a", "b", "c", "d"];
  it("moves along and wraps", () => {
    expect(stepSound(ids, new Set(), "b", 1)).toBe("c");
    expect(stepSound(ids, new Set(), "d", 1)).toBe("a");
    expect(stepSound(ids, new Set(), "a", -1)).toBe("d");
  });
  it("skips a tile that can't take the sound", () => {
    expect(stepSound(ids, new Set(["c"]), "b", 1)).toBe("d");
    expect(stepSound(ids, new Set(["a"]), "b", -1)).toBe("d");
  });
  it("starts from an end when nothing has it, and gives up when nothing can", () => {
    expect(stepSound(ids, new Set(), null, 1)).toBe("a");
    expect(stepSound(ids, new Set(), null, -1)).toBe("d");
    expect(stepSound(ids, new Set(), "gone", -1)).toBe("d");
    expect(stepSound(ids, new Set(["b", "c", "d"]), "a", 1)).toBeNull();
  });
});

describe("the line's count (plan 018, H2)", () => {
  const p = (id: string, extra: Partial<Pick> = {}): Pick => ({ channelId: id, label: id, ...extra });

  it("is keyed on the set of channels: a Focus swap isn't a change (L2)", () => {
    expect(countKey([p("t:1"), p("t:2")])).toBe(countKey([p("t:2"), p("t:1")]));
    expect(countKey([p("t:1")])).not.toBe(countKey([p("t:1"), p("t:2")]));
  });

  it("holds the grid to the one line only when every tile is on it (L4)", () => {
    const conns = new Map([["t", { max: 1, active: 0 }]]);
    expect(lineFor(conns, [p("t:1"), p("t:2")])).toEqual({ max: 1, active: 0 });
    expect(lineFor(conns, [])).toEqual({ max: 1, active: 0 });
    // An M3U tile beside it: no single cap describes the grid.
    expect(lineFor(conns, [p("t:1"), p("m:9")])).toBeNull();
    // Two lines answering: none either.
    expect(lineFor(new Map([["t", 1], ["u", 2]]), [p("t:1")])).toBeNull();
  });

  it("believes 'elsewhere' only from a count taken long enough after the change (L3)", () => {
    expect(settledOn({ at: 1000 + SETTLED_AFTER_MS }, 1000)).toBe(true);
    expect(settledOn({ at: 1000 + SETTLED_AFTER_MS - 1 }, 1000)).toBe(false);
    // Taken before the change: never, however long ago the change was.
    expect(settledOn({ at: 500 }, 1000)).toBe(false);
    expect(settledOn(null, 0)).toBe(false);
  });
});

describe("goneFrom (plan 018, L5)", () => {
  const inCatalog = (id: string) => id === "t:1";
  it("drops a tile whose playlist loaded without it", () => {
    expect(goneFrom(["t"], "t:2", inCatalog)).toBe(true);
    expect(goneFrom(["t"], "t:1", inCatalog)).toBe(false);
  });
  it("keeps a tile whose playlist failed to load: it says nothing about its channels", () => {
    expect(goneFrom(["m"], "t:2", inCatalog)).toBe(false);
  });
});

describe("gameOver (plan 018, L9)", () => {
  const game = (start?: number): Pick => ({ channelId: "t:1", label: "BUF at KC", gameId: "g1", league: "football/nfl", start });
  const now = 100 * GAME_MAX_MS;
  it("half an hour after the board first called it final", () => {
    expect(gameOver(game(now - 3600_000), now, now - GAME_KEEP_MS, true, true)).toBe(true);
    expect(gameOver(game(now - 3600_000), now, now - GAME_KEEP_MS + 1, true, true)).toBe(false);
  });
  it("or 12 hours after it started, whether the board says or not", () => {
    expect(gameOver(game(now - GAME_MAX_MS), now, undefined, true, false)).toBe(true);
    // Still on the board's day or not, a game that started an hour ago stays.
    expect(gameOver(game(now - 3600_000), now, undefined, true, false)).toBe(false);
  });
  it("a tile saved before its start was kept goes when the board no longer has it", () => {
    expect(gameOver(game(), now, undefined, true, false)).toBe(true);
    expect(gameOver(game(), now, undefined, false, false)).toBe(false);
    expect(gameOver(game(), now, undefined, true, true)).toBe(false);
  });
  it("a channel tile is never a game", () => {
    expect(gameOver({ channelId: "t:1", label: "ESPN" }, now, 0, true, false)).toBe(false);
  });
});

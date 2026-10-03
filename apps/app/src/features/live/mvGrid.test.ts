import { describe, expect, it } from "vitest";
import {
  placeFor,
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
  lineOfChannel,
  settledOn,
  goneFrom,
  offPlaylist,
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

  it("says what the grid has room for when several sources are enabled, not a limit it can't state (MV1)", () => {
    // Several sources: no single line, so roomOn has no limit to report.
    expect(leftLine(roomOn(null, 2, true), true)).toBe("2 more fit in the grid");
    expect(leftLine(roomOn(null, 3, true), true)).toBe("1 more fits in the grid");
    expect(leftLine(roomOn(null, 4, true), true)).toBe("The grid is full");
    // And one source says what it always did.
    expect(leftLine(roomOn(null, 2, true), false)).toBe("Your provider doesn’t report a limit");
  });
});

describe("picks", () => {
  it("adds at the end, and never twice (whether there is room is placeFor's call)", () => {
    expect(addPick([pick("a")], pick("b")).map((p) => p.channelId)).toEqual(["a", "b"]);
    expect(addPick([pick("a")], pick("a"))).toHaveLength(1);
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

describe("placeFor on one source (arrive's rules, before MV1)", () => {
  // The grid is on the one line "t": every tile is on it, and it is the grid's.
  const grid = (...ids: string[]) => ids.map((i) => pick(`t:${i}`));
  const reading = (max: number, active: number, settled = true) => new Map([["t", { max, active, at: settled ? SETTLED_AFTER_MS : 0 }]]);
  const place = (list: Pick[], id: string, conns: ReturnType<typeof reading>) => placeFor(pick(`t:${id}`), list, conns, 0);

  it("joins the grid you left, at the end, while the line has room", () => {
    expect(place(grid("a", "b"), "x", reading(3, 2)).kind).toBe("add");
  });
  it("is only the sound when it is already there, full or not", () => {
    expect(place(grid("a", "b", "c"), "b", reading(3, 3)).kind).toBe("here");
  });
  it("asks for a tile when the line is full, or at four", () => {
    const three = grid("a", "b", "c");
    expect(place(three, "x", reading(3, 3))).toEqual({ kind: "replace", among: ["t:a", "t:b", "t:c"] });
    const four = grid("a", "b", "c", "d");
    expect(place(four, "x", new Map())).toEqual({ kind: "replace", among: ["t:a", "t:b", "t:c", "t:d"] });
  });
  it("counts a stream elsewhere against the room", () => {
    expect(place(grid("a", "b"), "x", reading(3, 3)).kind).toBe("replace");
  });
  it("does not blame a stream the grid just closed on someone else", () => {
    expect(place(grid("a", "b"), "x", reading(3, 3, false)).kind).toBe("add");
  });
  it("always takes it into an empty grid, where there is no tile to choose", () => {
    expect(place([], "x", reading(2, 2)).kind).toBe("add");
  });

  it("gives what roomOn and the old arrive gave, over every grid, line and count", () => {
    for (let max = 1; max <= 5; max++)
      for (let active = 0; active <= max; active++)
        for (let n = 0; n <= 4; n++)
          for (const settled of [true, false]) {
            const list = grid(...["a", "b", "c", "d"].slice(0, n));
            const old = n === 0 ? "add" : roomOn({ max, active }, n, settled).left > 0 ? "add" : "replace";
            const now = place(list, "x", reading(max, active, settled));
            expect(now.kind, JSON.stringify({ max, active, n, settled })).toBe(old);
            if (now.kind === "replace") expect(now.among).toEqual(list.map((p) => p.channelId));
          }
  });
  it("and with no reading, what roomOn gives a provider with no limit", () => {
    for (let n = 0; n <= 4; n++) {
      const list = grid(...["a", "b", "c", "d"].slice(0, n));
      const old = n === 0 || roomOn(null, n, true).left > 0 ? "add" : "replace";
      expect(place(list, "x", new Map()).kind).toBe(old);
    }
  });
});

describe("placeFor, room per line (audit MV1)", () => {
  // Two lines: "a" allows one stream, "b" allows five. "m" is an M3U, with no count.
  const at = SETTLED_AFTER_MS;
  const conns = (a: [number, number] = [0, 1], b: [number, number] = [0, 5]) =>
    new Map([
      ["a", { active: a[0], max: a[1], at }],
      ["b", { active: b[0], max: b[1], at }],
    ]);
  const grid = (...ids: string[]) => ids.map((i) => pick(i));

  it("is here for a channel already on the grid, whatever else is true", () => {
    expect(placeFor(pick("a:1"), grid("a:1"), conns(), 0)).toEqual({ kind: "here" });
  });

  it("takes anything into an empty grid, even on a line that is full", () => {
    expect(placeFor(pick("a:1"), [], conns([1, 1]), 0)).toEqual({ kind: "add" });
  });

  it("every tile on the line of one: another on that line replaces one of those tiles", () => {
    expect(placeFor(pick("a:2"), grid("a:1"), conns(), 0)).toEqual({ kind: "replace", among: ["a:1"] });
  });

  it("and a channel on the other line is added", () => {
    expect(placeFor(pick("b:1"), grid("a:1"), conns(), 0)).toEqual({ kind: "add" });
  });

  it("a full line replaces only its own tiles, not the ones on the other line", () => {
    const list = grid("a:1", "b:1", "b:2");
    expect(placeFor(pick("a:2"), list, conns(), 0)).toEqual({ kind: "replace", among: ["a:1"] });
    // The roomy line still adds, and counts only its own tiles.
    expect(placeFor(pick("b:3"), list, conns(), 0)).toEqual({ kind: "add" });
  });

  it("a line with room adds while the grid is under four, and replaces any tile at four", () => {
    expect(placeFor(pick("b:3"), grid("a:1", "b:1", "b:2"), conns(), 0).kind).toBe("add");
    expect(placeFor(pick("b:4"), grid("a:1", "b:1", "b:2", "b:3"), conns(), 0)).toEqual({
      kind: "replace",
      among: ["a:1", "b:1", "b:2", "b:3"],
    });
  });

  it("a line of two with both tiles on the grid is full for a third of its channels", () => {
    expect(placeFor(pick("a:3"), grid("a:1", "a:2", "b:1"), conns([0, 2]), 0)).toEqual({
      kind: "replace",
      among: ["a:1", "a:2"],
    });
  });

  it("a line full of other devices' streams, with none of the grid's on it, adds while the grid has room", () => {
    // Line a: one allowed, one in use, none of it the grid's (once settled).
    expect(placeFor(pick("a:1"), grid("b:1"), conns([1, 1]), 0)).toEqual({ kind: "add" });
    // And at four, any tile may go.
    expect(placeFor(pick("a:1"), grid("b:1", "b:2", "b:3", "b:4"), conns([1, 1]), 0)).toEqual({
      kind: "replace",
      among: ["b:1", "b:2", "b:3", "b:4"],
    });
  });

  it("believes a stream elsewhere only once the count has settled (L3)", () => {
    // Line b allows two; the grid has one tile on it and the panel says two are open.
    const list = grid("b:1");
    const reading = (taken: number) => new Map([["b", { active: 2, max: 2, at: taken }]]);
    expect(placeFor(pick("b:2"), list, reading(SETTLED_AFTER_MS), 0)).toEqual({ kind: "replace", among: ["b:1"] });
    expect(placeFor(pick("b:2"), list, reading(SETTLED_AFTER_MS - 1), 0)).toEqual({ kind: "add" });
  });

  it("a channel with no line to count against has all the room it likes, until four", () => {
    // The M3U, a portal, or a panel that hasn't answered.
    expect(placeFor(pick("m:1"), grid("a:1"), conns(), 0)).toEqual({ kind: "add" });
    expect(placeFor(pick("a:2"), grid("a:1"), new Map(), 0)).toEqual({ kind: "add" });
    expect(placeFor(pick("m:1"), grid("a:1", "a:2", "b:1", "b:2"), conns(), 0).kind).toBe("replace");
  });

  it("a tile with no line is not on any line's count", () => {
    // The M3U tile doesn't use up line a's one stream.
    expect(placeFor(pick("a:1"), grid("m:1"), conns(), 0)).toEqual({ kind: "add" });
  });

  it("a playlist id that is only a prefix of the channel's is not its line", () => {
    expect(placeFor(pick("ab:1"), grid("a:1"), conns(), 0)).toEqual({ kind: "add" });
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

  it("holds the grid to the one source's line, when it is the only one enabled (L4)", () => {
    const conns = new Map([["t", { max: 1, active: 0 }]]);
    expect(lineFor(conns, [p("t:1"), p("t:2")], ["t"])).toEqual({ max: 1, active: 0 });
    // Nothing on the grid yet: it is still that source's grid.
    expect(lineFor(conns, [], ["t"])).toEqual({ max: 1, active: 0 });
    // An M3U beside it, enabled: no single cap describes the grid, whichever tiles are on it.
    expect(lineFor(conns, [p("t:1"), p("m:9")], ["t", "m"])).toBeNull();
    expect(lineFor(conns, [p("t:1")], ["t", "m"])).toBeNull();
    expect(lineFor(conns, [p("m:9")], ["t", "m"])).toBeNull();
    // A tile on a playlist switched off a moment ago is not the source's to count.
    expect(lineFor(conns, [p("t:1"), p("m:9")], ["t"])).toBeNull();
    // A playlist id that is only a prefix of the tile's.
    expect(lineFor(conns, [p("tt:1")], ["t"])).toBeNull();
  });

  it("with two sources enabled there is no cap, however the tiles are spread (MV1)", () => {
    const conns = new Map([["t", { max: 1, active: 0 }], ["u", { max: 5, active: 0 }]]);
    const both = ["t", "u"];
    expect(lineFor(conns, [], both)).toBeNull();
    // Every tile on the line of one, or of five: neither caps the grid.
    expect(lineFor(conns, [p("t:1")], both)).toBeNull();
    expect(lineFor(conns, [p("u:1"), p("u:2")], both)).toBeNull();
    expect(lineFor(conns, [p("t:1"), p("u:1")], both)).toBeNull();
    // An Xtream line beside a portal or an M3U that has no count.
    expect(lineFor(new Map([["t", { max: 1, active: 0 }]]), [p("t:1")], ["t", "s"])).toBeNull();
  });

  it("the only source takes the line only if it answered (MV1)", () => {
    const conns = new Map([["t", { max: 1, active: 0 }]]);
    // The one enabled playlist is not the one that answered, or none did.
    expect(lineFor(conns, [], ["m"])).toBeNull();
    expect(lineFor(new Map(), [], ["t"])).toBeNull();
    // A reading kept for a playlist since switched off isn't the grid's line.
    const kept = new Map([["t", { max: 1, active: 0 }], ["u", { max: 5, active: 0 }]]);
    expect(lineFor(kept, [], ["u"])).toEqual({ max: 5, active: 0 });
  });

  it("finds one tile's own line, whatever else is in the grid", () => {
    const conns = new Map([["t", { max: 1, active: 1 }], ["u", { max: 2, active: 0 }]]);
    expect(lineOfChannel(conns, "t:1")).toEqual({ max: 1, active: 1 });
    expect(lineOfChannel(conns, "u:7")).toEqual({ max: 2, active: 0 });
    // A source with no count, and a playlist id that is only a prefix.
    expect(lineOfChannel(conns, "m:9")).toBeNull();
    expect(lineOfChannel(conns, "tt:1")).toBeNull();
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

describe("offPlaylist (MV3)", () => {
  it("is a tile whose playlist is not among the enabled ones: deleted, or switched off", () => {
    expect(offPlaylist(["t", "m"], "t:101")).toBe(false);
    expect(offPlaylist(["t", "m"], "m:espn")).toBe(false);
    expect(offPlaylist(["t"], "m:espn")).toBe(true);
    expect(offPlaylist([], "t:101")).toBe(true);
  });
  it("goes by the whole playlist id, not the start of it", () => {
    expect(offPlaylist(["t"], "tt:101")).toBe(true);
    expect(offPlaylist(["tt"], "t:101")).toBe(true);
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

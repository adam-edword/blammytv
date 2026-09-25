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
} from "./mvGrid";
import type { Channel, LiveData } from "./model";

const pick = (id: string): Pick => ({ channelId: id, label: id.toUpperCase() });

describe("cellsFor", () => {
  it("opens on a single place to add the first", () => {
    expect(cellsFor(0, 3)).toBe(1);
  });
  it("puts a place for the next beside a lone stream, while there is room", () => {
    expect(cellsFor(1, 2)).toBe(2);
    expect(cellsFor(1, 0)).toBe(1);
  });
  it("is exactly the streams from two on", () => {
    expect(cellsFor(2, 1)).toBe(2);
    expect(cellsFor(3, 0)).toBe(3);
    expect(cellsFor(4, 0)).toBe(4);
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

import { describe, expect, it } from "vitest";
import type { RecRecord } from "../../lib/tauri";
import { PAD_MS, clash, endsBefore, handOver, overlapping, programmeAction, scheduleKey } from "./schedule";

const MIN = 60_000;
const NOW = 1_000 * MIN;

const rec = (o: Partial<RecRecord> & { id: string }): RecRecord => ({
  channel: "BBC One",
  programme: null,
  playlistId: "p1",
  startedAt: NOW,
  endedAt: null,
  path: "C:\\v\\a.ts",
  bytes: 0,
  status: "recording",
  reason: null,
  buffer: false,
  ...o,
});

/** A scheduled recording of the programme `from`..`to`, padded as native does. */
const planned = (id: string, from: number, to: number, o: Partial<RecRecord> = {}): RecRecord =>
  rec({
    id,
    status: "scheduled",
    path: "",
    channelId: "p1:7",
    startedAt: from,
    startAt: from - PAD_MS,
    stopAt: to + PAD_MS,
    ...o,
  });

describe("the padding", () => {
  it("is the minute rec.rs adds either side", () => {
    expect(PAD_MS).toBe(60_000);
  });
});

describe("overlapping", () => {
  it("counts scheduled and running recordings of the line that meet the span", () => {
    const list = [
      planned("a", NOW + 60 * MIN, NOW + 120 * MIN),
      rec({ id: "b", startedAt: NOW - 5 * MIN }), // running, nothing to end it
      rec({ id: "c", startedAt: NOW - 5 * MIN, stopAt: NOW + 80 * MIN }),
    ];
    expect(overlapping(list, "p1", NOW + 90 * MIN, NOW + 150 * MIN)).toBe(2); // a and b
    expect(overlapping(list, "p1", NOW, NOW + 10 * MIN)).toBe(2); // b and c
  });

  it("leaves out other lines, the player's own buffer, and anything that has ended", () => {
    const list = [
      rec({ id: "other", playlistId: "p2" }),
      rec({ id: "buffer", buffer: true }),
      rec({ id: "done", status: "done" }),
      rec({ id: "partial", status: "partial" }),
      rec({ id: "failed", status: "failed" }),
      planned("missed", NOW + 60 * MIN, NOW + 90 * MIN, { status: "missed" }),
      planned("failed-plan", NOW + 60 * MIN, NOW + 90 * MIN, { status: "failed" }),
    ];
    expect(overlapping(list, "p1", NOW, NOW + 200 * MIN)).toBe(0);
  });

  it("does not count a recording that ends as the span begins, by its programme and not its padding", () => {
    const list = [planned("a", NOW + 60 * MIN, NOW + 90 * MIN)];
    const stops = NOW + 90 * MIN;
    expect(overlapping(list, "p1", stops, stops + 30 * MIN)).toBe(0);
    expect(overlapping(list, "p1", stops - 1, stops + 30 * MIN)).toBe(1);
    const starts = NOW + 60 * MIN;
    expect(overlapping(list, "p1", starts - 30 * MIN, starts)).toBe(0);
    expect(overlapping(list, "p1", starts - 30 * MIN, starts + 1)).toBe(1);
  });

  it("does not count the minute a running recording has left in its padding", () => {
    const end = NOW + 10 * MIN;
    const list = [rec({ id: "a", stopAt: end + PAD_MS })];
    expect(overlapping(list, "p1", end, end + 30 * MIN)).toBe(0);
    expect(overlapping(list, "p1", end - 1, end + 30 * MIN)).toBe(1);
  });
});

describe("clash", () => {
  const from = NOW + 60 * MIN;
  const to = NOW + 90 * MIN;

  it("says nothing when the line reports no limit", () => {
    const list = [rec({ id: "a" }), rec({ id: "b" })];
    expect(clash(list, null, "p1", from, to)).toBeNull();
    expect(clash(list, undefined, "p1", from, to)).toBeNull();
  });

  it("says nothing while the line has a connection to spare", () => {
    expect(clash([], { max: 1 }, "p1", from, to)).toBeNull();
    expect(clash([rec({ id: "a" })], { max: 2 }, "p1", from, to)).toBeNull();
    // Recording on another line is no one's business here.
    expect(clash([rec({ id: "a", playlistId: "p2" })], { max: 1 }, "p1", from, to)).toBeNull();
  });

  it("says so, with the numbers, when one more would be too many", () => {
    expect(clash([rec({ id: "a" })], { max: 1 }, "p1", from, to)).toBe(
      "1 other recording overlaps this one, and your line allows 1 stream at once",
    );
    const two = [rec({ id: "a" }), planned("b", NOW + 70 * MIN, NOW + 80 * MIN)];
    expect(clash(two, { max: 2 }, "p1", from, to)).toBe(
      "2 other recordings overlap this one, and your line allows 2 streams at once",
    );
  });

  it("counts a recording scheduled for later but meeting the span, not one before it", () => {
    const before = [planned("a", NOW + 10 * MIN, NOW + 30 * MIN)];
    const meets = [planned("a", NOW + 80 * MIN, NOW + 100 * MIN)];
    expect(clash(before, { max: 1 }, "p1", from, to)).toBeNull();
    expect(clash(meets, { max: 1 }, "p1", from, to)).not.toBeNull();
  });

  it("is no clash for two programmes back to back on a one-stream line, padding or not", () => {
    const one = { max: 1 };
    const first = planned("a", from, to); // padded either side, as native keeps it
    expect(clash([first], one, "p1", to, to + 30 * MIN)).toBeNull();
    expect(clash([first], one, "p1", from - 30 * MIN, from)).toBeNull();
    // A programme that really does overlap still is one.
    expect(clash([first], one, "p1", to - 1, to + 30 * MIN)).not.toBeNull();
    // And so is the recording that is running its last minute of padding.
    const running = rec({ id: "r", startedAt: from - 5 * MIN, stopAt: to + PAD_MS });
    expect(clash([running], one, "p1", to, to + 30 * MIN)).toBeNull();
  });
});

describe("a line handed over when only the padding is in the way", () => {
  const T = NOW + 30 * MIN; // the next programme starts here
  const early = (id: string, end: number, o: Partial<RecRecord> = {}) =>
    rec({ id, startedAt: end - 30 * MIN - PAD_MS, stopAt: end + PAD_MS, ...o });

  it("finds the running recordings of the line whose programme is over by then, soonest first", () => {
    const list = [
      early("late", T),
      early("sooner", T - 5 * MIN),
      early("overlaps", T + 1), // still on at T: no
      rec({ id: "no-end" }), // nothing ends it: no
      early("buffer", T, { buffer: true }),
      early("other-line", T, { playlistId: "p2" }),
      early("done", T, { status: "done" }),
    ];
    expect(endsBefore(list, "p1", T).map((r) => r.id)).toEqual(["sooner", "late"]);
  });

  it("stops the earlier recording at its programme's end when that makes room", () => {
    const list = [early("a", T)];
    expect(handOver(list, { max: 1 }, "p1", T)).toEqual({ stop: ["a"], at: T });
  });

  it("stops only as many as it takes, the soonest first", () => {
    const list = [early("a", T), early("b", T - 5 * MIN), early("c", T - 2 * MIN)];
    expect(handOver(list, { max: 3 }, "p1", T)).toEqual({ stop: ["b"], at: T - 5 * MIN });
    expect(handOver(list, { max: 2 }, "p1", T)).toEqual({ stop: ["b", "c"], at: T - 2 * MIN });
  });

  it("leaves it alone when there is room, when the line says nothing, or when stopping would not help", () => {
    expect(handOver([early("a", T)], { max: 2 }, "p1", T)).toBeNull();
    expect(handOver([early("a", T)], null, "p1", T)).toBeNull();
    expect(handOver([early("a", T)], undefined, "p1", T)).toBeNull();
    // Full of a recording that is still on at T: the start will say so.
    expect(handOver([early("a", T), early("on", T + 10 * MIN)], { max: 1 }, "p1", T)).toBeNull();
    expect(handOver([], { max: 1 }, "p1", T)).toBeNull();
  });
});

describe("what the menu offers for a programme", () => {
  const p = { channelId: "p1:7", playlistId: "p1", channel: "BBC One" };
  const later = { ...p, start: NOW + 60 * MIN, end: NOW + 90 * MIN };
  const on = { ...p, start: NOW - 10 * MIN, end: NOW + 20 * MIN };

  it("offers Record for a programme to come, and for one that is on", () => {
    expect(programmeAction([], later, NOW)).toEqual({ kind: "record", label: "Record" });
    expect(programmeAction([], on, NOW)).toEqual({ kind: "record", label: "Record" });
  });

  it("offers nothing for a programme that is over", () => {
    expect(programmeAction([], { ...p, start: NOW - 60 * MIN, end: NOW }, NOW)).toBeNull();
    expect(programmeAction([], { ...p, start: NOW - 60 * MIN, end: NOW - 1 }, NOW)).toBeNull();
  });

  it("offers Cancel Recording, with the record's id, for a scheduled one", () => {
    const list = [planned("s1", later.start, later.end)];
    expect(programmeAction(list, later, NOW)).toEqual({
      kind: "cancel",
      label: "Cancel Recording",
      id: "s1",
    });
  });

  it("matches the programme by its channel and its times, not by its channel alone", () => {
    const list = [planned("s1", later.start, later.end)];
    const next = { ...later, start: later.end, end: later.end + 30 * MIN };
    expect(programmeAction(list, next, NOW)?.kind).toBe("record");
    expect(programmeAction(list, { ...later, channelId: "p1:8" }, NOW)?.kind).toBe("record");
  });

  it("still offers Cancel Recording when a guide refresh moved the programme's start", () => {
    const list = [planned("s1", later.start, later.end)];
    const moved = { ...later, start: later.start + 5 * MIN, end: later.end + 5 * MIN };
    expect(programmeAction(list, moved, NOW)).toEqual({ kind: "cancel", label: "Cancel Recording", id: "s1" });
  });

  it("says Recording, not Record, in the minute before a scheduled start, once native has begun it", () => {
    // Native began it a minute early: it is a running record with no channel id, and the
    // programme has not started yet.
    const soon = { ...p, start: NOW + 30_000, end: NOW + 30 * MIN };
    const running = rec({
      id: "r",
      startedAt: NOW - 30_000,
      stopAt: soon.end + PAD_MS,
      channel: "BBC One",
      playlistId: "p1",
    });
    expect(programmeAction([running], soon, NOW)).toEqual({ kind: "recording", label: "Recording" });
    // The programme after it is its own.
    const next = { ...soon, start: soon.end, end: soon.end + 30 * MIN };
    expect(programmeAction([running], next, NOW)?.kind).toBe("record");
  });

  it("does not offer Cancel Recording for a missed or failed one", () => {
    for (const status of ["missed", "failed"] as const) {
      const list = [planned("s1", later.start, later.end, { status })];
      expect(programmeAction(list, later, NOW)?.kind).toBe("record");
    }
  });

  it("says Recording, off, for a programme that is on while its channel is being recorded", () => {
    const list = [rec({ id: "r", channel: "BBC One", playlistId: "p1" })];
    expect(programmeAction(list, on, NOW)).toEqual({ kind: "recording", label: "Recording" });
    // A programme to come is still worth keeping.
    expect(programmeAction(list, later, NOW)?.kind).toBe("record");
    // And another channel's recording is not this one's.
    expect(programmeAction([rec({ id: "r", channel: "ITV" })], on, NOW)?.kind).toBe("record");
  });
});

describe("scheduleKey", () => {
  it("names a programme by its channel and its start", () => {
    expect(scheduleKey("p1:7", 5)).toBe(scheduleKey("p1:7", 5));
    expect(scheduleKey("p1:7", 5)).not.toBe(scheduleKey("p1:7", 6));
    expect(scheduleKey("p1:7", 5)).not.toBe(scheduleKey("p1:8", 5));
  });
});

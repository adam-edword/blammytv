import { describe, expect, it } from "vitest";
import type { RecRecord } from "../../lib/tauri";
import { PAD_MS, clash, overlapping, programmeAction, scheduleKey } from "./schedule";

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

  it("does not count a recording that ends as the span begins", () => {
    const list = [planned("a", NOW + 60 * MIN, NOW + 90 * MIN)];
    const stops = NOW + 90 * MIN + PAD_MS;
    expect(overlapping(list, "p1", stops, stops + 30 * MIN)).toBe(0);
    expect(overlapping(list, "p1", stops - 1, stops + 30 * MIN)).toBe(1);
    const starts = NOW + 60 * MIN - PAD_MS;
    expect(overlapping(list, "p1", starts - 30 * MIN, starts)).toBe(0);
    expect(overlapping(list, "p1", starts - 30 * MIN, starts + 1)).toBe(1);
  });
});

describe("clash", () => {
  const from = NOW + 60 * MIN - PAD_MS;
  const to = NOW + 90 * MIN + PAD_MS;

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

  it("matches the programme by its channel and its start, not by its channel alone", () => {
    const list = [planned("s1", later.start, later.end)];
    const next = { ...later, start: later.end, end: later.end + 30 * MIN };
    expect(programmeAction(list, next, NOW)?.kind).toBe("record");
    expect(programmeAction(list, { ...later, channelId: "p1:8" }, NOW)?.kind).toBe("record");
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

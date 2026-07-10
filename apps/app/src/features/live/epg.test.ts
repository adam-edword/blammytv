import { describe, expect, it } from "vitest";
import {
  PX_PER_MIN,
  cellRect,
  normalizeProgrammes,
  progress,
  ticks,
  windowStart,
  xForTime,
} from "./epg";

const at = (h: number, m: number) => new Date(2026, 5, 30, h, m);

describe("windowStart", () => {
  it("floors to the previous half hour", () => {
    expect(windowStart(at(20, 38))).toEqual(at(20, 30));
    expect(windowStart(at(20, 29))).toEqual(at(20, 0));
    expect(windowStart(at(20, 0))).toEqual(at(20, 0));
  });
});

describe("layout", () => {
  const start = at(20, 30);

  it("positions times at PX_PER_MIN density", () => {
    expect(xForTime(at(21, 0), start)).toBe(30 * PX_PER_MIN);
  });

  it("emits a tick per half hour", () => {
    const t = ticks(start);
    expect(t).toHaveLength(8);
    expect(t[1]).toEqual(at(21, 0));
  });

  it("clamps cells to the window and drops off-window ones", () => {
    // Started before the window: clamped to the left edge.
    expect(cellRect(at(20, 0), at(21, 0), start)).toEqual({
      x: 0,
      w: 30 * PX_PER_MIN,
    });
    // Fully before the window: gone.
    expect(cellRect(at(19, 0), at(20, 30), start)).toBeNull();
    // Runs past the window: clamped to the right edge.
    const clipped = cellRect(at(23, 30), at(25, 0), start)!;
    expect(clipped.x).toBe(180 * PX_PER_MIN);
    expect(clipped.w).toBe(60 * PX_PER_MIN);
  });
});

describe("progress", () => {
  it("clamps to 0..1", () => {
    expect(progress(at(20, 0), at(21, 0), at(20, 30))).toBe(0.5);
    expect(progress(at(20, 0), at(21, 0), at(19, 0))).toBe(0);
    expect(progress(at(20, 0), at(21, 0), at(22, 0))).toBe(1);
  });
});

describe("normalizeProgrammes", () => {
  const prog = (title: string, s: Date, e: Date, synopsis?: string) => ({
    title,
    ...(synopsis ? { synopsis } : {}),
    start: s,
    end: e,
  });

  it("merges same-title duplicates with shifted starts (the T20 Blast case)", () => {
    // The bug's exact shape: the provider listed the match twice —
    // 12:45–16:30 and 12:55–16:30 — and both drew as overlapping cells.
    const list = [
      prog("T20 Blast : Lancashire Lightning v Yorkshire", at(12, 45), at(16, 30)),
      prog("T20 Blast : Lancashire Lightning v Yorkshire", at(12, 55), at(16, 30)),
    ];
    const out = normalizeProgrammes(list);
    expect(out).toHaveLength(1);
    expect(out[0].start).toEqual(at(12, 45));
    expect(out[0].end).toEqual(at(16, 30));
  });

  it("merge keeps the latest end and backfills a missing synopsis", () => {
    const out = normalizeProgrammes([
      prog("Show", at(12, 0), at(13, 0)),
      prog("show ", at(12, 30), at(13, 30), "the details"), // case/space-insensitive
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].end).toEqual(at(13, 30));
    expect(out[0].synopsis).toBe("the details");
  });

  it("clips a different-title overlap at the later entry's start", () => {
    const out = normalizeProgrammes([
      prog("Formula 1", at(12, 0), at(15, 0)),
      prog("News", at(14, 0), at(16, 0)),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].end).toEqual(at(14, 0)); // clipped, no overlap left
    expect(out[1].start).toEqual(at(14, 0));
  });

  it("drops an entry clipped to nothing and non-positive durations", () => {
    const out = normalizeProgrammes([
      prog("Sliver", at(12, 0), at(14, 0)),
      prog("Real Programme", at(12, 0), at(15, 0)), // same start → Sliver clips to zero
      prog("Broken", at(16, 0), at(16, 0)), // zero duration
      prog("Backwards", at(18, 0), at(17, 0)), // negative duration
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Real Programme");
  });

  it("sorts unsorted input and leaves clean back-to-back listings intact", () => {
    const a = prog("A", at(12, 0), at(13, 0));
    const b = prog("B", at(13, 0), at(14, 0));
    const out = normalizeProgrammes([b, a]);
    expect(out.map((p) => p.title)).toEqual(["A", "B"]);
    expect(out[0].end).toEqual(at(13, 0));
  });

  it("never mutates the input entries", () => {
    const first = prog("Dup", at(12, 0), at(13, 0));
    const second = prog("Dup", at(12, 10), at(13, 30));
    const clippee = prog("Long", at(14, 0), at(16, 0));
    const clipper = prog("Short", at(15, 0), at(17, 0));
    normalizeProgrammes([first, second, clippee, clipper]);
    expect(first.end).toEqual(at(13, 0));
    expect(clippee.end).toEqual(at(16, 0));
  });
});

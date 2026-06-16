import { describe, it, expect } from "vitest";
import type { EpgProgram } from "@blammytv/shared";
import {
  PX_PER_MIN,
  SLOT_MIN,
  guideWindow,
  ticks,
  minutesFromStart,
  blockGeometry,
  isLiveNow,
  progressPct,
  formatTime,
} from "./epg";

const SLOT_MS = SLOT_MIN * 60_000;
// A clean UTC half-hour boundary so floor()-to-slot math is exact.
const BASE = Date.UTC(2026, 5, 16, 20, 0, 0); // 2026-06-16 20:00:00Z
const NOW = BASE + 17 * 60_000 + 30_000; // 20:17:30Z — mid-slot

/** Build a programme spanning [base+startMin, base+stopMin] minutes. */
function prog(startMin: number, stopMin: number): EpgProgram {
  return {
    id: `p-${startMin}-${stopMin}`,
    channelId: "c1",
    title: "Test",
    start: new Date(BASE + startMin * 60_000).toISOString(),
    stop: new Date(BASE + stopMin * 60_000).toISOString(),
  };
}

describe("guideWindow", () => {
  it("floors now to the half-hour and spans slotsAfter ahead", () => {
    const w = guideWindow(NOW);
    expect(w.start).toBe(BASE);
    expect(w.end).toBe(BASE + 9 * SLOT_MS);
  });

  it("honours slotsBefore", () => {
    const w = guideWindow(NOW, 2, 4);
    expect(w.start).toBe(BASE - 2 * SLOT_MS);
    expect(w.end).toBe(BASE + 4 * SLOT_MS);
  });
});

describe("ticks", () => {
  it("emits one tick per half-hour, inclusive of both ends", () => {
    const w = guideWindow(NOW); // 9 slots wide
    const t = ticks(w);
    expect(t).toHaveLength(10);
    expect(t[0]).toBe(BASE);
    expect(t.at(-1)).toBe(BASE + 9 * SLOT_MS);
    // Evenly spaced.
    expect(t[1] - t[0]).toBe(SLOT_MS);
  });
});

describe("minutesFromStart", () => {
  it("converts an absolute time to minutes past the window start", () => {
    const w = guideWindow(NOW);
    expect(minutesFromStart(w, BASE)).toBe(0);
    expect(minutesFromStart(w, BASE + 90 * 60_000)).toBe(90);
  });
});

describe("blockGeometry", () => {
  it("places a programme fully inside the window", () => {
    const w = guideWindow(NOW);
    const { left, width } = blockGeometry(w, prog(30, 90));
    expect(left).toBe(30 * PX_PER_MIN);
    expect(width).toBe(60 * PX_PER_MIN);
  });

  it("clamps a programme that starts before the window", () => {
    const w = guideWindow(NOW);
    const { left, width } = blockGeometry(w, prog(-30, 30));
    expect(left).toBe(0);
    expect(width).toBe(30 * PX_PER_MIN);
  });

  it("clamps a programme that runs past the window end", () => {
    const w = guideWindow(NOW, 0, 2); // ends at BASE + 60 min
    const { left, width } = blockGeometry(w, prog(30, 600));
    expect(left).toBe(30 * PX_PER_MIN);
    expect(width).toBe(30 * PX_PER_MIN); // clamped to the 60-min end
  });
});

describe("isLiveNow", () => {
  it("is true within [start, stop) and false outside", () => {
    const p = prog(0, 30);
    expect(isLiveNow(p, BASE + 15 * 60_000)).toBe(true);
    expect(isLiveNow(p, BASE)).toBe(true); // inclusive start
    expect(isLiveNow(p, BASE + 30 * 60_000)).toBe(false); // exclusive stop
    expect(isLiveNow(p, BASE - 1)).toBe(false);
  });
});

describe("progressPct", () => {
  it("ramps 0 → 100 across the programme and clamps outside", () => {
    const p = prog(0, 60);
    expect(progressPct(p, BASE - 1000)).toBe(0);
    expect(progressPct(p, BASE)).toBe(0);
    expect(progressPct(p, BASE + 30 * 60_000)).toBe(50);
    expect(progressPct(p, BASE + 60 * 60_000)).toBe(100);
    expect(progressPct(p, BASE + 120 * 60_000)).toBe(100);
  });
});

describe("formatTime", () => {
  it("returns a non-empty clock string", () => {
    const s = formatTime(BASE);
    expect(typeof s).toBe("string");
    expect(s).toMatch(/\d/);
  });
});

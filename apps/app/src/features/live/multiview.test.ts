import { describe, expect, it } from "vitest";
import {
  allowedSizes,
  capLine,
  usableSize,
} from "./multiview";

describe("allowedSizes", () => {
  it("offers everything when the line does not publish a limit", () => {
    // Stalker and M3U have no API to ask. Refusing a feature because we
    // could not ask is worse than letting it try.
    expect(allowedSizes(null)).toEqual([2, 3, 4]);
    expect(allowedSizes(undefined)).toEqual([2, 3, 4]);
  });

  it("caps at what the line carries", () => {
    expect(allowedSizes({ max: 5 })).toEqual([2, 3, 4]);
    expect(allowedSizes({ max: 4 })).toEqual([2, 3, 4]);
    // Adam's own line.
    expect(allowedSizes({ max: 3 })).toEqual([2, 3]);
    expect(allowedSizes({ max: 2 })).toEqual([2]);
  });

  it("says no at all on a one-connection line", () => {
    // mpv.rs's unload doc: such a line outright fails to tune with a second
    // stream open, so there is no grid to offer.
    expect(allowedSizes({ max: 1 })).toEqual([]);
  });

  it("ignores what is currently in use", () => {
    // `active` counts this app's own stream, which opening the grid
    // releases first, so subtracting it would under-offer every time.
    expect(allowedSizes({ max: 4, active: 3 } as { max: number })).toEqual([
      2, 3, 4,
    ]);
  });
});

describe("usableSize", () => {
  it("keeps the viewer's choice when the line allows it", () => {
    expect(usableSize(4, { max: 4 })).toBe(4);
    expect(usableSize(2, { max: 3 })).toBe(2);
  });

  it("clamps down rather than refusing", () => {
    // Chose 4 on one playlist, switched to a 3-connection one: 3 is what
    // they meant.
    expect(usableSize(4, { max: 3 })).toBe(3);
    expect(usableSize(4, { max: 2 })).toBe(2);
  });

  it("is null only when the line cannot do multiview at all", () => {
    expect(usableSize(2, { max: 1 })).toBeNull();
    expect(usableSize(4, null)).toBe(4);
  });
});

describe("capLine", () => {
  it("says the number, because that is the actionable part", () => {
    expect(capLine({ max: 3 })).toContain("3");
    expect(capLine({ max: 6 })).toContain("6");
  });

  it("tells a big line it is not the constraint", () => {
    expect(capLine({ max: 5 })).toMatch(/any size works/);
  });

  it("tells a tight line what it caps out at", () => {
    expect(capLine({ max: 3 })).toMatch(/biggest grid/);
    expect(capLine({ max: 2 })).toMatch(/biggest grid/);
  });

  it("says outright when multi-view cannot run at all", () => {
    // Better than letting someone find out by opening four dead tiles.
    expect(capLine({ max: 1 })).toMatch(/can.t run/);
  });

  it("does not invent a number it was never given", () => {
    for (const c of [null, undefined]) {
      expect(capLine(c)).not.toMatch(/\d/);
      expect(capLine(c)).toMatch(/report a limit/);
    }
  });
});

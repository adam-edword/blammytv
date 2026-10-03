import { describe, expect, it } from "vitest";
import { elementFor, gainFor, isRouted, type RouteInputs } from "./mvAudio";
import { tileGain } from "./multiviewTuning";

const ready: RouteInputs = {
  tauri: true,
  sink: true,
  running: true,
  soundId: "t:101",
  muted: false,
  volume: 0.5,
};

describe("isRouted", () => {
  it("is routed only when every input says so", () => {
    expect(isRouted(ready)).toBe(true);
    expect(isRouted({ ...ready, tauri: false })).toBe(false);
    expect(isRouted({ ...ready, sink: false })).toBe(false);
    expect(isRouted({ ...ready, running: false })).toBe(false);
    expect(isRouted({ ...ready, soundId: null })).toBe(false);
  });

  it("does not depend on the bar: a muted or silent bar is still routed", () => {
    expect(isRouted({ ...ready, muted: true })).toBe(true);
    expect(isRouted({ ...ready, volume: 0 })).toBe(true);
  });
});

describe("gainFor", () => {
  it("is mpv's cubic curve on the slider", () => {
    expect(gainFor({ muted: false, volume: 1 })).toBe(1);
    expect(gainFor({ muted: false, volume: 0.5 })).toBeCloseTo(0.125, 10);
    expect(gainFor({ muted: false, volume: 0.05 })).toBeCloseTo(0.05 ** 3, 12);
  });

  it("is zero when muted, whatever the slider says", () => {
    expect(gainFor({ muted: true, volume: 1 })).toBe(0);
    expect(gainFor({ muted: true, volume: 0.5 })).toBe(0);
  });
});

describe("elementFor", () => {
  it("routed: every tile is muted, the sound tile too", () => {
    expect(elementFor(true, true, false, 0.5).muted).toBe(true);
    expect(elementFor(true, false, false, 0.5).muted).toBe(true);
    expect(elementFor(true, true, true, 0.5).muted).toBe(true);
  });

  it("routed: the element's volume is out of the copy's way, at 1", () => {
    expect(elementFor(true, true, false, 0.5).volume).toBe(1);
    expect(elementFor(true, false, false, 0.2).volume).toBe(1);
  });

  it("not routed: today's behaviour, exactly", () => {
    // MultiviewTile's: muted = !focused || muted; volume = tileGain(volume)
    expect(elementFor(false, true, false, 0.4)).toEqual({ muted: false, volume: tileGain(0.4) });
    expect(elementFor(false, true, true, 0.4)).toEqual({ muted: true, volume: tileGain(0.4) });
    expect(elementFor(false, false, false, 0.4)).toEqual({ muted: true, volume: tileGain(0.4) });
    expect(elementFor(false, false, true, 0.4)).toEqual({ muted: true, volume: tileGain(0.4) });
  });
});

describe("never both, never neither", () => {
  const ids = ["t:101", "t:102", "t:103"];
  const yes = [true, false];

  it("an audible bar has the sound in the app or in one element, never both or none", () => {
    for (const tauri of yes)
      for (const sink of yes)
        for (const running of yes) {
          const i: RouteInputs = { tauri, sink, running, soundId: "t:102", muted: false, volume: 0.8 };
          const routed = isRouted(i);
          const unmuted = ids.filter((id) => !elementFor(routed, id === i.soundId, i.muted, i.volume).muted);
          const inApp = routed && gainFor(i) > 0;
          expect(unmuted.length + (inApp ? 1 : 0), JSON.stringify(i)).toBe(1);
        }
  });

  it("a muted bar is silent both ways", () => {
    for (const routed of yes) {
      const i: RouteInputs = { ...ready, muted: true };
      const unmuted = ids.filter((id) => !elementFor(routed, id === i.soundId, i.muted, i.volume).muted);
      expect(unmuted).toEqual([]);
      expect(gainFor(i)).toBe(0);
    }
  });

  it("with no sound tile nothing is routed and nothing plays", () => {
    const i: RouteInputs = { ...ready, soundId: null };
    expect(isRouted(i)).toBe(false);
    expect(ids.filter((id) => !elementFor(false, id === i.soundId, i.muted, i.volume).muted)).toEqual([]);
  });
});

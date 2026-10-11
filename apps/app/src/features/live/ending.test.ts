import { describe, expect, it } from "vitest";
import {
  COMPLETE_FRAC,
  FAILED_OPEN_MS,
  FAILED_OPEN_POLLS,
  endDecision,
  looksFailedOpen,
  type EndInputs,
} from "./ending";

const base: EndInputs = {
  loading: false,
  presenting: true,
  ended: false,
  vod: true,
  time: { pos: 0, dur: 1440 },
};
const at = (pos: number, dur = 1440) => ({ pos, dur });

describe("the threshold is pinned with a literal", () => {
  it("is nine tenths", () => {
    expect(COMPLETE_FRAC).toBe(0.9);
  });
});

describe("endDecision", () => {
  it("lets a first frame outrank an EOF flag", () => {
    // Order is load-bearing: during a tune mpv can report both, and reading
    // that as an ending would declare a stream dead as it came alive.
    expect(
      endDecision({ ...base, loading: true, presenting: true, ended: true }),
    ).toBe("present");
  });

  it("does nothing while still tuning", () => {
    expect(
      endDecision({ ...base, loading: true, presenting: false, ended: false }),
    ).toBe("none");
  });

  it("does nothing in steady playback", () => {
    expect(endDecision({ ...base, time: at(700) })).toBe("none");
  });

  it("completes a VOD that reached the end", () => {
    expect(endDecision({ ...base, ended: true, time: at(1400) })).toBe(
      "complete",
    );
  });

  it("puts the completion boundary at exactly 90 percent", () => {
    // Literals, not `dur * COMPLETE_FRAC` — that would hold for any value.
    expect(endDecision({ ...base, ended: true, time: at(1296) })).toBe(
      "complete",
    );
    expect(endDecision({ ...base, ended: true, time: at(1295.9) })).toBe(
      "rearm",
    );
  });

  it("treats no clock at EOF as a DEATH, not a finish", () => {
    // The first shipped regression. `!time` once counted as proof of
    // completion, which inverted the guard exactly when it mattered: no
    // clock means the source died before one ever arrived, e.g. a debrid
    // 403 seconds in. Completing there ran markWatched, wrote dur/dur,
    // auto-rolled the next episode and destroyed the resume position.
    expect(endDecision({ ...base, ended: true, time: null })).toBe("rearm");
    expect(endDecision({ ...base, ended: true, time: at(0, 0) })).toBe("rearm");
  });

  it("treats a mid-film death as a death", () => {
    expect(endDecision({ ...base, ended: true, time: at(12) })).toBe("rearm");
  });

  it("never completes live, and treats unknown meta as live", () => {
    // A VOD misread as live costs a reload. A live stream misread as VOD
    // costs the user's position, so the unknown case has to fall this way.
    expect(
      endDecision({ ...base, ended: true, vod: false, time: at(1440) }),
    ).toBe("rearm");
    expect(
      endDecision({ ...base, ended: true, vod: undefined, time: at(1440) }),
    ).toBe("rearm");
  });

  it("is not fooled by the position the SCRUBBER is showing", () => {
    // The second shipped regression, stated as a test. The seek hold freezes
    // the displayed clock after a seek; if that value reaches this function,
    // a source dying inside the hold looks like a finish. Here the user
    // seeked from 95% to 10% and the source died: the truth is 144, the
    // display still said 1368, and only one of them gives the right answer.
    expect(endDecision({ ...base, ended: true, time: at(144) })).toBe("rearm");
    expect(endDecision({ ...base, ended: true, time: at(1368) })).toBe(
      "complete",
    );
  });
});

describe("a VOD that never opened", () => {
  // The poll of a debrid 403, as mpv leaves it: idle, no clock, still waiting
  // for a first frame, long after the load. One poll before it looked the same.
  const dead: EndInputs = {
    loading: true,
    presenting: false,
    ended: true,
    vod: true,
    time: null,
    sinceLoadMs: 1500,
    priorFailedPolls: 1,
  };

  it("pins the floor and the poll count with literals", () => {
    expect(FAILED_OPEN_MS).toBe(1000);
    expect(FAILED_OPEN_POLLS).toBe(2);
  });

  it("is a failed open on the second poll in a row", () => {
    expect(endDecision(dead)).toBe("failed-open");
    expect(endDecision({ ...dead, priorFailedPolls: 5 })).toBe("failed-open");
  });

  it("is not one on a single poll", () => {
    expect(endDecision({ ...dead, priorFailedPolls: 0 })).toBe("none");
    expect(endDecision({ ...dead, priorFailedPolls: undefined })).toBe("none");
  });

  it("puts the floor at exactly a second after the load", () => {
    // Literals again: `FAILED_OPEN_MS - 1` would hold for any value.
    expect(endDecision({ ...dead, sinceLoadMs: 1000 })).toBe("failed-open");
    expect(endDecision({ ...dead, sinceLoadMs: 999 })).toBe("none");
    // The idle that comes BEFORE the new loadfile reads a few milliseconds.
    expect(endDecision({ ...dead, sinceLoadMs: 50 })).toBe("none");
    expect(endDecision({ ...dead, sinceLoadMs: 0 })).toBe("none");
  });

  it("needs native to have said how long ago, and reads silence as unknown", () => {
    // A native build from before v0.11.33 sends no field: the watchdog, as ever.
    expect(endDecision({ ...dead, sinceLoadMs: undefined })).toBe("none");
    // And nothing loaded at all.
    expect(endDecision({ ...dead, sinceLoadMs: null })).toBe("none");
  });

  it("leaves live alone, and treats unknown meta as live", () => {
    // Its silent reloads are how a live line recovers.
    expect(endDecision({ ...dead, vod: false })).toBe("none");
    expect(endDecision({ ...dead, vod: undefined })).toBe("none");
  });

  it("is not one for a slow open, which mpv does not call idle", () => {
    expect(endDecision({ ...dead, ended: false })).toBe("none");
  });

  it("still lets a first frame outrank it", () => {
    expect(endDecision({ ...dead, presenting: true })).toBe("present");
  });

  it("does not need a clock, which a link that never opened never had", () => {
    expect(endDecision({ ...dead, time: null })).toBe("failed-open");
    // A VOD that died mid-play and was re-armed has one; it is still dead.
    expect(endDecision({ ...dead, time: at(600) })).toBe("failed-open");
  });

  it("leaves the end of a file that WAS playing exactly as it was", () => {
    // Not loading: the finish-or-die rules above, untouched by any of this.
    const playing = { ...dead, loading: false, priorFailedPolls: 5 };
    expect(endDecision({ ...playing, time: at(1400) })).toBe("complete");
    expect(endDecision({ ...playing, time: at(12) })).toBe("rearm");
    expect(endDecision({ ...playing, time: null })).toBe("rearm");
  });

  it("describes one poll the same way the decision does", () => {
    expect(looksFailedOpen(dead)).toBe(true);
    for (const no of [
      { vod: false },
      { vod: undefined },
      { loading: false },
      { presenting: true },
      { ended: false },
      { sinceLoadMs: 999 },
      { sinceLoadMs: null },
      { sinceLoadMs: undefined },
    ] satisfies Partial<EndInputs>[])
      expect(looksFailedOpen({ ...dead, ...no }), JSON.stringify(no)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { COMPLETE_FRAC, endDecision, type EndInputs } from "./ending";

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

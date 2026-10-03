import { describe, expect, it } from "vitest";
import { statusPollMs } from "./useDirectOverlay";

// The status poll's rate (audit LV4). A stream that never presents leaves
// `loading` true, so the rate has to key on the watchdog's verdict too.
describe("statusPollMs", () => {
  const tuning = statusPollMs(true, false);
  const steady = statusPollMs(false, false);

  it("is fast while a tune is loading and slower once the picture is up", () => {
    expect(tuning).toBeLessThan(steady);
  });

  it("is the steady rate once the watchdog has called the tune dead", () => {
    // `loading` is still true on a dead stream: it never presented.
    expect(statusPollMs(true, true)).toBe(steady);
  });

  it("stays the steady rate for a dead flag with a picture up", () => {
    expect(statusPollMs(false, true)).toBe(steady);
  });
});

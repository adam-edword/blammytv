import { describe, expect, it } from "vitest";
import { mpegtsConfig } from "./multiviewTuning";

describe("mpegtsConfig", () => {
  it("smooth never seeks to chase the live edge", () => {
    const c = mpegtsConfig("smooth");
    expect(c.liveBufferLatencyChasing).toBeUndefined();
    // The stash buffer is left at the library's default (on).
    expect(c.enableStashBuffer).toBeUndefined();
    expect(c.liveSync).toBe(true);
    expect(c.liveSyncPlaybackRate).toBe(1.1);
  });

  it("chase is exactly what v0.9.101 shipped, for the A/B", () => {
    expect(mpegtsConfig("chase")).toEqual({
      enableStashBuffer: false,
      liveBufferLatencyChasing: true,
    });
  });
});

import { describe, expect, it } from "vitest";
import { channels } from "./audioLayout";

describe("channels", () => {
  it("names the source's count and shows what reached the device", () => {
    expect(channels({ audioChannels: 6, audioOut: "5.1" })).toBe("5.1 → 5.1");
    expect(channels({ audioChannels: 6, audioOut: "stereo" })).toBe("5.1 → stereo");
    expect(channels({ audioChannels: 8, audioOut: "7.1" })).toBe("7.1 → 7.1");
  });

  it("falls back to a count for a layout without a common name", () => {
    expect(channels({ audioChannels: 3, audioOut: "stereo" })).toBe("3 ch → stereo");
  });

  it("shows whichever half mpv reported, and nothing without either", () => {
    expect(channels({ audioChannels: 2 })).toBe("stereo");
    expect(channels({ audioOut: "5.1" })).toBe("5.1");
    expect(channels({})).toBeNull();
    expect(channels({ audioChannels: 0, audioOut: "" })).toBeNull();
  });
});

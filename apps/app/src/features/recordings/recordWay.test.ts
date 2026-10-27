import { describe, expect, it } from "vitest";
import { recordWay } from "./recordWay";

describe("recordWay (plan 029, D3)", () => {
  it("asks on the channel on screen when the line allows one stream", () => {
    expect(recordWay({ max: 1 }, true, true)).toBe("ask");
  });

  it("goes straight to the buffer once the warning is off", () => {
    expect(recordWay({ max: 1 }, true, false)).toBe("buffer");
  });

  it("opens a stream of its own on a line that allows more", () => {
    expect(recordWay({ max: 2 }, true, true)).toBe("stream");
    expect(recordWay({ max: 3 }, true, false)).toBe("stream");
  });

  it("opens one when the line reports nothing (Stalker, M3U, a panel that does not say)", () => {
    expect(recordWay(null, true, true)).toBe("stream");
    expect(recordWay(undefined, true, false)).toBe("stream");
  });

  it("opens one for a channel that is not on screen: only the picture has a buffer", () => {
    expect(recordWay({ max: 1 }, false, true)).toBe("stream");
  });
});

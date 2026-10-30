import { describe, expect, it } from "vitest";
import { noticeText, recordWay } from "./recordWay";

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

describe("recordWay's heads-up (plan 029, D5)", () => {
  it("gives every line but D3's a heads-up while it is on", () => {
    expect(recordWay({ max: 3 }, true, true, true)).toBe("notice");
    expect(recordWay({ max: 2 }, true, false, true)).toBe("notice");
    expect(recordWay(null, true, true, true)).toBe("notice");
    expect(recordWay(undefined, true, true, true)).toBe("notice");
    expect(recordWay({ max: 1 }, false, true, true)).toBe("notice");
  });

  it("goes straight to a stream once the heads-up is off", () => {
    expect(recordWay({ max: 3 }, true, true, false)).toBe("stream");
    expect(recordWay(null, true, true, false)).toBe("stream");
  });

  it("leaves D3 its own dialog: the heads-up never stands in for it or follows it", () => {
    expect(recordWay({ max: 1 }, true, true, true)).toBe("ask");
    expect(recordWay({ max: 1 }, true, false, true)).toBe("buffer");
  });
});

describe("noticeText (plan 029, D5)", () => {
  it("names the limit a line reports", () => {
    expect(noticeText({ max: 3 })).toBe("This recording uses one of the 3 streams your line allows, for as long as it runs.");
    expect(noticeText({ max: 2 })).toBe("This recording uses one of the 2 streams your line allows, for as long as it runs.");
  });

  it("says one stream in the singular", () => {
    expect(noticeText({ max: 1 })).toBe("This recording uses the one stream your line allows, for as long as it runs.");
  });

  it("names the provider's streams when the line reports nothing", () => {
    const words = "This recording uses one of your provider’s streams for as long as it runs.";
    expect(noticeText(null)).toBe(words);
    expect(noticeText(undefined)).toBe(words);
    expect(noticeText({ max: 0 })).toBe(words);
  });
});

import { describe, expect, it } from "vitest";
import { carriageText } from "./carriage";

/**
 * The one line that makes this a viewer rather than a scores app, and
 * until it was pulled out of GameCard for the wide race card to share, it
 * had no test at all: it was a nested ternary inside a component.
 */
const base = {
  state: "pre" as const,
  channels: [] as { id: string; name: string }[],
  broadcasts: [] as string[],
};
const ch = (...names: string[]) =>
  names.map((name, i) => ({ id: String(i), name }));

describe("carriageText", () => {
  it("names the one channel that has it", () => {
    expect(carriageText({ ...base, channels: ch("US| CBS HD") })).toBe(
      "On US| CBS HD",
    );
  });

  it("counts them once there is a choice, because hopping is the point", () => {
    expect(carriageText({ ...base, channels: ch("A", "B", "C") })).toBe(
      "On 3 channels",
    );
  });

  it("says LIVE on only where that is true", () => {
    // A game at 8:30 is not live on anything yet.
    expect(
      carriageText({ ...base, state: "live", channels: ch("ESPN") }),
    ).toBe("Live on ESPN");
    expect(carriageText({ ...base, state: "pre", channels: ch("ESPN") })).toBe(
      "On ESPN",
    );
  });

  it("falls back to the network when none of your channels carry it", () => {
    // Racing really does reach here: every F1 session carries "Apple TV".
    expect(carriageText({ ...base, broadcasts: ["Apple TV"] })).toBe(
      "On Apple TV",
    );
  });

  it("admits it when nothing at all carries it", () => {
    expect(carriageText(base)).toBe("Not on your channels");
  });

  it("distinguishes NOT KNOWN YET from nothing", () => {
    // A cold start reaches the board before the 20k channel guide is
    // parsed, and for that window the cards were asserting "Not on your
    // channels" with no basis for it.
    expect(carriageText({ ...base, channelsPending: true })).toBe(
      "Checking your channels…",
    );
    // Even with broadcasts to fall back on: pending outranks the guess.
    expect(
      carriageText({ ...base, channelsPending: true, broadcasts: ["FOX"] }),
    ).toBe("Checking your channels…");
  });

  it("says so when the only copy is in a folder you hid", () => {
    // Still offered, because you asked for the game and this is the only
    // copy, but calling it "Live on 1 channel" would be a small lie about
    // a folder somebody muted deliberately.
    expect(
      carriageText({
        ...base,
        state: "live",
        channels: ch("XXX Sports"),
        hiddenOnly: true,
      }),
    ).toBe("Live on XXX Sports in a hidden folder");
    expect(
      carriageText({
        ...base,
        state: "live",
        channels: ch("A", "B"),
        hiddenOnly: true,
      }),
    ).toBe("Live on 2 channels in a hidden folder");
  });
});

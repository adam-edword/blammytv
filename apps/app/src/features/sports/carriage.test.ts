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

  it("blames the linking, which is the only thing it can know", () => {
    // Three wordings have stood here and the first two each described the
    // WORLD: "Not on your channels" claimed the playlist did not have it,
    // and "No channel listed for this game" claimed nothing had it. Adam:
    // it "still implies there isn't a channel in the entire EPG that has
    // these games, not that it couldn't be linked... we can't really know
    // that." The schedule named no broadcaster, which is a fact about
    // ESPN's payload and not about a 20,000 channel playlist.
    expect(carriageText(base)).toBe("Could not link channel");
  });

  it("never claims a game is absent, in any of its no-channel states", () => {
    // The rule the wording above exists to keep, held over every route to
    // an empty channel list. None of these may assert that nothing carries
    // the game, because none of them is evidence of that.
    const claims = [
      carriageText(base),
      carriageText({ ...base, broadcasts: ["Peacock"] }),
      carriageText({ ...base, presumed: ["Win Sports"] }),
    ];
    for (const said of claims) {
      expect(said).not.toMatch(/not on|no channel|nothing|unavailable/i);
    }
  });

  it("names the map's network when the playlist has none of it", () => {
    // Colombia's Primera A on a real board: the map knows it is Win Sports,
    // and Adam's 1,875 channels do not carry it. Throwing that away for "no
    // listing" would be discarding the one useful thing we know.
    expect(carriageText({ ...base, presumed: ["Win Sports"] })).toBe(
      "Usually found on Win Sports",
    );
  });

  it("prefers what the source said over what the map guesses", () => {
    // Both present is not a real state today, since the map is only
    // consulted when broadcasts is empty, but the ordering is the rule and
    // it should not depend on the caller keeping to it.
    expect(
      carriageText({ ...base, broadcasts: ["FOX"], presumed: ["ESPN"] }),
    ).toBe("On FOX");
  });

  it("words a guess from the network map as a guess", () => {
    // The map knows where the LEAGUE lives, which is not the same claim as
    // knowing where this game is. "Live on Tennis Channel" would state as
    // fact something no source said.
    expect(
      carriageText({
        ...base,
        state: "live",
        channels: ch("US: Tennis Channel"),
        presumedOnly: true,
      }),
    ).toBe("Usually found on US: Tennis Channel");
    expect(
      carriageText({
        ...base,
        state: "live",
        channels: ch("A", "B"),
        presumedOnly: true,
      }),
    ).toBe("Usually found on 2 channels");
  });

  it("never lets a presumed match borrow the live wording", () => {
    // The whole point of the flag: state is live, and the sentence still
    // refuses to say so about a channel nobody told us about.
    const said = carriageText({
      ...base,
      state: "live",
      channels: ch("US: Tennis Channel"),
      presumedOnly: true,
    });
    expect(said).not.toContain("Live on");
  });

  it("still says where a hidden folder is the only copy of a guess", () => {
    expect(
      carriageText({
        ...base,
        channels: ch("US: Tennis Channel"),
        presumedOnly: true,
        hiddenOnly: true,
      }),
    ).toBe("Usually found on US: Tennis Channel in a hidden folder");
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

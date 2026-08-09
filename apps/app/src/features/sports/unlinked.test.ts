import { describe, expect, it } from "vitest";
import { unlinkedReason } from "./unlinked";
import type { Fixture } from "./model";

/**
 * #21's board-level "none of this is on your channels".
 *
 * The interesting cases are the ones that must NOT fire, because each is a
 * board state that looks identical from the outside and means something
 * completely different.
 */
const g = (over: Partial<Fixture> = {}): Fixture => ({
  kind: "fixture",
  id: `g${Math.random()}`,
  sport: "baseball",
  league: "MLB",
  leagueKey: "mlb",
  state: "pre",
  start: new Date(2026, 7, 9, 19),
  status: "7:00 PM",
  home: { name: "Orioles", abbr: "BAL" },
  away: { name: "Braves", abbr: "ATL" },
  broadcasts: ["MASN"],
  channels: [],
  ...over,
});

const chan = [{ id: "c1", name: "MASN HD" }];

describe("unlinkedReason", () => {
  it("says unmatched when a playlist exists and nothing matched", () => {
    expect(unlinkedReason([g(), g()], 20000)).toBe("unmatched");
  });

  it("says no-playlist when there are no channels at all", () => {
    // Same symptom, completely different fix.
    expect(unlinkedReason([g(), g()], 0)).toBe("no-playlist");
  });

  it("stays quiet when even ONE game matched", () => {
    // The cards handle the per-game case. This line is only for "all of it".
    expect(unlinkedReason([g(), g({ channels: chan })], 20000)).toBeNull();
  });

  it("stays quiet while channels are still resolving", () => {
    // "Not known yet" is not "not on your channels", and saying the second
    // during the first is the flash useCatalog's warm start avoids.
    expect(unlinkedReason([g({ channelsPending: true })], 20000)).toBeNull();
  });

  it("stays quiet on a board of finished games", () => {
    // A final's carriage line is its start time, not a channel, so counting
    // finals would fire this on any evening that had already played out.
    expect(
      unlinkedReason([g({ state: "final" }), g({ state: "final" })], 20000),
    ).toBeNull();
  });

  it("ignores finals when judging the rest", () => {
    expect(
      unlinkedReason([g({ state: "final" }), g({ state: "live" })], 20000),
    ).toBe("unmatched");
    expect(
      unlinkedReason(
        [g({ state: "final" }), g({ state: "live", channels: chan })],
        20000,
      ),
    ).toBeNull();
  });

  it("stays quiet on an empty board, which has its own screens", () => {
    expect(unlinkedReason([], 20000)).toBeNull();
    expect(unlinkedReason([], 0)).toBeNull();
  });
});

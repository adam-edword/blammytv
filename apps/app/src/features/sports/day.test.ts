import { describe, expect, it } from "vitest";
import { dayLabel, nowish, onDay , tooEarly } from "./day";
import type { Fixture, Game, GameState } from "./model";

/**
 * The hub's day logic.
 *
 * All three of these decide what a viewer sees rather than how it looks,
 * and two of them depend on the local clock, which is exactly the kind of
 * thing that works every day except one. The dates below are built from
 * local parts on purpose: a UTC literal would pass or fail depending on
 * which side of Greenwich the machine running this sits.
 */

const game = (
  id: string,
  state: GameState,
  start: Date,
): Fixture => ({
  kind: "fixture",
  id,
  sport: "baseball",
  league: "MLB",
  leagueKey: "mlb",
  state,
  start,
  status: "",
  home: { name: "Home", abbr: "H" },
  away: { name: "Away", abbr: "A" },
  broadcasts: [],
  channels: [],
});

const at = (day: number, hour: number, min = 0) =>
  new Date(2026, 6, day, hour, min);

describe("onDay", () => {
  const today = new Date(2026, 6, 26);

  it("keeps only the games that start on the day asked for", () => {
    const games = [
      game("today", "pre", at(26, 19)),
      game("tomorrow", "pre", at(27, 19)),
      // The real reason this function exists: a league between matchdays
      // answers with its next one whatever date you asked for.
      game("next month", "pre", at(21 + 31, 15)),
    ];
    expect(onDay(games, today, false).map((g) => g.id)).toEqual(["today"]);
  });

  it("orders by kick-off, not by the order the leagues answered in", () => {
    const games = [
      game("late", "pre", at(26, 22)),
      game("early", "pre", at(26, 13)),
      game("middle", "pre", at(26, 19, 30)),
    ];
    expect(onDay(games, today, false).map((g) => g.id)).toEqual([
      "early",
      "middle",
      "late",
    ]);
  });

  it("keeps a game still going from last night, when asked for today", () => {
    // 11pm yesterday, still live. It is on now, whatever date is on it.
    const running = game("running", "live", at(25, 23));
    const [first, second] = onDay(
      [game("tonight", "pre", at(26, 19)), running],
      today,
      true,
    );
    // And it sorts before tonight's, because it started before it.
    expect(first.id).toBe("running");
    expect(second.id).toBe("tonight");
  });

  it("does not pull a live game onto a day that is not today", () => {
    const tomorrow = new Date(2026, 6, 27);
    const running = game("running", "live", at(26, 23));
    expect(onDay([running], tomorrow, false)).toEqual([]);
  });

  it("does not keep a game that finished yesterday", () => {
    const done = game("done", "final", at(25, 19));
    expect(onDay([done], today, true)).toEqual([]);
  });

  it("crosses a month boundary on the day, not on the number", () => {
    const jul31 = new Date(2026, 6, 31);
    const games = [
      game("jul31", "pre", new Date(2026, 6, 31, 20)),
      game("aug1", "pre", new Date(2026, 7, 1, 20)),
    ];
    expect(onDay(games, jul31, false).map((g) => g.id)).toEqual(["jul31"]);
  });
});

describe("dayLabel", () => {
  const today = new Date(2026, 6, 26, 14, 30);

  it("names the first two days", () => {
    expect(dayLabel(new Date(2026, 6, 26), today)).toBe("Today");
    expect(dayLabel(new Date(2026, 6, 27), today)).toBe("Tomorrow");
  });

  it("is still Today late at night, not Tomorrow", () => {
    // The comparison is against local midnight, so any hour of the 26th is
    // the 26th. Comparing against `now` would flip this after noon.
    const nearlyMidnight = new Date(2026, 6, 26, 23, 59);
    expect(dayLabel(new Date(2026, 6, 26), nearlyMidnight)).toBe("Today");
    expect(dayLabel(new Date(2026, 6, 27), nearlyMidnight)).toBe("Tomorrow");
  });

  it("spells out anything further off, because a weekday alone is ambiguous", () => {
    const label = dayLabel(new Date(2026, 6, 28), today);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Tomorrow");
    expect(label).toContain("28");
  });

  it("survives the clocks changing", () => {
    // US DST ends 2026-11-01: the 1st is 25 hours long, so the gap from
    // Nov 1 to Nov 2 is 25 * 3600s. Rounding is what keeps that "Tomorrow"
    // rather than 1.04 days.
    const dst = new Date(2026, 10, 1, 12);
    expect(dayLabel(new Date(2026, 10, 2), dst)).toBe("Tomorrow");
    expect(dayLabel(new Date(2026, 10, 1), dst)).toBe("Today");
  });
});

describe("nowish", () => {
  it("prefers a live game over everything else", () => {
    const games = [
      game("done", "final", at(26, 13)),
      game("on", "live", at(26, 19)),
      game("later", "pre", at(26, 22)),
    ];
    expect(nowish(games)!.id).toBe("on");
  });

  it("falls back to the game that finished most recently", () => {
    const games = [
      game("first", "final", at(26, 13)),
      game("last", "final", at(26, 16)),
      game("later", "pre", at(26, 22)),
    ];
    expect(nowish(games)!.id).toBe("last");
  });

  it("falls back to the next one to start", () => {
    const games = [
      game("next", "pre", at(26, 19)),
      game("after", "pre", at(26, 22)),
    ];
    expect(nowish(games)!.id).toBe("next");
  });

  it("has no answer for an empty day", () => {
    expect(nowish([])).toBeUndefined();
  });
});

describe("tooEarly", () => {
  // tooEarly reads two fields and neither is a side, so this stub stays a
  // stub: casting is honest here in a way filling in eleven unread fields
  // would not be.
  const at = (h: number): Game =>
    ({
      state: "pre",
      start: new Date(Date.now() + h * 3600_000),
    }) as Game;

  it("lets you open anything later today", () => {
    expect(tooEarly(at(1))).toBe(false);
    expect(tooEarly(at(15))).toBe(false);
  });

  it("stops you opening tomorrow's fixtures", () => {
    // Opening one tuned the best channel and titled the chrome with a
    // fixture that had not happened.
    expect(tooEarly(at(17))).toBe(true);
    expect(tooEarly(at(48))).toBe(true);
  });

  it("never blocks a game that is on or finished", () => {
    // A live game is by definition not ahead of us, and a final has a
    // result worth reaching even though it will not autoplay.
    expect(tooEarly({ ...at(48), state: "live" } as Game)).toBe(false);
    expect(tooEarly({ ...at(48), state: "final" } as Game)).toBe(false);
  });
});

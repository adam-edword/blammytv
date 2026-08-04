import { describe, expect, it } from "vitest";
import { dateRange, golfPath, toGolf, type RawGolf } from "./golf";
import { isField } from "./model";
import done from "./fixtures/golf-final.json";
import pre from "./fixtures/golf-pre.json";

/**
 * The golf adapter (plan 010 #10).
 *
 * Both fixtures are REAL captures, pruned to the paths this reads: a
 * finished 3M Open with 144 competitors, and the Wyndham Championship the
 * day before it starts, which is the state four of the five golf leagues
 * spend most of their time in.
 */

describe("golfPath", () => {
  it("claims the five golf leagues and nothing else", () => {
    for (const p of ["golf/pga", "golf/lpga", "golf/eur", "golf/liv", "golf/champions-tour"])
      expect(golfPath(p)).toBe(true);
    expect(golfPath("racing/f1")).toBe(false);
    expect(golfPath("baseball/mlb")).toBe(false);
  });
});

describe("a finished tournament", () => {
  const [board] = toGolf(done as RawGolf, "golf/pga");

  it("is one card for the whole event, not one per round", () => {
    expect(toGolf(done as RawGolf, "golf/pga")).toHaveLength(1);
    expect(isField(board)).toBe(true);
    expect(board.state).toBe("final");
  });

  it("orders the field by the source's own position", () => {
    expect(board.entrants.map((e) => e.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("carries the score to par as the string the source keeps", () => {
    // Not a number. "-25" and "E" are golf's own unit and there is no
    // arithmetic we should be doing on them.
    expect(board.entrants[0].score).toBe("-25");
    expect(typeof board.entrants[0].score).toBe("string");
  });

  it("names the winner as position one, since there is no winner field", () => {
    expect(board.entrants[0].name).toBe("Jackson Koivun");
  });

  it("gives every player their flag", () => {
    for (const e of board.entrants) expect(e.mark).toMatch(/^https?:/);
  });

  it("writes no caption code, because golf has none", () => {
    // Racing derives one from the surname; inventing three letters for a
    // golfer would be a caption nobody uses.
    for (const e of board.entrants) expect(e.code).toBeUndefined();
  });

  it("does not count laps at a sport that has none", () => {
    expect(board.race).toBe(false);
    expect(board.lap).toBeUndefined();
    expect(board.laps).toBeUndefined();
  });

  it("says nothing about THRU once the round is over", () => {
    // 18 of 18 is not progress, it is a finished round, and "THRU 18" on a
    // card would be noise dressed as news.
    expect(board.thru).toBeUndefined();
  });

  it("keeps the broadcasts, which golf actually populates", () => {
    // One of the few sports where the source says anything at all: 3 of 3
    // in the #27 sweep.
    expect(board.broadcasts).toContain("CBS");
    expect(board.broadcasts.length).toBeGreaterThan(1);
  });

  it("puts the tournament in the card's big slot", () => {
    expect(board.place).toBe("3M Open");
  });
});

describe("a tournament nobody has teed off in", () => {
  const [board] = toGolf(pre as RawGolf, "golf/pga");

  it("carries NO entrants, however many the source lists", () => {
    // The measurement behind this: the PGA and LIV hand back the whole
    // field pre-tournament with everyone on "E" and null rounds, while the
    // other three leagues return zero competitors. A leaderboard of 147
    // players tied at even is not a leaderboard.
    expect(board.state).toBe("pre");
    expect(board.entrants).toEqual([]);
  });

  it("has no round and no thru to report", () => {
    expect(board.session).toBe("");
    expect(board.thru).toBeUndefined();
  });

  it("says the date rather than a tee time", () => {
    // A tournament runs Thursday to Sunday, so a clock is the wrong grain.
    expect(board.status).toMatch(/[A-Z][a-z]{2}\s\d+/);
  });
});

describe("shapes the source can hand back", () => {
  it("survives an event with no competitions at all", () => {
    const raw: RawGolf = { events: [{ id: "1", date: "2026-08-06T00:00Z" }] };
    const [board] = toGolf(raw, "golf/pga");
    expect(board.entrants).toEqual([]);
    expect(board.broadcasts).toEqual([]);
  });

  it("drops an event with no id or no date rather than inventing one", () => {
    expect(toGolf({ events: [{ name: "Nameless" }] }, "golf/pga")).toEqual([]);
    expect(toGolf({ events: [{ id: "1" }] }, "golf/pga")).toEqual([]);
  });

  it("answers nothing for a league between seasons", () => {
    expect(toGolf({ events: [] }, "golf/lpga")).toEqual([]);
    expect(toGolf({}, "golf/lpga")).toEqual([]);
  });
});

describe("dateRange", () => {
  // The upcoming card's headline, and the only thing worth the room before
  // anyone tees off.
  const d = (iso: string) => new Date(iso);

  it("reads as one month when it is one month", () => {
    expect(dateRange(d("2026-08-06T12:00"), d("2026-08-09T12:00"))).toBe("AUG 6-9");
  });

  it("names both months when a tournament straddles one", () => {
    expect(dateRange(d("2026-08-28T12:00"), d("2026-09-01T12:00"))).toBe(
      "AUG 28 - SEP 1",
    );
  });

  it("says one day rather than a range of one", () => {
    expect(dateRange(d("2026-08-06T12:00"), d("2026-08-06T20:00"))).toBe("AUG 6");
  });

  it("falls back to the start rather than inventing an end", () => {
    // A range with a guessed end is worse than a start.
    expect(dateRange(d("2026-08-06T12:00"))).toBe("AUG 6");
  });
});

describe("the upcoming card's fields", () => {
  it("carries the end date, so the range can be drawn", () => {
    const [board] = toGolf(pre as RawGolf, "golf/pga");
    expect(board.end).toBeInstanceOf(Date);
    expect(dateRange(board.start, board.end)).toBe("AUG 6-9");
  });

  it("uses the tournament's full name, not an abbreviation", () => {
    const [board] = toGolf(pre as RawGolf, "golf/pga");
    expect(board.place).toBe("Wyndham Championship");
  });
});

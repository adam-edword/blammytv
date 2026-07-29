import { describe, expect, it } from "vitest";
import { nextUp, toBoard } from "./race";

/**
 * The split rule, which is the one part of the racing mapping with a right
 * answer rather than a look: a weekend is ONE card until the day its first
 * session runs, and its five sessions from then on.
 *
 * Dates are written with an explicit local time rather than a bare
 * "2026-08-21", because a bare date string is parsed as UTC and would put
 * the test's answer on the far side of midnight for anyone west of London.
 */

const at = (iso: string) => new Date(iso);

/** A weekend, shaped the way ESPN sends one. */
const weekend = (
  labels: [string, string][] = [
    ["FP1", "2026-08-21T10:30"],
    ["FP2", "2026-08-21T14:00"],
    ["FP3", "2026-08-22T10:30"],
    ["Qual", "2026-08-22T14:00"],
    ["Race", "2026-08-23T13:00"],
  ],
) => ({
  leagues: [{ name: "Formula 1" }],
  events: [
    {
      id: "600057441",
      circuit: { id: "613", address: { country: "Netherlands" } },
      competitions: labels.map(([abbreviation, date]) => ({
        date,
        type: { abbreviation },
        status: { type: { state: "pre" } },
        competitors: [],
      })),
    },
  ],
});

describe("toBoard", () => {
  it("is one weekend card while the weekend is still ahead", () => {
    const { weekends, sessions } = toBoard(weekend(), at("2026-08-18T09:00"));
    expect(weekends).toHaveLength(1);
    expect(sessions).toHaveLength(0);
    expect(weekends[0].sessions.map((s) => s.label)).toEqual([
      "FP1",
      "FP2",
      "FP3",
      "QUAL",
      "RACE",
    ]);
  });

  it("breaks into session cards on the DAY of the first session, not at its start time", () => {
    // 6am, hours before FP1's 10:30. Adam's rule: the board should not
    // rearrange itself under someone mid-morning.
    const { weekends, sessions } = toBoard(weekend(), at("2026-08-21T06:00"));
    expect(weekends).toHaveLength(0);
    expect(sessions).toHaveLength(5);
  });

  it("stays broken out once the weekend has been and gone", () => {
    const { weekends, sessions } = toBoard(weekend(), at("2026-09-30T12:00"));
    expect(weekends).toHaveLength(0);
    expect(sessions).toHaveLength(5);
  });

  it("dates the card by RACE day, not by the first session", () => {
    // FP1 is the 21st and the Grand Prix the 23rd. A person means the 23rd.
    const { weekends } = toBoard(weekend(), at("2026-08-18T09:00"));
    expect(weekends[0].date).toBe("AUG 23");
  });

  it("finds race day by label rather than by position", () => {
    // Same weekend with the race listed first. Position would answer AUG 21.
    const odd = weekend([
      ["Race", "2026-08-23T13:00"],
      ["FP1", "2026-08-21T10:30"],
      ["FP2", "2026-08-21T14:00"],
      ["FP3", "2026-08-22T10:30"],
      ["Qual", "2026-08-22T14:00"],
    ]);
    expect(toBoard(odd, at("2026-08-18T09:00")).weekends[0].date).toBe("AUG 23");
  });

  it("marks only qualifying and the race as major", () => {
    const { weekends } = toBoard(weekend(), at("2026-08-18T09:00"));
    expect(
      weekends[0].sessions.filter((s) => s.major).map((s) => s.label),
    ).toEqual(["QUAL", "RACE"]);
  });

  it("leaves the sprint race a step back, which is the trade-off that was chosen", () => {
    // The six sprint weekends run FP1/SS/SR/Qual/Race, and SR is a real
    // race with points. The ramp is about the two sessions everyone plans
    // around, so SR is grey. Pinned so it cannot drift back silently.
    const sprint = weekend([
      ["FP1", "2026-04-24T10:30"],
      ["SS", "2026-04-24T14:30"],
      ["SR", "2026-04-25T10:00"],
      ["Qual", "2026-04-25T14:00"],
      ["Race", "2026-04-26T13:00"],
    ]);
    const { weekends } = toBoard(sprint, at("2026-04-20T09:00"));
    expect(
      weekends[0].sessions.filter((s) => s.major).map((s) => s.label),
    ).toEqual(["QUAL", "RACE"]);
  });

  it("survives ESPN filing three sessions under one label", () => {
    // The Spanish GP really does come back as FP1/FP1/FP1/Qual/Race.
    const spain = weekend([
      ["FP1", "2026-09-11T11:30"],
      ["FP1", "2026-09-11T15:00"],
      ["FP1", "2026-09-12T10:30"],
      ["Qual", "2026-09-12T14:00"],
      ["Race", "2026-09-13T13:00"],
    ]);
    const { weekends } = toBoard(spain, at("2026-09-08T09:00"));
    expect(weekends[0].sessions).toHaveLength(5);
    expect(weekends[0].sessions.map((s) => s.day)).toEqual([
      "FRI",
      "FRI",
      "SAT",
      "SAT",
      "SUN",
    ]);
  });

  it("treats a weekend with no usable dates as running", () => {
    // A weekend card with no schedule on it is the one thing it cannot be,
    // so an undated event goes down the session branch instead.
    const undated = {
      leagues: [{ name: "Formula 1" }],
      events: [{ id: "x", competitions: [{ type: { abbreviation: "Race" } }] }],
    };
    const { weekends, sessions } = toBoard(undated, at("2026-08-18T09:00"));
    expect(weekends).toHaveLength(0);
    expect(sessions).toHaveLength(1);
  });

  it("answers empty for a league that is out of season", () => {
    expect(toBoard({}, at("2026-01-01T00:00"))).toEqual({
      weekends: [],
      sessions: [],
    });
  });
});

/** A whole season, the way the year fetch answers: events in calendar order. */
const season = (...starts: string[]) => ({
  leagues: [{ name: "Formula 1" }],
  events: starts.map((day, n) => ({
    id: `e${n}`,
    circuit: { id: "613", address: { country: `Round ${n}` } },
    competitions: [
      ["FP1", `${day}T10:30`],
      ["FP2", `${day}T14:00`],
      ["FP3", `${day}T18:00`],
      ["Qual", `${day}T20:00`],
      ["Race", `${day}T22:00`],
    ].map(([abbreviation, date]) => ({
      date,
      type: { abbreviation },
      status: { type: { state: "pre" } },
      competitors: [],
    })),
  })),
});

describe("nextUp", () => {
  it("keeps the weekend just gone and the one still ahead, out of a whole season", () => {
    // Six rounds; four have been and gone. Mapping the lot would put
    // twenty finished session cards on today's grid.
    const { weekends, sessions } = nextUp(
      season(
        "2026-03-06",
        "2026-04-10",
        "2026-05-15",
        "2026-06-19",
        "2026-08-21",
        "2026-09-25",
      ),
      at("2026-07-29T12:00"),
    );
    // The one ahead is the NEXT, not the last of the season.
    expect(weekends.map((w) => w.place)).toEqual(["Round 4"]);
    // The one just gone is the most RECENT, not the first of the season.
    expect(new Set(sessions.map((s) => s.place))).toEqual(new Set(["Round 3"]));
    expect(sessions).toHaveLength(5);
  });

  it("carries a weekend card alone before the season has started", () => {
    const { weekends, sessions } = nextUp(
      season("2026-03-06", "2026-04-10"),
      at("2026-01-15T12:00"),
    );
    expect(weekends.map((w) => w.place)).toEqual(["Round 0"]);
    expect(sessions).toHaveLength(0);
  });

  it("carries sessions alone once the last round has started", () => {
    const { weekends, sessions } = nextUp(
      season("2026-03-06", "2026-12-06"),
      at("2026-12-06T09:00"),
    );
    expect(weekends).toHaveLength(0);
    expect(new Set(sessions.map((s) => s.place))).toEqual(new Set(["Round 1"]));
  });

  it("answers empty out of season", () => {
    expect(nextUp({}, at("2026-01-01T00:00"))).toEqual({
      weekends: [],
      sessions: [],
    });
  });
});

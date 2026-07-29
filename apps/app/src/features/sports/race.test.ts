import { describe, expect, it } from "vitest";
import { toBoard } from "./race";

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

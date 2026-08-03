import { describe, expect, it } from "vitest";
import { sessionClock, sessionDay, toRacing, toWeekend } from "./racing";
import { onDay } from "./day";
import { isField } from "./model";
import type { Field } from "./model";

/**
 * The racing adapter (plan 010 #1).
 *
 * Dates are written with an explicit local time rather than a bare
 * "2026-08-21", because a bare date string is parsed as UTC and would put
 * the answer on the far side of midnight for anyone west of London.
 */

const at = (iso: string) => new Date(iso);
const F1 = "racing/f1";

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
      circuit: {
        id: "613",
        fullName: "Circuit Park Zandvoort",
        address: { country: "Netherlands" },
      },
      competitions: labels.map(([abbreviation, date], i) => ({
        id: `s${i}`,
        date,
        type: { abbreviation },
        status: { type: { state: "pre" } },
        broadcasts: [{ names: ["Apple TV"] }],
        competitors: [],
      })),
    },
  ],
});

describe("toRacing", () => {
  it("makes one Field per session, not one per weekend", () => {
    // On the day the sessions are separate things: FP1, Qual and the race
    // each have their own clock, state and order.
    const games = toRacing(weekend(), F1);
    expect(games).toHaveLength(5);
    expect(games.every(isField)).toBe(true);
    expect(games.map((g) => g.session)).toEqual([
      "FP1",
      "FP2",
      "FP3",
      "Qual",
      "Race",
    ]);
  });

  it("gives every session its own id", () => {
    // Five sessions share one event id, so the event id alone would
    // collide five ways and React would render one card.
    const ids = toRacing(weekend(), F1).map((g) => g.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids[0]).toMatch(/^espn-racing\/f1-600057441-/);
  });

  it("carries the country, the circuit and the art key separately", () => {
    const [g] = toRacing(weekend(), F1);
    // "Hungary" is what a person calls the weekend; the circuit's own name
    // goes where a stadium goes.
    expect(g.place).toBe("Netherlands");
    expect(g.venue).toBe("Circuit Park Zandvoort");
    expect(g.circuitId).toBe("613");
    expect(g.leagueKey).toBe(F1);
    expect(g.sport).toBe("racing");
    // The LONG name, which is what a race card says.
    expect(g.league).toBe("Formula 1");
  });

  it("counts laps for a race and a sprint race, and nothing else", () => {
    const sprint = weekend([
      ["FP1", "2026-04-24T10:30"],
      ["SS", "2026-04-24T14:30"],
      ["SR", "2026-04-25T10:00"],
      ["Qual", "2026-04-25T14:00"],
      ["Race", "2026-04-26T13:00"],
    ]);
    const counting = toRacing(sprint, F1)
      .filter((g) => g.race)
      .map((g) => g.session);
    expect(counting).toEqual(["SR", "Race"]);
  });

  it("carries the broadcast, which is the whole point of the row", () => {
    // Racing really does have one: every F1 session is "Apple TV" in 2026.
    expect(toRacing(weekend(), F1)[0].broadcasts).toEqual(["Apple TV"]);
  });

  it("keeps the top of the field in order, and only the top", () => {
    const raw = weekend();
    raw.events[0].competitions[4].competitors = [
      { order: 3, athlete: { displayName: "Kimi Antonelli", flag: { href: "i" } } },
      { order: 1, athlete: { displayName: "Lando Norris", flag: { href: "g" } } },
      { order: 7, athlete: { displayName: "George Russell", flag: { href: "g" } } },
      { order: 2, athlete: { displayName: "Max Verstappen", flag: { href: "n" } } },
      { order: 5, athlete: { displayName: "Lewis Hamilton", flag: { href: "g" } } },
      { order: 4, athlete: { displayName: "Charles Leclerc", flag: { href: "m" } } },
    ] as never;
    const race = toRacing(raw, F1).find((g) => g.session === "Race")!;
    expect(race.entrants.map((e) => e.place)).toEqual([1, 2, 3, 4, 5]);
    // The three letters a broadcast would caption them with.
    expect(race.entrants.map((e) => e.code)).toEqual([
      "NOR",
      "VER",
      "ANT",
      "LEC",
      "HAM",
    ]);
  });

  it("says the local clock before it starts and ESPN's words after", () => {
    const raw = weekend();
    const [pre] = toRacing(raw, F1);
    expect(pre.status).toMatch(/^\d{1,2}:\d{2}(AM|PM)$/);
    raw.events[0].competitions[4].status = {
      type: { state: "post", shortDetail: "Final" },
    } as never;
    const done = toRacing(raw, F1).find((g) => g.session === "Race")!;
    expect(done.state).toBe("final");
    expect(done.status).toBe("Final");
  });

  it("reads the lap number, and the total only when the text has one", () => {
    const raw = weekend();
    raw.events[0].competitions[4].status = {
      period: 41,
      type: { state: "in", shortDetail: "Lap 41/72" },
    } as never;
    const live = toRacing(raw, F1).find((g) => g.session === "Race")!;
    expect(live.state).toBe("live");
    expect(live.lap).toBe(41);
    expect(live.laps).toBe(72);
  });

  it("leaves the total absent rather than inventing one", () => {
    // The scoreboard carries no total anywhere. "LAP 41" is a normal state.
    const raw = weekend();
    raw.events[0].competitions[4].status = {
      period: 41,
      type: { state: "in", shortDetail: "In Progress" },
    } as never;
    const live = toRacing(raw, F1).find((g) => g.session === "Race")!;
    expect(live.lap).toBe(41);
    expect(live.laps).toBeUndefined();
  });

  it("drops a session it cannot put on a day", () => {
    // A board is days, so an undated session has nowhere to go. Dropped
    // rather than guessed at, like a fixture with no sides.
    const undated = {
      leagues: [{ name: "Formula 1" }],
      events: [{ id: "x", competitions: [{ type: { abbreviation: "Race" } }] }],
    };
    expect(toRacing(undated, F1)).toEqual([]);
  });

  it("answers empty for a league that is out of season", () => {
    expect(toRacing({}, F1)).toEqual([]);
    expect(toRacing({ events: [] }, F1)).toEqual([]);
  });
});

describe("the whole weekend comes back for every day of it", () => {
  it("lands each session on its own day once onDay has it", () => {
    // MEASURED against the live endpoint: asked for any date inside a race
    // weekend, ESPN answers with all five sessions, each carrying its own
    // date. So the board asks three times, gets the same five back three
    // times, and onDay sorts them out. That is why the adapter needed no
    // per-day special case (plan 010 #1 and #3).
    const all = toRacing(weekend(), F1);
    const day = (iso: string) =>
      onDay(all, at(iso), false).map((g) => (g as Field).session);
    expect(day("2026-08-21T00:00")).toEqual(["FP1", "FP2"]);
    expect(day("2026-08-22T00:00")).toEqual(["FP3", "Qual"]);
    expect(day("2026-08-23T00:00")).toEqual(["Race"]);
    // And a day outside it carries none of them.
    expect(day("2026-08-24T00:00")).toEqual([]);
  });
});

describe("toWeekend", () => {
  const event = weekend().events[0];

  it("dates the card by RACE day, not by the first session", () => {
    // FP1 is the 21st and the Grand Prix the 23rd. A person means the 23rd.
    expect(toWeekend(event, "Formula 1").date).toBe("AUG 23");
  });

  it("finds race day by label rather than by position", () => {
    // The same weekend with the race listed first. Position answers AUG 21.
    const odd = weekend([
      ["Race", "2026-08-23T13:00"],
      ["FP1", "2026-08-21T10:30"],
      ["FP2", "2026-08-21T14:00"],
      ["FP3", "2026-08-22T10:30"],
      ["Qual", "2026-08-22T14:00"],
    ]).events[0];
    expect(toWeekend(odd, "Formula 1").date).toBe("AUG 23");
  });

  it("marks only qualifying and the race as major", () => {
    const w = toWeekend(event, "Formula 1");
    expect(w.sessions.filter((s) => s.major).map((s) => s.label)).toEqual([
      "QUAL",
      "RACE",
    ]);
  });

  it("leaves the sprint race a step back, which is the trade-off chosen", () => {
    // The six sprint weekends run FP1/SS/SR/Qual/Race, and SR is a real
    // race with points. The ramp is about the two sessions everyone plans
    // around, so SR is grey. Pinned so it cannot drift back silently.
    const sprint = weekend([
      ["FP1", "2026-04-24T10:30"],
      ["SS", "2026-04-24T14:30"],
      ["SR", "2026-04-25T10:00"],
      ["Qual", "2026-04-25T14:00"],
      ["Race", "2026-04-26T13:00"],
    ]).events[0];
    expect(
      toWeekend(sprint, "Formula 1").sessions.filter((s) => s.major).map((s) => s.label),
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
    ]).events[0];
    const w = toWeekend(spain, "Formula 1");
    expect(w.sessions).toHaveLength(5);
    expect(w.sessions.map((s) => s.day)).toEqual([
      "FRI",
      "FRI",
      "SAT",
      "SAT",
      "SUN",
    ]);
  });
});

describe("sessionClock and sessionDay", () => {
  it("prints a time with no space inside it", () => {
    // The upcoming card puts a day and a time on one line, and a space
    // inside the time competes with the one between them for which gap
    // the eye reads as the separator.
    expect(sessionClock(at("2026-08-23T13:00"))).toMatch(
      /^\d{1,2}:\d{2}(AM|PM)$/,
    );
  });

  it("names the weekday in caps", () => {
    expect(sessionDay(at("2026-08-23T13:00"))).toBe("SUN");
  });
});

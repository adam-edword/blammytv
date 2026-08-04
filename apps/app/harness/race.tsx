import React from "react";
import ReactDOM from "react-dom/client";
import "../src/fonts";
import "../src/styles/tokens.css";
import "../src/styles/packs.css";
import "../src/styles/base.css";
import "../src/styles/ui.css";
import "../src/styles/themes.css";
import "../src/styles/sports.css";
import { RaceCard } from "../src/features/sports/RaceCard";
import type { Field } from "../src/features/sports/model";
import { WeekendCard } from "../src/features/sports/WeekendCard";
import type { Weekend } from "../src/features/sports/model";
import { toRacing, toWeekend } from "../src/features/sports/racing";
import circuits from "../src/features/sports/circuits/index.json";
import { applyAccent, loadAccent } from "../src/features/settings/accent";
import { applyTheme, loadTheme } from "../src/features/settings/theme";
import f1 from "./fixtures/f1.json";

/**
 * Rig for the race card. Dev-server only:
 *
 *   http://localhost:1420/harness/race.html
 *
 * The fixture is a REAL F1 weekend, pruned to the paths the card reads, so
 * the drivers, the flags, the sessions and the circuit are the ones the app
 * would get. The mapping below is the rig's, not the app's: the racing
 * adapter is still to be written, and putting a throwaway one in espn.ts to
 * see a card would be the wrong place for it.
 */

/**
 * The REAL mapper, not a copy of it.
 *
 * This rig used to carry its own toRaces, and a second mapper is a second
 * thing to keep in step: the moment the card grew a field the copy stopped
 * compiling, which is the good outcome, but it would just as easily have
 * gone on producing stale shapes. Dated past the fixture so toBoard sends
 * every event down the SESSION branch.
 */
const races: Field[] = toRacing(f1 as never, "racing/f1");

applyAccent(loadAccent());
applyTheme(loadTheme());

/**
 * The same card at every circuit on the calendar.
 *
 * The flag wash is the one part of this card whose weight is not ours to
 * set: a country supplies it. Hungary is red, white and green in even
 * bands; Japan is mostly white and Bahrain mostly red, and a treatment
 * tuned on one of those is not tuned. So all 24 render at once.
 */
const everywhere: Field[] = Object.entries(circuits.circuits).map(
  ([id, c], i) => ({
    ...races[Math.min(4, races.length - 1)],
    id: `flag-${id}`,
    circuitId: id,
    place: c.country ?? c.name,
    session: "Race",
    time: `${1 + (i % 12)}:00 PM`,
    // Undimmed on purpose: the fixture's sessions are all finished, and a
    // sheet for judging 24 flag washes must not view every one of them
    // through the finished state's 50% black.
    state: "live",
  }),
);

/**
 * The same session in every state it can be in, side by side.
 *
 * Four, not three, and the split is Adam's: an upcoming session, a live
 * RACE, a live practice or qualifying, and a finished one. The middle two
 * differ only in the header, and that is the whole reason they are two —
 * a race counts laps and nothing else does.
 *
 * The upcoming one has an EMPTY podium because the real payload has one:
 * measured, a `pre` session returns `competitors` of length zero.
 */
const base = races[Math.min(4, races.length - 1)];
const states: Field[] = [
  {
    ...base,
    id: "st-pre",
    session: "Race",
    state: "pre",
    // `entrants`, not `top`. The field was renamed when the union landed and
    // this rig kept the old spelling — which TypeScript could not tell it,
    // because the harness was outside `include`. Excess properties are
    // erased at runtime, so `top: []` did nothing and `entrants` stayed
    // spread from `base`: the card showed five drivers, and the ONE case
    // this entry exists to prove — that a `pre` session returns an empty
    // podium — was never on screen.
    entrants: [],
  },
  // A live race that knows its distance, and one that does not. The total
  // is optional in the model because the scoreboard has no field for it;
  // both readings have to look deliberate.
  { ...base, id: "st-live-race", session: "Race", state: "live", race: true, lap: 41, laps: 72 },
  { ...base, id: "st-live-nolaps", session: "Race", state: "live", race: true, lap: 41, laps: undefined },
  // Practice and qualifying: no lap worth counting, so it just says live.
  { ...base, id: "st-live-fp", session: "FP1", state: "live", race: false, lap: 33 },
  { ...base, id: "st-final", session: "Qual", state: "final" },
];

/**
 * The weekend card, through the REAL mapper rather than a rig one.
 *
 * `toWeekend` takes a raw event directly now, so there is no date to
 * fake: the split by day belongs to the board (onDay) and this rig only
 * ever wanted the weekend SHAPE.
 *
 * Both weekend shapes, because there are two and only two: the ordinary
 * FP1/FP2/FP3/Qual/Race, and the sprint FP1/SS/SR/Qual/Race, where the
 * greyed SR is an actual race with points. Adam's call, made against that.
 */
const events = (f1.events ?? []) as never[];
const weekends: Weekend[] = [
  ...events.map((e) => toWeekend(e, "Formula 1")),
  /* The LONGEST track name on the calendar and the shortest, because the
   * name is the one thing on this card whose width the source picks. The
   * spread is 7 characters ("Madring") to 34, in a column about 180px
   * wide, so the long one has to wrap and the short one must not look
   * stranded. */
  ...events.map((e) => toWeekend(e, "Formula 1")).flatMap((w) =>
    ["Suzuka International Racing Course", "Madring"].map((track, n) => ({
      ...w,
      id: `name-${n}`,
      place: n ? "Spain" : "Japan",
      track,
    })),
  ),
  ...events.slice(0, 1).map((e) => toWeekend(e, "Formula 1")).map((w, i) => ({
    ...w,
    id: `sprint-${i}`,
    sessions: w.sessions.map((s, n) =>
      n === 1
        ? { ...s, label: "SS", major: false }
        : n === 2
          ? { ...s, label: "SR", major: false }
          : s,
    ),
  })),
];

export function Rig() {
  return (
    <div
      // `sports` MATTERS, it is not decoration. --sports-name and the rest
      // are scoped to it, so without it every card here renders its country
      // at the 16px inherited fallback instead of the app's 28px, and the
      // rig quietly answers the wrong question about what fits.
      className="sports"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(383px, 1fr))",
        gap: 22,
        padding: 24,
        background: "#0a0a0a",
        minHeight: "100vh",
      }}
    >
      {weekends.map((w) => (
        <WeekendCard key={w.id} weekend={w} />
      ))}
      {states.map((r) => (
        <RaceCard key={r.id} race={r} />
      ))}
      {everywhere.map((r) => (
        <RaceCard key={r.id} race={r} />
      ))}
      {/* The same card with no art and no flag, which is every racing
        * league but F1. */}
      <RaceCard
        race={{
          ...races[Math.min(4, races.length - 1)],
          id: "no-art",
          circuitId: undefined,
          place: "St. Petersburg",
          league: "IndyCar Series",
        }}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Rig />
  </React.StrictMode>,
);

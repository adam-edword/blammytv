import React from "react";
import ReactDOM from "react-dom/client";
import "../src/fonts";
import "../src/styles/tokens.css";
import "../src/styles/packs.css";
import "../src/styles/base.css";
import "../src/styles/ui.css";
import "../src/styles/themes.css";
import "../src/styles/sports.css";
import { RaceCard, type Race } from "../src/features/sports/RaceCard";
import { WeekendCard, type Weekend } from "../src/features/sports/WeekendCard";
import { toBoard } from "../src/features/sports/race";
import { driverCode } from "../src/features/sports/driverCode";
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

const STATES: Record<string, Race["state"]> = { pre: "pre", in: "live", post: "final" };

interface RawSession {
  date?: string;
  type?: { abbreviation?: string };
  status?: { type?: { state?: string } };
  competitors?: {
    order?: number;
    athlete?: { displayName?: string; flag?: { href?: string } };
  }[];
}

function toRaces(): Race[] {
  const event = (f1.events ?? [])[0] as unknown as {
    id: string;
    circuit?: { id?: string; address?: { country?: string } };
    competitions?: RawSession[];
  };
  const series = f1.leagues?.[0]?.name ?? "Formula 1";
  return (event.competitions ?? []).map((s, i) => ({
    id: `${event.id}-${i}`,
    series,
    session: s.type?.abbreviation ?? "Session",
    place: event.circuit?.address?.country ?? "",
    circuitId: event.circuit?.id,
    time: new Date(s.date ?? "").toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    }),
    state: STATES[s.status?.type?.state ?? ""] ?? "pre",
    top: (s.competitors ?? [])
      .slice()
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
      .slice(0, 3)
      .map((c, n) => ({
        place: c.order ?? n + 1,
        name: c.athlete?.displayName ?? "",
        code: driverCode(c.athlete?.displayName ?? ""),
        mark: c.athlete?.flag?.href,
      })),
  }));
}

const races = toRaces();

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
const everywhere: Race[] = Object.entries(circuits.circuits).map(
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
 * The same session in all three states, side by side.
 *
 * Measured off the real payload rather than invented: an UPCOMING session
 * comes back with `competitors` of length ZERO, so its podium column is
 * empty here because it is empty there. That gap is the state Adam is
 * designing; the row exists so the other two can be judged against it.
 */
const base = races[Math.min(4, races.length - 1)];
const threeStates: Race[] = [
  { ...base, id: "st-pre", session: "Race", state: "pre", time: "9:00 AM", top: [] },
  { ...base, id: "st-live", session: "Race", state: "live", time: "LAP 32" },
  { ...base, id: "st-final", session: "Race", state: "final", time: "FINAL" },
];

/**
 * The weekend card, through the REAL mapper rather than a rig one.
 *
 * Dated a year back so toBoard's split sends every event down the weekend
 * branch: the fixture's own weekend is finished, and the branch worth
 * looking at here is the one the fixture cannot reach.
 *
 * Both weekend shapes, because there are two and only two: the ordinary
 * FP1/FP2/FP3/Qual/Race, and the sprint FP1/SS/SR/Qual/Race, where the
 * greyed SR is an actual race with points. Adam's call, made against that.
 */
const sprint = { ...f1, events: [{ ...(f1.events ?? [])[0] }] } as never;
const weekends: Weekend[] = [
  ...toBoard(f1 as never, new Date("2025-01-01")).weekends,
  /* The LONGEST track name on the calendar and the shortest, because the
   * name is the one thing on this card whose width the source picks. The
   * spread is 7 characters ("Madring") to 34, in a column about 180px
   * wide, so the long one has to wrap and the short one must not look
   * stranded. */
  ...toBoard(f1 as never, new Date("2025-01-01")).weekends.flatMap((w) =>
    ["Suzuka International Racing Course", "Madring"].map((track, n) => ({
      ...w,
      id: `name-${n}`,
      place: n ? "Spain" : "Japan",
      track,
    })),
  ),
  ...toBoard(sprint, new Date("2025-01-01")).weekends.map((w, i) => ({
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
      {threeStates.map((r) => (
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
          series: "IndyCar Series",
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

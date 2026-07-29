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
import { driverCode } from "../src/features/sports/driverCode";
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

export function Rig() {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 22,
        padding: 24,
        background: "#0a0a0a",
        minHeight: "100vh",
      }}
    >
      {races.map((r) => (
        <RaceCard key={r.id} race={r} />
      ))}
      {/* The same card with no art, which is every racing league but F1. */}
      <RaceCard race={{ ...races[4], id: "no-art", circuitId: undefined, place: "St. Petersburg", series: "IndyCar Series" }} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Rig />
  </React.StrictMode>,
);

import { useEffect, useState } from "react";
import { driverCode } from "./driverCode";
import type { Race } from "./RaceCard";

/**
 * Races, from the schedule (plan 010).
 *
 * TEMPORARY, deliberately, and narrower than the adapter this will become.
 * The board still fetches its five team leagues through espn.ts and knows
 * nothing about a Race; this fetches F1 on its own so the card can be seen
 * in the app while the real racing path is written. When it is, this moves
 * into espn.ts beside toGames and stops being a second front door.
 *
 * F1 only, and only because it is the one racing league with a circuit to
 * draw. The rest work through the same mapping and would simply have no
 * art; there is no reason to fetch six leagues to look at one card.
 */

const URL = "https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard";

const STATES: Record<string, Race["state"]> = {
  pre: "pre",
  in: "live",
  post: "final",
};

/** Only the paths this file reads, same discipline as espn.ts. */
interface RawSession {
  date?: string;
  type?: { abbreviation?: string };
  status?: { type?: { state?: string } };
  competitors?: {
    order?: number;
    athlete?: { displayName?: string; flag?: { href?: string } };
  }[];
}
interface RawRace {
  leagues?: { name?: string }[];
  events?: {
    id?: string;
    circuit?: { id?: string; address?: { country?: string } };
    competitions?: RawSession[];
  }[];
}

/**
 * A weekend's sessions, as cards.
 *
 * One card PER SESSION rather than one per weekend, because the sessions
 * are separate in the source and separate on the day: FP1, FP2, FP3, Qual
 * and Race each have their own clock, their own state and their own order,
 * and a card that averaged them would be answering no question at all.
 */
export function toRaces(raw: RawRace): Race[] {
  const series = raw.leagues?.[0]?.name ?? "Racing";
  return (raw.events ?? []).flatMap((event) =>
    (event.competitions ?? []).map((session, i) => ({
      id: `${event.id ?? "race"}-${i}`,
      series,
      session: session.type?.abbreviation ?? "Session",
      // The country, not the circuit: "Hungary" is what a person calls the
      // weekend, and the circuit's own name is on the art behind it.
      place: event.circuit?.address?.country ?? "",
      circuitId: event.circuit?.id,
      time: new Date(session.date ?? "").toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
      state: STATES[session.status?.type?.state ?? ""] ?? "pre",
      top: (session.competitors ?? [])
        .slice()
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
        .slice(0, 3)
        .map((c, n) => ({
          place: c.order ?? n + 1,
          name: c.athlete?.displayName ?? "",
          code: driverCode(c.athlete?.displayName ?? ""),
          // A country flag: the source carries no constructor.
          mark: c.athlete?.flag?.href,
        })),
    })),
  );
}

/** The current weekend's sessions, or nothing. A racing league being out
 * of season is the normal case for most of the year, not an error. */
export function useRaces(): Race[] {
  const [races, setRaces] = useState<Race[]>([]);
  useEffect(() => {
    const stop = new AbortController();
    fetch(URL, { signal: stop.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw: RawRace | null) => raw && setRaces(toRaces(raw)))
      .catch(() => undefined);
    return () => stop.abort();
  }, []);
  return races;
}

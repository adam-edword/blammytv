import { useEffect, useState } from "react";
import { driverCode } from "./driverCode";
import type { Race } from "./RaceCard";
import type { Session, Weekend } from "./WeekendCard";

/**
 * Races, from the schedule (plan 010).
 *
 * TEMPORARY, deliberately, and narrower than the adapter this will become.
 * The board still fetches its five team leagues through espn.ts and knows
 * nothing about a Race; this fetches F1 on its own so the cards can be seen
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

/**
 * The sessions the weekend is FOR.
 *
 * Adam's call, made against the trade-off: on the six sprint weekends a
 * season this leaves SR — an actual race, with points — a step back with
 * the practice sessions. The ramp is about the two sessions everyone plans
 * around, not about which sessions happen to be races.
 */
const MAJOR = new Set(["Qual", "Race"]);

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
interface RawEvent {
  id?: string;
  circuit?: { id?: string; address?: { country?: string } };
  competitions?: RawSession[];
}
interface RawRace {
  leagues?: { name?: string }[];
  events?: RawEvent[];
}

const time = (iso: string | undefined) =>
  new Date(iso ?? "")
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    // "1:00 PM" -> "1:00PM": the row is a label, a day and a time on one
    // line, and the space inside the time competes with the ones between
    // them for which gap the eye reads as the separator.
    .replace(/\s+/g, "");

const weekday = (iso: string | undefined) =>
  new Date(iso ?? "").toLocaleDateString([], { weekday: "short" }).toUpperCase();

/** Midnight on the day this instant falls in, in the reader's own zone. */
function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** The earliest session in a weekend, which is the day it breaks apart on. */
function firstDay(event: RawEvent): Date | undefined {
  const times = (event.competitions ?? [])
    .map((c) => new Date(c.date ?? "").getTime())
    .filter((t) => Number.isFinite(t));
  return times.length ? startOfDay(new Date(Math.min(...times))) : undefined;
}

/** A weekend's sessions as a schedule, for the one card that precedes them. */
function toWeekend(event: RawEvent, series: string): Weekend {
  const comps = event.competitions ?? [];
  const sessions: Session[] = comps.map((c) => ({
    label: (c.type?.abbreviation ?? "?").toUpperCase(),
    day: weekday(c.date),
    time: time(c.date),
    major: MAJOR.has(c.type?.abbreviation ?? ""),
  }));
  // RACE DAY, which is what a person means by the date of a Grand Prix.
  // By label rather than by position: the sessions arrive in order today,
  // but the label is the thing that actually says which one is the race.
  // Falling back to the last, which is where it has been all season.
  const race = comps.find((c) => c.type?.abbreviation === "Race") ?? comps.at(-1);
  return {
    id: `wk-${event.id ?? "race"}`,
    series,
    place: event.circuit?.address?.country ?? "",
    circuitId: event.circuit?.id,
    date: new Date(race?.date ?? "")
      .toLocaleDateString([], { month: "short", day: "numeric" })
      .toUpperCase(),
    sessions,
  };
}

/**
 * A weekend's sessions, as cards.
 *
 * One card PER SESSION rather than one per weekend, because once the
 * weekend is running the sessions are separate on the day: FP1, FP2, FP3,
 * Qual and Race each have their own clock, their own state and their own
 * order, and a card that averaged them would be answering no question.
 */
function toSessions(event: RawEvent, series: string): Race[] {
  return (event.competitions ?? []).map((session, i) => ({
    id: `${event.id ?? "race"}-${i}`,
    series,
    session: session.type?.abbreviation ?? "Session",
    // The country, not the circuit: "Hungary" is what a person calls the
    // weekend, and the circuit's own name is on the art behind it.
    place: event.circuit?.address?.country ?? "",
    circuitId: event.circuit?.id,
    time: time(session.date),
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
  }));
}

/**
 * The board's racing cards: weekends that have not started, and the
 * sessions of the ones that have.
 *
 * THE SPLIT IS BY DAY, not by whether FP1 is running. Adam's rule, and it
 * is the better one: a board that rearranged itself the minute a practice
 * session went green would move under someone reading it, and "is it this
 * weekend yet" is a question about the date rather than about a clock.
 *
 * `today` is a parameter so this can be tested without owning the clock,
 * the same reason dayLabel takes one.
 */
export function toBoard(
  raw: RawRace,
  today = new Date(),
): { weekends: Weekend[]; sessions: Race[] } {
  const series = raw.leagues?.[0]?.name ?? "Racing";
  const midnight = startOfDay(today);
  const weekends: Weekend[] = [];
  const sessions: Race[] = [];
  for (const event of raw.events ?? []) {
    const first = firstDay(event);
    // No usable dates: treat it as running, because a weekend card with no
    // schedule on it is the one thing this card cannot be.
    if (first && midnight.getTime() < first.getTime()) {
      weekends.push(toWeekend(event, series));
    } else {
      sessions.push(...toSessions(event, series));
    }
  }
  return { weekends, sessions };
}

/** The current weekend's cards, or nothing. A racing league being out of
 * season is the normal case for most of the year, not an error. */
export function useRaces(): { weekends: Weekend[]; sessions: Race[] } {
  const [board, setBoard] = useState<{ weekends: Weekend[]; sessions: Race[] }>({
    weekends: [],
    sessions: [],
  });
  useEffect(() => {
    const stop = new AbortController();
    fetch(URL, { signal: stop.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw: RawRace | null) => raw && setBoard(toBoard(raw)))
      .catch(() => undefined);
    return () => stop.abort();
  }, []);
  return board;
}

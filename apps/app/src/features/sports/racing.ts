import { driverCode } from "./driverCode";
import type { Entrant, Field, GameState, Session, Weekend } from "./model";

/**
 * Racing, as sessions on the board (plan 010 #1).
 *
 * This used to be `race.ts`, a second front door: it fetched F1 on its own
 * with its own cache and its own hook, and joined nothing. It is an
 * adapter now, sitting beside espn.ts's fixture mapper and reached the
 * same way — `fetchLeague` dispatches on the catalog path's sport segment,
 * so a racing league is a followed league like any other.
 *
 * WHAT THE ENDPOINT DOES, because it is not what the fixture one does and
 * the difference is load-bearing. Asked for a date inside a race weekend
 * it answers with the WHOLE weekend, all five sessions, each carrying its
 * own date; asked for a date outside one it answers with nothing. Measured
 * against Zandvoort, 2026-08-21 to 23:
 *
 *   ?dates=20260821  ->  FP1, SS, SR, Qual, Race
 *   ?dates=20260822  ->  the same five
 *   ?dates=20260819  ->  no events
 *
 * So the board asks three times and gets the same five sessions back three
 * times, and `onDay` sorts them out: FP1 and SS land on Friday, SR and
 * Qual on Saturday, the race on Sunday. That is plan 010 #3 arriving for
 * free, and it is why this needed no per-day special case in the end.
 */

/** ESPN's three states, in this app's words. */
const STATES: Record<string, GameState> = {
  pre: "pre",
  in: "live",
  post: "final",
};

/**
 * The sessions that are actually races, and so count laps.
 *
 * The Grand Prix and, on the six sprint weekends, the sprint. Practice and
 * qualifying have a lap number too, but it is whatever lap the session
 * happens to have reached and it is not a thing anyone is counting.
 */
const RACES = new Set(["Race", "SR"]);

/**
 * What the abbreviations mean, for the tooltip.
 *
 * The source gives an abbreviation and NOTHING else: `type.text` and
 * `type.name` are both absent, so every expansion here is ours.
 *
 * The card keeps the short form, and that is measured rather than lazy. At
 * the board's narrowest 315px track, "SPRINT" pushes the country 4.3px past
 * the card's padding and "SPRINT QUAL" makes it overlap the schedule by
 * 9.9px. So the long name lives on the row's tooltip, where it costs no
 * width at all (plan 010 #9).
 */
export const SESSION_NAMES: Record<string, string> = {
  FP1: "Free Practice 1",
  FP2: "Free Practice 2",
  FP3: "Free Practice 3",
  QUAL: "Qualifying",
  RACE: "Race",
  SS: "Sprint Qualifying",
  SR: "Sprint Race",
};

/** How much of the field to carry. The cards slice it: three on the small
 * card's podium, five on the wide one. */
const FIELD = 5;

/** Only the paths this file reads, same discipline as espn.ts. */
interface RawSession {
  id?: string;
  date?: string;
  type?: { abbreviation?: string };
  status?: {
    period?: number;
    type?: { state?: string; detail?: string; shortDetail?: string };
  };
  /** Present on every F1 session, and it is "Apple TV" for 2026. */
  broadcasts?: { names?: string[] }[];
  competitors?: {
    order?: number;
    athlete?: { displayName?: string; flag?: { href?: string } };
  }[];
}
export interface RawRacingEvent {
  id?: string;
  circuit?: { id?: string; fullName?: string; address?: { country?: string } };
  competitions?: RawSession[];
}
export interface RawRacing {
  leagues?: { name?: string; abbreviation?: string }[];
  events?: RawRacingEvent[];
}

/**
 * The race distance, if the source happens to say it.
 *
 * IT USUALLY WILL NOT. Measured over a full season, the scoreboard carries
 * `status.period` — a lap NUMBER — and no total anywhere: a search of
 * every key in a finished Grand Prix for lap, team or constructor returns
 * nothing. ESPN's own live text is the only place a total could appear,
 * and confirming that needs a running session (plan 010 #8).
 *
 * Hence a parse rather than a field, and an optional answer.
 */
function lapTotal(session: RawSession): number | undefined {
  const text = `${session.status?.type?.shortDetail ?? ""} ${session.status?.type?.detail ?? ""}`;
  const found = /lap\s*\d+\s*(?:\/|of)\s*(\d+)/i.exec(text);
  return found ? Number(found[1]) : undefined;
}

/**
 * A racing scoreboard as Fields, one per session.
 *
 * One per SESSION rather than one per weekend, because on the day the
 * sessions are separate things: FP1, Qual and the race each have their own
 * clock, their own state and their own order, and a card that averaged
 * them would be answering no question.
 */
export function toRacing(raw: RawRacing, path: string): Field[] {
  // The LONG name here, where the fixture adapter prefers the
  // abbreviation. "MLB" is what a fixture card has room for and "Formula
  // 1" is what a race card says; the race card's league line is a whole
  // column rather than a corner, so it can hold it.
  const league = raw.leagues?.[0]?.name ?? raw.leagues?.[0]?.abbreviation ?? path;
  const sport = path.slice(0, path.indexOf("/")) || path;
  return (raw.events ?? []).flatMap((event) =>
    (event.competitions ?? [])
      .map((session, i) => toField(event, session, i, path, sport, league))
      .filter((f): f is Field => f !== null),
  );
}

function toField(
  event: RawRacingEvent,
  session: RawSession,
  index: number,
  path: string,
  sport: string,
  league: string,
): Field | null {
  const start = new Date(session.date ?? "");
  // A session with no usable time cannot be put on a day, and a board is
  // days. Dropped rather than guessed at, like a fixture with no sides.
  if (!event.id || Number.isNaN(start.getTime())) return null;
  const abbr = session.type?.abbreviation ?? "Session";
  const state = STATES[session.status?.type?.state ?? ""] ?? "pre";
  const entrants: Entrant[] = (session.competitors ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .slice(0, FIELD)
    .map((c, n) => ({
      place: c.order ?? n + 1,
      name: c.athlete?.displayName ?? "",
      code: driverCode(c.athlete?.displayName ?? ""),
      // A country flag: the source carries no constructor.
      mark: c.athlete?.flag?.href,
    }));
  return {
    kind: "field",
    // The session id where there is one, the index where there is not.
    // Five sessions share an event id, so the event id alone would
    // collide five ways and React would render one card.
    id: `espn-${path}-${event.id}-${session.id ?? index}`,
    sport,
    league,
    leagueKey: path,
    state,
    start,
    // ESPN's own words once it is running or done, the local clock before
    // that, exactly as the fixture adapter decides it.
    status:
      state === "pre"
        ? sessionClock(start)
        : (session.status?.type?.shortDetail ?? ""),
    session: abbr,
    // The country, not the circuit: "Hungary" is what a person calls the
    // weekend, and the circuit's own name goes where a stadium goes.
    place: event.circuit?.address?.country ?? "",
    venue: event.circuit?.fullName,
    circuitId: event.circuit?.id,
    race: RACES.has(abbr),
    lap: session.status?.period,
    laps: lapTotal(session),
    entrants,
    broadcasts: [
      ...new Set((session.broadcasts ?? []).flatMap((b) => b.names ?? [])),
    ],
    // Filled by the matcher against the user's own channels. Racing needs
    // its own path there, keyed on the series rather than on team names
    // (plan 010 #5); until that lands this resolves off `broadcasts`.
    channels: [],
  };
}

/** The long name for a session abbreviation, for a tooltip. */
export function sessionName(abbr: string): string | undefined {
  return SESSION_NAMES[abbr.toUpperCase()];
}

/**
 * A session's kick-off, as the cards print it: "1:00PM".
 *
 * No space inside the time, which is deliberate. The upcoming card puts a
 * day and a time on one line, and a space inside the time competes with
 * the one between them for which gap the eye reads as the separator.
 */
export function sessionClock(start: Date): string {
  return start
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .replace(/\s+/g, "");
}

/** "SAT". Only the upcoming card shows it; the rest are on the day. */
export function sessionDay(start: Date): string {
  return start.toLocaleDateString([], { weekday: "short" }).toUpperCase();
}

/**
 * The sessions the weekend is FOR.
 *
 * Adam's call, made against the trade-off: on the six sprint weekends a
 * season this leaves SR — an actual race, with points — a step back with
 * the practice sessions. The ramp is about the two sessions everyone plans
 * around, not about which sessions happen to be races.
 */
const MAJOR = new Set(["Qual", "Race"]);

/**
 * A whole weekend as ONE card, for the days before it starts.
 *
 * NOT ON THE BOARD TODAY, and that is a consequence of two decisions
 * rather than an oversight. Adam's: racing sits on its real dates and
 * falls off the home board when it is outside the window. The endpoint's:
 * a date outside a race weekend answers with no events at all. Together
 * those mean the earliest racing can appear is the day of FP1, by which
 * point the weekend has broken into sessions and this card's moment has
 * passed.
 *
 * Kept, with its tests, because it comes back with #36: narrow the board
 * to F1 and it reaches out to the next event, which is exactly the
 * question this card answers. The rig renders it meanwhile.
 */
export function toWeekend(
  event: RawRacingEvent,
  series: string,
  path = "racing/f1",
): Weekend {
  const comps = event.competitions ?? [];
  const sessions: Session[] = comps.map((c) => {
    const label = (c.type?.abbreviation ?? "?").toUpperCase();
    const when = new Date(c.date ?? "");
    return {
      label,
      full: SESSION_NAMES[label],
      day: sessionDay(when),
      time: sessionClock(when),
      major: MAJOR.has(c.type?.abbreviation ?? ""),
    };
  });
  // RACE DAY, which is what a person means by the date of a Grand Prix.
  // By label rather than by position: the sessions arrive in order today,
  // but the label is the thing that actually says which one is the race.
  // Falling back to the last, which is where it has been all season.
  const race = comps.find((c) => c.type?.abbreviation === "Race") ?? comps.at(-1);
  const raceDay = new Date(race?.date ?? "");
  return {
    kind: "weekend",
    id: `wk-${event.id ?? "race"}`,
    sport: "racing",
    league: series,
    leagueKey: path,
    // Always upcoming, by construction: a weekend only ever reaches the
    // board ahead of its own window (see Weekend in model.ts). Once it is
    // running, the sessions are the things on the board.
    state: "pre",
    /**
     * RACE DAY, not the first session, and it is what puts the card on the
     * right heading. The board files a game under `start`, and a Grand Prix
     * three weeks out belongs under the Sunday everyone plans around rather
     * than under the Friday practice nobody is asking about.
     */
    start: raceDay,
    // The card draws its own date and schedule, so this is only what a
    // screen reader and a tooltip would say.
    status: sessionClock(raceDay),
    venue: event.circuit?.fullName,
    // The weekend as a whole is not broadcast; its sessions are, and they
    // carry their own when they arrive on the board in their own right.
    broadcasts: [],
    channels: [],
    series,
    place: event.circuit?.address?.country ?? "",
    // From the payload rather than the vendored index, so a circuit whose
    // art we have not got still gets named.
    track: event.circuit?.fullName,
    circuitId: event.circuit?.id,
    date: raceDay
      .toLocaleDateString([], { month: "short", day: "numeric" })
      .toUpperCase(),
    sessions,
  };
}

/**
 * A racing scoreboard as WEEKENDS, one per event.
 *
 * The other half of `toRacing`, and which one runs is a question about
 * WHEN rather than about the data. Asked about a day, the answer is the
 * sessions on it; asked what is next (the bare call, plan 010 #36), the
 * answer is a weekend three weeks out, and breaking that into five cards
 * across three dated headings is how Adam found it: "shouldn't this be the
 * schedule card thingy? not all broken out".
 */
export function toWeekends(raw: RawRacing, path: string): Weekend[] {
  const league = raw.leagues?.[0]?.name ?? raw.leagues?.[0]?.abbreviation ?? path;
  return (raw.events ?? [])
    .map((event) => toWeekend(event, league, path))
    // Same rule the session mapper applies: no usable race date, no day to
    // put it on, so it is dropped rather than guessed at.
    .filter((w) => !Number.isNaN(w.start.getTime()));
}

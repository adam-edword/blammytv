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

/**
 * The WHOLE season, not the bare scoreboard.
 *
 * The bare one answers with the current weekend only, and for most of the
 * year that weekend has already run — so the weekend card, which is the
 * shape for a weekend that has NOT run, could never appear. A season is one
 * request and holds both sides of the split.
 */
const URL = (year: number) =>
  `https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard?dates=${year}`;

const STATES: Record<string, Race["state"]> = {
  pre: "pre",
  in: "live",
  post: "final",
};

/**
 * How much of the field to carry into a Race.
 *
 * The cards decide what they draw: three on the small card's podium, five
 * on the wide one. This is only the ceiling on what is kept.
 */
const FIELD = 5;

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
 * width at all.
 */
const SESSION_NAMES: Record<string, string> = {
  FP1: "Free Practice 1",
  FP2: "Free Practice 2",
  FP3: "Free Practice 3",
  QUAL: "Qualifying",
  RACE: "Race",
  SS: "Sprint Qualifying",
  SR: "Sprint Race",
};

/**
 * The race distance, if the source happens to say it.
 *
 * IT USUALLY WILL NOT. Measured over a full season, the scoreboard carries
 * `status.period` — a lap NUMBER — and no total anywhere: a search of
 * every key in a finished Grand Prix for lap, team or constructor returns
 * nothing. ESPN's own live text is the only place a total could appear,
 * and F1 is not running, so this cannot be confirmed from here.
 *
 * Hence a parse rather than a field, and an optional answer. The card
 * reads "LAP 41 / 72" when this finds a total and "LAP 41" when it does
 * not, and the second is a normal state rather than a broken one.
 */
function lapTotal(session: RawSession): number | undefined {
  const text = `${session.status?.type?.shortDetail ?? ""} ${session.status?.type?.detail ?? ""}`;
  const found = /lap\s*\d+\s*(?:\/|of)\s*(\d+)/i.exec(text);
  return found ? Number(found[1]) : undefined;
}

/** Only the paths this file reads, same discipline as espn.ts. */
interface RawSession {
  date?: string;
  type?: { abbreviation?: string };
  status?: {
    period?: number;
    type?: { state?: string; detail?: string; shortDetail?: string };
  };
  /** Present on every F1 session, and it is "Apple TV" for 2026. */
  broadcasts?: { market?: string; names?: string[] }[];
  competitors?: {
    order?: number;
    athlete?: { displayName?: string; flag?: { href?: string } };
  }[];
}
interface RawEvent {
  id?: string;
  circuit?: { id?: string; fullName?: string; address?: { country?: string } };
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

/**
 * Has this weekend not started yet?
 *
 * An event with no usable dates counts as started, because a weekend card
 * with no schedule on it is the one thing that card cannot be.
 */
function ahead(event: RawEvent, midnight: Date): boolean {
  const first = firstDay(event);
  return !!first && midnight.getTime() < first.getTime();
}

/** A weekend's sessions as a schedule, for the one card that precedes them. */
function toWeekend(event: RawEvent, series: string): Weekend {
  const comps = event.competitions ?? [];
  const sessions: Session[] = comps.map((c) => {
    const label = (c.type?.abbreviation ?? "?").toUpperCase();
    return {
      label,
      full: SESSION_NAMES[label],
      day: weekday(c.date),
      time: time(c.date),
      major: MAJOR.has(c.type?.abbreviation ?? ""),
    };
  });
  // RACE DAY, which is what a person means by the date of a Grand Prix.
  // By label rather than by position: the sessions arrive in order today,
  // but the label is the thing that actually says which one is the race.
  // Falling back to the last, which is where it has been all season.
  const race = comps.find((c) => c.type?.abbreviation === "Race") ?? comps.at(-1);
  return {
    id: `wk-${event.id ?? "race"}`,
    series,
    place: event.circuit?.address?.country ?? "",
    // From the payload rather than the vendored index, so a circuit whose
    // art we have not got still gets named.
    track: event.circuit?.fullName,
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
    track: event.circuit?.fullName,
    circuitId: event.circuit?.id,
    time: time(session.date),
    start: new Date(session.date ?? ""),
    day: weekday(session.date),
    // Flattened and de-duplicated, the way espn.ts does it for a fixture.
    // No market ordering: a race has no home feed to rank against.
    broadcasts: [
      ...new Set((session.broadcasts ?? []).flatMap((b) => b.names ?? [])),
    ],
    // Filled by the matcher once racing is a real adapter (plan 010 #1).
    channels: [],
    race: RACES.has(session.type?.abbreviation ?? ""),
    lap: session.status?.period,
    laps: lapTotal(session),
    state: STATES[session.status?.type?.state ?? ""] ?? "pre",
    top: (session.competitors ?? [])
      .slice()
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
      // As many as the widest card wants. The small card slices this to
      // three for its podium; the wide one takes five. Carrying the extra
      // two costs a name and a flag URL each and saves a second fetch
      // shape when the adapter lands.
      .slice(0, FIELD)
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
    if (ahead(event, midnight)) weekends.push(toWeekend(event, series));
    else sessions.push(...toSessions(event, series));
  }
  return { weekends, sessions };
}

/**
 * What a board should actually carry, out of a whole season.
 *
 * A season is 24 weekends and 120 sessions, and by July most of it has
 * happened; mapping the lot would drop sixty-five finished practice cards
 * onto today's grid. Two events are the ones with anything to say right
 * now: the most recent to have STARTED, whose sessions are the ones with
 * live and final states on them, and the next one still ahead, which is the
 * weekend card.
 *
 * TEMPORARY in its placement rather than its logic — the real adapter will
 * put each session on its own day instead of at the head of today — but the
 * choice of which two weekends matter is the same either way.
 *
 * Events arrive in calendar order, so the last started and the first ahead
 * are the two ends of the split.
 */
export function nextUp(
  raw: RawRace,
  today = new Date(),
): { weekends: Weekend[]; sessions: Race[] } {
  const midnight = startOfDay(today);
  const events = raw.events ?? [];
  const running = events.filter((e) => !ahead(e, midnight)).at(-1);
  const upcoming = events.find((e) => ahead(e, midnight));
  return toBoard(
    { ...raw, events: [running, upcoming].filter((e): e is RawEvent => !!e) },
    today,
  );
}

/** The current weekend's cards, or nothing. A racing league being out of
 * season is the normal case for most of the year, not an error. */
/**
 * The season, fetched at most once a run.
 *
 * A SEASON, which is 3.5MB of JSON, and the screen is unmounted every time
 * you flip to the Guide. Without this, every visit to the tab re-fetched
 * and re-parsed all of it to pull out the two weekends that matter, which
 * is 12 to 18ms of main thread parse on top of the download.
 *
 * A calendar is the right thing to hold: it is fixed months ahead, and the
 * live half of a weekend, the state and the order, is read from it fresh
 * each time by nextUp rather than cached here. The cost of a stale
 * calendar is a session appearing an hour late in its own listing; the
 * cost of not caching is paying for a season on every tab flip.
 *
 * Deliberately for the life of the process, like the guide's own session
 * cache in live/source.ts, which exists for exactly this reason.
 */
let season: Promise<RawRace | null> | null = null;

function seasonOnce(year: number): Promise<RawRace | null> {
  season ??= fetch(URL(year))
    // A NON-2XX MUST THROW. Returning null from the `then` FULFILS the
    // promise, so the `catch` below never ran and a single 429 or 500 was
    // remembered as "no racing" for the life of the process. The comment
    // under it said the opposite of what the code did. The board polls
    // ESPN every 90 seconds, so a rate-limit response is not hypothetical.
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<RawRace>;
    })
    // A failed load must not be remembered as an answer, or the tab is
    // empty until the app restarts.
    .catch(() => {
      season = null;
      return null;
    });
  return season;
}

/**
 * TEMPORARY, and the most temporary thing in this file: one staged LIVE
 * session, so the wide race card can be looked at in the app.
 *
 * It exists because of a calendar. F1 ran at the Hungaroring on 26 July
 * and does not run again until Zandvoort on 21 August, and the wide card
 * only ever appears while a session is RUNNING (plan 010 #4, Adam's rule).
 * So on any day between those two there is no way to see the card at all,
 * which makes it impossible to judge.
 *
 * WHAT IS REAL: the circuit, its id and art, the country, the session's
 * broadcast ("Apple TV", which is genuinely F1's 2026 US rights), and the
 * drivers with their flags and their finishing order.
 *
 * WHAT IS STAGED: that it is happening. The order is the last race that
 * actually ran, because Zandvoort has not, and the lap is a number.
 *
 * Deletes itself along with everything else in this file when the racing
 * adapter lands, and until then it is one card that says LIVE about a race
 * that is not. Nobody should ship a release with this in it.
 */
export function demoLive(raw: RawRace, today = new Date()): Race | null {
  const midnight = startOfDay(today);
  const events = raw.events ?? [];
  const next = events.find((e) => ahead(e, midnight));
  // The most recent weekend to have run, for a field with real names in it.
  const ran = events.filter((e) => !ahead(e, midnight)).at(-1);
  if (!next || !ran) return null;
  const finished = (ran.competitions ?? []).find(
    (c) => c.type?.abbreviation === "Race",
  );
  const race = (next.competitions ?? []).find(
    (c) => c.type?.abbreviation === "Race",
  );
  if (!finished || !race) return null;
  const [session] = toSessions({ ...next, competitions: [race] }, "Formula 1");
  const [order] = toSessions({ ...ran, competitions: [finished] }, "Formula 1");
  return {
    ...session,
    state: "live",
    // Zandvoort's real distance, which is the one number here that could
    // not come from the payload: the scoreboard carries no lap total (plan
    // 010 #8, unverifiable until a session is actually running).
    lap: 41,
    laps: 72,
    top: order.top,
  };
}

export function useRaces(): {
  weekends: Weekend[];
  sessions: Race[];
  /** TEMPORARY, see demoLive. */
  demo: Race | null;
} {
  const [board, setBoard] = useState<{
    weekends: Weekend[];
    sessions: Race[];
    demo: Race | null;
  }>({
    weekends: [],
    sessions: [],
    demo: null,
  });
  useEffect(() => {
    const stop = new AbortController();
    // NO SIGNAL. The first caller's AbortController must not own a cache
    // every later caller shares: under StrictMode the first effect's
    // cleanup aborts before the second effect runs, the second gets the
    // already-doomed promise back from `??=`, and the board stays empty
    // for the whole mount. Verified in the harness: one request, aborted,
    // zero race cards. Cancellation is the `aborted` check below, which
    // guards the state update rather than the shared request.
    void seasonOnce(new Date().getFullYear())
      .then((raw) => {
        if (raw && !stop.signal.aborted)
          setBoard({ ...nextUp(raw), demo: demoLive(raw) });
      })
      .catch(() => undefined);
    return () => stop.abort();
  }, []);
  return board;
}

/**
 * A golf scoreboard as an ordered field (plan 010 #10).
 *
 * THE RACE CARD WITH A DIFFERENT NUMBER, which is what the plan predicted
 * and what the data confirms: an ordered list of people, a flag each, and
 * one figure that decides the order. So golf maps to `Field` rather than
 * earning a fifth kind, and everything the board already does — bucketing a
 * day, matching channels, following a league, memoising a card — works
 * unchanged.
 *
 * WHAT THE SOURCE ACTUALLY CARRIES, probed against a finished 3M Open (144
 * competitors) and all five golf leagues on 2026-08-04:
 *
 *   order        leaderboard position
 *   score        to par, as a STRING: "-25", "E"
 *   linescores   one per round: { value: 64, displayValue: "-7", period: 1 }
 *                and each of those nests its own 18 holes
 *   athlete      displayName and flag (href + a country `alt`)
 *
 * And what it does NOT carry, each of which was a design question until it
 * was answered:
 *
 *   par / course   NOTHING. No course object, no yardage, no par, anywhere
 *                  in the payload. A card cannot say "PAR 73".
 *   winner         absent entirely, unlike UFC. Position 1 is the winner.
 *   statistics     present as a key and empty on every competitor, finished
 *                  or not.
 *   thru           no such field — but every round nests its holes, and the
 *                  ones already played are the ones with a score, so it is
 *                  derivable. See `thruHoles`.
 */

import type { Entrant, Field, GameState } from "./model";

/** How deep a card could ever want. The real field is 57 to 147. */
const DEPTH = 8;

/** Every round is 18, which is the one number about golf we can assume. */
const HOLES = 18;

interface RawHole {
  value?: number;
}
interface RawRound {
  value?: number;
  displayValue?: string;
  period?: number;
  linescores?: RawHole[];
}
interface RawGolfCompetitor {
  order?: number;
  score?: string;
  athlete?: { displayName?: string; flag?: { href?: string; alt?: string } };
  linescores?: RawRound[];
}
interface RawGolfCompetition {
  id?: string;
  competitors?: RawGolfCompetitor[];
  status?: { type?: { state?: string; completed?: boolean; description?: string } };
  broadcasts?: { names?: string[] }[];
}
export interface RawGolfEvent {
  id?: string;
  name?: string;
  shortName?: string;
  date?: string;
  endDate?: string;
  competitions?: RawGolfCompetition[];
  status?: { type?: { state?: string; completed?: boolean; description?: string } };
}
export interface RawGolf {
  leagues?: { name?: string; abbreviation?: string }[];
  events?: RawGolfEvent[];
}

/** Is this catalog path one of the five golf leagues? */
export function golfPath(path: string): boolean {
  return path.startsWith("golf/");
}

/**
 * Which round is being played, from the deepest one anybody has a score in.
 *
 * Derived rather than read, because there is no round field. Rounds arrive
 * as `linescores` with a `period`, so the highest period anyone has started
 * is the round in progress.
 */
function currentRound(field: RawGolfCompetitor[]): number {
  let round = 0;
  for (const c of field)
    for (const r of c.linescores ?? [])
      if ((r.period ?? 0) > round && (r.value != null || r.linescores?.length))
        round = r.period ?? 0;
  return round;
}

/**
 * How far through the round the LEADERS are.
 *
 * The leaders and not the field, because that is what a leaderboard header
 * means by "thru": the last group out is always further behind and saying
 * so would be answering a different question. Taken as the furthest anyone
 * in the top few has reached.
 *
 * A hole counts as played when it has a score. A round that is over reads
 * 18, which the card should show as nothing at all rather than "THRU 18".
 */
function thruHoles(field: RawGolfCompetitor[], round: number): number | undefined {
  if (!round) return undefined;
  let thru = 0;
  for (const c of field.slice(0, DEPTH)) {
    const r = (c.linescores ?? []).find((x) => x.period === round);
    const played = (r?.linescores ?? []).filter((h) => h.value != null).length;
    if (played > thru) thru = played;
  }
  return thru > 0 && thru < HOLES ? thru : undefined;
}

/**
 * A golf scoreboard as Fields, one per tournament.
 *
 * One card per EVENT rather than per round, which is the opposite of
 * racing's choice and right for the same reason racing's is: a race weekend
 * is five separate things with their own clocks, and a golf tournament is
 * one thing that takes four days. The leaderboard is cumulative, so a card
 * per round would be four views of one number.
 */
export function toGolf(raw: RawGolf, path: string): Field[] {
  // The LONG name, as racing does: the card's league line is a full column
  // rather than a corner, and "PGA TOUR" reads better than "PGA".
  const league = raw.leagues?.[0]?.name ?? raw.leagues?.[0]?.abbreviation ?? path;
  const sport = path.slice(0, path.indexOf("/")) || path;
  return (raw.events ?? [])
    .map((event) => toLeaderboard(event, path, sport, league))
    .filter((f): f is Field => f !== null);
}

function toLeaderboard(
  event: RawGolfEvent,
  path: string,
  sport: string,
  league: string,
): Field | null {
  if (!event.id || !event.date) return null;
  const comp = event.competitions?.[0];
  const raw = comp?.competitors ?? [];
  const status = comp?.status?.type ?? event.status?.type;
  const state: GameState =
    status?.state === "post" ? "final" : status?.state === "in" ? "live" : "pre";

  const field = raw
    .slice()
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const round = currentRound(field);

  /*
   * NOBODY BEFORE THE FIRST TEE, and that is a real state rather than a
   * guard. Measured across the five leagues: LPGA, the DP World Tour and
   * the Champions Tour return ZERO competitors while an event is `pre`,
   * and the PGA and LIV return the whole field with every player on "E"
   * and null rounds. A leaderboard of 147 players tied at even is not a
   * leaderboard, so an event that has not started carries no entrants at
   * all and the card shows its own face for that.
   */
  const entrants: Entrant[] =
    state === "pre"
      ? []
      : field.slice(0, DEPTH).map((c, i) => ({
          place: c.order ?? i + 1,
          name: c.athlete?.displayName ?? "",
          // No code. A golf scoreboard captions by country, and inventing
          // three letters for a player nobody abbreviates would be us
          // writing a caption that does not exist. See Entrant.code.
          mark: c.athlete?.flag?.href,
          score: c.score,
        }));

  return {
    kind: "field",
    id: `espn-${path}-${event.id}`,
    sport,
    league,
    leagueKey: path,
    state,
    start: new Date(event.date),
    // Thursday to Sunday. The upcoming card leads with the range, because
    // before anyone tees off that is the whole of what is known.
    end: event.endDate ? new Date(event.endDate) : undefined,
    // ESPN's own words once it is running or done. Before that the DATE
    // rather than a clock: a tournament starts on a Thursday and runs to a
    // Sunday, so a tee time is the wrong grain.
    status:
      state === "pre"
        ? new Date(event.date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })
        : (status?.description ?? ""),
    // The tournament's own name goes where a race puts its country, which
    // is the card's big slot. There is no course to put anywhere else: the
    // payload carries no venue for golf at all.
    session: round ? `Round ${round}` : "",
    place: event.name ?? event.shortName ?? "",
    // Not a race, so the card must not count laps at it.
    race: false,
    thru: thruHoles(field, round),
    entrants,
    broadcasts: [
      ...new Set((comp?.broadcasts ?? []).flatMap((b) => b.names ?? [])),
    ],
    // Filled by the matcher against the user's own channels. Golf is one of
    // the few sports where the source populates broadcasts at all — 3 of 3
    // in the #27 sweep — so this resolves like a fixture does.
    channels: [],
  };
}

/**
 * "AUG 6-9", or "AUG 28 - SEP 1" when a tournament straddles a month.
 *
 * The one thing an upcoming golf card can say that is worth the room. Both
 * dates are the source's; the formatting is ours, and it renders in LOCAL
 * time from the absolute instants like everything else on the board.
 *
 * Falls back to the single day when there is no end date, rather than
 * inventing one — a range with a guessed end is worse than a start.
 */
export function dateRange(start: Date, end?: Date): string {
  const month = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short" }).toUpperCase();
  if (!end || start.toDateString() === end.toDateString())
    return `${month(start)} ${start.getDate()}`;
  return month(start) === month(end)
    ? `${month(start)} ${start.getDate()}-${end.getDate()}`
    : `${month(start)} ${start.getDate()} - ${month(end)} ${end.getDate()}`;
}

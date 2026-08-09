import { driverCode } from "./driverCode";
import { league as catalogLeague } from "./leagues";
import { toRacing, toWeekends, type RawRacing } from "./racing";
import { golfPath, toGolf, type RawGolf } from "./golf";
import { isTournament } from "./model";
import type { Competitor, Fixture, Game, GameState, Tournament } from "./model";

/**
 * The schedule source (plan 010, phase 1): ESPN's undocumented scoreboard
 * JSON, mapped into this app's own types.
 *
 * Undocumented means it can change under us without warning, so this file
 * is the only one that knows a single ESPN field name, every read is
 * defensive, and one bad event is dropped rather than taking the row with
 * it. The fixtures beside it are real responses, pruned to the paths read
 * here, so a shape change fails a test instead of an evening.
 *
 * The gate that chose it (2026-07-26): 16/16 NFL, 15/15 MLB and 1/1 Premier
 * League fixtures carried a broadcast name, and the names are the kind that
 * match a channel list ("NBC", "FOX", "MASN", "Peacock"). CORS is open
 * (`access-control-allow-origin: *`), so this runs in the webview rather
 * than through Rust.
 */

const BASE = "https://site.api.espn.com/apis/site/v2/sports";

/**
 * The six biggest leagues, and NO LONGER what an empty store fetches.
 *
 * It was the floor under "nothing followed" and it is not any more: an empty
 * store now asks for the whole catalog, because an absent preference is not
 * a preference for these six, and a board that already looks curated gives
 * nobody a reason to curate it (see fetchList).
 *
 * What is left is a sensible default ARGUMENT — the value `fetchGames` and
 * `useGames` fall back to when handed no list at all, which in practice
 * means the tests and the layout rig. Kept as a named export rather than
 * inlined there because "the six a reasonable person would name" is a real
 * thing to want, and both onboarding items (plan 010 #18, #19) will want it
 * again as the set a first run can start from with one click.
 */
export const DEFAULT_LEAGUES: readonly string[] = [
  "football/nfl",
  "basketball/nba",
  "baseball/mlb",
  "hockey/nhl",
  "soccer/eng.1",
  "racing/f1",
];

/**
 * At most this many ESPN requests in flight at once, across the whole app.
 *
 * It used to be five, structurally: five hardcoded leagues, one request
 * each. Now the fetch list is whatever is followed over a 151-league
 * catalog, times three days, so a keen follower could open twenty leagues
 * and put sixty requests on the wire in one frame. This is a free endpoint
 * we do not own and the plan's own instruction is to behave like a guest.
 *
 * Six rather than one: a board that loads serially over twenty leagues is a
 * board you watch fill in. Six keeps the wire busy without ever looking
 * like a scrape.
 */
const MAX_INFLIGHT = 6;
let inflight = 0;
const waiting: (() => void)[] = [];

/** Run `job` when there is room, FIFO. */
async function gate<T>(job: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_INFLIGHT) await new Promise<void>((r) => waiting.push(r));
  inflight++;
  try {
    return await job();
  } finally {
    inflight--;
    waiting.shift()?.();
  }
}

/* ------------------------------------------------------------------ */
/* Behaving like a guest, second half (plan 010 #15).                  */
/*                                                                      */
/* The concurrency half shipped in v0.8.120: six requests in flight     */
/* across every league. What was missing is not asking for what we      */
/* already have, and not hammering something that just said no.         */
/* ------------------------------------------------------------------ */

/**
 * How long a response stays good enough to hand back without asking again.
 *
 * DELIBERATELY SHORTER THAN THE REFRESH. `useGames` re-reads today every 90
 * seconds because scores move, and a cache that outlived that would freeze
 * them, which is a worse bug than the one this fixes. 30 seconds only
 * collapses asks that are genuinely duplicates: a StrictMode double-mount,
 * two screens wanting the same league, or the club reach landing on a league
 * the window just read.
 */
const CACHE_MS = 30_000;

/** First wait after a failure. Doubles per consecutive failure. */
const BACKOFF_BASE_MS = 5_000;
/** And stops doubling here, so a long outage settles into a slow poll
 * rather than an exponential one that effectively never retries. */
const BACKOFF_MAX_MS = 5 * 60_000;

const fresh = new Map<string, { at: number; games: Game[] }>();
const failures = new Map<string, { count: number; until: number }>();

/** Test seam. The module holds process-wide state by design, so a test that
 * did not clear it would be reading another test's answers. */
export function resetEspnCache(): void {
  fresh.clear();
  failures.clear();
}

/**
 * The retry gate. Returns 0 when the URL is free to ask, otherwise the ms
 * still to wait.
 *
 * Per URL rather than per host: one league being down says nothing about the
 * other 150, and blocking all of them on one bad path would turn a single
 * dead endpoint into "Couldn't reach the schedule".
 */
function backoffLeft(url: string, now: number): number {
  const f = failures.get(url);
  return f && f.until > now ? f.until - now : 0;
}

function noteFailure(url: string, now: number): void {
  const prev = failures.get(url)?.count ?? 0;
  const count = prev + 1;
  const wait = Math.min(BACKOFF_BASE_MS * 2 ** (count - 1), BACKOFF_MAX_MS);
  failures.set(url, { count, until: now + wait });
}

/** ESPN's three states, in this app's words. */
const STATES: Record<string, GameState> = {
  pre: "pre",
  in: "live",
  post: "final",
};

/** Only the paths this file reads. The rest of the payload is ignored. */
interface RawScoreboard {
  leagues?: { name?: string; abbreviation?: string }[];
  events?: RawEvent[];
}
interface RawEvent {
  id?: string;
  date?: string;
  /** "National Bank Open presented by Rogers". The tournament's own name,
   * which is what a tournament card headlines with. */
  name?: string;
  shortName?: string;
  /** The last day of a multi-day event. */
  endDate?: string;
  /** "Toronto, Canada" on a tournament, where a fixture carries a stadium. */
  venue?: { displayName?: string };
  competitions?: RawCompetition[];
  /**
   * Tennis, and only tennis so far.
   *
   * A tournament puts its matches under groupings (Men's Singles, Women's
   * Doubles) and leaves `competitions` EMPTY, so an adapter that reads
   * only `competitions` sees a tournament with nothing in it. Measured on
   * a real ATP board: two events, `competitions` length 0 on both,
   * `groupings` length 2 and 4, holding 54 and 121 matches.
   *
   * The whole DRAW, not the day: a single National Bank Open event carries
   * 284 matches spread over a fortnight. See toTournaments for why that
   * makes the summary per-day rather than per-event.
   */
  groupings?: {
    grouping?: { displayName?: string };
    competitions?: RawCompetition[];
  }[];
  /**
   * The event-level status, and it CANNOT BE TRUSTED. Measured on
   * 2026-08-03: the National Bank Open runs to 2026-08-14 and its event
   * status already read STATUS_FINAL with `completed: true`. A tournament's
   * state is derived from the matches actually being played that day.
   */
  status?: { type?: { state?: string } };
}
interface RawCompetition {
  id?: string;
  date?: string;
  attendance?: number;
  status?: {
    type?: {
      state?: string;
      /** False on postponed, suspended, retired and walkover, all of which
       * arrive as state "post". See toGame. */
      completed?: boolean;
      detail?: string;
      shortDetail?: string;
    };
  };
  venue?: {
    fullName?: string;
    /** Tennis only: "Centre Court", "Court 3", "Grandstand". */
    court?: string;
    address?: { city?: string };
  };
  /**
   * Each entry says WHICH feed it is: "national", "home" or "away".
   *
   * CLE @ CIN carries MLB.TV (national), Reds.TV (home) and
   * CLEGuardians.TV (away). All three are legitimate ways to watch, so all
   * three stay searchable, but which one a card HEADLINES should not be
   * decided by the order ESPN happened to send them in.
   */
  broadcasts?: { market?: string; names?: string[] }[];
  competitors?: RawCompetitor[];
  /**
   * A playoff series, already written out: "CLE leads series 2-0", "Series
   * tied 1-1", "OU wins series 2-1".
   *
   * Null all summer and on every regular-season game, so this is a field
   * that is either the most important thing on the card or absent. Measured
   * on 2026-04-20: 3/3 NBA and 4/4 NHL games carried one.
   */
  series?: { summary?: string };
  /** "Round 1", "Quarterfinal", "Final". Tournament matches carry it and
   * it is the one thing that says where in a draw a day sits. */
  round?: { displayName?: string };
  /**
   * Why this game is not an ordinary one: "Hall of Fame Game", "East 1st
   * Round - Game 2", "NBA Canada Games 2026", "Paris Saint-Germain win 4-3
   * on penalties". 14 of 182 events across an 18-board sweep.
   */
  notes?: { headline?: string; text?: string }[];
  /**
   * A wire one-liner about this fixture. `type` is "Preview" before and
   * "Recap" after; `shortLinkText` is the sentence, already trimmed to a
   * length a headline can be. 41 of 182 in the same sweep, and near every
   * MLB game.
   */
  headlines?: { type?: string; shortLinkText?: string }[];
}
interface RawCompetitor {
  homeAway?: string;
  score?: string;
  /**
   * A set-by-set line. Tennis scores this way and carries no `score` at
   * all, so the scoreline is derived from it: see setsWon.
   */
  linescores?: { value?: number; winner?: boolean }[];
  /** An individual sport's competitor. Tennis has this where a team sport
   * has `team`, with the same job. */
  athlete?: {
    id?: string;
    displayName?: string;
    shortName?: string;
    flag?: { href?: string };
  };
  /**
   * A PAIR, in doubles. Same job as `athlete`, for two people: the payload
   * drops `athlete` entirely and carries a roster instead, already written
   * as "Finn Reynolds / James Watt". Measured: 37 of 175 matches on a real
   * ATP board are doubles, and reading only `athlete` left every one of
   * them with no name at all.
   */
  roster?: { displayName?: string; shortDisplayName?: string };
  /**
   * Won-lost, in however many columns the sport keeps: "59-53" (MLB),
   * "41-25-16" (NHL, with overtime losses), "9-3-5" (soccer, with draws),
   * "54-14-1" (college baseball, with ties).
   *
   * Several rows, split home and away. `type: "total"` is the one a card
   * means by "their record". Present on 156 of 182 events across an
   * 18-board sweep; see teamRecord for why two thirds of those are still
   * not worth drawing.
   */
  records?: { type?: string; summary?: string }[];
  team?: {
    id?: string;
    displayName?: string;
    shortDisplayName?: string;
    abbreviation?: string;
    color?: string;
    logo?: string;
  };
}

/**
 * Is this league an ordered field rather than a set of fixtures?
 *
 * By the catalog path's sport segment, which is ESPN's own word. Golf will
 * join this the day it has a card (plan 010 #10); it is deliberately not a
 * list of league slugs, because the shape belongs to the sport.
 */
export function racingPath(path: string): boolean {
  return path.startsWith("racing/");
}

/**
 * A date as the endpoint wants it: YYYYMMDD, built from LOCAL parts.
 *
 * Local rather than UTC because the question being asked is "what is on
 * Tuesday", and whose Tuesday that is comes from the person asking, not
 * from Greenwich.
 */
export function espnDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/**
 * One league's scoreboard as games, or an empty list.
 *
 * A league that is out of season answers 200 with no events, which is the
 * normal case for most of the year and not an error.
 *
 * Without a date it answers for today, and "today" is its own idea, not
 * necessarily yours: a league between matchdays hands back its NEXT one,
 * which can be a month away. Whatever asks for a specific day should also
 * check that it got that day.
 */
export async function fetchLeague(
  path: string,
  {
    date,
    signal,
    ahead,
    withinDays,
  }: {
    date?: Date;
    signal?: AbortSignal;
    ahead?: boolean;
    /**
     * A bounded window forward, in days, for "when does this CLUB next
     * play" (plan 010 #40).
     *
     * The bare `ahead` call answers for a LEAGUE, which is useless for a
     * followed club: a mid-season league hands back somebody else's
     * fixture. Asking a range and filtering to the club is the only way to
     * get there without a per-team endpoint, and the per-team one is worse
     * (measured 2026-08-08: `/teams/10/schedule` on MLB is a whole season,
     * 2.6 MB).
     *
     * Bounded rather than open because the payload tracks events-in-window
     * and ESPN caps a response at 100 events, so an open range on a
     * daily-cadence league is megabytes to find one row. Measured over
     * 20260808 forward:
     *
     * | league | 14 days        | 30 days        |
     * |--------|----------------|----------------|
     * | EPL    | 63 KB, 6       | 222 KB, 30     |
     * | NFL    | (pre-season)   | 369 KB, 48     |
     * | MLB    | 1.5 MB, 100    | 1.5 MB, 100    |
     *
     * MLB is the same 1.5 MB at 7, 14 and 30 days because it hits the cap
     * either way. That is affordable precisely where it is never needed: a
     * club that plays daily is not absent from a three-day window, so this
     * does not fire for MLB. It fires for weekly-cadence leagues, and there
     * 14 days is 63 KB.
     */
    withinDays?: number;
  } = {},
): Promise<Game[]> {
  /**
   * A day, a SEASON, or whatever is next.
   *
   * The bare call answers with a league's next event and nothing else,
   * which is right for "when is the NBA back" and wrong for racing: Adam,
   * looking at one lonely Dutch Grand Prix, "shouldn't there be more than
   * just NED? like the rest of the schedule should be showing".
   *
   * A year does answer, and only racing can afford to ask. Measured
   * 2026-08-03: `?dates=2026` on F1 returns all 25 rounds, 152 KB gzipped
   * in 0.64s, of which 12 are still ahead. The same question asked of a
   * team league would be a whole season of fixtures — 1,230 games for the
   * NBA, 2,430 for MLB — which is a wall nobody asked for and megabytes to
   * find it in. A racing calendar IS the thing people plan around, and it
   * is 25 rows.
   */
  const season = ahead && racingPath(path);
  /**
   * A rolling twelve months, NOT the calendar year.
   *
   * `?dates=2026` asks for a year that is mostly over. On 20 December every
   * round it returns has already run, `loadAhead` filters them all out, and
   * a followed racing league shows nothing at all until 1 January — the
   * exact silence #36 exists to prevent, arriving at the worst moment.
   *
   * ESPN accepts a RANGE, confirmed against the live endpoint on 2026-08-04:
   *   ?dates=2026               25 events, 2026-03-06 .. 2026-12-04
   *   ?dates=20260804-20270804  12 events, 2026-08-21 .. 2026-12-04
   * The range answers with the season still AHEAD, which is what was
   * wanted, and carries the year boundary with it. It is also half the
   * payload, since the 13 rounds already run are never sent.
   *
   * A future year alone does not work — `?dates=2027` answers with the 2026
   * season — so the range is the mechanism rather than a preference.
   */
  const rolling = () => {
    const from = new Date();
    const to = new Date(from);
    to.setFullYear(to.getFullYear() + 1);
    return `${espnDate(from)}-${espnDate(to)}`;
  };
  /** A bounded range forward from today, for `withinDays`. */
  const within = (days: number) => {
    const from = new Date();
    const to = new Date(from);
    to.setDate(to.getDate() + days);
    return `${espnDate(from)}-${espnDate(to)}`;
  };
  const url =
    `${BASE}/${path}/scoreboard` +
    (date
      ? `?dates=${espnDate(date)}`
      : withinDays
        ? `?dates=${within(withinDays)}`
        : season
          ? `?dates=${rolling()}`
          : "");
  const now = Date.now();
  // Already have it, recently enough. Returned before the gate, so a
  // duplicate ask does not even occupy a slot other leagues are queuing for.
  const hit = fresh.get(url);
  if (hit && now - hit.at < CACHE_MS) return hit.games;
  // Said no recently. Failing here rather than asking is the whole point:
  // fetchBoard degrades one league quietly, so the board keeps its other
  // rows instead of everyone retrying a dead path every 90 seconds.
  const wait = backoffLeft(url, now);
  if (wait > 0) {
    throw new Error(
      `ESPN ${path}: backing off, ${Math.ceil(wait / 1000)}s left`,
    );
  }
  // The slot covers the whole transfer, not just the handshake: releasing
  // it at the response header would let six more requests start while six
  // bodies were still downloading.
  let raw: RawScoreboard;
  try {
    raw = await gate(async () => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`ESPN ${path}: HTTP ${res.status}`);
      return (await res.json()) as RawScoreboard;
    });
  } catch (err) {
    // An ABORT is not a failure of the endpoint, it is us changing our mind:
    // navigating away or re-narrowing the board aborts in-flight requests,
    // and counting those would back off a perfectly healthy league because
    // the user clicked twice.
    if (!signal?.aborted) noteFailure(url, Date.now());
    throw err;
  }
  failures.delete(url);
  // Which MAPPER, decided by the catalog path's sport segment. A racing
  // scoreboard is an event with five sessions rather than a fixture with
  // two sides, so it maps to Fields (racing.ts) where everything else maps
  // to Fixtures. Same request, same gate, same fetch list: the only thing
  // racing gets to be special about is its shape.
  // GOLF is a third shape: an ordered leaderboard rather than two sides or
  // a race weekend. Same dispatch point, same rule — the only thing a sport
  // gets to be special about is how its events are put together.
  // ONE exit, because the cache is written here and three returns would be
  // three places to forget it.
  const games = golfPath(path)
    ? toGolf(raw as RawGolf, path)
    : !racingPath(path)
      ? toGames(raw, path)
      : // SESSIONS or a WEEKEND, and it is a question about when rather than
        // about the data. Asked about a day, the sessions on it are the
        // answer; asked what is NEXT, a weekend three weeks out is one thing
        // to plan around, and five session cards under three dated headings
        // is not.
        ahead
        ? toWeekends(raw as RawRacing, path)
        : toRacing(raw as RawRacing, path);
  fresh.set(url, { at: Date.now(), games });
  return games;
}

/**
 * Every followed league at once. One league failing does not take the
 * others: a board with four sports on it beats an error page because the
 * NHL is having a bad night.
 *
 * Takes the list rather than owning it. WHAT to fetch is a question about
 * what the user follows, which this file has no business answering; it maps
 * responses into Games and nothing else.
 */
export async function fetchGames(
  paths: readonly string[] = DEFAULT_LEAGUES,
  opts: { date?: Date; signal?: AbortSignal; ahead?: boolean } = {},
): Promise<Game[]> {
  return (await fetchBoard(paths, opts)).games;
}

/**
 * The same fetch, and WHICH PATHS ARE WORTH ASKING AGAIN.
 *
 * The board polls today every 90 seconds, and an empty follow store now puts
 * all 151 catalog leagues on the fetch list. Re-asking all 151 on every tick
 * is roughly 100 requests a minute at a free, undocumented endpoint we do
 * not own, which is the behaviour this file's header rules out.
 *
 * It is also almost entirely waste. Measured across the catalog on
 * 2026-08-03: 151 leagues answered, 20 of them had anything on at all. A
 * league with no game today at nine in the morning still has none at eight
 * in the evening — a day's fixture list is known in advance — so the only
 * paths whose answers can still CHANGE are the ones that returned something.
 *
 * FAILURES COUNT AS WORTH RETRYING, which is the whole reason this returns a
 * list rather than the caller deriving one from `games`. A league that threw
 * contributed no game to read a path back off, so a derived list would drop
 * it silently and never ask again for the rest of the session — turning one
 * bad response into a league that is missing until the app restarts.
 */
export async function fetchBoard(
  paths: readonly string[] = DEFAULT_LEAGUES,
  opts: {
    date?: Date;
    signal?: AbortSignal;
    ahead?: boolean;
    withinDays?: number;
  } = {},
): Promise<{ games: Game[]; answered: string[] }> {
  const settled = await Promise.allSettled(
    paths.map((p) => fetchLeague(p, opts)),
  );
  const answered = paths.filter((_, i) => {
    const r = settled[i];
    return r.status === "rejected" || r.value.length > 0;
  });
  const ok = settled.filter((r) => r.status === "fulfilled");
  // EVERY league failing is not a quiet day, it is an outage, and the two
  // looked identical: allSettled never rejects, so the screen's own
  // "Couldn't reach the schedule" could not render and a dead connection
  // was reported as "Nothing on today". On a Saturday that is simply false.
  //
  // One league failing still degrades quietly, which is the paragraph above
  // and still right: a board with four sports on it beats an error page
  // because the NHL is having a bad night.
  if (settled.length > 0 && ok.length === 0) {
    throw new Error("every league failed");
  }
  return {
    games: dedupe(ok.flatMap((r) => (r as PromiseFulfilledResult<Game[]>).value)),
    answered: [...answered],
  };
}

/**
 * One card per id, because two leagues can serve the same event.
 *
 * Only tournaments can collide, by construction: a fixture's id carries its
 * league path, so nothing else in the catalog can name the same card. Tennis
 * can, and does on every single tournament — atp and wta both return the
 * full combined draw sheet, so without this every tennis card on the board
 * appeared twice.
 *
 * The collision MERGES rather than picks. Dropping the second copy would
 * also drop the fact that the other tour served it, and paths are sorted
 * upstream, so "tennis/atp" would win every time and someone following only
 * the WTA would lose a tournament that is half women's draws.
 */
export function dedupe(games: Game[]): Game[] {
  const by = new Map<string, Game>();
  for (const game of games) {
    const seen = by.get(game.id);
    if (!seen) {
      by.set(game.id, game);
      continue;
    }
    if (isTournament(seen) && isTournament(game)) {
      by.set(game.id, {
        ...seen,
        keys: [...new Set([...seen.keys, ...game.keys])],
      });
    }
  }
  return [...by.values()];
}

/**
 * The mapping, split out so the tests can run it on a saved response.
 *
 * `path` is the catalog id ("baseball/mlb", "soccer/eng.1"), and it is the
 * only thing this needs to know about which league it is looking at. It was
 * a row from a hardcoded table of five; the table is gone, and a path is
 * something the catalog can hand over for any of 151.
 */
export function toGames(raw: RawScoreboard, path: string): Game[] {
  // "Premier League", "MLB": the short one is what the card's league line
  // has room for. Falls back to the long name, then to the catalog's own
  // label, then to the path.
  //
  // The response first because it is the source's own wording for the
  // competition it just answered about, and the catalog after because a
  // league out of season answers 200 with no `leagues` block to read.
  const name =
    raw.leagues?.[0]?.abbreviation ??
    raw.leagues?.[0]?.name ??
    catalogLeague(path)?.label ??
    path;
  // "soccer/eng.1" -> "soccer". ESPN's own first path segment, which is
  // what the catalog is keyed by too.
  const sport = path.slice(0, path.indexOf("/")) || path;
  return (raw.events ?? []).flatMap((e): Game[] => {
    // A DRAW rather than a meeting. An event with no `competitions` and
    // groupings instead is a tournament, and it summarises to one card a
    // day instead of expanding to its whole draw. Detected by SHAPE, not by
    // a list of league slugs, for the same reason racingPath is: how an
    // event is put together belongs to the event.
    if (!e.competitions?.length && e.groupings?.length) {
      return toTournaments(e, path, sport, name);
    }
    const matches = e.competitions ?? [];
    // The suffix only appears when it has to. A one match event keeps the
    // id it has always had, which matters: ids are React keys and the
    // row's scroll anchor, and renaming every game in the app to support
    // tennis would be a large blast radius for no gain.
    return matches
      .map((c, i) =>
        toGame(
          e,
          c,
          matches.length > 1 ? (c.id ?? String(i)) : null,
          path,
          sport,
          name,
        ),
      )
      .filter((g): g is Fixture => g !== null);
  });
}

/**
 * A tournament, as one card PER DAY it plays on.
 *
 * Three measurements decided this shape, all taken on 2026-08-03/04 across
 * the whole 151-league catalog:
 *
 *   THE SCALE. One WTA event carries its entire draw — 284 to 447 matches
 *   over a fortnight — and 89 of them landed on a single day. Tennis was
 *   256 of the 304 cards a whole-catalog board would draw, so 84% of the
 *   screen was one sport's early rounds.
 *
 *   THE DATE. A summary of the whole event would carry the first match's
 *   date, so `onDay` would file a two-week tournament under its opening
 *   Monday and it would vanish for the other thirteen days. Grouping the
 *   draw by day and emitting one per day is what makes the existing day
 *   filter do the right thing with no special case.
 *
 *   THE STATE. `event.status` says STATUS_FINAL on a tournament that runs
 *   for another eleven days, so it is ignored: a day is live if anything on
 *   it is on court, otherwise upcoming if anything has yet to start, and
 *   finished only when all of it is.
 */
function toTournaments(
  event: RawEvent,
  path: string,
  sport: string,
  leagueName: string,
): Tournament[] {
  if (!event.id) return [];
  const title = event.shortName ?? event.name;
  if (!title) return [];
  const end = event.endDate ? new Date(event.endDate) : undefined;

  /**
   * The day's matches, keyed by LOCAL date, same as `onDay` buckets by.
   *
   * Mapped through the ordinary per-match path, so a tennis match inside a
   * tournament is exactly the Fixture it always was — scored in sets, with
   * a doubles pair named off its roster. Only its ALTITUDE changed.
   */
  const byDay = new Map<string, { draw?: string; round?: string; game: Fixture }[]>();
  for (const group of event.groupings ?? []) {
    const draw = group.grouping?.displayName;
    for (const comp of group.competitions ?? []) {
      const mapped = toGame(event, comp, comp.id ?? null, path, sport, leagueName);
      if (!mapped) continue;
      // Which draw, remembered on the match itself: the screen filters on
      // it and the grouping is lost once these are flattened.
      const game: Fixture = draw ? { ...mapped, draw } : mapped;
      const key = game.start.toDateString();
      const entry = { draw, round: comp.round?.displayName, game };
      const bucket = byDay.get(key);
      if (bucket) bucket.push(entry);
      else byDay.set(key, [entry]);
    }
  }

  return [...byDay.values()].map((day) => {
    const matches = day
      .map((m) => m.game)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const start = matches[0].start;
    const playing = matches.filter((m) => m.state === "live").length;
    const state: GameState =
      playing > 0
        ? "live"
        : matches.some((m) => m.state !== "final")
          ? "pre"
          : "final";
    return {
      kind: "tournament" as const,
      /**
       * NO PATH IN THE ID, deliberately, and it is what makes the duplicate
       * collapse. ESPN's tennis/atp and tennis/wta scoreboards return the
       * SAME combined events: measured, all 405 of ATP's match ids were
       * among WTA's 447, with identical men's and women's draws on both.
       * Keying on the sport and the event id means both feeds name the same
       * card and `fetchGames` folds them into one. The day is in the id
       * because there is one of these per day.
       */
      id: `espn-tournament-${sport}-${event.id}-${espnDate(start)}`,
      sport,
      league: leagueName,
      leagueKey: path,
      // Both feeds' paths, merged on dedupe below. A tournament is not "an
      // ATP event": the same draw sheet carries men's and women's, so
      // following either tour has to be able to reach it.
      keys: [path],
      state,
      start,
      status:
        state === "live"
          ? `${playing} LIVE`
          : state === "final"
            ? "Final"
            : statusText("pre", start),
      title,
      matches,
      // Ordered as the source listed them, deduped: a day can straddle two
      // rounds, and 2026-08-04 did exactly that ("Round 1", "Round 2").
      rounds: unique(day.map((m) => m.round)),
      draws: unique(day.map((m) => m.draw)),
      venue: event.venue?.displayName,
      end,
      // The day's networks, flattened across its matches. Tennis carried
      // none at all when this was measured, so the matcher will find
      // nothing and the card will say so honestly rather than guess.
      broadcasts: [...new Set(matches.flatMap((m) => m.broadcasts))],
      channels: [],
    };
  });
}

/** Present, in order, once each. */
function unique(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

/**
 * Sets won, which is what a tennis scoreline actually is.
 *
 * The competitors carry no `score`, only a set by set `linescores`. Two
 * players at [6,4,2] and [3,6,6] have not scored 12 and 15, they have won
 * one set and two. Counting the sets is the only reading that puts the
 * right number on a card.
 *
 * The per set `winner` flag first, and comparing games only when it is
 * missing. A tiebreak set is filed as `{ value: 6, tiebreak: 6, winner:
 * false }`, so the flag is the source's own answer to a question the games
 * column does not quite ask.
 *
 * Returns a NUMBER, including zero. A player who lost in straight sets won
 * none, and zero is a score: the first version of this ran the result
 * through `|| undefined` and blanked every whitewash on the board.
 */
function setsWon(
  mine?: { value?: number; winner?: boolean }[],
  theirs?: { value?: number; winner?: boolean }[],
): number | undefined {
  if (!mine?.length) return undefined;
  let won = 0;
  for (let i = 0; i < mine.length; i++) {
    const a = mine[i];
    if (a?.winner != null) {
      if (a.winner) won++;
      continue;
    }
    const b = theirs?.[i];
    if (a?.value != null && b?.value != null && a.value > b.value) won++;
  }
  return won;
}

function toGame(
  event: RawEvent,
  comp: RawCompetition | undefined,
  suffix: string | null,
  path: string,
  sport: string,
  leagueName: string,
): Fixture | null {
  const home = pick(comp?.competitors, "home");
  const away = pick(comp?.competitors, "away");
  // Everything downstream is built around two sides and a start time. An
  // event without them is not a thing this app can draw.
  if (!event.id || !comp || !home || !away) return null;
  // The MATCH's own date first. A tennis event is a week long, so the
  // tournament's date says nothing about when any single match is on, and
  // taking it would file every match in the draw under the Monday.
  const start = new Date(comp.date ?? event.date ?? "");
  if (Number.isNaN(start.getTime())) return null;

  /**
   * POSTPONED IS NOT A RESULT, and ESPN files it as one.
   *
   * A postponed game comes back with state "post" and a 0-0 line, so it
   * mapped straight to `final` and the board drew it as a finished nil-nil
   * draw: dimmed, collapsed into a compact result, and beaten by nobody.
   * Real example, ATL @ NYM on 2026-07-28.
   *
   * `completed` is the boolean that separates them and it is already in
   * every response. A `post` that never completed has not been played, so
   * it reads as one that has not happened yet, and it keeps ESPN's own word
   * for why rather than showing a kick-off time that is no longer true.
   */
  const raw = comp.status?.type;
  const abandoned = raw?.state === "post" && raw?.completed === false;
  /**
   * SUSPENDED IS NOT POSTPONED, which the rule above could not tell apart.
   *
   * Both arrive as `post` with `completed: false`, so a match stopped
   * part-way through was being called "not played yet". Surfaced by the
   * draw screen (#38), where four real matches sat under "Upcoming"
   * carrying scores of 3-6, 1-0 — a fixture that has not happened does not
   * have a scoreline.
   *
   * The scoreline IS the difference, and it needs no new field: a
   * postponement is 0-0 with nothing on the line, where a suspended match
   * has games on the board. So an abandoned game that has been PLAYED is
   * treated as unfinished rather than unstarted, which files it with the
   * other matches still to resolve. ESPN's own word ("Suspended") is
   * already what the status says.
   */
  const played = (comp.competitors ?? []).some(
    (c) => (c.linescores?.length ?? 0) > 0 || Number(c.score) > 0,
  );
  const state = abandoned
    ? played
      ? "live"
      : "pre"
    : (STATES[raw?.state ?? ""] ?? "pre");
  return {
    kind: "fixture",
    // The slash stays. It is only ever a React key, a data attribute and a
    // quoted attribute selector, all of which take it literally, and an id
    // you can read back to a path is worth more than one that is tidy.
    id: `espn-${path}-${event.id}${suffix ? `-${suffix}` : ""}`,
    sport,
    league: leagueName,
    leagueKey: path,
    state,
    start,
    status: abandoned
      ? (raw?.shortDetail ?? raw?.detail ?? "Postponed")
      : statusText(state, start, raw?.shortDetail),
    home: toCompetitor(home, away),
    away: toCompetitor(away, home),
    // The COURT where a tournament sends one ("Court 3", "Grandstand"),
    // because inside an event whose venue is already "Toronto, Canada" the
    // city is the one thing every match on the day has in common. No other
    // sport sends `court`, so nothing else changes shape.
    venue:
      comp.venue?.court ?? comp.venue?.fullName ?? comp.venue?.address?.city,
    // WHY THIS GAME MATTERS, where the source says so. The series first:
    // "CLE leads series 2-0" tells you what "East 1st Round - Game 2"
    // only implies, and a playoff game carries both.
    //
    // Never a spoiler about THIS game. A series line counts games already
    // played, and an event note names the occasion.
    note: comp.series?.summary ?? comp.notes?.[0]?.headline ?? comp.notes?.[0]?.text,
    // The wire's own sentence about the fixture. Too long for a card face,
    // which is why it lands in the tooltip.
    headline: comp.headlines?.[0]?.shortLinkText,
    // Flattened and de-duplicated, but ORDERED: national first, then the
    // home feed, then the away one.
    //
    // A game carries all three and the matcher wants a plain list, so the
    // shape stays a string array. What changes is that `broadcasts[0]` is
    // now the neutral feed by construction rather than by whatever order
    // the payload arrived in, because that is the one the card prints as
    // "On MLB.TV". A regional feed is still a real way to watch and is
    // still offered; it just should not be the headline.
    broadcasts: orderedBroadcasts(comp.broadcasts),
    // Filled by the matcher against the user's own channels (phase 2).
    channels: [],
  };
}

/**
 * What the card's status line says.
 *
 * Live and finished games get ESPN's own words, because only it knows that
 * baseball says "Bot 11th" and soccer says "45'+2". A game that has not
 * started gets the local kick-off time instead: ESPN's own is either the
 * useless "Scheduled" (soccer) or a US-Eastern wall time with the date
 * stapled on (NFL), and neither is what someone scanning tonight wants.
 *
 * A finished game is trimmed at the slash: ESPN qualifies it with however
 * it got there ("Final/11", "Final/OT", "Final/SO") and the card only
 * claims that it is over. Trimmed rather than replaced with "Final", so
 * that anything else the post state carries survives intact.
 *
 * A live game is trimmed at the comma, for the same reason from the other
 * end. ESPN prefixes the clock with why it is not running ("Delayed, Top
 * 1st", "Rain Delay, Bot 3rd"), and the answer to "where is this game up
 * to" is the part after the comma. The prefix is a story about the weather.
 * Everything ESPN says without a comma is already the clock ("Bot 7th",
 * "Q3 4:11", "45'+2"), and a bare "Delayed" with no clock behind it keeps
 * its word, because then it is the only thing known.
 */
function statusText(state: GameState, start: Date, shortDetail?: string): string {
  if (state === "final") return (shortDetail ?? "").split("/")[0].trim();
  if (state === "live") return (shortDetail ?? "").split(",").pop()?.trim() ?? "";
  return start
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .replace(/\s/g, "");
}

/**
 * One side of a fixture, whoever they are.
 *
 * `other` is only for the scoreline: tennis has no `score` and a set by
 * set line instead, so the number can only be worked out by comparing the
 * two sides. Nothing else here looks at the opponent.
 *
 * A TEAM or an ATHLETE. An individual sport puts its competitor under
 * `athlete` with the same job `team` does elsewhere, so the fields are
 * read from whichever is there. An athlete has no abbreviation of its own,
 * so the caption is derived from the surname the way a broadcast does it,
 * which is exactly what driverCode already works out for F1.
 */
/**
 * Their record, if it says anything yet.
 *
 * `type: "total"` is the season one; the others split it home and away and
 * are a different question. Falls back to the first row for a sport that
 * only sends one.
 *
 * ALL ZEROES IS NOT A RECORD. Every team is 0-0 before a season starts, and
 * measured on a real August board that is two thirds of everything with a
 * record at all: 202 of 312 competitors, because the NFL, college football
 * and the Premier League had all not kicked off. "0-0" under a team name is
 * noise dressed as information, and it would have been on most of the
 * cards.
 */
function teamRecord(recs?: { type?: string; summary?: string }[]): string | undefined {
  const all = recs ?? [];
  const s = (all.find((r) => r.type === "total") ?? all[0])?.summary;
  if (!s || /^[0-]+$/.test(s)) return undefined;
  return s;
}

function toCompetitor(raw: RawCompetitor, other?: RawCompetitor): Competitor {
  const t = raw.team ?? {};
  const a = raw.athlete;
  const pair = raw.roster;
  const score = Number(raw.score);
  const record = teamRecord(raw.records);
  if ((a || pair) && !raw.team) {
    const full = a?.displayName ?? pair?.displayName ?? "";
    const short = a?.shortName ?? pair?.shortDisplayName;
    return {
      id: a?.id,
      name: full || short || "",
      shortName: short,
      // A PAIR has no abbreviation anyone uses, so this is the first
      // player's and it is a placeholder rather than a claim. Singles get
      // the surname code a broadcast would caption with.
      abbr: driverCode(full.split("/")[0] ?? ""),
      // A country flag, since an individual has no crest. A pair has no
      // single country, so it has none.
      logo: a?.flag?.href,
      record,
      score: Number.isFinite(score)
        ? score
        : setsWon(raw.linescores, other?.linescores),
      // The line itself. `setsWon` reduces it to a total for a board card;
      // a match card wants the sets, and who took each one.
      sets: raw.linescores?.length
        ? raw.linescores.map((l) => ({ games: l.value ?? 0, won: l.winner }))
        : undefined,
    };
  }
  return {
    id: t.id,
    name: t.displayName ?? t.shortDisplayName ?? "",
    shortName: t.shortDisplayName,
    abbr: t.abbreviation ?? "",
    logo: t.logo,
    // ESPN serves the inverted mark at the same path with the size segment
    // swapped. It is not in the payload and it does not exist for every
    // club, so this is a derivation with a fallback rather than a promise.
    logoDark: t.logo?.includes("/500/")
      ? t.logo.replace("/500/", "/500-dark/")
      : undefined,
    // ESPN sends hex without the hash, which is what the card wants.
    color: t.color,
    record,
    score: Number.isFinite(score) ? score : undefined,
  };
}

/** National, then home, then away, then anything unlabelled. */
const MARKET_ORDER = ["national", "home", "away"];

function orderedBroadcasts(
  raw: { market?: string; names?: string[] }[] | undefined,
): string[] {
  const rank = (m?: string) => {
    const i = MARKET_ORDER.indexOf((m ?? "").toLowerCase());
    return i === -1 ? MARKET_ORDER.length : i;
  };
  const sorted = [...(raw ?? [])].sort((a, b) => rank(a.market) - rank(b.market));
  return [...new Set(sorted.flatMap((b) => b.names ?? []))];
}

function pick(competitors: RawCompetitor[] | undefined, side: string) {
  return competitors?.find((c) => c.homeAway === side);
}

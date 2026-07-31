import { driverCode } from "./driverCode";
import type { Competitor, Game, GameState } from "./model";

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
 * What we ask for. Adam's brief: every major US league, plus the global
 * competitions worth following from here.
 *
 * F1 is deliberately absent. A race is a session with twenty entrants, not
 * two competitors, so it needs its own card before it can have a row (the
 * plan's own risk list). Nothing here would crash on it; it would just map
 * to nothing, which is worse than an honest omission.
 */
export const LEAGUES = [
  { key: "nfl", path: "football/nfl", sport: "football" },
  { key: "nba", path: "basketball/nba", sport: "basketball" },
  { key: "mlb", path: "baseball/mlb", sport: "baseball" },
  { key: "nhl", path: "hockey/nhl", sport: "hockey" },
  { key: "epl", path: "soccer/eng.1", sport: "soccer" },
] as const satisfies ReadonlyArray<{
  key: string;
  path: string;
  sport: Game["sport"];
}>;

export type LeagueKey = (typeof LEAGUES)[number]["key"];

/**
 * What to CALL each league, and what it looks like, where there are no
 * games to ask.
 *
 * The board takes both from the response, which is right there and is the
 * source's own wording. The sidebar cannot: it offers all five whether or
 * not any of them is playing tonight, and a league out of season answers
 * with nothing to read a name or a mark out of.
 *
 * The marks are the DARK variants the response itself points at
 * (`leagues[0].logos`, rel `["full","dark"]`), verified 200 for all five.
 * Two shapes rather than one pattern, and that is the source's doing: the
 * US leagues live under teamlogos keyed by our own name, soccer under
 * leaguelogos keyed by a competition number. Written out rather than
 * derived, because a derivation that is wrong for one of five is just a
 * table with a bug in it.
 */
export const LEAGUE_NAMES: Record<LeagueKey, string> = {
  nfl: "NFL",
  nba: "NBA",
  mlb: "MLB",
  nhl: "NHL",
  epl: "Premier League",
};

const LOGO = "https://a.espncdn.com/i";
export const LEAGUE_LOGOS: Record<LeagueKey, string> = {
  nfl: `${LOGO}/teamlogos/leagues/500-dark/nfl.png`,
  nba: `${LOGO}/teamlogos/leagues/500-dark/nba.png`,
  mlb: `${LOGO}/teamlogos/leagues/500-dark/mlb.png`,
  nhl: `${LOGO}/teamlogos/leagues/500-dark/nhl.png`,
  epl: `${LOGO}/leaguelogos/soccer/500-dark/23.png`,
};

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
  competitions?: RawCompetition[];
  /**
   * Tennis, and only tennis so far.
   *
   * A tournament puts its matches under groupings (Men's Singles, Women's
   * Doubles) and leaves `competitions` EMPTY, so an adapter that reads
   * only `competitions` sees a tournament with nothing in it. Measured on
   * a real ATP board: two events, `competitions` length 0 on both,
   * `groupings` length 2 and 4, holding 54 and 121 matches.
   */
  groupings?: { competitions?: RawCompetition[] }[];
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
  venue?: { fullName?: string; address?: { city?: string } };
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
  league: (typeof LEAGUES)[number],
  { date, signal }: { date?: Date; signal?: AbortSignal } = {},
): Promise<Game[]> {
  const url =
    `${BASE}/${league.path}/scoreboard` +
    (date ? `?dates=${espnDate(date)}` : "");
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`ESPN ${league.key}: HTTP ${res.status}`);
  return toGames((await res.json()) as RawScoreboard, league);
}

/**
 * Every league at once. One league failing does not take the others: a
 * board with four sports on it beats an error page because the NHL is
 * having a bad night.
 */
export async function fetchGames(
  opts: { date?: Date; signal?: AbortSignal } = {},
): Promise<Game[]> {
  const settled = await Promise.allSettled(
    LEAGUES.map((l) => fetchLeague(l, opts)),
  );
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
  return ok.flatMap((r) => (r as PromiseFulfilledResult<Game[]>).value);
}

/** The mapping, split out so the tests can run it on a saved response. */
export function toGames(
  raw: RawScoreboard,
  league: (typeof LEAGUES)[number],
): Game[] {
  // "Premier League", "MLB": the short one is what the card's league line
  // has room for. Falls back to the long name, then to our own key.
  const name =
    raw.leagues?.[0]?.abbreviation ?? raw.leagues?.[0]?.name ?? league.key;
  return (raw.events ?? [])
    .flatMap((e) => {
      const matches = matchesOf(e);
      // The suffix only appears when it has to. A one match event keeps the
      // id it has always had, which matters: ids are React keys and the
      // row's scroll anchor, and renaming every game in the app to support
      // tennis would be a large blast radius for no gain.
      return matches.map((c, i) =>
        toGame(e, c, matches.length > 1 ? (c.id ?? String(i)) : null, league, name),
      );
    })
    .filter((g): g is Game => g !== null);
}

/**
 * Every match in an event. Usually exactly one.
 *
 * A tennis tournament is the exception and it is a big one: it leaves
 * `competitions` EMPTY and hangs its matches off `groupings` instead, one
 * per draw. Measured on a real ATP board, a single event carried 121
 * matches this way.
 *
 * That scale is worth knowing before this is switched on for tennis: one
 * tournament produces more cards than a full day of all five team leagues
 * put together, so something upstream will want to narrow it (a draw, a
 * round, or today only). This function's job is only to find them.
 */
function matchesOf(event: RawEvent): RawCompetition[] {
  if (event.competitions?.length) return event.competitions;
  return (event.groupings ?? []).flatMap((g) => g.competitions ?? []);
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
  league: (typeof LEAGUES)[number],
  leagueName: string,
): Game | null {
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
  const state = abandoned ? "pre" : (STATES[raw?.state ?? ""] ?? "pre");
  return {
    id: `espn-${league.key}-${event.id}${suffix ? `-${suffix}` : ""}`,
    sport: league.sport,
    league: leagueName,
    leagueKey: league.key,
    state,
    start,
    status: abandoned
      ? (raw?.shortDetail ?? raw?.detail ?? "Postponed")
      : statusText(state, start, raw?.shortDetail),
    home: toCompetitor(home, away),
    away: toCompetitor(away, home),
    venue: comp.venue?.fullName ?? comp.venue?.address?.city,
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
function toCompetitor(raw: RawCompetitor, other?: RawCompetitor): Competitor {
  const t = raw.team ?? {};
  const a = raw.athlete;
  const pair = raw.roster;
  const score = Number(raw.score);
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
      score: Number.isFinite(score)
        ? score
        : setsWon(raw.linescores, other?.linescores),
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

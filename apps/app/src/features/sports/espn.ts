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
}
interface RawCompetition {
  status?: { type?: { state?: string; shortDetail?: string } };
  venue?: { fullName?: string; address?: { city?: string } };
  broadcasts?: { names?: string[] }[];
  competitors?: RawCompetitor[];
}
interface RawCompetitor {
  homeAway?: string;
  score?: string;
  team?: {
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
  return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
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
    .map((e) => toGame(e, league, name))
    .filter((g): g is Game => g !== null);
}

function toGame(
  event: RawEvent,
  league: (typeof LEAGUES)[number],
  leagueName: string,
): Game | null {
  const comp = event.competitions?.[0];
  const home = pick(comp?.competitors, "home");
  const away = pick(comp?.competitors, "away");
  // Everything downstream is built around two sides and a start time. An
  // event without them is not a thing this app can draw.
  if (!event.id || !comp || !home || !away) return null;
  const start = new Date(event.date ?? "");
  if (Number.isNaN(start.getTime())) return null;

  const state = STATES[comp.status?.type?.state ?? ""] ?? "pre";
  return {
    id: `espn-${league.key}-${event.id}`,
    sport: league.sport,
    league: leagueName,
    state,
    start,
    status: statusText(state, start, comp.status?.type?.shortDetail),
    home: toCompetitor(home),
    away: toCompetitor(away),
    venue: comp.venue?.fullName ?? comp.venue?.address?.city,
    // Flattened and de-duplicated: a game carries a national feed and a
    // regional one for each side, and the matcher wants a plain list.
    broadcasts: [
      ...new Set((comp.broadcasts ?? []).flatMap((b) => b.names ?? [])),
    ],
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

function toCompetitor(raw: RawCompetitor): Competitor {
  const t = raw.team ?? {};
  const score = Number(raw.score);
  return {
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

function pick(competitors: RawCompetitor[] | undefined, side: string) {
  return competitors?.find((c) => c.homeAway === side);
}

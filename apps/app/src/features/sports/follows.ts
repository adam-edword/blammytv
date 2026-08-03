import { load, save } from "../../lib/storage";
import { DEFAULT_LEAGUES } from "./espn";
import type { Competitor, Game } from "./model";

/**
 * What the user follows: leagues and clubs (plan 010 phase 5).
 *
 * One store rather than two, because they answer the same question from
 * different heights ("show me hockey" and "show me the Blackhawks") and the
 * board has to read both to decide what it opens on.
 *
 * WHAT IT DOES to the board is deliberately not decided here. This is the
 * list and the keys; the rule that reads it is the design question, and
 * keeping it out means that rule can change without a migration.
 */

const KEY = "sports-follows";
const VERSION = 1;

export interface Follows {
  /** Catalog paths: "baseball/mlb", "soccer/eng.1". */
  leagues: string[];
  /** `teamKey` values. */
  teams: string[];
}

const EMPTY: Follows = { leagues: [], teams: [] };

export function loadFollows(): Follows {
  return asFollows(load<unknown>(KEY, VERSION, EMPTY));
}

/**
 * The five keys this feature shipped with, and what they are now.
 *
 * D1 re-keyed leagues from a name of our own to the catalog path, which
 * makes every follow anyone has already saved a dead string. `resolvable()`
 * means a dead string is harmless rather than a wedge, but harmless is not
 * the same as kept: someone who followed the NHL in v0.8.9x should still be
 * following it after the update, not quietly back to the default board.
 *
 * Done here rather than by bumping the storage version, because a version
 * bump in `load` discards the value outright — the very loss this exists to
 * prevent. Five entries, applied on read, rewritten to disk by the next
 * toggle. Deletable once nobody is upgrading from before v0.8.120.
 */
const LEGACY: Record<string, string> = {
  nfl: "football/nfl",
  nba: "basketball/nba",
  mlb: "baseball/mlb",
  nhl: "hockey/nhl",
  epl: "soccer/eng.1",
};

/**
 * Whatever came out of storage, as a Follows.
 *
 * Split from the read so the defensive half can be tested without a
 * localStorage: this is read on the board's FIRST PAINT, and a half-written
 * or hand-edited value should cost a preference rather than the screen.
 */
export function asFollows(raw: unknown): Follows {
  const v = (raw ?? {}) as Partial<Follows>;
  return {
    leagues: dedupe(strings(v.leagues).map(migrateLeague)),
    teams: dedupe(strings(v.teams).map(migrateTeam)),
  };
}

/** A stored league key, as a catalog path. Already a path? Untouched. */
function migrateLeague(key: string): string {
  return LEGACY[key] ?? key;
}

/** The same, for the league half of `${leagueKey}:${teamId}`. */
function migrateTeam(key: string): string {
  const cut = key.indexOf(":");
  if (cut === -1) return key;
  const moved = LEGACY[key.slice(0, cut)];
  return moved ? moved + key.slice(cut) : key;
}

/** Two keys can migrate onto one only if the store was hand-edited, but a
 * duplicate would double every count the sidebar shows. */
const dedupe = (list: string[]): string[] => [...new Set(list)];

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * How a club is named in storage, and the reason it is not the abbreviation.
 *
 * Two failures the abbreviation has and this does not. It is league-scoped,
 * so "SEA" is the Mariners, the Seahawks AND the Kraken; and it MOVES, since
 * a rebrand or a relocation rewrites it and every saved follow against the
 * old one goes quietly dead. The source's id survives both.
 *
 * Prefixed by the league because source ids are numbered per league: MLB's
 * team 1 and NFL's team 1 are different clubs entirely.
 *
 * Null for a competitor the source gave no id, which cannot be followed. It
 * does not happen in a real response; it happens in a pruned fixture, and
 * the caller should draw the club normally and skip the follow control
 * rather than invent an identity for it.
 */
export function teamKey(
  leagueKey: string,
  team: Pick<Competitor, "id">,
): string | null {
  return team.id ? `${leagueKey}:${team.id}` : null;
}

/** Both sides of a game, as follow keys. Absent ids drop out. */
export function gameTeamKeys(game: Game): string[] {
  return [
    teamKey(game.leagueKey, game.home),
    teamKey(game.leagueKey, game.away),
  ].filter((k): k is string => k !== null);
}

/**
 * WHICH LEAGUES TO FETCH, which is the whole of D1 in six lines.
 *
 * Follows used to be a filter over five leagues that were always fetched.
 * They are the fetch list now: what you follow is what goes on the wire,
 * over a catalog of 151. A team follow pulls its league in, because there
 * is no way to ask ESPN for one club's fixtures and no reason to want one:
 * the league's board is a superset, and `isFollowed` narrows it back down.
 *
 * Nothing followed asks for the default five. See DEFAULT_LEAGUES for why
 * there is a floor at all rather than an empty board.
 *
 * Sorted, so that two stores holding the same leagues in a different order
 * produce the same list. The board keys its fetching effect on this, and an
 * order-dependent answer would refetch the world every time a follow moved.
 */
export function fetchList(follows: Follows): string[] {
  const paths = new Set(follows.leagues);
  for (const key of follows.teams) {
    const cut = key.indexOf(":");
    if (cut > 0) paths.add(key.slice(0, cut));
  }
  return paths.size > 0 ? [...paths].sort() : [...DEFAULT_LEAGUES];
}

/**
 * The follows that still MEAN something, given the leagues that exist now.
 *
 * A stored key is a foreign key into the league catalog, and a key that no
 * longer resolves must not be able to filter the board. Without this, the
 * Sports tab wedges permanently for anyone holding one:
 *
 *   - `narrowed` reads true, because the stale strings are still stored
 *   - nothing matches them, so every game on every day is filtered out
 *   - the sidebar renders the stale keys as no control at all, because it
 *     iterates the CURRENT leagues, so there is nothing to click
 *   - `flip` only removes an exact string, so no click anywhere can clear
 *     them, and "nothing followed shows everything" becomes unreachable
 *
 * The screen would say "nothing on for what you follow, widen it" while the
 * sidebar said nothing was followed, forever, with no path out but
 * devtools. So an unresolvable key is treated as absent: the filter can go
 * back to empty, which is the state the whole feature is built to fall
 * back to.
 */
export function resolvable(follows: Follows, known: readonly string[]): Follows {
  const live = new Set(known);
  return {
    leagues: follows.leagues.filter((k) => live.has(k)),
    // A team key is `${leagueKey}:${teamId}`, so it is only meaningful
    // while its league half still exists.
    teams: follows.teams.filter((k) => live.has(k.slice(0, k.indexOf(":")))),
  };
}

/**
 * Is this game one the user follows, by either half of the store?
 *
 * Still a FILTER, on top of the fetch list rather than instead of it.
 * Following one club pulls its whole league onto the wire (fetchList), and
 * this is what puts only that club's games on the board. Following the
 * league itself passes everything in it, which is the same rule read from
 * the other end.
 */
export function isFollowed(game: Game, follows: Follows): boolean {
  if (follows.leagues.includes(game.leagueKey)) return true;
  return gameTeamKeys(game).some((k) => follows.teams.includes(k));
}

/** Toggle and persist, returning the new list. Mirrors live/favorites. */
export function toggleLeague(follows: Follows, leagueKey: string): Follows {
  return persist({ ...follows, leagues: flip(follows.leagues, leagueKey) });
}

export function toggleTeam(follows: Follows, key: string): Follows {
  return persist({ ...follows, teams: flip(follows.teams, key) });
}

function flip(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function persist(next: Follows): Follows {
  save(KEY, VERSION, next);
  return next;
}

import { load, save } from "../../lib/storage";
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
  /** LeagueKey values: "mlb", "epl". Our own, not the source's wording. */
  leagues: string[];
  /** `teamKey` values. */
  teams: string[];
}

const EMPTY: Follows = { leagues: [], teams: [] };

export function loadFollows(): Follows {
  return asFollows(load<unknown>(KEY, VERSION, EMPTY));
}

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
    leagues: strings(v.leagues),
    teams: strings(v.teams),
  };
}

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

/** Is this game one the user follows, by either half of the store? */
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

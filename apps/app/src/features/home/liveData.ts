import { progress } from "../live/epg";
import type { Channel, LiveData, Programme } from "../live/model";
import { airing } from "../live/mvTile";
import { isFollowed, isRankable, isRanked, type Follows } from "../sports/follows";
import { SPORTS } from "../sports/leagues";
import { isFixture, type Fixture, type Game } from "../sports/model";
import type { Recording } from "../recordings/store";

/**
 * What Home's live rows (plan 033, phase 2) draw, as plain functions of the
 * data the Guide, the Sports board and the recordings store already hold.
 * Nothing here fetches: StreamScreen's Home reads those through their own
 * hooks, and only while a row is on.
 */

/** A channel with what is on it, for On Now and Recent Channels. */
export interface ChannelCard {
  channel: Channel;
  /** On the air at `now`, or null: no guide for it, or nothing airing. */
  now: Programme | null;
  /** The programme after it. */
  next: Programme | null;
  /** 0..1 through `now`, or null with no programme on. */
  pct: number | null;
}

/** The ids as cards, in the order given. An id the catalog no longer has (a
 * playlist removed, a folder hidden) is dropped, and so is everything with no
 * catalog yet. Now and next are the Guide's own: the programme list the
 * channel has, read by `airing` as Multi-view's picker reads it. */
export function channelCards(ids: readonly string[], live: LiveData | null, now: Date): ChannelCard[] {
  if (!live || ids.length === 0) return [];
  const byId = new Map(live.channels.map((c) => [c.id, c]));
  const cards: ChannelCard[] = [];
  for (const id of ids) {
    const channel = byId.get(id);
    if (!channel) continue;
    const a = airing(live.programmes.get(id), now);
    cards.push({ channel, now: a.now, next: a.next, pct: a.now ? progress(a.now.start, a.now.end, now) : null });
  }
  return cards;
}

/** Today's games to draw: fixtures only (the Sports board opens nothing
 * else), of what you follow, and ranked when Ranked Only is on. The board's
 * own filter, so the row and the board agree. Kick-off order, as given. */
export function homeGames(games: readonly Game[], follows: Follows, rankedOnly: boolean): Fixture[] {
  return games.filter(
    (g): g is Fixture => isFixture(g) && isFollowed(g, follows) && (!rankedOnly || !isRankable(g) || isRanked(g)),
  );
}

/** The catalog's key for the sport a game is in: the first segment of its
 * league's path ("football" for "football/nfl"). */
const sportKeyOf = (path: string): string => path.slice(0, path.indexOf("/"));

/** The sports that have games in these, in the catalog's order, each with its
 * count and the app's own name (so soccer is Fútbol): what the Today's Games
 * row's sport menu offers. */
export function sportsToday(games: readonly Fixture[]): { key: string; name: string; count: number }[] {
  const n = new Map<string, number>();
  for (const g of games) n.set(sportKeyOf(g.leagueKey), (n.get(sportKeyOf(g.leagueKey)) ?? 0) + 1);
  return SPORTS.filter((s) => n.has(s.key)).map((s) => ({ key: s.key, name: s.name, count: n.get(s.key)! }));
}

/** The games of one sport, or all of them with none named. A saved sport with
 * no games today is all of them too, so the filter never empties the row
 * (tomorrow it filters again). */
export const gamesOfSport = (games: readonly Fixture[], sport?: string): Fixture[] => {
  const some = sport ? games.filter((g) => sportKeyOf(g.leagueKey) === sport) : [];
  return some.length > 0 ? some : [...games];
};

/** Whether anything is followed, since nothing followed is every league on
 * the Sports board and would be 151 requests on Home. */
export const followsAny = (f: Follows): boolean => f.leagues.length + f.teams.length + f.conferences.length > 0;

/** The recordings Play can open, newest first: one that finished (all or
 * part of it). Running, scheduled, missed and failed ones are the Library's
 * to show. */
export function playable(list: readonly Recording[], max = 20): Recording[] {
  return list.filter((r) => r.status === "done" || r.status === "partial").slice(0, max);
}

// ---- what Settings → Home says about Today's Games ----

/**
 * How many games the row has, as Home last counted: null until it has, and
 * while the row is off. Settings → Home reads it for the line under an empty
 * row. Held here, beside the row, because Home is the only thing that
 * fetches the games and the editor must not start a second read.
 */
let gamesToday: number | null = null;
const GAMES_EVENT = "blammytv:home-games";

export function publishGamesToday(n: number | null): void {
  if (gamesToday === n) return;
  gamesToday = n;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(GAMES_EVENT));
}

export const peekGamesToday = (): number | null => gamesToday;

export function onGamesToday(cb: () => void): () => void {
  window.addEventListener(GAMES_EVENT, cb);
  return () => window.removeEventListener(GAMES_EVENT, cb);
}

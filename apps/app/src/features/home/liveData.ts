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

/** The games of one sport, or all of them with none named. The Today's Games
 * row is the second and a sport's row the first, both from the one read. */
export const gamesOfSport = (games: readonly Fixture[], sport?: string): Fixture[] =>
  sport ? games.filter((g) => sportKeyOf(g.leagueKey) === sport) : [...games];

/** The sports something is followed in (a league, a team or a conference),
 * as catalog keys in the catalog's order. A key the catalog dropped is not one. */
export function followedSports(f: Follows): string[] {
  const keys = new Set([...f.leagues, ...f.teams, ...f.conferences].map((k) => sportKeyOf(k)));
  return SPORTS.filter((s) => keys.has(s.key)).map((s) => s.key);
}

/** What a games row is called: Today's Games, or "Football Today" for one
 * sport (the app's own name for it, so soccer is Fútbol). */
export const gamesTitle = (sport?: string): string =>
  sport ? `${SPORTS.find((s) => s.key === sport)?.name ?? sport} Today` : "Today’s Games";

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
 * How many games Home has today, in all and by sport, as Home last counted:
 * null until it has, and while no games row is on. Settings → Home reads it
 * for the line under an empty row. Held here, beside the rows, because Home is
 * the only thing that fetches the games and the editor must not start a second
 * read.
 */
export interface GamesCount {
  all: number;
  bySport: Record<string, number>;
}
let gamesToday: GamesCount | null = null;
const GAMES_EVENT = "blammytv:home-games";

export function publishGamesToday(games: readonly Fixture[] | null): void {
  const next: GamesCount | null = games && {
    all: games.length,
    bySport: games.reduce<Record<string, number>>((n, g) => {
      const k = sportKeyOf(g.leagueKey);
      n[k] = (n[k] ?? 0) + 1;
      return n;
    }, {}),
  };
  // The same counts are the same snapshot, so nothing re-renders for them.
  if (JSON.stringify(gamesToday) === JSON.stringify(next)) return;
  gamesToday = next;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(GAMES_EVENT));
}

export const peekGamesToday = (): GamesCount | null => gamesToday;

export function onGamesToday(cb: () => void): () => void {
  window.addEventListener(GAMES_EVENT, cb);
  return () => window.removeEventListener(GAMES_EVENT, cb);
}

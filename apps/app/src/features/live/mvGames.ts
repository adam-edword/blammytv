import { useEffect, useMemo, useState } from "react";
import { fetchBoard } from "../sports/espn";
import { fetchList, gameTeamKeys, isFollowed, loadFollows, type Follows } from "../sports/follows";
import { useCatalog } from "../sports/catalog";
import { withChannels } from "../sports/useGames";
import { isFixture, type Fixture, type Game } from "../sports/model";

/**
 * Multi-view's own look at today's games (plan 017, P3b).
 *
 * P3a's picker offered the live games the Sports board last published, and
 * the board stops polling the moment you leave it, so that list could be
 * half an hour old and a game tile had no score at all. This asks ESPN
 * itself, the way the board does, and only while something here needs it:
 * the picker is open, or a tile on the grid is a game.
 *
 * THE BOARD'S MANNERS, BORROWED. The first look asks what you follow, or
 * the whole catalog when you follow nothing (fetchList, measured at 151
 * leagues, 5.5 MB, of which about 20 have anything on). After that only the
 * leagues that answered with something are asked again (fetchBoard's
 * `answered`), every 90 seconds, which is the board's own cadence. ESPN's
 * 30-second response cache is shared with the board, so arriving from
 * Sports costs nothing.
 */

/** The board's refresh (useGames REFRESH_MS). */
const POLL_MS = 90_000;

/**
 * The last look, kept across visits to the tab. `key` is the fetch list the
 * last FULL look started from: follow a new league on Sports and the next
 * look starts over rather than polling only what the old list answered.
 *
 * `at` is that full look's time. `scoresAt` is the last look at all, the
 * full one or one at only the grid's leagues, whose games replace those
 * leagues' games here (mergeLeagues).
 */
let last: {
  key: string;
  games: Game[];
  answered: string[];
  at: number;
  scoresAt: number;
} | null = null;

/**
 * `prev` with the leagues in `asked` answered afresh by `fresh`, each where
 * its games already sat (fetchBoard orders by league), a league new to the
 * list at the end.
 */
export function mergeLeagues(
  prev: readonly Game[],
  fresh: readonly Game[],
  asked: readonly string[],
): Game[] {
  const again = new Set(asked);
  const byLeague = new Map<string, Game[]>();
  for (const g of fresh) {
    const list = byLeague.get(g.leagueKey);
    if (list) list.push(g);
    else byLeague.set(g.leagueKey, [g]);
  }
  const out: Game[] = [];
  const placed = new Set<string>();
  for (const g of prev) {
    if (!again.has(g.leagueKey)) {
      out.push(g);
      continue;
    }
    if (placed.has(g.leagueKey)) continue;
    placed.add(g.leagueKey);
    out.push(...(byLeague.get(g.leagueKey) ?? []));
  }
  for (const [league, games] of byLeague) if (!placed.has(league)) out.push(...games);
  return out;
}

/** For tests: forget the last look. */
export function resetGamesToday(): void {
  last = null;
}

/**
 * Today's games with the channels that carry them, while `active`.
 * `pinned` are leagues always asked, for the games already on the grid.
 *
 * `full`: every league that had something, for the picker's list and its
 * Fill. Otherwise only `pinned` (plan 018, P5): with the picker closed only
 * the grid's own games matter, and it asked about 20 leagues every 90
 * seconds for the one or two on it.
 *
 * `listed` says a full look has landed, so the picker has a list to show;
 * `looked` that any has, so a game missing from its league's answer is
 * really gone.
 */
export function useGamesToday(
  active: boolean,
  pinned: readonly string[],
  full = true,
): { games: Game[]; looked: boolean; listed: boolean; at: number | null } {
  const catalog = useCatalog();
  const [raw, setRaw] = useState<Game[]>(() => last?.games ?? []);
  /** When the last answer came (Date.now()): a score kept through failed
   * looks says how old it is (plan 018, L10). */
  const [at, setAt] = useState<number | null>(() => last?.scoresAt ?? null);
  // Whether an answer has come back, this visit or an earlier one: an empty
  // list then means a quiet day, not "not asked yet".
  const [looked, setLooked] = useState(() => last !== null);
  const [listed, setListed] = useState(() => (last?.at ?? 0) > 0);
  const pinKey = [...new Set(pinned)].sort().join("|");
  const scoresOnly = !full && pinKey !== "";

  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer = 0;
    const look = async () => {
      if (scoresOnly) {
        const asked = pinKey.split("|");
        try {
          const { games } = await fetchBoard(asked, { date: new Date() });
          const now = Date.now();
          last = {
            key: last?.key ?? "",
            games: mergeLeagues(last?.games ?? [], games, asked),
            answered: last?.answered ?? [],
            at: last?.at ?? 0,
            scoresAt: now,
          };
          if (alive) {
            setRaw(last.games);
            setLooked(true);
            setAt(now);
          }
        } catch {
          // Every league failed: keep what we had, as below.
        }
        return;
      }
      const wanted = fetchList(loadFollows());
      const key = wanted.join("|");
      const paths = new Set(last?.key === key ? last.answered : wanted);
      for (const p of pinKey ? pinKey.split("|") : []) paths.add(p);
      try {
        const { games, answered } = await fetchBoard([...paths].sort(), { date: new Date() });
        const now = Date.now();
        last = { key, games, answered, at: now, scoresAt: now };
        if (alive) {
          setRaw(games);
          setLooked(true);
          setListed(true);
          setAt(now);
        }
      } catch {
        // Every league failed: an outage, not a quiet day. Keep what we had
        // and try again on the next tick.
      }
    };
    const tick = () => {
      void look().finally(() => {
        if (alive) timer = window.setTimeout(tick, POLL_MS);
      });
    };
    // A look younger than the poll is still good: wait out the rest of it.
    // The picker's list goes by the last full look, a tile's score by the
    // last look of any kind.
    const since = scoresOnly ? last?.scoresAt : last?.at;
    const wait = since ? Math.max(0, since + POLL_MS - Date.now()) : 0;
    timer = window.setTimeout(tick, wait);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [active, pinKey, scoresOnly]);

  const games = useMemo(() => withChannels(raw, catalog), [raw, catalog]);
  return { games, looked, listed, at };
}

/** The fixtures on now that one of your channels carries. */
export function liveWithChannels(games: readonly Game[]): Fixture[] {
  return games.filter(
    (g): g is Fixture => isFixture(g) && g.state === "live" && g.channels.length > 0,
  );
}

/**
 * What "Fill with live games" adds (decision M9): live games on your
 * channels that are not in the grid yet, as many as the line has room for.
 * Two games on one channel only count once: that channel is one stream.
 *
 * YOUR TEAMS FIRST, then your leagues, then the rest (ESPN puts favourites
 * first too). A followed league counts as followed everywhere else, so
 * ranking on `isFollowed` alone put an NFL game ahead of the Chelsea match
 * for someone who follows the NFL, the Premier League and Chelsea: the
 * team is the stronger say.
 */
export function fillFrom(
  live: readonly Fixture[],
  inGrid: ReadonlySet<string>,
  left: number,
  follows: Follows,
): Fixture[] {
  const rank = (g: Fixture) =>
    gameTeamKeys(g).some((k) => follows.teams.includes(k)) ? 0 : isFollowed(g, follows) ? 1 : 2;
  // Stable, so games of one rank keep the order they came in.
  const ranked = [...live].sort((a, b) => rank(a) - rank(b));
  const out: Fixture[] = [];
  const taken = new Set(inGrid);
  for (const g of ranked) {
    if (out.length >= left) break;
    const ch = g.channels[0]?.id;
    if (!ch || taken.has(ch)) continue;
    taken.add(ch);
    out.push(g);
  }
  return out;
}

/** What a tile calls a game: "Buffalo at Kansas City". */
export function gameLabel(g: Fixture): string {
  return `${g.away.shortName ?? g.away.name} at ${g.home.shortName ?? g.home.name}`;
}

/**
 * The score, the way a scoreboard bug reads it: "BUF 17 – 24 KC". Before
 * the start there is no score to show, only the matchup.
 */
export function scoreLine(g: Fixture): string {
  if (g.state === "pre") return `${g.away.abbr} at ${g.home.abbr}`;
  return `${g.away.abbr} ${g.away.score ?? 0} – ${g.home.score ?? 0} ${g.home.abbr}`;
}

import { load, save } from "../../lib/storage";
import { SPORTS, type CatalogLeague, type CatalogSport } from "../sports/leagues";
import { isFixture, type Fixture, type Game } from "../sports/model";

/**
 * Multi-view's Live Scores row (Adam, v0.10.6): the Sports theater's score
 * tracker as one scrollable row under the grid, shown by a toggle in the
 * bar, with a filter for which sports and leagues it carries.
 *
 * What is saved: whether the row is on, and the leagues hidden from it.
 * Hidden, not shown, so a league you start following later turns up in the
 * row without a trip to the filter.
 */
export interface MvScores {
  on: boolean;
  hidden: string[];
}

const KEY = "multiviewScores";
const VERSION = 1;
const OFF: MvScores = { on: false, hidden: [] };

export function loadMvScores(): MvScores {
  const s = load<MvScores>(KEY, VERSION, OFF);
  return {
    on: s?.on === true,
    hidden: Array.isArray(s?.hidden) ? s.hidden.filter((h): h is string => typeof h === "string") : [],
  };
}

export function saveMvScores(s: MvScores): void {
  save(KEY, VERSION, s);
}

/**
 * The games the row shows: the live ones in leagues not hidden, each
 * league's games together, leagues in the order their first game came
 * (the board's own order, kick-off first).
 */
export function rowGames(games: readonly Game[], hidden: ReadonlySet<string>): Fixture[] {
  const by = new Map<string, Fixture[]>();
  for (const g of games) {
    if (!isFixture(g) || g.state !== "live" || hidden.has(g.leagueKey)) continue;
    const seen = by.get(g.leagueKey);
    if (seen) seen.push(g);
    else by.set(g.leagueKey, [g]);
  }
  return [...by.values()].flat();
}

/**
 * What the filter offers: the sports of the leagues multi-view asks ESPN
 * for (the ones you follow, or every league when you follow none), each
 * with just those leagues, in the catalog's order.
 */
export function filterSports(asked: readonly string[]): { sport: CatalogSport; leagues: CatalogLeague[] }[] {
  const want = new Set(asked);
  return SPORTS.map((sport) => ({ sport, leagues: sport.leagues.filter((l) => want.has(l.path)) })).filter(
    (s) => s.leagues.length > 0,
  );
}

/**
 * A sport's switch: on when any of its leagues shows. Turning it off hides
 * all of them; on shows all of them.
 */
export function setSport(hidden: readonly string[], leagues: readonly CatalogLeague[], show: boolean): string[] {
  const paths = new Set(leagues.map((l) => l.path));
  const rest = hidden.filter((h) => !paths.has(h));
  return show ? rest : [...rest, ...paths];
}

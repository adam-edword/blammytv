import type { VodItem } from "../stream/model";
import { catKey, itemKey, type DiscoverCatalog } from "./data";

/**
 * What the last Discover grid was made of, for `copy(btvGenreGrid())`
 * (probe.ts). The genre rows rework (Adam, 1.0.28) is tuned on this: which
 * catalog each card came from and where in it, the card's own genres, and
 * per catalog what it declares and how much of what it sent carries the
 * genre asked for. In memory only, and names only: no URL, no manifest.
 */

interface Card {
  title: string;
  kind: VodItem["kind"];
  year?: number;
  rating?: number;
  genres: string[];
  /** `catalog#position` for every catalog page it came back in. */
  from: string[];
}

interface CatalogTally {
  /** What the manifest says it takes: its genre count, any genre, or none. */
  declares: string;
  pages: number;
  got: number;
  /** How many of what it sent carry the genre asked for. */
  tagged: number;
}

let genre: string | null = null;
let catalogs: Record<string, CatalogTally> = {};
let byKey = new Map<string, Card>();
let shown: Card[] = [];

export function logGridReset(g: string | null): void {
  genre = g;
  catalogs = {};
  byKey = new Map();
  shown = [];
}

export function logGridPage(c: DiscoverCatalog, skip: number, page: readonly VodItem[]): void {
  const k = catKey(c);
  const want = genre?.toLowerCase();
  const t = (catalogs[k] ??= {
    declares: c.genreCapable ? (c.genres.length ? `${c.genres.length} genres` : "any genre") : "no genre filter",
    pages: 0,
    got: 0,
    tagged: 0,
  });
  t.pages++;
  t.got += page.length;
  page.forEach((i, n) => {
    if (want && i.genres.some((g) => g.toLowerCase() === want)) t.tagged++;
    const at = `${k}#${skip + n + 1}`;
    const card = byKey.get(itemKey(i));
    if (card) card.from.push(at);
    else byKey.set(itemKey(i), { title: i.title, kind: i.kind, year: i.year, rating: i.rating, genres: i.genres, from: [at] });
  });
}

/** The cards as the grid shows them, in order. */
export function logGridShown(items: readonly VodItem[]): void {
  for (const i of items) {
    const card = byKey.get(itemKey(i));
    if (card) shown.push(card);
  }
}

export function gridLog() {
  return { genre, catalogs, cards: shown };
}

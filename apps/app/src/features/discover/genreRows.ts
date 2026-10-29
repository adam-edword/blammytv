import type { VodItem } from "../stream/model";
import { itemKey } from "./data";
import type { TypeFilter } from "./typeFilter";

/**
 * Discover's genre page as rows (plan 034).
 *
 * WHY. The genre grid asked every catalog that could take the genre and
 * interleaved the answers, so a catalog that ignored the filter sent its
 * whole list, a title with Comedy as a side tag ranked with a pure comedy,
 * and Adam's Comedy grid had Trick 'r Treat and Pulp Fiction in it. This is
 * the other shape: drop what is not the genre, rank what is by how much of it
 * the genre is, and cut the pool into rows (the pure ones, the series, the
 * mixes). It is all pure so it can be tested without a browser; the screen
 * does the fetching.
 *
 * THE NUMBERS BELOW ARE TUNED ON ONE `copy(btvGenreGrid())` OF COMEDY
 * (1.0.31, six MDBList lists through AIOStreams; the sample is the fixture
 * in fixtures/comedy-sample.json). What it showed: the addon's genre list is
 * in TMDB's order, main genre first, not alphabetical; anime titles carry
 * four to seven genres; and some tags (Reality, Talk Show) are not genres.
 * They are named and in one place so tuning them is one edit each.
 */

/** The pool is the first pages of every catalog that serves the genre, until
 * it holds about this many cards. */
export const POOL_TARGET = 150;
/** At most this many pages from any one catalog go into the pool. */
export const POOL_PAGES = 3;
/** Fewer than this share of the pool carrying any genres at all: the rows
 * would be built on nothing, so the page is one ranked grid instead. */
export const MIN_TAGGED = 0.5;
/** A mix row needs this many cards. */
export const MIN_ROW = 6;
/** At most this many mix rows. */
export const MAX_MIX_ROWS = 6;
/** At least this share of the cards with two or more genres must list them out
 * of alphabetical order for the order to mean something (TMDB's order puts the
 * main genre first). Alphabetical lists say nothing about which genre leads. */
export const ORDERED_SHARE = 0.3;
/** Tags that describe a show's format, not what it is about. A card is never
 * put in a mix row for one of these. */
export const NOT_GENRES: ReadonlySet<string> = new Set([
  "mini-series",
  "reality",
  "talk show",
  "news",
  "game show",
  "travel",
  "food",
  "soap",
]);
/** The most cards a row shows. See All shows the lot. */
export const ROW_MAX = 20;
/** The most TMDB titles looked up in the user's addons. */
export const TMDB_ROW = 20;
/** How many of those lookups run at once. */
export const TMDB_PARALLEL = 5;
/** How long the page waits on TMDB before it builds without that row. */
export const TMDB_WAIT_MS = 8000;

/** Where a card was seen: the catalogs that sent it and its best (lowest)
 * place in any of them, 1-based like genreLog's `catalog#position`. */
export interface Seen {
  cats: string[];
  best: number;
}
export type Appearances = Map<string, Seen>;

/** One row of the genre page. `all` is every card it holds; the row shows
 * the first ROW_MAX and See All shows `all`. */
export interface GenreRow {
  id: string;
  title: string;
  /** Said on the row when its cards come from somewhere other than the
   * user's catalogs. */
  from?: "TMDB";
  all: VodItem[];
}

/** Record one catalog page: for each card, that this catalog sent it and
 * where. `skip` is how many the catalog had already sent. */
export function noteAppearances(
  appear: Appearances,
  cat: string,
  skip: number,
  page: readonly VodItem[],
): void {
  page.forEach((item, n) => {
    const key = itemKey(item);
    const at = skip + n + 1;
    const was = appear.get(key);
    if (!was) appear.set(key, { cats: [cat], best: at });
    else
      appear.set(key, {
        cats: was.cats.includes(cat) ? was.cats : [...was.cats, cat],
        best: Math.min(was.best, at),
      });
  });
}

const norm = (s: string): string => s.trim().toLowerCase();

/** The card's own genres, trimmed, lower-cased and without repeats. */
const tagsOf = (item: VodItem): string[] => [
  ...new Set(item.genres.map(norm).filter(Boolean)),
];

/** A card that names its genres and does not name this one. A card that names
 * none is not off-genre, it is unknown. */
export function isOffGenre(item: VodItem, genre: string): boolean {
  const tags = tagsOf(item);
  return tags.length > 0 && !tags.includes(norm(genre));
}

export const dropOffGenre = (items: readonly VodItem[], genre: string): VodItem[] =>
  items.filter((i) => !isOffGenre(i, genre));

/** The share of the cards that carry any genres. 0 for none, so an empty
 * pool is never mistaken for a tagged one. */
export function taggedShare(items: readonly VodItem[]): number {
  if (items.length === 0) return 0;
  return items.filter((i) => tagsOf(i).length > 0).length / items.length;
}

/** Whether the order of a card's genres means something: at least
 * ORDERED_SHARE of the cards with two or more genres list them out of
 * alphabetical order. Read over the whole pool, so every row of a page agrees. */
export function orderMeaningful(items: readonly VodItem[]): boolean {
  const many = items.map(tagsOf).filter((t) => t.length >= 2);
  const loose = many.filter((t) => t.some((x, i) => i > 0 && t[i - 1] > x)).length;
  return many.length > 0 && loose / many.length >= ORDERED_SHARE;
}

const cmp = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);

/** How the genres of a card are read: `genre` is the one picked, and `ordered`
 * is `orderMeaningful` of the pool. */
export interface GenreOrder {
  genre: string;
  ordered: boolean;
}

/**
 * How much of a title is the genre, then how popular it looks.
 *
 *   1. how far the genre is from the card's top: when the order of the card's
 *      genres is meaningful, its place in the list, capped at the third (a
 *      show that leads with Comedy ranks above one that tucks it third).
 *      Otherwise the number of genres on the card, fewest first (Comedy alone
 *      ranks above Comedy, Crime and Drama). Without `order` it is the count.
 *      A card with no genres is unknown, not pure, so it goes after every card
 *      that has some.
 *   2. the number of catalogs that sent it, most first
 *   3. its best place in any of them, lowest first
 *   4. its rating, highest first (none after any)
 *   5. the order it came in
 *
 * There is no popularity number in a catalog; where a title sits in each
 * catalog's own order, and in how many, is the nearest thing.
 */
export function rankCards(
  items: readonly VodItem[],
  appear: Appearances,
  order?: GenreOrder,
): VodItem[] {
  const g = order ? norm(order.genre) : "";
  return items
    .map((item, i) => {
      const seen = appear.get(itemKey(item));
      const tags = tagsOf(item);
      const at = tags.indexOf(g);
      const lead = order?.ordered ? (at < 0 ? 2 : Math.min(at, 2)) : tags.length;
      return {
        item,
        i,
        tags: tags.length === 0 ? Infinity : lead,
        cats: seen?.cats.length ?? 0,
        best: seen?.best ?? Infinity,
        rating: item.rating ?? -Infinity,
      };
    })
    .sort(
      (a, b) =>
        cmp(a.tags, b.tags) ||
        cmp(b.cats, a.cats) ||
        cmp(a.best, b.best) ||
        cmp(b.rating, a.rating) ||
        a.i - b.i,
    )
    .map((x) => x.item);
}

/** The card with this id first, the rest as they were. */
export function pinFirst(items: readonly VodItem[], id: string | null): VodItem[] {
  const at = id ? items.findIndex((i) => i.id === id) : -1;
  return at > 0 ? [items[at], ...items.slice(0, at), ...items.slice(at + 1)] : [...items];
}

/**
 * What a mix row is called: the picked genre and the other one, in the user's
 * words. Names are Adam's to tune (1.0.30), so this is a small table and a
 * rule rather than anything clever.
 *
 * "{adjective} {Genre}" ("Romantic Comedy", "Crime Drama") only when the
 * picked genre works as the noun, and the pair has an adjective. Comedy and
 * Drama go together the same way round whichever was picked. Anything else is
 * "{Genre} and {Other}".
 */
const PAIR: Record<string, string> = {
  anime: "Anime {G}",
  romance: "Romantic {G}",
  action: "Action {G}",
  horror: "Horror {G}",
  animation: "Animated {G}",
  crime: "Crime {G}",
  family: "Family {G}",
  fantasy: "Fantasy {G}",
  adventure: "Adventure {G}",
  "science fiction": "Sci-Fi {G}",
  "sci-fi": "Sci-Fi {G}",
  mystery: "Mystery {G}",
  sport: "Sports {G}",
  sports: "Sports {G}",
  musical: "Musical {G}",
  music: "Musical {G}",
  war: "War {G}",
  history: "Historical {G}",
  western: "Western {G}",
  thriller: "{G} Thriller",
};
const NOUNS = new Set(["comedy", "drama", "thriller", "documentary"]);

export function mixName(genre: string, other: string): string {
  const g = norm(genre);
  const x = norm(other);
  if ((g === "comedy" && x === "drama") || (g === "drama" && x === "comedy"))
    return "Comedy Drama";
  const pair = PAIR[x];
  if (NOUNS.has(g) && pair) return pair.replace("{G}", genre);
  return `${genre} and ${other}`;
}

/** The one mix a card goes in: Anime if it has it (an Animation tag beside
 * Anime says nothing more), else its first tag that is not the picked genre
 * and is a genre. None if it has no such tag. */
function mixTag(tags: readonly string[], g: string): string | undefined {
  if (g !== "anime" && tags.includes("anime")) return "anime";
  return tags.find((t) => t !== g && !NOT_GENRES.has(t));
}

/**
 * The rows, top to bottom: TMDB's popular titles (resolved already, in TMDB's
 * order), the cards that are only this genre, its series (type filter Any
 * only), then the mixes. Every pool row is ranked by `rankCards`. A card is in
 * at most one mix (see `mixTag`), but Just and Series can hold it too. Empty when nothing qualifies, which the screen shows
 * as the ranked grid. So is a pool where fewer than MIN_TAGGED of the cards
 * carry any genres.
 *
 * Cards with no genres never get here: they are in See All, not in a row.
 * `pin` leads the first row that holds it (the title the genre's card is
 * wearing).
 */
export function buildRows(
  pool: readonly VodItem[],
  genre: string,
  filter: TypeFilter,
  appear: Appearances,
  extra: { tmdb?: readonly VodItem[]; pin?: string | null } = {},
): GenreRow[] {
  // Too few cards say what they are for rows to mean anything: the page is
  // today's grid, ranked, and nothing here.
  if (taggedShare(pool) < MIN_TAGGED) return [];
  const g = norm(genre);
  const tagged = dropOffGenre(pool, genre).filter((i) => tagsOf(i).length > 0);
  const rows: GenreRow[] = [];

  const tmdb = (extra.tmdb ?? []).slice(0, TMDB_ROW);
  if (tmdb.length >= MIN_ROW)
    rows.push({ id: "tmdb", title: `Popular ${genre}`, from: "TMDB", all: tmdb });

  const order = { genre, ordered: orderMeaningful(pool) };
  const ranked = (id: string, title: string, cards: VodItem[]): GenreRow => ({
    id,
    title,
    all: rankCards(cards, appear, order),
  });

  const just = tagged.filter((i) => tagsOf(i).length === 1);
  if (just.length > 0) rows.push(ranked("just", `Just ${genre}`, just));

  if (filter === "all") {
    const series = tagged.filter((i) => i.kind === "series");
    if (series.length > 0) rows.push(ranked("series", `${genre} Series`, series));
  }

  // The other genres, in the order they were first met, then by how many
  // cards they hold: a tie keeps that order, so the page is stable. Each card
  // is dealt to one of them, so a title is in one mix at most.
  const mixes = new Map<string, { name: string; cards: VodItem[] }>();
  for (const card of tagged) {
    const tag = mixTag(tagsOf(card), g);
    if (!tag) continue;
    const name = card.genres.find((x) => norm(x) === tag) as string;
    const mix = mixes.get(tag) ?? { name: name.trim(), cards: [] };
    mix.cards.push(card);
    mixes.set(tag, mix);
  }
  [...mixes.entries()]
    .filter(([, m]) => m.cards.length >= MIN_ROW)
    .sort((a, b) => b[1].cards.length - a[1].cards.length)
    .slice(0, MAX_MIX_ROWS)
    .forEach(([tag, m]) => rows.push(ranked(`mix:${tag}`, mixName(genre, m.name), m.cards)));

  const at = extra.pin ? rows.findIndex((r) => r.all.some((i) => i.id === extra.pin)) : -1;
  if (at >= 0) rows[at] = { ...rows[at], all: pinFirst(rows[at].all, extra.pin as string) };
  return rows;
}

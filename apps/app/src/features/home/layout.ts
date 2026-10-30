import { load, save } from "../../lib/storage";
import { loadShowHero } from "../settings/showHero";
import { SPORTS } from "../sports/leagues";

/**
 * Home's rows (plan 033): which rows the page behind the logo draws, in what
 * order, switched on or off, and under what name. Edited in Settings → Home,
 * drawn by StreamScreen's second root.
 *
 * THE CATALOG'S ROWS ARE NOT STORED, ONLY THEIR IDS. A catalog row is the
 * AIOStreams', Jellyfin's or a playlist's own (`aio:`, `jf:`, `xt:` ids), so
 * its title and its titles come from the catalog as it loads, and a row here
 * is just where it sits and whether it shows. `title` set means the person
 * renamed it; unset means the row's own name.
 *
 * CATALOG ROWS CAN BE SWITCHED OFF BUT NOT REMOVED. They come from the
 * sources, so a removed one would only come back on the next launch. That is
 * also what makes "new since Home was set up" simple: a catalog id that is not
 * in the list is new, and `withNewCatalogRows` appends it once, switched on.
 *
 * The live rows (On Now, Recent Channels, Today's Games, Recordings) are the
 * first that can be removed, and added again from Settings → Home. So are the
 * lists (phase 3): Saved (one per Library list, its id `saved:<list>`), Trakt
 * (one per Trakt list, `trakt:<list>`) and Needs a Source, a row an import
 * could not fill, which keeps Strand's own JSON in `strand`. `parseRow` is
 * what decides what a load keeps, so a kind this build does not know is
 * dropped, never trusted.
 *
 * TODAY'S GAMES CAN ALSO BE ONE ROW PER SPORT. A `games` row with a `sport`
 * (the catalog's key: "football", "soccer") draws only that sport's games, and
 * its id is `games:<sport>`, so it is its own row: renamed, switched, ordered
 * and removed like any other. It stays kind `games` because everything a games
 * row needs (the live source, the one ESPN read, the glyph, removal) is the
 * same; only the filter differs. A sport the catalog does not carry is not a
 * row. The auto-offered Today's Games is the one with no sport and the id
 * `games`, which is why "was it offered" asks for that id and not the kind.
 *
 * A NEEDS ROW KEEPS STRAND'S JSON, SO A LATER VERSION CAN FILL IT, but only
 * an object of at most STRAND_MAX characters: a Strand row is about 250, and
 * what is stored sits in localStorage beside everything else. A bigger one,
 * or one that is not an object, is not a row.
 *
 * ON NOW AND TODAY'S GAMES ARE OFFERED ONCE. A layout that was set up before
 * they existed, or before there was a live source, gets each appended the
 * first time there is one, switched on. `offered` is what remembers that it
 * happened, so taking one off Home does not bring it back at the next launch.
 * It is a field beside the rows rather than a version bump, which `load`
 * would answer by dropping the rows themselves; a layout stored as the bare
 * list (phase 1) reads as having been offered nothing.
 */
export type HomeRow =
  | { id: string; kind: "carousel" | "continue" | "upnext"; on: boolean; title?: string }
  | { id: string; kind: "catalog"; on: boolean; title?: string }
  | { id: string; kind: Exclude<LiveKind, "games">; on: boolean; title?: string }
  | { id: string; kind: "games"; sport?: string; on: boolean; title?: string }
  | { id: string; kind: "saved"; list: string; on: boolean; title?: string }
  | { id: string; kind: "trakt"; list: TraktList; on: boolean; title?: string }
  | { id: string; kind: "needs"; on: boolean; title: string; strand: unknown };

export type HomeRowKind = HomeRow["kind"];

/** The rows that need a live source: each exists once and may be removed. */
export type LiveKind = "onnow" | "recent" | "games" | "recordings";
export const LIVE_KINDS: readonly LiveKind[] = ["onnow", "recent", "recordings", "games"];

/** Trakt's four lists (`/movies/trending` and so on), in the order Add Row offers them. */
export type TraktList = "trending_movies" | "trending_shows" | "popular_movies" | "popular_shows";
export const TRAKT_LISTS: readonly TraktList[] = ["trending_movies", "trending_shows", "popular_movies", "popular_shows"];
const isTraktList = (x: unknown): x is TraktList => (TRAKT_LISTS as readonly unknown[]).includes(x);

/** The most JSON a Needs a Source row keeps of Strand's row. */
export const STRAND_MAX = 4000;

/** The ids of the rows that come from a list: one row for each list. */
export const savedId = (list: string) => `saved:${list}`;
export const traktId = (list: TraktList) => `trakt:${list}`;
export const gamesId = (sport: string) => `games:${sport}`;

const SPORT_KEYS: ReadonlySet<string> = new Set(SPORTS.map((s) => s.key));

/** The two a layout is offered once, on its own. */
const AUTO_KINDS: readonly LiveKind[] = ["onnow", "games"];

/** Whether a row needs a live source (and so is not Saved, Trakt or Needs a Source). */
export const isLive = (kind: HomeRowKind): kind is LiveKind => (LIVE_KINDS as readonly string[]).includes(kind);

/** Whether a row can be taken off the list, and not only switched off: the
 * live rows and the lists, which Add Row offers again (Needs a Source rows
 * are not offered: only an import makes one). */
export const removable = (kind: HomeRowKind): boolean =>
  kind !== "carousel" && kind !== "continue" && kind !== "upnext" && kind !== "catalog";

const KEY = "homeRows";
const VERSION = 1;
const EVENT = "blammytv:home-rows";

/** The kinds that exist once, whose id is the kind. */
type SingleKind = "carousel" | "continue" | "upnext" | LiveKind;
const SINGLES: ReadonlySet<string> = new Set<SingleKind>(["carousel", "continue", "upnext", ...LIVE_KINDS]);

function parseRow(x: unknown): HomeRow | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  if (typeof r.kind !== "string" || typeof r.on !== "boolean") return null;
  const title = typeof r.title === "string" && r.title.trim() ? { title: r.title.trim() } : {};
  // A sport row is its sport's: an unknown sport is dropped, not turned into
  // Today's Games (which would be a second copy of it).
  if (r.kind === "games" && r.sport !== undefined)
    return typeof r.sport === "string" && SPORT_KEYS.has(r.sport)
      ? { id: gamesId(r.sport), kind: "games", sport: r.sport, on: r.on, ...title }
      : null;
  if (SINGLES.has(r.kind)) return { id: r.kind, kind: r.kind as SingleKind, on: r.on, ...title };
  if (r.kind === "catalog" && typeof r.id === "string" && r.id) return { id: r.id, kind: "catalog", on: r.on, ...title };
  // A list row's id is made from its list, so one list is one row whatever id was stored.
  if (r.kind === "saved" && typeof r.list === "string" && r.list) return { id: savedId(r.list), kind: "saved", list: r.list, on: r.on, ...title };
  if (r.kind === "trakt" && isTraktList(r.list)) return { id: traktId(r.list), kind: "trakt", list: r.list, on: r.on, ...title };
  if (r.kind === "needs" && typeof r.id === "string" && r.id && title.title && fitsStrand(r.strand))
    return { id: r.id, kind: "needs", on: r.on, title: title.title, strand: r.strand };
  return null;
}

/** Whether this is something a Needs a Source row may keep: an object, and a small one. */
export function fitsStrand(x: unknown): boolean {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  try {
    return JSON.stringify(x).length <= STRAND_MAX;
  } catch {
    return false;
  }
}

/** Rows that are valid, once each, with the carousel on top (it is pinned
 * there and only switches). */
function normalize(list: unknown): HomeRow[] {
  const seen = new Set<string>();
  const rows: HomeRow[] = [];
  for (const x of Array.isArray(list) ? list : []) {
    const row = parseRow(x);
    // One id once: a catalog id is the catalog's own, a single's is its kind.
    if (!row || seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  const at = rows.findIndex((r) => r.kind === "carousel");
  return at > 0 ? [rows[at], ...rows.slice(0, at), ...rows.slice(at + 1)] : rows;
}

/** The auto rows that are in these rows, which have by that been offered. */
const autoIn = (rows: readonly HomeRow[]): LiveKind[] => AUTO_KINDS.filter((k) => rows.some((r) => r.id === k));

/** The offered list as it was stored: the auto kinds only, once each, and
 * any that are in the rows (one that is there was offered, whatever was
 * written). */
function parseOffered(x: unknown, rows: readonly HomeRow[]): LiveKind[] {
  const said = new Set<unknown>([...(Array.isArray(x) ? x : []), ...autoIn(rows)]);
  return AUTO_KINDS.filter((k) => said.has(k));
}

interface Stored {
  rows: HomeRow[];
  offered: LiveKind[];
}

/** What is stored, or null when Home has never been set up. The bare list
 * phase 1 wrote is rows with nothing offered. */
function read(): Stored | null {
  const raw = load<unknown>(KEY, VERSION, null);
  const boxed = typeof raw === "object" && raw !== null && !Array.isArray(raw);
  const body = boxed ? (raw as { rows?: unknown; offered?: unknown }) : null;
  const rows = normalize(body ? body.rows : raw);
  return rows.length > 0 ? { rows, offered: parseOffered(body?.offered, rows) } : null;
}

const write = (rows: readonly HomeRow[], offered: readonly LiveKind[]) => save(KEY, VERSION, { rows, offered });

/** What is stored, or null when Home has never been set up. */
export function loadHomeRows(): HomeRow[] | null {
  return read()?.rows ?? null;
}

/** The auto rows this layout has been offered, for `withAutoRows`. */
export function loadOffered(): readonly LiveKind[] {
  return read()?.offered ?? [];
}

/** Store these rows and tell Home, which is drawn behind Settings. A live row
 * in them counts as offered from then on, so one taken off again stays off. */
export function saveHomeRows(rows: readonly HomeRow[]): HomeRow[] {
  const next = normalize(rows);
  write(next, parseOffered(loadOffered(), next));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  return next;
}

export function onHomeRowsChange(cb: (rows: HomeRow[]) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<HomeRow[]>).detail ?? []);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** The first set of rows: the carousel (on as Appearance's Featured Carousel
 * is), Continue Watching, Up Next, On Now and Today's Games when there is a
 * live source, then every catalog row in the order given (Stream's own). */
export function seedHomeRows(opts: { carousel: boolean; catalogIds: readonly string[]; live?: boolean }): HomeRow[] {
  return normalize([
    { id: "carousel", kind: "carousel", on: opts.carousel },
    { id: "continue", kind: "continue", on: true },
    { id: "upnext", kind: "upnext", on: true },
    ...(opts.live ? AUTO_KINDS.map((kind) => ({ id: kind, kind, on: true })) : []),
    ...opts.catalogIds.map((id) => ({ id, kind: "catalog", on: true })),
  ]);
}

/** The rows with those named by `ids` put in that order, each into a slot one
 * of them held; every other row (the pinned carousel, a catalog row Settings
 * does not list) keeps its place. A drag in the editor reorders only what it
 * shows, and a row it hides must not move. */
export function reorderWithin(rows: readonly HomeRow[], ids: readonly string[]): HomeRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const order = ids.flatMap((id) => byId.get(id) ?? []);
  const moving = new Set(order.map((r) => r.id));
  let next = 0;
  return rows.map((r) => (moving.has(r.id) ? order[next++] : r));
}

/** The rows with any catalog row they lack added at the end, switched on.
 * The same array back when there is none, so a caller can tell. */
export function withNewCatalogRows(rows: readonly HomeRow[], catalogIds: readonly string[]): readonly HomeRow[] {
  const have = new Set(rows.map((r) => r.id));
  const fresh: HomeRow[] = [];
  for (const id of catalogIds)
    if (id && !have.has(id)) {
      have.add(id);
      fresh.push({ id, kind: "catalog", on: true });
    }
  return fresh.length > 0 ? [...rows, ...fresh] : rows;
}

/** The rows with On Now and Today's Games added at the end, switched on, when
 * there is a live source and the layout has not been offered them. The same
 * array back when there is nothing to add. Saving what comes back is what
 * records the offer (`saveHomeRows`). */
export function withAutoRows(rows: readonly HomeRow[], offered: readonly string[], live: boolean): readonly HomeRow[] {
  if (!live) return rows;
  const fresh: HomeRow[] = AUTO_KINDS.filter((k) => !offered.includes(k) && !rows.some((r) => r.id === k)).map(
    (kind) => ({ id: kind, kind, on: true }),
  );
  return fresh.length > 0 ? [...rows, ...fresh] : rows;
}

/**
 * The rows to use now: what is stored, else the seed, written down so the
 * first set is the one that stays. Not announced (no event): this runs while
 * a screen renders, and nothing else has drawn from rows that were not there.
 */
export function homeRows(catalogIds: readonly string[], live = false): HomeRow[] {
  const stored = loadHomeRows();
  if (stored) return stored;
  const seeded = seedHomeRows({ carousel: loadShowHero(), catalogIds, live });
  write(seeded, autoIn(seeded));
  return seeded;
}

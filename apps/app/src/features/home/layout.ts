import { load, save } from "../../lib/storage";
import { loadShowHero } from "../settings/showHero";

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
 * Phase 1 has the four kinds below. The live, saved and Trakt rows join the
 * union as their phases land; `parseRow` is what decides what a load keeps, so
 * a kind this build does not know is dropped, never trusted.
 */
export type HomeRow =
  | { id: string; kind: "carousel" | "continue" | "upnext"; on: boolean; title?: string }
  | { id: string; kind: "catalog"; on: boolean; title?: string };

export type HomeRowKind = HomeRow["kind"];

const KEY = "homeRows";
const VERSION = 1;
const EVENT = "blammytv:home-rows";

/** The kinds that exist once, whose id is the kind. */
const SINGLES: ReadonlySet<string> = new Set(["carousel", "continue", "upnext"]);

function parseRow(x: unknown): HomeRow | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  if (typeof r.kind !== "string" || typeof r.on !== "boolean") return null;
  const title = typeof r.title === "string" && r.title.trim() ? { title: r.title.trim() } : {};
  if (SINGLES.has(r.kind)) return { id: r.kind, kind: r.kind as "carousel" | "continue" | "upnext", on: r.on, ...title };
  if (r.kind === "catalog" && typeof r.id === "string" && r.id) return { id: r.id, kind: "catalog", on: r.on, ...title };
  return null;
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

/** What is stored, or null when Home has never been set up. */
export function loadHomeRows(): HomeRow[] | null {
  const rows = normalize(load<unknown>(KEY, VERSION, null));
  return rows.length > 0 ? rows : null;
}

/** Store these rows and tell Home, which is drawn behind Settings. */
export function saveHomeRows(rows: readonly HomeRow[]): HomeRow[] {
  const next = normalize(rows);
  save(KEY, VERSION, next);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  return next;
}

export function onHomeRowsChange(cb: (rows: HomeRow[]) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<HomeRow[]>).detail ?? []);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** The first set of rows: the carousel (on as Appearance's Featured Carousel
 * is), Continue Watching, Up Next, then every catalog row in the order given
 * (Stream's own). */
export function seedHomeRows(opts: { carousel: boolean; catalogIds: readonly string[] }): HomeRow[] {
  return normalize([
    { id: "carousel", kind: "carousel", on: opts.carousel },
    { id: "continue", kind: "continue", on: true },
    { id: "upnext", kind: "upnext", on: true },
    ...opts.catalogIds.map((id) => ({ id, kind: "catalog", on: true })),
  ]);
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

/**
 * The rows to use now: what is stored, else the seed, written down so the
 * first set is the one that stays. Not announced (no event): this runs while
 * a screen renders, and nothing else has drawn from rows that were not there.
 */
export function homeRows(catalogIds: readonly string[]): HomeRow[] {
  const stored = loadHomeRows();
  if (stored) return stored;
  const seeded = seedHomeRows({ carousel: loadShowHero(), catalogIds });
  save(KEY, VERSION, seeded);
  return seeded;
}

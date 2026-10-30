import { TRAKT_LIST } from "../stream/lists";
import { fitsStrand, savedId, traktId, TRAKT_LISTS, type HomeRow, type TraktList } from "./layout";
import { TRAKT_NAMES } from "./traktRows";

/**
 * Strand's exported layout as Home rows (plan 033, phase 3). Strand exports
 * its shelves as a list of
 *
 *   { id, isEnabled, sortOrder, source: { continueWatching: {} }, style, title }
 *
 * and only the kinds in Adam's sample are mapped, because those are the only
 * shapes seen:
 *
 *   continueWatching                    ours already: not added
 *   localWatchlist                      Saved, on the Trakt Watchlist when
 *                                       there is one, else the Library's first list
 *   traktBuiltIn { _0: <one of four> }  the Trakt row for that list
 *   anything else                       Needs a Source, keeping Strand's row
 *
 * `sortOrder` orders the rows among themselves, `title` titles them, and
 * `isEnabled` switches them; `style` is ignored (Home has one). The rows
 * come after the ones already on Home.
 *
 * A ROW THAT IS ALREADY ON HOME IS NOT ADDED AGAIN: Continue Watching, a
 * Trakt list, a Library list's Saved row, or a Needs a Source row from the
 * same Strand row (so importing a file twice adds nothing the second time).
 * Strand saying the row is off switches ours off; Strand saying it is on
 * never switches one on that was switched off here, and its title is not
 * applied to a row you may have named yourself.
 *
 * With no Library list at all, a watchlist has nothing to point at (a list is
 * only made by saving the first title), so it becomes a Needs a Source row,
 * and so keeps its place.
 */

export interface StrandImport {
  /** Home's rows after the import: the old ones (with any switched off), then the new. */
  rows: HomeRow[];
  /** How many rows were added. */
  added: number;
  /** How many of Strand's rows were already on Home, and so not added. */
  already: number;
}

interface StrandRow {
  id?: unknown;
  isEnabled?: unknown;
  sortOrder?: unknown;
  title?: unknown;
  source: Record<string, unknown>;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** The rows of a Strand export, or null when this is not one: not JSON, not a
 * list, or no row in it with a `source`. A row without one is skipped. */
function parse(text: string): StrandRow[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(json)) return null;
  const rows = json.filter((x): x is StrandRow => isObject(x) && isObject(x.source));
  return rows.length > 0 ? rows : null;
}

export function importStrand(
  text: string,
  rows: readonly HomeRow[],
  lists: readonly { id: string; name: string }[],
): StrandImport | null {
  const parsed = parse(text);
  if (!parsed) return null;

  // Where a watchlist goes: the Trakt Watchlist when there is one, else the first list.
  const target = lists.find((l) => l.id === TRAKT_LIST) ?? lists[0] ?? null;
  const ordered = parsed
    .map((row, i) => ({ row, i }))
    .sort((a, b) => sortKey(a.row) - sortKey(b.row) || a.i - b.i);

  let next: HomeRow[] = [...rows];
  let fresh: HomeRow[] = [];
  let already = 0;

  for (const { row, i } of ordered) {
    const off = row.isEnabled === false;
    const title = typeof row.title === "string" && row.title.trim() ? row.title.trim() : undefined;
    const kind = Object.keys(row.source)[0];

    if (kind === "continueWatching") {
      already++;
      if (off) next = next.map((r) => (r.kind === "continue" ? { ...r, on: false } : r));
      continue;
    }

    // The row to add, and the name it would have if it were not titled.
    let made: HomeRow | null = null;
    let own = "";
    if (kind === "localWatchlist" && target) {
      own = target.name;
      made = { id: savedId(target.id), kind: "saved", list: target.id, on: !off };
    } else if (kind === "traktBuiltIn") {
      const list = (row.source.traktBuiltIn as { _0?: unknown } | null)?._0;
      if (TRAKT_LISTS.includes(list as TraktList)) {
        own = TRAKT_NAMES[list as TraktList];
        made = { id: traktId(list as TraktList), kind: "trakt", list: list as TraktList, on: !off };
      }
    }
    if (!made) {
      // Strand's row, kept whole. One too big to keep is left out (a real
      // row is about 250 characters).
      if (!fitsStrand(row)) continue;
      const id = `needs:${typeof row.id === "string" && row.id ? row.id : `${i}:${title ?? ""}`}`;
      made = { id, kind: "needs", on: !off, title: title ?? "Untitled Row", strand: row };
    } else if (title && title !== own) {
      made = { ...made, title };
    }

    const id = made.id;
    if (next.some((r) => r.id === id) || fresh.some((r) => r.id === id)) {
      already++;
      const offIt = (r: HomeRow): HomeRow => (r.id === id ? { ...r, on: false } : r);
      if (off) {
        next = next.map(offIt);
        fresh = fresh.map(offIt);
      }
      continue;
    }
    fresh.push(made);
  }

  return { rows: [...next, ...fresh], added: fresh.length, already };
}

/** Strand's order: `sortOrder`, and a row with none goes last. */
const sortKey = (r: StrandRow): number => (typeof r.sortOrder === "number" && Number.isFinite(r.sortOrder) ? r.sortOrder : Infinity);

/**
 * A provider's movie and show lists, read (plan 028). `get_vod_streams` and
 * `get_series` answer in the loose way panels do: a number arrives as a number
 * or a string, a field goes missing, an empty list is `[]` where an object was
 * expected. Everything is coerced here, once, and the rest of this folder
 * reads the plain shapes below.
 *
 * An entry that cannot be used (no id, no name, a movie with no file
 * extension to ask for) is left out, never guessed: a title the panel cannot be
 * asked about is not one to list.
 *
 * Pure: no network, no storage.
 */

import { parseName, validYear, type XtQuality } from "./names";

/** What a movie and a show have in common: one entry of the panel's list, a
 * "copy". The same film held twice (a 4K one and a plain one) is two copies. */
export interface XtCopy {
  /** The panel's own id: `stream_id` for a movie, `series_id` for a show.
   * Digits, and not 0. */
  id: string;
  /** The name as the panel wrote it, tag and year in. */
  name: string;
  /** The name without its leading quality tag and trailing year (names.ts). */
  title: string;
  year?: number;
  quality: XtQuality | null;
  /** `tmdb_id`, or `tmdb` on the panels that spell it so. A positive whole
   * number, or absent: 0, "" and junk all mean the panel has none. */
  tmdb?: number;
  poster?: string;
  /** Out of 10. */
  rating?: number;
  /** Unix seconds: `added` for a movie, `last_modified` for a show. 0 when the
   * panel sent none. */
  added: number;
  /** The panel's own `is_adult` flag. */
  adult: boolean;
  /** `category_id`, as a string; empty when the panel sent none. */
  folderId: string;
}

export interface XtMovie extends XtCopy {
  /** `container_extension`, which the file's address ends in. Lower case. */
  ext: string;
}

export interface XtShow extends XtCopy {
  backdrop?: string;
  synopsis?: string;
  genres: string[];
  cast: string[];
  /** Minutes an episode runs (`episode_run_time`). */
  runtimeMin?: number;
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

/** An object, or null: an entry, or an `info` the panel sent as `[]`. */
export function record(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Text, trimmed; a number as its digits; anything else is empty. */
export function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

/** A finite number from a number or a numeric string. */
export function num(v: unknown): number | undefined {
  const s = typeof v === "string" ? v.trim() : v;
  if (s === "" || (typeof s !== "number" && typeof s !== "string")) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** A whole number above 0, or undefined. */
export function posInt(v: unknown): number | undefined {
  const n = num(v);
  return n !== undefined && Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/** A whole number from 0 up, or undefined. */
export function natural(v: unknown): number | undefined {
  const n = num(v);
  return n !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

/** A panel id as its digits, or undefined: the id goes into a file's address
 * and into a key, so nothing but a plain positive number is let through. */
export function idOf(v: unknown): string | undefined {
  const s = str(v);
  return /^[1-9]\d*$/.test(s) ? s : undefined;
}

/** An address the page may load as it is, or undefined. */
export function web(v: unknown): string | undefined {
  const s = str(v);
  return /^https?:\/\/\S+$/i.test(s) ? s : undefined;
}

/** The first address of a list the panel sends as an array (`backdrop_path`),
 * or as a bare string. */
export function firstWeb(v: unknown): string | undefined {
  if (Array.isArray(v)) {
    for (const x of v) {
      const u = web(x);
      if (u) return u;
    }
    return undefined;
  }
  return web(v);
}

/** The file extension a file's address ends in: letters and digits, lower case,
 * without a dot. Empty when the panel sent none or something else. */
export function extOf(v: unknown): string {
  const s = str(v).replace(/^\./, "").toLowerCase();
  return /^[a-z0-9]{2,5}$/.test(s) ? s : "";
}

/** A rating out of 10 from the panel's `rating` (out of 10, "0" for none) or
 * its `rating_5based`, doubled. Undefined when neither holds one. */
export function rating10(o: Record<string, unknown>): number | undefined {
  const r = num(o.rating);
  if (r !== undefined && r > 0 && r <= 10) return Math.round(r * 10) / 10;
  const five = num(o.rating_5based);
  if (five !== undefined && five > 0 && five <= 5) return Math.round(five * 20) / 10;
  return undefined;
}

/** "Comedy, War & Politics" as a list. At most `max` of them. */
export function splitList(v: unknown, max = 20): string[] {
  return str(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

/** A year from a date's first four digits ("1984-09-07"), when it is one. */
export function yearOf(v: unknown): number | undefined {
  const m = /^(\d{4})/.exec(str(v));
  const n = m ? Number(m[1]) : NaN;
  return validYear(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// The lists
// ---------------------------------------------------------------------------

/** The fields a movie's entry and a show's share. Art and rating are read by
 * the caller: the lists name their poster differently. */
function copyOf(o: Record<string, unknown>, id: string, added: unknown): XtCopy | null {
  const name = str(o.name);
  const parsed = parseName(name);
  if (!parsed.title) return null;
  const tmdb = posInt(o.tmdb_id) ?? posInt(o.tmdb);
  return {
    id,
    name,
    title: parsed.title,
    ...(parsed.year !== undefined ? { year: parsed.year } : {}),
    quality: parsed.quality,
    ...(tmdb !== undefined ? { tmdb } : {}),
    added: natural(added) ?? 0,
    adult: Number(o.is_adult) === 1,
    folderId: str(o.category_id),
  };
}

/** `get_vod_streams` as movies, in the panel's order. */
export function readMovies(raw: unknown): XtMovie[] {
  if (!Array.isArray(raw)) return [];
  const out: XtMovie[] = [];
  for (const r of raw) {
    const o = record(r);
    const id = o && idOf(o.stream_id);
    const ext = o ? extOf(o.container_extension) : "";
    if (!o || !id || !ext) continue;
    const c = copyOf(o, id, o.added);
    if (!c) continue;
    const poster = web(o.stream_icon);
    const rating = rating10(o);
    out.push({
      ...c,
      ...(poster ? { poster } : {}),
      ...(rating !== undefined ? { rating } : {}),
      ext,
    });
  }
  return out;
}

/** What a show's list entry and its info both say about it. `year` is the
 * release date's. */
export type XtShowFields = Pick<
  XtShow,
  "year" | "poster" | "rating" | "backdrop" | "synopsis" | "genres" | "cast" | "runtimeMin"
>;

export function showFields(o: Record<string, unknown>): XtShowFields {
  const year = yearOf(o.releaseDate);
  const poster = web(o.cover);
  const rating = rating10(o);
  const backdrop = firstWeb(o.backdrop_path);
  const synopsis = str(o.plot);
  const runtimeMin = posInt(o.episode_run_time);
  return {
    ...(year !== undefined ? { year } : {}),
    ...(poster ? { poster } : {}),
    ...(rating !== undefined ? { rating } : {}),
    ...(backdrop ? { backdrop } : {}),
    ...(synopsis ? { synopsis } : {}),
    genres: splitList(o.genre),
    cast: splitList(o.cast),
    ...(runtimeMin !== undefined ? { runtimeMin } : {}),
  };
}

/** `get_series` as shows, in the panel's order. */
export function readShows(raw: unknown): XtShow[] {
  if (!Array.isArray(raw)) return [];
  const out: XtShow[] = [];
  for (const r of raw) {
    const o = record(r);
    const id = o && idOf(o.series_id);
    if (!o || !id) continue;
    const c = copyOf(o, id, o.last_modified);
    if (!c) continue;
    const f = showFields(o);
    // The name's year first, as a movie has no other; the release date's when
    // the name has none.
    out.push({ ...f, ...c, ...(c.year === undefined && f.year !== undefined ? { year: f.year } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

/** A copy's standing in the list of sources: the tag it carries, best first.
 * An untagged name ranks, and is shown, as HD (sources.ts says why). */
const RANK: Record<XtQuality, number> = { "4K": 5, HDR: 4, FHD: 3, HD: 2, SD: 0 };
const rank = (q: XtQuality | null): number => (q === null ? RANK.HD : RANK[q]);

/**
 * The copies of one title in the order a source list shows them: best quality
 * first, then the lower panel id. Never the order the panel listed them in, so
 * the first copy (the one the card reads, and the one auto-play takes) is the
 * same whichever way a refresh arrives. A new array; the copies are not copied.
 */
export function orderCopies<T extends XtCopy>(copies: readonly T[]): T[] {
  return [...copies].sort(compareCopies);
}

export function compareCopies(a: XtCopy, b: XtCopy): number {
  return (
    rank(b.quality) - rank(a.quality) ||
    a.id.length - b.id.length ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** The first answer `f` gives, over the copies in order: how a title reads a
 * field from the best copy that has it. */
export function firstOf<C, T>(copies: readonly C[], f: (c: C) => T | undefined): T | undefined {
  for (const c of copies) {
    const v = f(c);
    if (v !== undefined) return v;
  }
  return undefined;
}

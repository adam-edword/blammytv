/**
 * A library as Discover reads it (plan 028, D3 option b): one Movies feed and
 * one Shows feed per library, newest first from the whole library and not only
 * the picked folders, and a search over every title of every library. Both are
 * views of the lists already in memory (library.ts), so Discover asks the panel
 * for nothing: Xtream has no search action, and a feed is a slice.
 *
 * The folders are not feeds. Adam's are mostly genres, so every folder as a feed
 * would be 58 feeds mixing the same titles in from 58 directions; and these
 * feeds take no genre (the movie list carries none), so they stay out of every
 * genre grid and the genre art.
 *
 * Pure: no network, no storage.
 */

import { rank } from "../discover/match";
import type { VodItem } from "../stream/model";
import type { XtKind } from "./keys";
import type { XtLibrary, XtTitle } from "./library";

/** A page of a feed: Jellyfin's (jellyfin/browse.ts), so the grid fills the same. */
export const PAGE = 50;

/** The most one search gives back for one kind. */
export const SEARCH_CAP = 50;

const feeds = new WeakMap<XtLibrary, Record<XtKind, XtTitle[]>>();

/** A library's titles of one kind, newest first by when the panel added them (a
 * title's newest copy). Titles added together keep the panel's order: sort is
 * stable. Sorted once per build of the library. */
export function feedOf(lib: XtLibrary, kind: XtKind): XtTitle[] {
  let f = feeds.get(lib);
  if (!f) {
    const all = [...lib.titles.values()].sort((a, b) => b.added - a.added);
    f = { movie: all.filter((t) => t.kind === "movie"), series: all.filter((t) => t.kind === "series") };
    feeds.set(lib, f);
  }
  return f[kind];
}

/** The cards of a feed past `skip` of them, one page. Empty past the end. */
export function pageOf(feed: readonly XtTitle[], skip: number): VodItem[] {
  const from = Math.max(0, Math.floor(skip));
  return feed.slice(from, from + PAGE).map((t) => t.item);
}

/**
 * The cards of these libraries that answer a typed query, best matches first and
 * at most `SEARCH_CAP`. The ranking is Discover's (discover/match.ts): case and
 * accents don't matter, nor spacing or punctuation, and a title that starts with
 * the query beats one that only contains it. A title that does not match is
 * dropped. Matches that tie keep each library's newest-first order.
 */
export function searchTitles(libs: readonly XtLibrary[], kind: XtKind, query: string): VodItem[] {
  const pool = libs.flatMap((lib) => feedOf(lib, kind).map((t) => t.item));
  return rank(pool, query, true).slice(0, SEARCH_CAP);
}

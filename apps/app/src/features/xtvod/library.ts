/**
 * A playlist's movie and show lists as a library (plan 028): every title as the
 * `VodItem` Stream draws, the copies behind it, and each folder's titles.
 *
 * One list, many views. The whole of both lists is read once; a picked folder's
 * row, search, a title's copies and the Discover feed are all views of what
 * this builds, so none of them asks the panel again.
 *
 * Copies with the same TMDB id are one title (a 4K one beside a plain one is
 * one card, one page, two sources). A copy without one is a title of its own,
 * keyed by the panel's id (keys.ts). The card reads from the FIRST copy in
 * `orderCopies` order, best quality first and then the lower panel id: the same
 * copy the source list puts first, and the same one whichever order the panel
 * lists them in, so a refresh does not repaint a card from another file. A
 * field that copy lacks (a poster, a year) is read from the next copy that has
 * one.
 *
 * Pure: no network, no storage.
 */

import type { XtreamCategory } from "../../data/xtream";
import { isAdultCategory } from "../live/adult";
import type { VodItem } from "../stream/model";
import { titleKey, type XtKind } from "./keys";
import { firstOf, orderCopies, type XtCopy, type XtMovie, type XtShow } from "./read";

/**
 * The adult rule: whether a title is left out of the library. Out when the
 * panel flags the title, or its folder is adult (the panel's flag, or a name
 * that says so, live/adult.ts), and adult content is hidden. The guide drops an
 * adult channel the same way; with the filter off nothing is left out.
 */
export function leftOut(
  titleAdult: boolean,
  folder: XtreamCategory | undefined,
  hideAdult: boolean,
): boolean {
  return hideAdult && (titleAdult || (folder !== undefined && isAdultCategory(folder)));
}

/** A title: its key, the card Stream draws, and the copies the panel holds of
 * it, in `orderCopies` order. */
export type XtTitle =
  | { kind: "movie"; key: string; item: VodItem; copies: XtMovie[]; added: number }
  | { kind: "series"; key: string; item: VodItem; copies: XtShow[]; added: number };

/** A folder and the keys of its titles, in the order the panel lists them,
 * each once. */
export interface XtFolder {
  id: string;
  name: string;
  keys: string[];
}

export interface XtLibrary {
  /** Every title, movies and shows, by key (a movie's and a show's differ). */
  titles: Map<string, XtTitle>;
  /** Movie folders and show folders are two lists: a movie folder and a show
   * folder can share an id. */
  movieFolders: XtFolder[];
  showFolders: XtFolder[];
}

/** What a library is built from: the lists as read (read.ts) and the folders as
 * fetched (data/xtream.ts). */
export interface XtLists {
  movies: readonly XtMovie[];
  shows: readonly XtShow[];
  movieFolders: readonly XtreamCategory[];
  showFolders: readonly XtreamCategory[];
}

const cardOf = (key: string, kind: XtKind, copies: readonly XtCopy[]): VodItem => ({
  id: key,
  from: "xt",
  title: copies[0].title,
  kind,
  year: firstOf(copies, (c) => c.year),
  poster: firstOf(copies, (c) => c.poster),
  rating: firstOf(copies, (c) => c.rating),
  genres: [],
  cast: [],
  seasons: [],
});

function showCard(key: string, copies: XtShow[]): VodItem {
  return {
    ...cardOf(key, "series", copies),
    backdrop: firstOf(copies, (c) => c.backdrop),
    synopsis: firstOf(copies, (c) => c.synopsis),
    runtimeMin: firstOf(copies, (c) => c.runtimeMin),
    genres: firstOf(copies, (c) => (c.genres.length > 0 ? c.genres : undefined)) ?? [],
    cast: firstOf(copies, (c) => (c.cast.length > 0 ? c.cast : undefined)) ?? [],
  };
}

/** One list folded: the copies by title key (the panel's order of first
 * appearance), and each folder's titles. The adult rule runs on every copy
 * first, so a title with one copy in an adult folder and one in an ordinary
 * folder keeps the ordinary one. */
function fold<C extends XtCopy>(
  playlistId: string,
  kind: XtKind,
  copies: readonly C[],
  folders: readonly XtreamCategory[],
  hideAdult: boolean,
): { byKey: Map<string, C[]>; folders: XtFolder[] } {
  const known = new Map<string, XtreamCategory>();
  for (const f of folders) if (!known.has(f.id)) known.set(f.id, f);
  const rows = new Map<string, { row: XtFolder; seen: Set<string> }>();
  for (const f of known.values())
    if (!leftOut(false, f, hideAdult)) rows.set(f.id, { row: { id: f.id, name: f.name, keys: [] }, seen: new Set() });

  const byKey = new Map<string, C[]>();
  for (const c of copies) {
    if (leftOut(c.adult, known.get(c.folderId), hideAdult)) continue;
    const key = titleKey(playlistId, kind, c);
    const group = byKey.get(key);
    // The panel lists a stream under every folder it is in: one copy, seen again.
    if (!group) byKey.set(key, [c]);
    else if (!group.some((x) => x.id === c.id)) group.push(c);
    const f = rows.get(c.folderId);
    if (f && !f.seen.has(key)) {
      f.seen.add(key);
      f.row.keys.push(key);
    }
  }
  return { byKey, folders: [...rows.values()].map((f) => f.row) };
}

/** A playlist's library. `hideAdult` is Settings' adult filter
 * (settings/adultFilter.ts), read by the caller. */
export function buildLibrary(playlistId: string, lists: XtLists, hideAdult: boolean): XtLibrary {
  const titles = new Map<string, XtTitle>();

  const movies = fold(playlistId, "movie", lists.movies, lists.movieFolders, hideAdult);
  for (const [key, group] of movies.byKey) {
    const copies = orderCopies(group);
    titles.set(key, {
      kind: "movie",
      key,
      item: cardOf(key, "movie", copies),
      copies,
      added: Math.max(...copies.map((c) => c.added)),
    });
  }

  const shows = fold(playlistId, "series", lists.shows, lists.showFolders, hideAdult);
  for (const [key, group] of shows.byKey) {
    const copies = orderCopies(group);
    titles.set(key, {
      kind: "series",
      key,
      item: showCard(key, copies),
      copies,
      added: Math.max(...copies.map((c) => c.added)),
    });
  }

  return { titles, movieFolders: movies.folders, showFolders: shows.folders };
}

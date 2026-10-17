/**
 * What a person chose about a provider's movies and shows (plan 028): whether a
 * playlist's library is on, and which of its folders are rows in Stream.
 *
 * Not on the playlist object. Any save of the playlist list makes Live reload
 * its channels (live/source.ts watchPlaylists), and a folder pick must not
 * cost a guide reload. So these live under their own key, by playlist id.
 * Nothing here is a credential.
 *
 * A playlist that is removed leaves its entries behind. Every reader asks for
 * the playlists that exist first (`eligiblePlaylists`), so a removed one's
 * choices are never read; clearing them is Settings' job.
 */

import { load, save } from "../../lib/storage";
import { loadPlaylists, type XtreamPlaylist } from "../settings/playlists";
import type { XtKind } from "./keys";

const KEY = "xtVod";
const VERSION = 1;

/** One playlist's choices. Absent fields are the defaults: the library on, no
 * folder picked. */
interface Choice {
  off?: true;
  picks?: Partial<Record<XtKind, string[]>>;
}

type Choices = Record<string, Choice>;

/** Said whenever a choice is written (the switch or a pick), so a screen that
 * draws it reads again. */
export const XT_CHANGED = "blammytv:xt-changed";

function read(): Choices {
  const v = load<unknown>(KEY, VERSION, {});
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Choices) : {};
}

/** A choice, whatever shape a damaged or hand-edited save left. */
function choiceOf(all: Choices, pid: string): Choice {
  const c: unknown = all[pid];
  return c !== null && typeof c === "object" && !Array.isArray(c) ? (c as Choice) : {};
}

/** Put one playlist's choice back, or take its entry away when it is the
 * default, and say so. Nothing is written, and nothing said, when nothing
 * changed. */
function write(pid: string, next: Choice): void {
  const all = read();
  const before = JSON.stringify(choiceOf(all, pid));
  const empty = !next.off && !(next.picks?.movie?.length || next.picks?.series?.length);
  if (empty) delete all[pid];
  else all[pid] = next;
  if (before === JSON.stringify(empty ? {} : next)) return;
  save(KEY, VERSION, all);
  window.dispatchEvent(new Event(XT_CHANGED));
}

/** Whether this playlist's library is switched off. */
export function isLibraryOff(pid: string): boolean {
  return choiceOf(read(), pid).off === true;
}

export function setLibraryOff(pid: string, off: boolean): void {
  const c = { ...choiceOf(read(), pid) };
  if (off) c.off = true;
  else delete c.off;
  write(pid, c);
}

/** The folder ids picked in this playlist, for movies or for shows. A movie
 * folder and a show folder can share an id, so they are two lists. */
export function loadPicks(pid: string, kind: XtKind): string[] {
  const v: unknown = choiceOf(read(), pid).picks?.[kind];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function setPicks(pid: string, kind: XtKind, ids: readonly string[]): void {
  const c = choiceOf(read(), pid);
  write(pid, { ...c, picks: { ...c.picks, [kind]: [...new Set(ids)] } });
}

/** Pick the folder, or unpick it when it is picked. */
export function togglePick(pid: string, kind: XtKind, folderId: string): void {
  const now = loadPicks(pid, kind);
  setPicks(pid, kind, now.includes(folderId) ? now.filter((x) => x !== folderId) : [...now, folderId]);
}

// ---------------------------------------------------------------------------
// What the last good load held
// ---------------------------------------------------------------------------

const HELD_KEY = "xtVodHeld";

/** How many movies and shows a playlist's last good load held. Its own key and
 * not the choices': Settings' file carries what a person chose, and these
 * counts are the app's own bookkeeping. */
export interface Held {
  movies: number;
  shows: number;
}

type HeldAll = Record<string, Held>;

function readHeld(): HeldAll {
  const v = load<unknown>(HELD_KEY, VERSION, {});
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as HeldAll) : {};
}

export function loadHeld(pid: string): Held | null {
  const h: unknown = readHeld()[pid];
  if (h === null || typeof h !== "object") return null;
  const { movies, shows } = h as Partial<Held>;
  return Number.isSafeInteger(movies) && Number.isSafeInteger(shows) ? { movies: movies as number, shows: shows as number } : null;
}

/** Record what a good load held. True when that changed what was recorded. */
export function saveHeld(pid: string, held: Held): boolean {
  const now = loadHeld(pid);
  if (now && now.movies === held.movies && now.shows === held.shows) return false;
  save(HELD_KEY, VERSION, { ...readHeld(), [pid]: held });
  return true;
}

// ---------------------------------------------------------------------------
// Which playlists have a library
// ---------------------------------------------------------------------------

/** The playlists whose movies and shows Stream shows: Xtream ones that are
 * enabled, with their library not switched off (D1: on unless turned off). */
export function eligiblePlaylists(): XtreamPlaylist[] {
  return loadPlaylists().filter(
    (p): p is XtreamPlaylist =>
      p.kind === "xtream" &&
      p.enabled &&
      typeof p.server === "string" &&
      typeof p.username === "string" &&
      typeof p.password === "string" &&
      !isLibraryOff(p.id),
  );
}

/**
 * Whether Stream has an Xtream library to show: some eligible playlist whose
 * last good load held a movie or a show. Sync, from the record, so the places
 * that ask "is Stream set up" (the palette, Settings' Playback and Appearance,
 * the Stream tab itself) can answer at launch, before any fetch.
 */
export function hasXtLibrary(): boolean {
  return eligiblePlaylists().some((p) => {
    const h = loadHeld(p.id);
    return !!h && h.movies + h.shows > 0;
  });
}

/**
 * Whether some eligible playlist has never been read: whether it holds a
 * library is still being found out. Stream shows its loading state only for
 * that. A playlist that has been read and holds nothing is live TV only, and
 * one whose panel fails the list calls before it was ever read is too, as far
 * as Stream can tell: neither turns "No Movies or Shows Yet" into a spinner or
 * an error.
 */
export function xtLibraryPending(): boolean {
  return eligiblePlaylists().some((p) => loadHeld(p.id) === null);
}

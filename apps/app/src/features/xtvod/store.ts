/**
 * What a person chose about a provider's movies and shows (plan 028): whether a
 * playlist's library is on, and which of its folders are rows in Stream, in what
 * order.
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
import { loadPlaylists, type Playlist, type XtreamPlaylist } from "../settings/playlists";
import type { XtKind } from "./keys";

const KEY = "xtVod";
const VERSION = 1;

/** A folder picked as a row: which of the two lists it is in and its id there.
 * A movie folder and a show folder can share an id, so the kind is part of it. */
export interface XtPick {
  kind: XtKind;
  id: string;
}

/** One playlist's choices. Absent fields are the defaults: the library on, no
 * folder picked. `picks` is read as `unknown` because two shapes are on disk
 * and in people's exported files (`picksFrom`). */
interface Choice {
  off?: true;
  picks?: unknown;
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

/**
 * The picks in a stored (or handed-over) value, once each, in order. Two shapes
 * are read, and the first is the only one written:
 *
 * - A list of `{ kind, id }`: the person's own order, one across movies and
 *   shows, which is what dragging a row changes.
 * - `{ movie: string[], series: string[] }`, which v0.12.1 and v0.12.2 saved
 *   (movies, then shows, and the rows were drawn in the panel's folder order
 *   whatever the order here). Read as movies first, then shows, each in its
 *   saved order, so nobody who picked folders loses them.
 *
 * It stays under the same version: `load` drops a value of any other version,
 * and a settings file made by the older build is imported as it is, so both
 * would have lost the picks. Anything else in it is skipped.
 */
function picksFrom(raw: unknown): XtPick[] {
  const out: XtPick[] = [];
  const add = (kind: unknown, id: unknown) => {
    if ((kind === "movie" || kind === "series") && typeof id === "string" && !out.some((p) => p.kind === kind && p.id === id))
      out.push({ kind, id });
  };
  if (Array.isArray(raw)) {
    for (const p of raw) if (p !== null && typeof p === "object") add((p as Partial<XtPick>).kind, (p as Partial<XtPick>).id);
  } else if (raw !== null && typeof raw === "object") {
    for (const kind of ["movie", "series"] as const) {
      const ids = (raw as Record<string, unknown>)[kind];
      if (Array.isArray(ids)) for (const id of ids) add(kind, id);
    }
  }
  return out;
}

/** A choice as it is written: the defaults left out, the picks a list. */
function canon(c: Choice): Choice {
  const picks = picksFrom(c.picks);
  return { ...(c.off === true ? { off: true as const } : {}), ...(picks.length > 0 ? { picks } : {}) };
}

/** Put one playlist's choice back, or take its entry away when it is the
 * default, and say so. Nothing is written, and nothing said, when nothing
 * changed. */
function write(pid: string, next: Choice): void {
  const all = read();
  const now = canon(next);
  const empty = Object.keys(now).length === 0;
  if (JSON.stringify(canon(choiceOf(all, pid))) === JSON.stringify(now)) return;
  if (empty) delete all[pid];
  else all[pid] = now;
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

/** The folders picked in this playlist, in the order the person made: the order
 * of the rows in Stream. */
export function loadPicks(pid: string): XtPick[] {
  return picksFrom(choiceOf(read(), pid).picks);
}

export function setPicks(pid: string, picks: readonly XtPick[]): void {
  write(pid, { ...choiceOf(read(), pid), picks });
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

/**
 * Take away what is kept for every playlist that is not in `keep`: its choices
 * and its record of what it held. Returns the ids it took, for the caller to
 * clear what else is kept for them (the lists on disk). Nothing is said: a
 * playlist that is gone has no screen drawing its choices.
 */
export function dropXtFor(keep: Iterable<string>): string[] {
  const live = new Set(keep);
  const choices = read();
  const held = readHeld();
  const gone = [...new Set([...Object.keys(choices), ...Object.keys(held)])].filter((id) => !live.has(id));
  if (gone.length === 0) return [];
  for (const id of gone) {
    delete choices[id];
    delete held[id];
  }
  save(KEY, VERSION, choices);
  save(HELD_KEY, VERSION, held);
  return gone;
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

/** Whether a playlist has a panel in Settings' Movies and Shows section
 * (settings/PlaylistLibrary.tsx): an Xtream one whose last good load held a
 * movie or a show, or that is switched off (it has to be able to come back on).
 * Not one that was read and holds nothing (live TV only), and not an M3U or a
 * Stalker portal. */
export function showsLibrary(p: Playlist): boolean {
  if (p.kind !== "xtream") return false;
  const held = loadHeld(p.id);
  return isLibraryOff(p.id) || !!(held && held.movies + held.shows > 0);
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

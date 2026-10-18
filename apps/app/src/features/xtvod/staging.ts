/**
 * Staging a library's picks (plan 028): the draft that Stream's empty page, its
 * Rows drawer and Settings edit, and the one button in each that commits it.
 *
 * Nothing a view does is live. A click, a switch or a drag changes the draft
 * only; the store (store.ts) is written when the view's own button says so, and
 * a draft that is closed or cancelled is just gone. Pure, so each of those is
 * a plain test: the views are thin over these.
 *
 * A draft holds only the playlists that were edited. One that was not is read
 * from the store as it stands, so a view never shows a stale copy of a playlist
 * nobody touched.
 */

import { KIND_WORD, type XtKind } from "./keys";
import { loadPicks, setPicks, type XtPick } from "./store";
import type { XtFolderView, XtLibraryView } from "./vod";

/** The staged picks by playlist id, for the playlists that were edited. */
export type Draft = Readonly<Record<string, readonly XtPick[]>>;

/** What names a pick: its kind and its id. Also what a sortable item is called. */
export const pickId = (p: XtPick): string => `${p.kind}:${p.id}`;

const samePicks = (a: readonly XtPick[], b: readonly XtPick[]): boolean =>
  a.length === b.length && a.every((p, i) => pickId(p) === pickId(b[i]));

/** A playlist's picks as staged: the draft's if it was edited, else the store's. */
export const stagedOf = (draft: Draft, pid: string): readonly XtPick[] => draft[pid] ?? loadPicks(pid);

/** The pick added to the end, or taken away when it is there. */
export function toggled(picks: readonly XtPick[], kind: XtKind, id: string): XtPick[] {
  const at = picks.findIndex((p) => p.kind === kind && p.id === id);
  return at === -1 ? [...picks, { kind, id }] : picks.filter((_, i) => i !== at);
}

/**
 * The picks with the ones in `order` put in that order. `order` is some of the
 * picks, rearranged (the rows a view can show: a pick whose folder is hidden by
 * the adult filter is not among them). Each of those takes the place of one of
 * them, and any other pick stays where it is.
 */
export function reordered(picks: readonly XtPick[], order: readonly XtPick[]): XtPick[] {
  const queue = [...order];
  const moving = new Set(order.map(pickId));
  return picks.map((p) => (moving.has(pickId(p)) ? (queue.shift() ?? p) : p));
}

/** A staged pick and the folder it names. */
export interface StagedRow {
  pick: XtPick;
  folder: XtFolderView;
}

/** What a folder is called to a screen reader: its name, which list it is in
 * (a movie folder and a show folder can share a name), and with more than one
 * playlist, whose. */
export const folderLabel = (f: XtFolderView, lib: XtLibraryView, several: boolean): string =>
  [f.name, KIND_WORD[f.kind], several ? lib.name : null].filter(Boolean).join(", ");

/** Which of the two lists have a folder to pick from in these libraries. */
export const kindsOffered = (libs: readonly XtLibraryView[]): XtKind[] =>
  (["movie", "series"] as const).filter((kind) => libs.some((lib) => lib.folders.some((f) => f.kind === kind)));

/** The staged picks of a library that name a folder it offers, in order. The
 * rest (a folder the panel dropped, an adult one while adult content is hidden)
 * stay in the draft untouched and are not shown. */
export function rowsOf(lib: XtLibraryView, picks: readonly XtPick[]): StagedRow[] {
  return picks.flatMap((pick) => {
    const folder = lib.folders.find((f) => f.kind === pick.kind && f.id === pick.id);
    return folder ? [{ pick, folder }] : [];
  });
}

/** Whether any edited playlist's draft differs from what is stored. */
export const isDirty = (draft: Draft): boolean => Object.entries(draft).some(([pid, picks]) => !samePicks(picks, loadPicks(pid)));

/** Write the draft to the store. */
export function commitDraft(draft: Draft): void {
  for (const [pid, picks] of Object.entries(draft)) setPicks(pid, picks);
}

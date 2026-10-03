import { hasId, loadList, save } from "../../lib/storage";

/**
 * Live-TV sources. Three kinds share the list; each carries its own
 * credentials, and all three load through the same pipeline — see
 * source.ts's buildXtreamSource / buildM3uSource / buildStalkerSource.
 *
 * (This comment used to say only Xtream was fetched, which was true when it
 * was written and stopped being true when the other two builders landed. It
 * outlived the fact long enough to put a wrong claim in the public docs.)
 */

export type PlaylistKind = "xtream" | "m3u" | "stalker";

interface PlaylistBase {
  id: string;
  name: string;
  enabled: boolean;
  /** Category/folder ids the user switched off — these stay out of the Live
   * sidebar. Absent (older saves) means nothing hidden; unknown ids are
   * ignored, so folders new on the provider side default to visible. */
  hiddenCategories?: string[];
}

export interface XtreamPlaylist extends PlaylistBase {
  kind: "xtream";
  server: string;
  username: string;
  password: string;
  /** Live container extension for the playable URL. Absent (older saves)
   * means the default "ts", which is what nearly every Xtream panel serves
   * for live; a few use "m3u8". */
  liveExt?: string;
}

export interface M3uPlaylist extends PlaylistBase {
  kind: "m3u";
  url: string;
}

export interface StalkerPlaylist extends PlaylistBase {
  kind: "stalker";
  portal: string;
  mac: string;
  /** The endpoint path that answered the handshake (`…/load.php` vs
   * `…/portal.php` varies by install), remembered by the add-form's probe
   * so later loads skip straight to it. Absent = probe again. */
  endpoint?: string;
}

export type Playlist = XtreamPlaylist | M3uPlaylist | StalkerPlaylist;

/** A playlist as it comes off the add form: no id/enabled yet. */
export type PlaylistDraft =
  | Omit<XtreamPlaylist, "id" | "enabled">
  | Omit<M3uPlaylist, "id" | "enabled">
  | Omit<StalkerPlaylist, "id" | "enabled">;

export const KIND_LABELS: Record<PlaylistKind, string> = {
  xtream: "Xtream",
  m3u: "M3U",
  stalker: "Stalker/MAG",
};

/** Picker options — ONE list for Settings and onboarding. */
export const KIND_TABS: Array<{ key: PlaylistKind; label: string }> = [
  { key: "xtream", label: KIND_LABELS.xtream },
  { key: "m3u", label: KIND_LABELS.m3u },
  { key: "stalker", label: KIND_LABELS.stalker },
];

/** The add-form's field bag — a superset across kinds, shared by the
 * Settings form and onboarding so the two can never drift. */
export interface PlaylistFormState {
  name: string;
  server: string;
  username: string;
  password: string;
  url: string;
  portal: string;
  mac: string;
}

export const EMPTY_PLAYLIST_FORM: PlaylistFormState = {
  name: "",
  server: "",
  username: "",
  password: "",
  url: "",
  portal: "",
  mac: "",
};

export function draftFrom(
  kind: PlaylistKind,
  f: PlaylistFormState,
): PlaylistDraft {
  switch (kind) {
    case "xtream":
      return {
        kind,
        name: f.name,
        server: f.server.trim(),
        username: f.username.trim(),
        password: f.password,
      };
    case "m3u":
      return { kind, name: f.name, url: f.url.trim() };
    case "stalker":
      return {
        kind,
        name: f.name,
        portal: f.portal.trim(),
        mac: f.mac.trim(),
      };
  }
}

export function isFormComplete(
  kind: PlaylistKind,
  f: PlaylistFormState,
): boolean {
  switch (kind) {
    case "xtream":
      return (
        isHttpUrl(f.server) && f.username.trim() !== "" && f.password !== ""
      );
    case "m3u":
      return isHttpUrl(f.url);
    case "stalker":
      return isHttpUrl(f.portal) && f.mac.trim() !== "";
  }
}

/** The address shown under a playlist's name in the list. */
export function playlistSource(p: Playlist): string {
  switch (p.kind) {
    case "xtream":
      return p.server;
    case "m3u":
      return p.url;
    case "stalker":
      return p.portal;
  }
}

/** The draft's name, or a default like "Xtream Playlist 2": numbered per
 * kind among the playlists already in `list`, like the design's examples. */
function nameFor(list: Playlist[], draft: PlaylistDraft): string {
  return (
    draft.name.trim() ||
    `${KIND_LABELS[draft.kind]} Playlist ${
      list.filter((p) => p.kind === draft.kind).length + 1
    }`
  );
}

/** Add a draft to the list. A blank name gets a default like "Xtream
 * Playlist 2" — numbered per kind, like the design's examples. */
export function addPlaylist(
  list: Playlist[],
  draft: PlaylistDraft,
  id: string = crypto.randomUUID(),
): Playlist[] {
  return [...list, { ...draft, name: nameFor(list, draft), id, enabled: true }];
}

/** Put a draft in the place of the playlist with this id: the same id and
 * spot in the list, the draft's fields, and the enabled switch it had.
 * Onboarding uses it so a second Continue on the same form replaces the
 * playlist the first one saved rather than adding another. A blank name is
 * numbered among the OTHER playlists, so the replaced one doesn't count
 * itself. An id that isn't in the list leaves it unchanged. */
export function replacePlaylist(
  list: Playlist[],
  id: string,
  draft: PlaylistDraft,
): Playlist[] {
  const name = nameFor(
    list.filter((p) => p.id !== id),
    draft,
  );
  return list.map((p) =>
    p.id === id ? { ...draft, name, id, enabled: p.enabled } : p,
  );
}

export function removePlaylist(list: Playlist[], id: string): Playlist[] {
  return list.filter((p) => p.id !== id);
}

export function togglePlaylist(list: Playlist[], id: string): Playlist[] {
  return list.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p));
}

export function isCategoryHidden(p: Playlist, categoryId: string): boolean {
  return p.hiddenCategories?.includes(categoryId) ?? false;
}

/** What to call one entry of a playlist's hidden set in the Unhide list: the
 * name the loaded catalog recorded for it (LiveGroup.hiddenFolders), else the
 * id itself. The id IS the name for an M3U, and for a Stalker portal it is
 * the genre id, which is all there is until the catalog has loaded or when
 * its record predates the field. Unhiding acts on the id either way. */
export function hiddenFolderLabel(
  id: string,
  known: readonly { id: string; name: string }[] | undefined,
): string {
  return known?.find((f) => f.id === id)?.name || id;
}

/** Flip one category's visibility on one playlist. */
export function toggleHiddenCategory(
  list: Playlist[],
  playlistId: string,
  categoryId: string,
): Playlist[] {
  return list.map((p) => {
    if (p.id !== playlistId) return p;
    const hidden = p.hiddenCategories ?? [];
    return {
      ...p,
      hiddenCategories: hidden.includes(categoryId)
        ? hidden.filter((id) => id !== categoryId)
        : [...hidden, categoryId],
    };
  });
}

/** Light URL check for server/playlist/portal fields. */
/** Batch visibility: hide or show MANY categories in one pass — the
 * folder editor's "toggle all" acts on every visible (searched) row, and
 * looping toggleHiddenCategory would clobber itself through stale state. */
export function setCategoriesHidden(
  list: Playlist[],
  playlistId: string,
  categoryIds: string[],
  hidden: boolean,
): Playlist[] {
  return list.map((p) => {
    if (p.id !== playlistId) return p;
    const current = new Set(p.hiddenCategories ?? []);
    for (const id of categoryIds) {
      if (hidden) current.add(id);
      else current.delete(id);
    }
    return { ...p, hiddenCategories: [...current] };
  });
}

/** Replace a playlist's hidden set wholesale — the folder editor's SAVE:
 * its draft carries the full hidden set (including ids the adult filter
 * keeps out of view), so a straight replace loses nothing. */
export function setHiddenCategories(
  list: Playlist[],
  playlistId: string,
  hiddenIds: string[],
): Playlist[] {
  return list.map((p) =>
    p.id === playlistId ? { ...p, hiddenCategories: [...hiddenIds] } : p,
  );
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const KEY = "playlists";
const VERSION = 1;
const EVENT = "blammytv:playlists";

export function loadPlaylists(): Playlist[] {
  return loadList(KEY, VERSION, (x): x is Playlist =>
    hasId(x) && ["xtream", "m3u", "stalker"].includes((x as { kind?: unknown }).kind as string),
  );
}

/** Saving notifies listeners (the Live tab) so its data refreshes without
 * a restart. */
export function savePlaylists(list: Playlist[]): void {
  save(KEY, VERSION, list);
  emitPlaylistsChange();
}

/** Fire the refresh signal without saving — for settings that change what
 * the Live tab shows through the same pipeline (the adult filter). */
export function emitPlaylistsChange(): void {
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onPlaylistsChange(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

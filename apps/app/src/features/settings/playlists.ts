import { load, save } from "../../lib/storage";

/**
 * Live-TV sources. Three kinds share the list; each carries its own
 * credentials. Only Xtream is fetched today — M3U and Stalker slot in behind
 * the same model when their clients land.
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

/** Add a draft to the list. A blank name gets a default like "Xtream
 * Playlist 2" — numbered per kind, like the design's examples. */
export function addPlaylist(
  list: Playlist[],
  draft: PlaylistDraft,
  id: string = crypto.randomUUID(),
): Playlist[] {
  const name =
    draft.name.trim() ||
    `${KIND_LABELS[draft.kind]} Playlist ${
      list.filter((p) => p.kind === draft.kind).length + 1
    }`;
  return [...list, { ...draft, name, id, enabled: true }];
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
  return load<Playlist[]>(KEY, VERSION, []);
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

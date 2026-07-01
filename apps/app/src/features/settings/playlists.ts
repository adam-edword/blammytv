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
}

export interface XtreamPlaylist extends PlaylistBase {
  kind: "xtream";
  server: string;
  username: string;
  password: string;
}

export interface M3uPlaylist extends PlaylistBase {
  kind: "m3u";
  url: string;
}

export interface StalkerPlaylist extends PlaylistBase {
  kind: "stalker";
  portal: string;
  mac: string;
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

/** Light URL check for server/playlist/portal fields. */
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

export function loadPlaylists(): Playlist[] {
  return load<Playlist[]>(KEY, VERSION, []);
}

export function savePlaylists(list: Playlist[]): void {
  save(KEY, VERSION, list);
}

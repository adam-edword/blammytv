import type { XtreamPlaylist } from "./xtream";

/**
 * On-device Xtream playlists (self-contained build). Credentials live in
 * localStorage on the device — entered in the Playlists settings tab, used to
 * build the live section directly. (Previously the server's sources.json.)
 */
export interface Playlist extends XtreamPlaylist {
  enabled: boolean;
  createdAt: string;
}

const KEY = "blammytv.playlists";

export function loadPlaylists(): Playlist[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Playlist[]) : [];
  } catch {
    return [];
  }
}

function save(list: Playlist[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export function addPlaylist(input: {
  name?: string;
  baseUrl: string;
  username: string;
  password: string;
  liveExt?: string;
}): Playlist {
  const list = loadPlaylists();
  const p: Playlist = {
    id: crypto.randomUUID(),
    name: input.name?.trim() || "IPTV",
    baseUrl: input.baseUrl.replace(/\/+$/, ""),
    username: input.username,
    password: input.password,
    liveExt: (input.liveExt || "ts").replace(/^\./, ""),
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  list.push(p);
  save(list);
  return p;
}

export function removePlaylist(id: string): void {
  save(loadPlaylists().filter((p) => p.id !== id));
}

export function setPlaylistEnabled(id: string, enabled: boolean): void {
  save(loadPlaylists().map((p) => (p.id === id ? { ...p, enabled } : p)));
}

import type { XtreamPlaylist } from "./xtream";

/**
 * On-device live-TV playlists (self-contained build). Credentials live in
 * localStorage on the device — entered in the Playlists settings tab (or handed
 * over from a phone), and used to build the live section directly.
 *
 * A playlist is one of two kinds, discriminated by `kind`:
 *  - `xtream` — an Xtream Codes panel (player_api.php JSON + XMLTV).
 *  - `m3u`    — a hosted M3U playlist URL (+ optional XMLTV EPG URL).
 *
 * Both produce the same `{ groups, channels, programs }` live section (see
 * `lib/live`). Stalker/MAG will slot in as a third kind later.
 */
export interface XtreamPlaylistEntry extends XtreamPlaylist {
  kind: "xtream";
  enabled: boolean;
  createdAt: string;
}

export interface M3uPlaylistEntry {
  kind: "m3u";
  id: string;
  name: string;
  /** The hosted .m3u/.m3u8 playlist URL. */
  url: string;
  /** Optional XMLTV EPG URL; falls back to the playlist's own `url-tvg` header. */
  epgUrl?: string;
  enabled: boolean;
  createdAt: string;
}

export type Playlist = XtreamPlaylistEntry | M3uPlaylistEntry;

const KEY = "blammytv.playlists";

/** Coerce a stored record into a typed Playlist. Legacy entries predate `kind`
 * and are all Xtream — default them so old configs keep working. */
function normalize(p: unknown): Playlist | null {
  if (!p || typeof p !== "object") return null;
  const r = p as Record<string, unknown>;
  const id = String(r.id ?? "");
  const enabled = r.enabled !== false;
  const createdAt = String(r.createdAt ?? new Date(0).toISOString());
  if (!id) return null;

  if (r.kind === "m3u") {
    const url = String(r.url ?? "");
    if (!url) return null;
    return {
      kind: "m3u",
      id,
      name: String(r.name ?? "M3U"),
      url,
      epgUrl: r.epgUrl ? String(r.epgUrl) : undefined,
      enabled,
      createdAt,
    };
  }

  const baseUrl = String(r.baseUrl ?? "");
  if (!baseUrl) return null;
  return {
    kind: "xtream",
    id,
    name: String(r.name ?? "IPTV"),
    baseUrl,
    username: String(r.username ?? ""),
    password: String(r.password ?? ""),
    liveExt: String(r.liveExt ?? "ts"),
    enabled,
    createdAt,
  };
}

export function loadPlaylists(): Playlist[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    return Array.isArray(list)
      ? list.map(normalize).filter((p): p is Playlist => p !== null)
      : [];
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
}): XtreamPlaylistEntry {
  const list = loadPlaylists();
  const p: XtreamPlaylistEntry = {
    kind: "xtream",
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

export function addM3uPlaylist(input: {
  name?: string;
  url: string;
  epgUrl?: string;
}): M3uPlaylistEntry {
  const list = loadPlaylists();
  const p: M3uPlaylistEntry = {
    kind: "m3u",
    id: crypto.randomUUID(),
    name: input.name?.trim() || "M3U Playlist",
    url: input.url.trim(),
    epgUrl: input.epgUrl?.trim() || undefined,
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

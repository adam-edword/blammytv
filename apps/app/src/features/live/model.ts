/**
 * The Live tab's domain model — one shape whether the data comes from a real
 * Xtream playlist or the bundled mock harness. Ids are namespaced by source
 * (`<playlistId>:<streamId>`) so multiple playlists never collide and
 * favorites/recents stay stable across reloads.
 */

export type Quality = "4K" | "FHD" | "HD" | "HDR";

export interface Channel {
  id: string;
  name: string;
  /** Best-effort badge from the title — null renders no badge. */
  quality: Quality | null;
  /** Sidebar folder (category) this channel lives in. */
  folderId: string;
  logo?: string;
  /** Days of server-side catch-up archive, 0 when the channel has none.
   * Derived from the panel's tv_archive / tv_archive_duration fields (both
   * arrive string-typed, so this is the coerced, guarded number). */
  archiveDays: number;
}

export interface Programme {
  title: string;
  synopsis?: string;
  start: Date;
  end: Date;
}

export interface LiveFolder {
  id: string;
  name: string;
}

/** One source's sidebar section: a playlist (or the mock catalog). */
export interface LiveGroup {
  id: string;
  name: string;
  folders: LiveFolder[];
  /** Set when this source failed to load — its folders/channels are absent
   * but the other sources still render. */
  error?: string;
}

export interface LiveData {
  groups: LiveGroup[];
  channels: Channel[];
  /** Channel id → programmes sorted by start. Missing/empty means the
   * channel renders a "No Information" lane. */
  programmes: Map<string, Programme[]>;
}

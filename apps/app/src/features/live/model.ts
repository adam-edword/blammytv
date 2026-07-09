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
  /** Provider channel number (Xtream `num`), shown in the hero on hover.
   * Undefined when the source doesn't number its channels. */
  number?: number;
  /** Direct stream URL (M3U entries carry theirs verbatim). Absent for
   * Xtream, whose URL is rebuilt from the id + saved credentials — see
   * stream.ts#channelStreamUrl. Callers prefer this when present. */
  url?: string;
  /** Stalker only: the channel's opaque play command, exchanged per-play
   * for a short-lived tokenized URL (stream.ts#resolveStreamUrl →
   * data/stalker.ts#createLink). Rides the Channel so it survives the disk
   * cache, same pattern as archiveDays. */
  streamCmd?: string;
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

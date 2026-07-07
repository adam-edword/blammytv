import type { TheaterMeta } from "../../lib/tauri";
import { loadPlaylists, type XtreamPlaylist } from "../settings/playlists";
import type { Channel, Programme } from "./model";

/**
 * Rebuild a playable Xtream live URL from a channel id. The new model doesn't
 * store the URL (or even the raw stream_id) on the channel — ids are
 * namespaced `<playlistId>:<streamId>`, so we split that back apart and look
 * the credentials up from the saved playlist. Returns null when the id isn't a
 * real Xtream channel (the mock catalog, or a playlist that's since gone).
 *
 * Format (classic Xtream, credentials in the path):
 *   {server}/live/{username}/{password}/{streamId}.{liveExt}
 */
export function channelStreamUrl(channelId: string): string | null {
  const sep = channelId.indexOf(":");
  if (sep < 0) return null; // mock ids ("ch0") have no playlist prefix
  const playlistId = channelId.slice(0, sep);
  const streamId = channelId.slice(sep + 1);
  if (!streamId) return null;

  const playlist = loadPlaylists().find(
    (p): p is XtreamPlaylist =>
      p.id === playlistId && p.kind === "xtream",
  );
  if (!playlist) return null;

  const base = playlist.server.trim().replace(/\/+$/, "");
  const u = encodeURIComponent(playlist.username);
  const p = encodeURIComponent(playlist.password);
  const ext = (playlist.liveExt || "ts").replace(/^\./, "");
  return `${base}/live/${u}/${p}/${streamId}.${ext}`;
}

/** The overlay's now-playing metadata for a channel + its airing programme. */
export function buildMeta(
  channel: Channel,
  programme: Programme | undefined,
  now: Date,
): TheaterMeta {
  const live =
    !!programme && programme.start <= now && now < programme.end;
  return {
    channelName: channel.name,
    logo: channel.logo,
    title: programme?.title,
    description: programme?.synopsis,
    live,
  };
}

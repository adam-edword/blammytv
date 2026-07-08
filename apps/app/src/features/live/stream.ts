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

/** Which wall-clock the panel expects in a timeshift URL. This is THE open
 * question the spike exists to answer: panels disagree on whether the start
 * timestamp is the server's local time or UTC, and it can only be settled
 * against a live server. Isolated here so flipping it is a one-line change. */
export type TimeshiftTz = "utc" | "local";

const pad = (n: number) => String(n).padStart(2, "0");

/** Format an instant as the panel's `YYYY-MM-DD:HH-MM`, in either UTC or the
 * machine's local wall-clock. Seconds are dropped — timeshift granularity is
 * the minute. */
export function formatTimeshiftStamp(at: Date, tz: TimeshiftTz): string {
  const [y, mo, d, h, mi] =
    tz === "utc"
      ? [
          at.getUTCFullYear(),
          at.getUTCMonth() + 1,
          at.getUTCDate(),
          at.getUTCHours(),
          at.getUTCMinutes(),
        ]
      : [
          at.getFullYear(),
          at.getMonth() + 1,
          at.getDate(),
          at.getHours(),
          at.getMinutes(),
        ];
  return `${y}-${pad(mo)}-${pad(d)}:${pad(h)}-${pad(mi)}`;
}

/** The two timeshift URL schemes Xtream/XUI panels ship. Which one a given
 * panel honors is exactly what the spike is probing:
 *   - "path": {server}/timeshift/{u}/{p}/{mins}/{stamp}/{id}.{ext}
 *   - "php":  {server}/streaming/timeshift.php?username&password&stream&start&duration
 */
export type TimeshiftFormat = "path" | "php";

/**
 * Rebuild a playable Xtream *timeshift* (catch-up) URL for a past slot on a
 * channel. Same id→credentials lookup as the live builder; returns null for
 * non-Xtream ids or a since-removed playlist.
 *
 * `durationMins` is the LENGTH of the requested playback (the programme's
 * runtime), not the archive depth; `start` is the programme's start moment.
 */
export function catchupStreamUrl(
  channelId: string,
  start: Date,
  durationMins: number,
  tz: TimeshiftTz = "utc",
  format: TimeshiftFormat = "path",
): string | null {
  const sep = channelId.indexOf(":");
  if (sep < 0) return null;
  const playlistId = channelId.slice(0, sep);
  const streamId = channelId.slice(sep + 1);
  if (!streamId) return null;

  const playlist = loadPlaylists().find(
    (p): p is XtreamPlaylist => p.id === playlistId && p.kind === "xtream",
  );
  if (!playlist) return null;

  const mins = Math.max(1, Math.round(durationMins));
  const base = playlist.server.trim().replace(/\/+$/, "");
  const stamp = formatTimeshiftStamp(start, tz);

  if (format === "php") {
    const qs = new URLSearchParams({
      username: playlist.username,
      password: playlist.password,
      stream: streamId,
      start: stamp,
      duration: String(mins),
    });
    return `${base}/streaming/timeshift.php?${qs}`;
  }

  const u = encodeURIComponent(playlist.username);
  const p = encodeURIComponent(playlist.password);
  const ext = (playlist.liveExt || "ts").replace(/^\./, "");
  return `${base}/timeshift/${u}/${p}/${mins}/${stamp}/${streamId}.${ext}`;
}

/** The overlay's now-playing metadata for a channel + its airing programme. */
export function buildMeta(
  channel: Channel,
  programme: Programme | undefined,
  now: Date,
  sourceName?: string,
  favorite?: boolean,
): TheaterMeta {
  const live =
    !!programme && programme.start <= now && now < programme.end;
  let progressPct: number | undefined;
  let startLabel: string | undefined;
  if (programme) {
    const span = programme.end.getTime() - programme.start.getTime();
    progressPct =
      span > 0
        ? Math.min(
            100,
            Math.max(
              0,
              ((now.getTime() - programme.start.getTime()) / span) * 100,
            ),
          )
        : 0;
    startLabel = programme.start.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return {
    channelName: channel.name,
    logo: channel.logo,
    title: programme?.title,
    description: programme?.synopsis,
    live,
    sourceName,
    startLabel,
    progressPct,
    favorite,
  };
}

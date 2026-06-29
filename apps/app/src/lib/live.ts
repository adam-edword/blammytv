import type { ConfigBlob } from "@blammytv/shared";
import { buildXtreamLive } from "./xtream";
import { buildM3uLive } from "./m3u";
import type { Playlist, M3uPlaylistEntry, XtreamPlaylistEntry } from "./playlists";

type LiveSection = ConfigBlob["live"];

const EMPTY: LiveSection = { groups: [], channels: [], programs: [] };

/**
 * Build the merged live section from every enabled playlist, dispatching by
 * `kind`. Xtream and M3U are built independently and concatenated — each source
 * is already best-effort internally, so one kind failing never affects the
 * other. Stalker/MAG will add a third branch here later.
 */
export async function buildLive(playlists: Playlist[]): Promise<LiveSection> {
  const xtream = playlists.filter(
    (p): p is XtreamPlaylistEntry => p.kind === "xtream",
  );
  const m3u = playlists.filter((p): p is M3uPlaylistEntry => p.kind === "m3u");

  const [x, m] = await Promise.all([
    xtream.length ? buildXtreamLive(xtream) : EMPTY,
    m3u.length ? buildM3uLive(m3u) : EMPTY,
  ]);

  const groups = [...x.groups, ...m.groups];
  const channels = [...x.channels, ...m.channels];
  const programs = [...x.programs, ...m.programs];
  return { groups, channels, programs, featuredChannelId: channels[0]?.id };
}

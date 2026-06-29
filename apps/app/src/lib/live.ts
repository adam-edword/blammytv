import type { ConfigBlob } from "@blammytv/shared";
import { buildXtreamChannels } from "./xtream";
import { buildM3uChannels } from "./m3u";
import type { Playlist, M3uPlaylistEntry, XtreamPlaylistEntry } from "./playlists";

type LiveSection = ConfigBlob["live"];

/** A source's channels + groups. Programmes are NOT built here — the guide
 * fetches each channel's EPG lazily (see lib/epgLazy) so a 20k-channel provider
 * doesn't block the load on a tens-of-MB XMLTV dump. */
export interface ChannelBuild {
  groups: LiveSection["groups"];
  channels: LiveSection["channels"];
}

const EMPTY: ChannelBuild = { groups: [], channels: [] };

/**
 * Build the live section's channels + groups, dispatching by kind. Fast (auth +
 * the channel lists). Programmes start empty and stream in per-channel from the
 * lazy EPG store as the guide renders.
 */
export async function buildLive(playlists: Playlist[]): Promise<LiveSection> {
  const xtream = playlists.filter(
    (p): p is XtreamPlaylistEntry => p.kind === "xtream",
  );
  const m3u = playlists.filter((p): p is M3uPlaylistEntry => p.kind === "m3u");

  const [x, m] = await Promise.all([
    xtream.length ? buildXtreamChannels(xtream) : EMPTY,
    m3u.length ? buildM3uChannels(m3u) : EMPTY,
  ]);

  const groups = [...x.groups, ...m.groups];
  const channels = [...x.channels, ...m.channels];
  return { groups, channels, programs: [], featuredChannelId: channels[0]?.id };
}

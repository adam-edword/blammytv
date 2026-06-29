import type { ConfigBlob, EpgProgram } from "@blammytv/shared";
import { buildXtreamChannels } from "./xtream";
import { buildM3uChannels } from "./m3u";
import type { Playlist, M3uPlaylistEntry, XtreamPlaylistEntry } from "./playlists";

type LiveSection = ConfigBlob["live"];

/** A source's channels/groups now, with its EPG deferred to `loadPrograms()` so
 * the guide can render before the (often huge) XMLTV finishes downloading. */
export interface ChannelBuild {
  groups: LiveSection["groups"];
  channels: LiveSection["channels"];
  loadPrograms: () => Promise<EpgProgram[]>;
}

const EMPTY: ChannelBuild = {
  groups: [],
  channels: [],
  loadPrograms: async () => [],
};

/**
 * Build the live section in two phases. The returned section has channels +
 * groups but **no programs** — it resolves fast (auth + the channel lists, a
 * couple seconds) so the app is usable immediately. The EPG (tens of MB of
 * XMLTV) is then fetched + parsed in the background and handed back via
 * `onPrograms`, which patches the guide once it's ready.
 */
export async function buildLive(
  playlists: Playlist[],
  onPrograms?: (programs: EpgProgram[]) => void,
): Promise<LiveSection> {
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

  // Background: pull + parse the EPG, then patch it in. Best-effort — a failed
  // EPG just leaves channels rendering "No info".
  if (onPrograms) {
    void Promise.all([x.loadPrograms(), m.loadPrograms()])
      .then(([xp, mp]) => onPrograms([...xp, ...mp]))
      .catch(() => {});
  }

  return { groups, channels, programs: [], featuredChannelId: channels[0]?.id };
}

import type { ConfigBlob } from "@blammytv/shared";
import { XtreamClient } from "./client";
import { mapChannels, mapGroups } from "./mapper";
import type { XtreamConfig } from "./types";
import type { ChannelBuild } from "../live";

type LiveSection = ConfigBlob["live"];

/** A saved Xtream playlist: account config + identity. */
export type XtreamPlaylist = XtreamConfig & { id: string; name: string };

/**
 * Build the channels/groups from the enabled Xtream playlists (fast — auth +
 * the live lists). EPG is fetched per-channel on demand (see lib/epgLazy), not
 * here. Each source is best-effort: one failing playlist doesn't sink the others.
 */
export async function buildXtreamChannels(
  sources: XtreamPlaylist[],
): Promise<ChannelBuild> {
  const groups: LiveSection["groups"] = [];
  const channels: LiveSection["channels"] = [];

  await Promise.all(
    sources.map(async (source) => {
      try {
        const client = new XtreamClient(source);
        await client.authenticate();

        const [cats, streams] = await Promise.all([
          client.getLiveCategories(),
          client.getLiveStreams(),
        ]);

        groups.push(...mapGroups(cats, source.id));
        channels.push(...mapChannels(streams, source.id, client));
      } catch (err) {
        console.error(`[xtream] playlist "${source.name}" failed: ${msg(err)}`);
      }
    }),
  );

  return { groups, channels };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

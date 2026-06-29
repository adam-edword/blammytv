import type { ConfigBlob, EpgProgram } from "@blammytv/shared";
import { XtreamClient } from "./client";
import { mapChannels, mapEpg, mapGroups } from "./mapper";
import type { XtreamConfig } from "./types";
import type { ChannelBuild } from "../live";

type LiveSection = ConfigBlob["live"];

/** A saved Xtream playlist: account config + identity. */
export type XtreamPlaylist = XtreamConfig & { id: string; name: string };

/**
 * Build the channels/groups from the enabled Xtream playlists (fast — auth +
 * the live lists). The EPG is deferred to `loadPrograms()` so the guide can
 * render immediately and the (often tens-of-MB) XMLTV streams in behind it. Each
 * source is best-effort: one failing playlist doesn't sink the others.
 */
export async function buildXtreamChannels(
  sources: XtreamPlaylist[],
): Promise<ChannelBuild> {
  const groups: LiveSection["groups"] = [];
  const channels: LiveSection["channels"] = [];
  // One EPG loader per source, capturing the (authenticated) client + that
  // source's channels — so the deferred phase re-fetches nothing.
  const epgLoaders: Array<() => Promise<EpgProgram[]>> = [];

  await Promise.all(
    sources.map(async (source) => {
      try {
        const client = new XtreamClient(source);
        await client.authenticate();

        const [cats, streams] = await Promise.all([
          client.getLiveCategories(),
          client.getLiveStreams(),
        ]);

        const srcChannels = mapChannels(streams, source.id, client);
        groups.push(...mapGroups(cats, source.id));
        channels.push(...srcChannels);

        epgLoaders.push(async () => {
          try {
            const xmltv = await client.getXmltv();
            return mapEpg(xmltv, srcChannels, Date.now());
          } catch (err) {
            console.warn(`[xtream] EPG failed for "${source.name}": ${msg(err)}`);
            return [];
          }
        });
      } catch (err) {
        console.error(`[xtream] playlist "${source.name}" failed: ${msg(err)}`);
      }
    }),
  );

  return {
    groups,
    channels,
    loadPrograms: async () =>
      (await Promise.all(epgLoaders.map((f) => f()))).flat(),
  };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

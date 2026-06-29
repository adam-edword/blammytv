import type { ConfigBlob } from "@blammytv/shared";
import { XtreamClient } from "./client";
import { mapChannels, mapEpg, mapGroups } from "./mapper";
import type { XtreamConfig } from "./types";

type LiveSection = ConfigBlob["live"];

/** A saved Xtream playlist: account config + identity. */
export type XtreamPlaylist = XtreamConfig & { id: string; name: string };

/**
 * Build the merged live section from the enabled Xtream playlists. Each source
 * is best-effort: one failing playlist (or its EPG) doesn't sink the others.
 */
export async function buildXtreamLive(
  sources: XtreamPlaylist[],
): Promise<LiveSection> {
  const groups: LiveSection["groups"] = [];
  const channels: LiveSection["channels"] = [];
  const programs: LiveSection["programs"] = [];

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

        // EPG is best-effort — channels still render ("No info") without it.
        try {
          const xs = performance.now();
          const xmltv = await client.getXmltv();
          const xf = performance.now();
          const mapped = mapEpg(xmltv, srcChannels, Date.now());
          console.log(
            `[load] EPG "${source.name}": fetch ${Math.round(xf - xs)}ms ` +
              `(${(xmltv.length / 1e6).toFixed(1)}MB), parse ${Math.round(performance.now() - xf)}ms → ${mapped.length}`,
          );
          programs.push(...mapped);
        } catch (err) {
          console.warn(`[xtream] EPG failed for "${source.name}": ${msg(err)}`);
        }
      } catch (err) {
        console.error(`[xtream] playlist "${source.name}" failed: ${msg(err)}`);
      }
    }),
  );

  return { groups, channels, programs, featuredChannelId: channels[0]?.id };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

import type { ConfigBlob, EpgProgram } from "@blammytv/shared";
import { httpGetText } from "../http";
import { channelId, groupId, mapEpg, validUrl } from "../xtream/mapper";
import type { M3uPlaylistEntry } from "../playlists";
import type { ChannelBuild } from "../live";
import { parseM3u } from "./parser";

type LiveSection = ConfigBlob["live"];

const UNCATEGORIZED = "Uncategorized";

/**
 * Build channels/groups from the enabled M3U playlists (fetch + parse the
 * playlist). The EPG (the `url-tvg` / explicit XMLTV) is deferred to
 * `loadPrograms()` so the guide renders immediately. Each source is best-effort.
 * M3U entries already carry a directly-playable URL — same shape as Xtream.
 */
export async function buildM3uChannels(
  sources: M3uPlaylistEntry[],
): Promise<ChannelBuild> {
  const groups: LiveSection["groups"] = [];
  const channels: LiveSection["channels"] = [];
  const epgLoaders: Array<() => Promise<EpgProgram[]>> = [];

  await Promise.all(
    sources.map(async (source) => {
      try {
        const text = await httpGetText(source.url);
        const { entries, epgUrl } = parseM3u(text);

        // Distinct group-titles become groups, in first-seen order.
        const order = new Map<string, number>();
        for (const e of entries) {
          const g = e.groupTitle || UNCATEGORIZED;
          if (!order.has(g)) {
            order.set(g, order.size);
            groups.push({
              id: groupId(source.id, g),
              name: g,
              hidden: false,
              order: order.size - 1,
            });
          }
        }

        // Index-based ids guarantee uniqueness (tvg-id repeats across HD/SD
        // variants); tvg-id is kept only as the EPG match key.
        const srcChannels = entries.map((e, i) => ({
          id: channelId(source.id, i),
          name: e.name,
          logo: validUrl(e.logo),
          groupId: groupId(source.id, e.groupTitle || UNCATEGORIZED),
          streamUrl: e.url,
          epgId: e.tvgId || undefined,
        }));
        channels.push(...srcChannels);

        const epg = source.epgUrl || epgUrl;
        if (epg) {
          epgLoaders.push(async () => {
            try {
              const xmltv = await httpGetText(epg);
              return mapEpg(xmltv, srcChannels, Date.now());
            } catch (err) {
              console.warn(`[m3u] EPG failed for "${source.name}": ${msg(err)}`);
              return [];
            }
          });
        }
      } catch (err) {
        console.error(`[m3u] playlist "${source.name}" failed: ${msg(err)}`);
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

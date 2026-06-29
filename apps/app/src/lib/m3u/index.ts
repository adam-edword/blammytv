import type { ConfigBlob } from "@blammytv/shared";
import { httpGetText } from "../http";
import { channelId, groupId, mapEpg, validUrl } from "../xtream/mapper";
import type { M3uPlaylistEntry } from "../playlists";
import { parseM3u } from "./parser";

type LiveSection = ConfigBlob["live"];

const UNCATEGORIZED = "Uncategorized";

/**
 * Build the merged live section from the enabled M3U playlists. Each source is
 * best-effort: a playlist that fails to fetch or parse (or whose EPG fails)
 * never sinks the others. M3U entries already carry a directly-playable URL, so
 * channels need no per-play resolution — they slot into the same shape Xtream
 * produces.
 */
export async function buildM3uLive(
  sources: M3uPlaylistEntry[],
): Promise<LiveSection> {
  const groups: LiveSection["groups"] = [];
  const channels: LiveSection["channels"] = [];
  const programs: LiveSection["programs"] = [];

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

        // EPG is best-effort — channels still render ("No info") without it.
        const epg = source.epgUrl || epgUrl;
        if (epg) {
          try {
            const xmltv = await httpGetText(epg);
            programs.push(...mapEpg(xmltv, srcChannels, Date.now()));
          } catch (err) {
            console.warn(`[m3u] EPG failed for "${source.name}": ${msg(err)}`);
          }
        }
      } catch (err) {
        console.error(`[m3u] playlist "${source.name}" failed: ${msg(err)}`);
      }
    }),
  );

  return { groups, channels, programs, featuredChannelId: channels[0]?.id };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

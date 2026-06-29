import type { ConfigBlob } from "@blammytv/shared";
import { httpGetText } from "../http";
import { channelId, groupId, validUrl } from "../xtream/mapper";
import type { M3uPlaylistEntry } from "../playlists";
import type { ChannelBuild } from "../live";
import { parseM3u } from "./parser";

type LiveSection = ConfigBlob["live"];

const UNCATEGORIZED = "Uncategorized";

/**
 * Build channels/groups from the enabled M3U playlists (fetch + parse the
 * playlist). Each source is best-effort. M3U entries carry a directly-playable
 * URL — same shape as Xtream. (M3U has no per-channel EPG API, so M3U channels
 * currently show no programme info; that's a follow-up.)
 */
export async function buildM3uChannels(
  sources: M3uPlaylistEntry[],
): Promise<ChannelBuild> {
  const groups: LiveSection["groups"] = [];
  const channels: LiveSection["channels"] = [];

  await Promise.all(
    sources.map(async (source) => {
      try {
        const text = await httpGetText(source.url);
        const { entries } = parseM3u(text);

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
        channels.push(
          ...entries.map((e, i) => ({
            id: channelId(source.id, i),
            name: e.name,
            logo: validUrl(e.logo),
            groupId: groupId(source.id, e.groupTitle || UNCATEGORIZED),
            streamUrl: e.url,
            epgId: e.tvgId || undefined,
          })),
        );
      } catch (err) {
        console.error(`[m3u] playlist "${source.name}" failed: ${msg(err)}`);
      }
    }),
  );

  return { groups, channels };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

import {
  authenticate,
  fetchLiveCategories,
  fetchLiveStreams,
  fetchXmltv,
  type XtreamStream,
} from "../../data/xtream";
import {
  loadPlaylists,
  type XtreamPlaylist,
} from "../settings/playlists";
import { mockLive } from "./mock";
import type { Channel, LiveData, LiveGroup, Programme } from "./model";
import { extractQuality } from "./quality";
import { parseXmltv } from "./xmltv";

/**
 * The seam between the Live tab and where its data comes from. With no
 * enabled playlists the bundled mock catalog loads instead, so the tab is
 * always a working dev harness. Real sources follow the old build's proven
 * strategy: everything is fetched up front (categories + all streams in two
 * calls, then the full XMLTV document), and each playlist is best-effort —
 * one failing source (or its EPG) never sinks the others.
 */
export async function loadLive(now: Date): Promise<LiveData> {
  const playlists = loadPlaylists().filter(
    (p): p is XtreamPlaylist => p.enabled && p.kind === "xtream",
  );
  if (playlists.length === 0) return mockLive(now);

  const data: LiveData = { groups: [], channels: [], programmes: new Map() };
  const built = await Promise.all(
    playlists.map((p) => buildXtreamSource(p, now)),
  );
  // Assembled in saved-playlist order, not arrival order.
  for (const src of built) {
    data.groups.push(src.group);
    data.channels.push(...src.channels);
    for (const [id, list] of src.programmes) data.programmes.set(id, list);
  }
  return data;
}

async function buildXtreamSource(
  p: XtreamPlaylist,
  now: Date,
): Promise<{
  group: LiveGroup;
  channels: Channel[];
  programmes: Map<string, Programme[]>;
}> {
  try {
    await authenticate(p);
    const [cats, streams] = await Promise.all([
      fetchLiveCategories(p),
      fetchLiveStreams(p),
    ]);

    const hidden = new Set(p.hiddenCategories ?? []);
    const folders = cats
      .filter((c) => !hidden.has(c.id))
      .map((c) => ({ id: folderId(p.id, c.id), name: c.name }));
    const channels = mapStreams(streams, p);

    // EPG is best-effort — channels still render "No Information" without it.
    let programmes = new Map<string, Programme[]>();
    try {
      const xml = await fetchXmltv(p);
      programmes = parseXmltv(xml, epgIndex(streams, p), now);
    } catch (err) {
      console.warn(`[live] EPG failed for "${p.name}": ${msg(err)}`);
    }

    return { group: { id: p.id, name: p.name, folders }, channels, programmes };
  } catch (err) {
    console.error(`[live] playlist "${p.name}" failed: ${msg(err)}`);
    return {
      group: { id: p.id, name: p.name, folders: [], error: msg(err) },
      channels: [],
      programmes: new Map(),
    };
  }
}

const folderId = (playlistId: string, catId: unknown) =>
  `${playlistId}:${String(catId ?? "")}`;
const channelId = (playlistId: string, streamId: number | string) =>
  `${playlistId}:${streamId}`;

/** Normalize raw panel streams into channels. Streams in a hidden category
 * drop out entirely — hiding a folder hides its content, not just the
 * sidebar row. */
export function mapStreams(
  streams: XtreamStream[],
  p: XtreamPlaylist,
): Channel[] {
  const hidden = new Set(p.hiddenCategories ?? []);
  return streams
    .filter((s) => !hidden.has(String(s.category_id ?? "")))
    .map((s) => {
      const name = s.name?.trim() || `Channel ${s.stream_id}`;
      return {
        id: channelId(p.id, s.stream_id),
        name,
        quality: extractQuality(name),
        folderId: folderId(p.id, s.category_id),
        logo: validUrl(s.stream_icon),
      };
    });
}

/** epg_channel_id → our channel ids (one feed can back several channels). */
export function epgIndex(
  streams: XtreamStream[],
  p: XtreamPlaylist,
): Map<string, string[]> {
  const hidden = new Set(p.hiddenCategories ?? []);
  const byEpg = new Map<string, string[]>();
  for (const s of streams) {
    if (!s.epg_channel_id || hidden.has(String(s.category_id ?? ""))) continue;
    const list = byEpg.get(s.epg_channel_id) ?? [];
    list.push(channelId(p.id, s.stream_id));
    byEpg.set(s.epg_channel_id, list);
  }
  return byEpg;
}

function validUrl(s?: string | null): string | undefined {
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : undefined;
  } catch {
    return undefined;
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

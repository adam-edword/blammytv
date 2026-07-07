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
 *
 * `onStage` narrates progress for the loading screen — big playlists spend
 * real time in each stage, and a stalled label tells us exactly which one
 * wedged. Timings land on the console for the same reason.
 */
/** Session cache: switching tabs unmounts the Live screen, and refetching
 * a 90MB playlist on every remount is absurd. Keyed by the playlist
 * configs (so a Settings change misses naturally) and aged out on the
 * guide's half-hour rhythm. In-memory only — a fresh app launch always
 * fetches. */
const CACHE_TTL_MS = 30 * 60_000;
let cache: { key: string; at: number; data: LiveData } | null = null;

const enabledXtream = () =>
  loadPlaylists().filter(
    (p): p is XtreamPlaylist => p.enabled && p.kind === "xtream",
  );

const cacheKey = (playlists: XtreamPlaylist[]) =>
  playlists.length === 0
    ? "mock"
    : JSON.stringify(
        playlists.map((p) => [
          p.id,
          p.server,
          p.username,
          p.password,
          p.hiddenCategories ?? [],
        ]),
      );

/** The cached catalog, if it's still current — lets a remounting Live
 * screen render data in its very first frame, no loading state. */
export function peekLive(): LiveData | null {
  const key = cacheKey(enabledXtream());
  return cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS
    ? cache.data
    : null;
}

export async function loadLive(
  now: Date,
  onStage?: (label: string) => void,
  force = false,
): Promise<LiveData> {
  const playlists = enabledXtream();
  const key = cacheKey(playlists);
  if (!force && cache && cache.key === key) {
    if (Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
    cache = null;
  }

  let data: LiveData;
  if (playlists.length === 0) {
    data = mockLive(now);
  } else {
    data = { groups: [], channels: [], programmes: new Map() };
    const built = await Promise.all(
      playlists.map((p) => buildXtreamSource(p, now, onStage)),
    );
    // Assembled in saved-playlist order, not arrival order. concat, not
    // push(...spread): spreading a six-figure channel list overflows the
    // argument stack.
    for (const src of built) {
      data.groups.push(src.group);
      data.channels = data.channels.concat(src.channels);
      for (const [id, list] of src.programmes) data.programmes.set(id, list);
    }
  }

  // A total failure (no channels at all) stays uncached so the next mount
  // retries instead of pinning the error for half an hour.
  if (data.channels.length > 0) cache = { key, at: Date.now(), data };
  return data;
}

/** Yield a macrotask so the loading UI can paint between blocking stages
 * (huge playlists spend whole seconds in single JSON.parse / DOMParser
 * calls that nothing can interrupt). */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

async function buildXtreamSource(
  p: XtreamPlaylist,
  now: Date,
  onStage?: (label: string) => void,
): Promise<{
  group: LiveGroup;
  channels: Channel[];
  programmes: Map<string, Programme[]>;
}> {
  try {
    onStage?.(`Signing in to ${p.name}…`);
    await authenticate(p);

    onStage?.(`Fetching ${p.name} channels…`);
    await breathe();
    let t = performance.now();
    const [cats, streams] = await Promise.all([
      fetchLiveCategories(p),
      fetchLiveStreams(p),
    ]);
    console.info(
      `[live] ${p.name}: ${cats.length} categories + ${streams.length} streams in ${Math.round(performance.now() - t)}ms`,
    );

    const hidden = new Set(p.hiddenCategories ?? []);
    const folders = cats
      .filter((c) => !hidden.has(c.id))
      .map((c) => ({ id: folderId(p.id, c.id), name: c.name }));
    const channels = mapStreams(streams, p);

    // EPG is best-effort — channels still render "No Information" without it.
    let programmes = new Map<string, Programme[]>();
    try {
      onStage?.(`Downloading the ${p.name} TV guide…`);
      await breathe();
      t = performance.now();
      const xml = await fetchXmltv(p);
      const fetched = performance.now();
      onStage?.(`Reading the ${p.name} TV guide…`);
      await breathe();
      programmes = parseXmltv(xml, epgIndex(streams, p), now);
      console.info(
        `[live] ${p.name}: xmltv ${(xml.length / 1e6).toFixed(1)}MB in ${Math.round(fetched - t)}ms, parsed EPG for ${programmes.size} channels in ${Math.round(performance.now() - fetched)}ms`,
      );
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

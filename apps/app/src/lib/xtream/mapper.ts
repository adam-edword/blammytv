import type { ChannelGroup, LiveChannel, EpgProgram } from "@blammytv/shared";
import type {
  XtreamCategory,
  XtreamEpgListing,
  XtreamLiveStream,
} from "./types";
import type { XtreamClient } from "./client";

/** Decode a base64 field (Xtream encodes EPG title/desc), UTF-8 safe. */
function decodeB64(s?: string): string {
  if (!s) return "";
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes).trim();
  } catch {
    return "";
  }
}

/** Map a channel's `get_short_epg` listings into our programme shape. */
export function mapShortEpg(
  listings: XtreamEpgListing[],
  channelId: string,
): EpgProgram[] {
  const out: EpgProgram[] = [];
  for (const l of listings) {
    const start = Number(l.start_timestamp) * 1000;
    const stop = Number(l.stop_timestamp) * 1000;
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start)
      continue;
    const title = decodeB64(l.title);
    if (isFillerTitle(title)) continue;
    out.push({
      id: `${channelId}@${start}`,
      channelId,
      title,
      start: new Date(start).toISOString(),
      stop: new Date(stop).toISOString(),
      description: decodeB64(l.description) || undefined,
    });
  }
  return out;
}

// Ids are namespaced by source so multiple playlists never collide. Shared with
// the M3U builder so both source kinds use one id scheme.
export const groupId = (sourceId: string, catId: string) =>
  `${sourceId}:g:${catId}`;
export const channelId = (sourceId: string, streamId: number | string) =>
  `${sourceId}:c:${streamId}`;

export function mapGroups(
  cats: XtreamCategory[],
  sourceId: string,
): ChannelGroup[] {
  return cats.map((c, i) => ({
    id: groupId(sourceId, String(c.category_id)),
    name: c.category_name,
    hidden: false,
    order: i,
  }));
}

export function mapChannels(
  streams: XtreamLiveStream[],
  sourceId: string,
  client: XtreamClient,
): LiveChannel[] {
  return streams.map((s) => ({
    id: channelId(sourceId, s.stream_id),
    name: s.name,
    logo: validUrl(s.stream_icon),
    groupId: groupId(sourceId, String(s.category_id ?? "")),
    streamUrl: client.liveStreamUrl(s.stream_id),
    epgId: s.epg_channel_id || undefined,
  }));
}

/**
 * Map XMLTV programmes onto our channels, windowed to keep the blob bounded.
 * Parsed with the WebView's native DOMParser. Matched to channels by epg id.
 */
export function mapEpg(
  xmltv: string,
  channels: LiveChannel[],
  now: number,
): EpgProgram[] {
  // epgId → our channel ids (a single EPG feed can map to several channels).
  const byEpg = new Map<string, string[]>();
  for (const ch of channels) {
    if (!ch.epgId) continue;
    const list = byEpg.get(ch.epgId) ?? [];
    list.push(ch.id);
    byEpg.set(ch.epgId, list);
  }
  if (byEpg.size === 0) return [];

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xmltv, "text/xml");
    if (doc.querySelector("parsererror")) return [];
  } catch {
    return [];
  }

  const from = now - 60 * 60 * 1000;
  const to = now + 12 * 60 * 60 * 1000;
  const out: EpgProgram[] = [];

  for (const prog of Array.from(doc.getElementsByTagName("programme"))) {
    const targets = byEpg.get(prog.getAttribute("channel") ?? "");
    if (!targets) continue;
    const start = parseXmltvTime(prog.getAttribute("start"));
    const stop = parseXmltvTime(prog.getAttribute("stop"));
    if (start == null || stop == null || stop < from || start > to) continue;

    const title =
      prog.getElementsByTagName("title")[0]?.textContent?.trim() ?? "";
    // Skip filler entries ("To Be Announced", "No Information", untitled, …).
    // Providers often add a day-spanning placeholder that overlaps the real
    // programmes — it collides with them in the guide and clutters the hero.
    if (isFillerTitle(title)) continue;
    const description =
      prog.getElementsByTagName("desc")[0]?.textContent?.trim() || undefined;
    const startIso = new Date(start).toISOString();
    const stopIso = new Date(stop).toISOString();

    for (const chId of targets) {
      out.push({
        id: `${chId}@${start}`,
        channelId: chId,
        title,
        start: startIso,
        stop: stopIso,
        description,
      });
    }
  }
  return out;
}

/** "20260614200000 +0000" → epoch ms (UTC if no offset given). */
function parseXmltvTime(s?: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/.exec(
    String(s).trim(),
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, se, tz] = m;
  const offset = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : "Z";
  const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${se}${offset}`);
  return Number.isNaN(t) ? null : t;
}

/** Placeholder programme titles that carry no real info — dropped from the EPG. */
function isFillerTitle(t: string): boolean {
  if (!t) return true;
  return /^(to be announced|tba|no info(rmation)?|n\/?a|programme|program)\.?$/i.test(
    t,
  );
}

export function validUrl(s?: string | null): string | undefined {
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : undefined;
  } catch {
    return undefined;
  }
}

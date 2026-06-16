import { XMLParser } from "fast-xml-parser";
import type { ChannelGroup, LiveChannel, EpgProgram } from "@blammytv/shared";
import type { XtreamCategory, XtreamLiveStream } from "./types.js";
import type { XtreamClient } from "./client.js";

// Ids are namespaced by source so multiple playlists never collide.
const groupId = (sourceId: string, catId: string) => `${sourceId}:g:${catId}`;
const channelId = (sourceId: string, streamId: number | string) =>
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
 * Programmes are matched to channels by their `epg_channel_id`.
 */
export function mapEpg(
  xmltv: string,
  channels: LiveChannel[],
  now: number,
): EpgProgram[] {
  let doc: unknown;
  try {
    doc = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    }).parse(xmltv);
  } catch {
    return [];
  }

  const programmes = asArray((doc as XmlDoc)?.tv?.programme);
  if (programmes.length === 0) return [];

  // epgId → our channel ids (a single EPG feed can map to several channels).
  const byEpg = new Map<string, string[]>();
  for (const ch of channels) {
    if (!ch.epgId) continue;
    const list = byEpg.get(ch.epgId) ?? [];
    list.push(ch.id);
    byEpg.set(ch.epgId, list);
  }
  if (byEpg.size === 0) return [];

  const from = now - 60 * 60 * 1000;
  const to = now + 12 * 60 * 60 * 1000;
  const out: EpgProgram[] = [];

  for (const prog of programmes) {
    const targets = byEpg.get(String(prog["@_channel"] ?? ""));
    if (!targets) continue;
    const start = parseXmltvTime(prog["@_start"]);
    const stop = parseXmltvTime(prog["@_stop"]);
    if (start == null || stop == null || stop < from || start > to) continue;

    const title = textOf(prog.title) || "Programme";
    const description = textOf(prog.desc) || undefined;
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

interface XmlProgramme {
  "@_channel"?: string;
  "@_start"?: string;
  "@_stop"?: string;
  title?: unknown;
  desc?: unknown;
}
interface XmlDoc {
  tv?: { programme?: XmlProgramme | XmlProgramme[] };
}

/** "20260614200000 +0000" → epoch ms (UTC if no offset given). */
function parseXmltvTime(s?: string): number | null {
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

/** XMLTV text nodes can be a string, an object with #text, or an array. */
function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === "object") return String((node as { "#text"?: unknown })["#text"] ?? "");
  return String(node);
}

function asArray<T>(x: T | T[] | undefined): T[] {
  return Array.isArray(x) ? x : x == null ? [] : [x];
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

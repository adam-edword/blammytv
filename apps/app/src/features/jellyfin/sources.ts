/**
 * A Jellyfin item's own files as the streams the Stream tab lists (plan 027,
 * batch 2). Where AIOStreams searches for sources, a Jellyfin server already
 * holds them: `jf_sources` answers at once with the item's `MediaSources`,
 * cut down in Rust to what is read here (jf.rs `SOURCE_KEEPS`, `STREAM_KEEPS`).
 * A source's `Path` is the file's path on the server and is never carried.
 *
 * A file plays by its direct stream, `/Videos/{id}/stream?static=true&
 * mediaSourceId=…&tag=…`: the file as it is, in ranges, which mpv plays
 * whatever it holds. The probe found it needs no token (plans/027-api-facts.md
 * #2), and the URL carries none either way: a token, if the server ever asks
 * for one, goes to mpv as a header (batch 3).
 *
 * Pure: no network, no storage.
 */

import type { StremioStream } from "../../data/stremio";
import { HEX32 } from "./items";

/** A media stream, the fields `jf.rs` keeps. */
export interface JfStream {
  Index?: number;
  Type?: string;
  Codec?: string;
  Language?: string;
  DisplayTitle?: string;
  Title?: string;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsHearingImpaired?: boolean;
  IsExternal?: boolean;
  IsTextSubtitleStream?: boolean;
  Channels?: number;
  ChannelLayout?: string;
  Width?: number;
  Height?: number;
  BitRate?: number;
  VideoRange?: string;
  BitDepth?: number;
}

/** A media source, the fields `jf.rs` keeps. */
export interface JfSource {
  Id?: string;
  Name?: string;
  Container?: string;
  Size?: number;
  RunTimeTicks?: number;
  Bitrate?: number;
  ETag?: string;
  Protocol?: string;
  IsRemote?: boolean;
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
  MediaStreams?: JfStream[];
}

/** The direct stream of one source, or null when the item or source id is not
 * one, or the source is a remote one (a `.strm` file points elsewhere, and the
 * server's answer for it is not a file this reads). */
export function streamUrl(base: string, itemId: string, source: JfSource): string | null {
  if (!HEX32.test(itemId) || !source.Id || !HEX32.test(source.Id) || source.IsRemote === true) return null;
  const tag = source.ETag ? `&tag=${encodeURIComponent(source.ETag)}` : "";
  return `${base.replace(/\/+$/, "")}/Videos/${itemId}/stream?static=true&mediaSourceId=${source.Id}${tag}`;
}

const video = (s: JfSource) => s.MediaStreams?.find((x) => x.Type === "Video");

/** "1080p", from the picture's height; undefined when it has none. The bands
 * are the usual ones: a 1920x800 film is 1080p, as everywhere. */
export function resolutionOf(s: JfSource): string | undefined {
  const w = video(s)?.Width;
  const h = video(s)?.Height;
  if (typeof h !== "number" || h <= 0) return undefined;
  const wide = typeof w === "number" && w > 0 ? w : 0;
  if (h >= 2000 || wide >= 3400) return "2160p";
  if (h >= 1300 || wide >= 2400) return "1440p";
  if (h >= 900 || wide >= 1800) return "1080p";
  if (h >= 600 || wide >= 1200) return "720p";
  if (h >= 400) return "480p";
  return `${h}p`;
}

function size(bytes: number | undefined): string | undefined {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

const upper = (c: string | undefined) => (c ? c.toUpperCase() : undefined);

function pictureLine(s: JfSource): string | undefined {
  const v = video(s);
  const parts = [
    resolutionOf(s),
    upper(v?.Codec),
    // "SDR" is the default and "Unknown" says nothing; the rest is worth a word.
    v?.VideoRange && v.VideoRange !== "SDR" && v.VideoRange !== "Unknown" ? v.VideoRange : undefined,
    typeof v?.BitDepth === "number" && v.BitDepth > 8 ? `${v.BitDepth}-bit` : undefined,
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** The audio the server plays by default, else the first track. */
function audioLine(s: JfSource): string | undefined {
  const audio = (s.MediaStreams ?? []).filter((x) => x.Type === "Audio");
  const a = audio.find((x) => x.Index === s.DefaultAudioStreamIndex) ?? audio.find((x) => x.IsDefault) ?? audio[0];
  if (!a) return undefined;
  const layout = a.ChannelLayout || (typeof a.Channels === "number" ? `${a.Channels}ch` : undefined);
  const parts = [upper(a.Codec), layout, a.Language].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * `jf_sources` into the streams `mapStreams` reads, in the server's order. A
 * source with no usable id, or a remote one, is left out. `name` is the
 * resolution (mapper.ts `qualityLabel` reads it), `description` the lines the
 * source row shows, and `streamData` says the file is the user's own and
 * there already (`service.cached`), which is what makes it the auto-play pick.
 * `bingeGroup` is `jellyfin|<resolution>|<codec>`, the form `resolutionOf` in
 * mapper.ts reads, so the next episode prefers the same kind of file.
 */
export function streamsOf(base: string, itemId: string, sources: readonly JfSource[]): StremioStream[] {
  const out: StremioStream[] = [];
  for (const s of sources) {
    const url = streamUrl(base, itemId, s);
    if (!url) continue;
    const res = resolutionOf(s);
    const codec = upper(video(s)?.Codec);
    const lines = [
      s.Name,
      pictureLine(s),
      audioLine(s),
      [upper(s.Container), size(s.Size)].filter((p): p is string => !!p).join(" · ") || undefined,
    ].filter((l): l is string => !!l);
    const filename = s.Name ? (s.Container ? `${s.Name}.${s.Container}` : s.Name) : undefined;
    out.push({
      name: res ?? "Jellyfin",
      ...(lines.length > 0 ? { description: lines.join("\n") } : {}),
      url,
      behaviorHints: {
        bingeGroup: `jellyfin|${res ?? "unknown"}|${codec ?? "unknown"}`,
        ...(filename ? { filename } : {}),
        ...(typeof s.Size === "number" && Number.isFinite(s.Size) && s.Size > 0 ? { videoSize: s.Size } : {}),
      },
      streamData: { type: "jellyfin", service: { id: "jellyfin", cached: true } },
    });
  }
  return out;
}

/** An external subtitle file the player can be given. */
export interface ExternalSubtitle {
  index: number;
  url: string;
  language?: string;
  title: string;
  isDefault: boolean;
  isForced: boolean;
}

/**
 * The source's external text subtitles, each as a URL mpv can load
 * (`Subtitles/{index}/Stream.srt`, built here: the server's own `DeliveryUrl`
 * carries the session token, and `jf.rs` drops it). Embedded subtitles are not
 * listed: mpv reads those out of the file. An image subtitle (PGS, VobSub)
 * cannot be asked for as text and is left out.
 */
export function externalSubtitlesOf(base: string, itemId: string, source: JfSource): ExternalSubtitle[] {
  if (!HEX32.test(itemId) || !source.Id || !HEX32.test(source.Id)) return [];
  const root = base.replace(/\/+$/, "");
  return (source.MediaStreams ?? []).flatMap((x) => {
    if (x.Type !== "Subtitle" || x.IsExternal !== true || x.IsTextSubtitleStream !== true) return [];
    if (typeof x.Index !== "number" || !Number.isInteger(x.Index) || x.Index < 0) return [];
    return [
      {
        index: x.Index,
        url: `${root}/Videos/${itemId}/${source.Id}/Subtitles/${x.Index}/Stream.srt`,
        ...(x.Language ? { language: x.Language } : {}),
        title: x.DisplayTitle || x.Title || x.Language || "Subtitles",
        isDefault: x.IsDefault === true,
        isForced: x.IsForced === true,
      },
    ];
  });
}

/**
 * What native is told about each source's subtitles: its stream address and the
 * index and name of each external text subtitle, no address of their own (jf.rs
 * makes those from the stream). Every source with a stream is listed, one with
 * no subtitles too, so a list that no longer has any clears the last.
 */
export function subtitlesFor(
  base: string,
  itemId: string,
  sources: readonly JfSource[],
): { streamUrl: string; subtitles: { index: number; title: string; language?: string }[] }[] {
  const out: { streamUrl: string; subtitles: { index: number; title: string; language?: string }[] }[] = [];
  for (const s of sources) {
    const url = streamUrl(base, itemId, s);
    if (!url) continue;
    out.push({
      streamUrl: url,
      subtitles: externalSubtitlesOf(base, itemId, s).map((x) => ({
        index: x.index,
        title: x.title,
        ...(x.language ? { language: x.language } : {}),
      })),
    });
  }
  return out;
}

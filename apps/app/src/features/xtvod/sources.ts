/**
 * A provider's own files as the streams the Stream tab lists (plan 028). Where
 * AIOStreams searches for sources and a Jellyfin server answers with the item's
 * files, an Xtream panel plays a movie or an episode by an address built from
 * the account and the file's id, so nothing is asked for here: a copy of a title
 * is a source, and its address is built.
 *
 *   {server}/movie/{user}/{pass}/{stream_id}.{container_extension}
 *   {server}/series/{user}/{pass}/{episode id}.{container_extension}
 *
 * The same credentials-in-the-path shape Live's `/live/` addresses have
 * (live/stream.ts), trimmed and encoded the same way. These are the streams
 * `mapStreams` reads (stream/mapper.ts); one per copy, the best quality first,
 * which is the order auto-play takes.
 *
 * The quality a source shows is the one its name's tag said (names.ts): 4K as
 * 2160p, FHD as 1080p, HD, HDR and SD as they are. A name with no tag says
 * nothing, and is shown as HD: the mapper would show it as SD, which is a claim
 * about the file the name never made. Plan 028 calls the untagged copy of a
 * pair "the HD one" beside the 4K copy.
 *
 * Pure: no network, no storage.
 */

import type { StremioStream } from "../../data/stremio";
import type { XtreamPlaylist } from "../settings/playlists";
import type { XtQuality } from "./names";
import { orderCopies, type XtMovie } from "./read";
import { orderInfos, type XtSeriesInfo } from "./series";

/** What a file's address is built from: the account. */
export type XtCreds = Pick<XtreamPlaylist, "server" | "username" | "password">;

/** The address of a movie (`movie`) or an episode (`series`) file, or null when
 * the id or the extension is not one: both go into the address as they are. */
export function playUrl(c: XtCreds, kind: "movie" | "series", id: string, ext: string): string | null {
  if (!/^[1-9]\d*$/.test(id) || !/^[a-z0-9]{2,5}$/i.test(ext)) return null;
  const base = c.server.trim().replace(/\/+$/, "");
  return `${base}/${kind}/${encodeURIComponent(c.username)}/${encodeURIComponent(c.password)}/${id}.${ext}`;
}

/** What the source list shows for a copy's quality (see the header). */
export function qualityLabel(q: XtQuality | null): string {
  if (q === "4K") return "2160p";
  if (q === "FHD") return "1080p";
  return q ?? "HD";
}

function streamOf(url: string, q: XtQuality | null, lines: string[], filename: string): StremioStream {
  const label = qualityLabel(q);
  return {
    name: label,
    description: lines.join("\n"),
    url,
    // The group an episode roll prefers: the same kind of file as the last.
    behaviorHints: { bingeGroup: `xtream|${label}`, filename },
    // The provider's file is there to play, as the user's own Jellyfin file is:
    // what makes it the auto-play pick.
    streamData: { type: "xtream", service: { id: "xtream", cached: true } },
  };
}

/** A movie's sources, one per copy, best quality first. A copy whose address
 * cannot be built is left out. */
export function movieStreams(c: XtCreds, copies: readonly XtMovie[]): StremioStream[] {
  const out: StremioStream[] = [];
  for (const m of orderCopies(copies)) {
    const url = playUrl(c, "movie", m.id, m.ext);
    if (url) out.push(streamOf(url, m.quality, [m.name, m.ext.toUpperCase()], `${m.name}.${m.ext}`));
  }
  return out;
}

/** An episode's sources: one per copy of the show that holds that season and
 * number, best quality first. `infos` is one read per copy (series.ts). */
export function episodeStreams(
  c: XtCreds,
  infos: readonly XtSeriesInfo[],
  season: number,
  episode: number,
): StremioStream[] {
  const out: StremioStream[] = [];
  for (const i of orderInfos(infos)) {
    const e = i.episodes.find((x) => x.season === season && x.number === episode);
    const url = e && playUrl(c, "series", e.id, e.ext);
    if (e && url)
      out.push(
        streamOf(url, i.show.quality, [i.show.name, e.title, e.ext.toUpperCase()], `${i.show.name} - ${e.title}.${e.ext}`),
      );
  }
  return out;
}

/**
 * One show's `get_series_info`, read (plan 028). The answer is `{ info,
 * episodes }`, with the episodes keyed by season number as a string and each
 * episode's `id` a string, the id its file is asked for by.
 *
 * Two quirks of the panels this reads around. An empty `info` is `[]` and not
 * `{}` (PHP's empty array). And `episodes` is an object keyed "1", "2", ... but
 * a plain array when the seasons happen to be numbered from 0 with no gap, so
 * it is read by entries, which an array and an object both answer.
 *
 * Pure: no network, no storage.
 */

import { releaseOf } from "../stream/mapper";
import { compareCopies, extOf, idOf, natural, record, showFields, str, web, type XtShow, type XtShowFields } from "./read";

/** One episode of one copy of a show. */
export interface XtEpisode {
  /** The panel's episode id: what the file is asked for by. Digits. */
  id: string;
  season: number;
  number: number;
  title: string;
  ext: string;
  /** "Sep 7, 1984", from the episode's release date. */
  airDate?: string;
  still?: string;
}

/** What one copy's `get_series_info` said. */
export interface XtSeriesInfo {
  show: XtShow;
  /** What the show's `info` says about it, as the list does. */
  fields: XtShowFields;
  episodes: XtEpisode[];
}

// The show's name, then "S01E01", as panels title an episode they have no name
// for ("'Allo 'Allo! S01E01" on Adam's). Separators as escapes, as in names.ts.
const SEP = String.raw`[\s|:.\-\u2013\u2014]*`;
const MARK = String.raw`S\d{1,3}\s*E\d{1,4}\b`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * An episode's title without what the page already says: the show's name and
 * the season and number in front of it. "'Allo 'Allo! S01E01" is "Episode 1"
 * (the app's word for an episode with no name, stream/mapper.ts), and
 * "Breaking Bad S01E01 - Pilot" is "Pilot". The name comes off only when the
 * mark follows it, so "Lost in Space" under "Lost" keeps every word.
 */
export function episodeTitle(raw: string, show: Pick<XtShow, "name" | "title">, number: number): string {
  let t = raw.replace(/\s+/g, " ").trim();
  for (const name of [show.name, show.title].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const lead = new RegExp(`^${escape(name)}${SEP}(?=${MARK})`, "i").exec(t);
    if (lead) {
      t = t.slice(lead[0].length);
      break;
    }
  }
  t = t
    .replace(new RegExp(`^${MARK}${SEP}`, "i"), "")
    .replace(new RegExp(`${SEP}${MARK}$`, "i"), "")
    .trim();
  return t || `Episode ${number}`;
}

/** `raw` is the answer as fetched; anything else reads as a show with no
 * episodes. An episode with no usable id, number or file extension is left out
 * (there is nothing to ask for), and a season and number held twice keep the
 * first. A season is the key it is filed under, else the episode's own
 * `season`. */
export function readSeriesInfo(show: XtShow, raw: unknown): XtSeriesInfo {
  const o = record(raw);
  const fields = showFields(record(o?.info) ?? {});
  const episodes: XtEpisode[] = [];
  const seen = new Set<string>();
  const bySeason = o?.episodes;
  const seasons = bySeason !== null && typeof bySeason === "object" ? Object.entries(bySeason) : [];
  for (const [key, list] of seasons) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const e = record(item);
      if (!e) continue;
      const id = idOf(e.id);
      const number = natural(e.episode_num);
      const season = natural(key) ?? natural(e.season);
      const ext = extOf(e.container_extension);
      if (!id || number === undefined || season === undefined || !ext) continue;
      if (seen.has(`${season}:${number}`)) continue;
      seen.add(`${season}:${number}`);
      const info = record(e.info);
      const airDate = releaseOf(str(info?.releaseDate)).airDate;
      const still = web(info?.movie_image);
      episodes.push({
        id,
        season,
        number,
        title: episodeTitle(str(e.title), show, number),
        ext,
        ...(airDate ? { airDate } : {}),
        ...(still ? { still } : {}),
      });
    }
  }
  return { show, fields, episodes };
}

/** The infos in the order of their copies (read.ts `orderCopies`), so the
 * first is the one the card reads and its episodes lead the merged ones. */
export function orderInfos(infos: readonly XtSeriesInfo[]): XtSeriesInfo[] {
  return [...infos].sort((a, b) => compareCopies(a.show, b.show));
}

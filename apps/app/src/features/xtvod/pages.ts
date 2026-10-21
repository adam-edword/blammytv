/**
 * A title's page (plan 028): the card from the library filled with what the
 * panel says about it when the page opens. A movie's comes from its
 * `get_vod_info`; a show's from `get_series_info` of every copy of it, so a 4K
 * copy with one season and a plain one with two are one show with two seasons.
 *
 * Both start from the card the library built, so a field the panel does not
 * send on the page stays as the list had it.
 *
 * Pure: no network, no storage.
 */

import type { Episode, Season, VodItem } from "../stream/model";
import { episodeKey } from "./keys";
import { firstOf, firstWeb, posInt, rating10, record, splitList, str, web, yearOf } from "./read";
import { orderInfos, type XtEpisode, type XtSeriesInfo } from "./series";

/**
 * A movie's page. `raw` is `get_vod_info`'s answer: `{ info, movie_data }`.
 * What `info` says wins over the list's (the page is the panel's fuller
 * answer): the synopsis, the backdrop, the runtime from `duration_secs`, the
 * genres and cast, the year from `releasedate`, the rating. The title stays the
 * card's: `info.name` is the panel's name with its tag and year still in. An
 * answer with no `info` (an empty array for an id the panel does not have)
 * returns the card as it was.
 */
export function movieFromInfo(card: VodItem, raw: unknown): VodItem {
  const info = record(record(raw)?.info);
  if (!info) return card;
  const secs = posInt(info.duration_secs);
  const runtimeMin = secs !== undefined && secs >= 30 ? Math.round(secs / 60) : undefined;
  const genres = splitList(info.genre);
  const cast = splitList(info.cast);
  return {
    ...card,
    year: yearOf(info.releasedate) ?? card.year,
    poster: card.poster ?? web(info.movie_image),
    backdrop: web(info.backdrop) ?? firstWeb(info.backdrop_path) ?? card.backdrop,
    rating: rating10(info) ?? card.rating,
    runtimeMin: runtimeMin ?? card.runtimeMin,
    synopsis: str(info.plot) || card.synopsis,
    genres: genres.length > 0 ? genres : card.genres,
    cast: cast.length > 0 ? cast : card.cast,
  };
}

/**
 * A show's page: the card with its seasons. `infos` is one read per copy of the
 * show. Episodes are merged by season and number, so an episode both copies
 * hold is one tile (read from the better copy), and one only a copy holds is
 * there too. An episode's id is its key under the show's (`card.id`), which is
 * what Continue Watching and the watched marks keep; the panel's own episode id
 * stays in the info, for sources.ts. Specials (season 0) come first, as the
 * addon's do.
 *
 * What the card lacks the infos fill, best copy first; what the card has stays.
 */
export function showFromInfos(card: VodItem, infos: readonly XtSeriesInfo[]): VodItem {
  const ordered = orderInfos(infos);
  const merged = new Map<number, Map<number, XtEpisode>>();
  for (const i of ordered)
    for (const e of i.episodes) {
      const season = merged.get(e.season) ?? new Map<number, XtEpisode>();
      if (!season.has(e.number)) season.set(e.number, e);
      merged.set(e.season, season);
    }

  const seasons: Season[] = [...merged.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, eps]) => ({
      id: `s${number}`,
      number,
      name: number === 0 ? "Specials" : `Season ${number}`,
      episodes: [...eps.values()]
        .sort((a, b) => a.number - b.number)
        .map(
          (e): Episode => ({
            id: episodeKey(card.id, e.season, e.number),
            number: e.number,
            title: e.title,
            ...(e.airDate ? { airDate: e.airDate } : {}),
            ...(e.still ? { still: e.still } : {}),
          }),
        ),
    }));

  const pick = <T>(f: (i: XtSeriesInfo) => T | undefined) => firstOf(ordered, f);
  return {
    ...card,
    year: card.year ?? pick((i) => i.fields.year),
    poster: card.poster ?? pick((i) => i.fields.poster),
    backdrop: card.backdrop ?? pick((i) => i.fields.backdrop),
    rating: card.rating ?? pick((i) => i.fields.rating),
    runtimeMin: card.runtimeMin ?? pick((i) => i.fields.runtimeMin),
    synopsis: card.synopsis ?? pick((i) => i.fields.synopsis),
    genres: card.genres.length > 0 ? card.genres : (pick((i) => (i.fields.genres.length > 0 ? i.fields.genres : undefined)) ?? []),
    cast: card.cast.length > 0 ? card.cast : (pick((i) => (i.fields.cast.length > 0 ? i.fields.cast : undefined)) ?? []),
    seasons,
  };
}

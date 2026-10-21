/**
 * An Xtream provider's real answers, for this folder's tests (plan 028): the
 * field names, the types and the titles are the plan's "The data", taken from
 * Adam's panel on 2026-10-17 (numbers that arrive as numbers or strings here
 * arrive as they did there). The values the plan does not give (ids, poster
 * addresses, dates, the plot text) are stand-ins. The panel's own address is
 * in none of it and is not to be: `SERVER` is a reserved name.
 *
 * Test-only.
 */

import type { XtCreds } from "./sources";

export const SERVER = "http://panel.example.invalid:8080";
export const CREDS: XtCreds = { server: SERVER, username: "adam", password: "pw" };

const POSTER = "https://image.tmdb.org/t/p/w600_and_h900_bestv2/poster.jpg";
const BACKDROP = "https://image.tmdb.org/t/p/w1280/backdrop.jpg";

/** `get_vod_categories`, as `fetchVodCategories` returns them. */
export const MOVIE_FOLDERS = [
  { id: "11", name: "4K Movies", adult: false },
  { id: "12", name: "Action", adult: false },
  { id: "13", name: "Comedy", adult: false },
];

/** `get_series_categories`, as `fetchSeriesCategories` returns them. Two of its
 * ids are two of the movie folders': they are two lists. */
export const SHOW_FOLDERS = [
  { id: "12", name: "Drama", adult: false },
  { id: "13", name: "Sitcoms", adult: false },
];

/** `get_vod_streams`: the 4K copy of a film, with every field the plan lists. */
export const MOVIE_4K = {
  num: 1,
  name: "4K The Fantastic 4: First Steps (2025)",
  stream_type: "movie",
  stream_id: 52114,
  tmdb_id: 617126,
  stream_icon: POSTER,
  rating: "7.2",
  rating_5based: 3.6,
  added: "1753228800",
  is_adult: "0",
  category_id: "11",
  container_extension: "mkv",
  custom_sid: "",
  direct_source: "",
};

/** The same film's plain copy, in another folder: one TMDB id, another file. */
export const MOVIE_HD = {
  ...MOVIE_4K,
  num: 2,
  name: "The Fantastic 4: First Steps (2025)",
  stream_id: 52390,
  added: "1753833600",
  category_id: "12",
  container_extension: "mp4",
};

/** `get_series`: a show with every field the plan lists. */
export const SHOW = {
  num: 1,
  name: "'Allo 'Allo! (1984)",
  series_id: 3101,
  tmdb_id: 4521,
  cover: POSTER,
  plot: "René runs a cafe in occupied France.",
  cast: "Gorden Kaye, Carmen Silvera, Vicki Michelle",
  director: "",
  genre: "Comedy, War & Politics",
  releaseDate: "1984-09-07",
  last_modified: "1700000000",
  rating: "8.1",
  rating_5based: 4.05,
  backdrop_path: [BACKDROP],
  youtube_trailer: "",
  episode_run_time: "30",
  is_adult: "0",
  category_id: "13",
};

/** `get_vod_info&vod_id=52114`. */
export const VOD_INFO = {
  info: {
    movie_image: POSTER,
    name: "4K The Fantastic 4: First Steps (2025)",
    tmdb_id: 617126,
    backdrop: BACKDROP,
    backdrop_path: [],
    youtube_trailer: "",
    genre: "Science Fiction, Adventure",
    plot: "Four astronauts return to a changed Earth.",
    cast: "Pedro Pascal, Vanessa Kirby, Joseph Quinn, Ebon Moss-Bachrach",
    rating: "7.2",
    director: "Matt Shakman",
    releasedate: "2025-07-23",
    duration_secs: 6900,
    duration: "01:55:00",
  },
  movie_data: {
    stream_id: 52114,
    name: "4K The Fantastic 4: First Steps (2025)",
    added: "1753228800",
    category_id: "11",
    container_extension: "mkv",
    custom_sid: "",
    direct_source: "",
  },
};

const episode = (id: string, season: number, num: number, extra: Record<string, unknown> = {}) => ({
  id,
  episode_num: num,
  title: `'Allo 'Allo! S0${season}E0${num}`,
  container_extension: "mkv",
  added: "1700000000",
  season,
  custom_sid: "",
  direct_source: "",
  info: {
    movie_image: POSTER,
    releaseDate: `1984-09-0${num}`,
    plot: `Season ${season}, episode ${num}.`,
    rating: "7.9",
    duration_secs: 1800,
    duration: "00:30:00",
  },
  ...extra,
});

/** `get_series_info&series_id=3101`: two seasons, episode ids as strings, the
 * seasons keyed as strings, and the list's fields again with no `tmdb_id`. */
export const SERIES_INFO = {
  info: (({ tmdb_id: _tmdb, ...rest }) => rest)(SHOW),
  episodes: {
    "1": [episode("186", 1, 1), episode("187", 1, 2), episode("188", 1, 3)],
    "2": [episode("201", 2, 1), episode("202", 2, 2)],
  },
};

/** A 4K copy of the same show with the first season only, its own episode ids. */
export const SHOW_4K = {
  ...SHOW,
  num: 2,
  name: "4K 'Allo 'Allo! (1984)",
  series_id: 3102,
  category_id: "12",
  backdrop_path: [],
};

export const SERIES_INFO_4K = {
  info: (({ tmdb_id: _tmdb, ...rest }) => rest)(SHOW_4K),
  episodes: {
    "1": [episode("9001", 1, 1), episode("9002", 1, 2), episode("9003", 1, 3)],
  },
};

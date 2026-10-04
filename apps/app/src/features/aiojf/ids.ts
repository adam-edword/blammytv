/**
 * AIOStreams' packed Jellyfin item ids (plan 023, B2; every id type it packs
 * and `jellyfinIdOf`, plan 024, B2).
 *
 * AIOStreams answers as a Jellyfin server, and names every film, show and
 * episode by a 16-byte id shown as 32 lowercase hex. For an id it can rebuild
 * from the title's own id, the bytes are the id itself, so no lookup is
 * needed: this file computes them from the ids BlammyTV already holds, and
 * reads them back. Ported from AIOStreams v2.35.9, `core/src/jellyfin/ids.ts`
 * (`tryPack`, `unpack`, `rebuildBaseId`, `isRebuildableVideoId`, the code
 * tables) and the id rows of `core/src/utils/id-parser.ts`:
 *
 *   byte 0       0xa1, "packed content"
 *   byte 1       (kind << 4) | id type
 *   byte 2       the Stremio media type
 *   bytes 3-8    the numeric id, uint48 big-endian
 *   bytes 9-10   season, uint16 BE (0xffff for none)
 *   bytes 11-12  episode, uint16 BE (0xffff for none)
 *   bytes 13-15  zero
 *
 * All eight id types AIOStreams packs (`ID_TYPE_CODES`) are handled, written
 * as an addon writes them: IMDb `tt0111161`, TMDB `tmdb:603`, TVDB
 * `tvdb:81189`, Kitsu `kitsu:7442`, MAL `mal:16498`, AniList `anilist:16498`,
 * AniDB `anidb:9541`, Simkl `simkl:12345`. An episode id is the parser's
 * `generator` row: `<base>:S:E` for IMDb, TMDB and TVDB, `<base>:E` (no
 * season) for the other five. Every id type AIOStreams does not pack, and
 * every id it would hash instead of pack, comes back null. No Buffer: this
 * runs in the webview.
 */

export type MediaType = "movie" | "series" | "anime" | "tv" | "other" | "channel";

export interface Packed {
  kind: "movie" | "series" | "season" | "episode" | "boxset";
  type: MediaType;
  /** The base id: `tt…`, `kitsu:N`, `tmdb:N` and the other five kinds. */
  id: string;
  season?: number;
  episode?: number;
}

const MARK_PACKED = 0xa1;

const KIND_CODES = { movie: 1, series: 2, season: 3, episode: 4, boxset: 5 } as const;
const KIND_BY_CODE: Record<number, Packed["kind"]> = {
  1: "movie",
  2: "series",
  3: "season",
  4: "episode",
  5: "boxset",
};

/**
 * One of the eight id types AIOStreams packs (`ID_TYPE_CODES`).
 *
 * `season` is how its parser writes an episode (`generator`): with a season
 * (`tt…:S:E`, `tmdb:N:S:E`, `tvdb:N:S:E`) or without (`kitsu:N:E`, and the
 * same for MAL, AniList, AniDB, Simkl). `anime` marks the id databases that
 * only hold anime: a show under one is typed `anime`, not `series`.
 */
interface IdKind {
  code: number;
  season: boolean;
  anime: boolean;
  /** A base id, capturing its number. */
  base: RegExp;
  /** An episode id, capturing its base id, then its season (when it has one)
   * and its number. */
  episode: RegExp;
  /** AIOStreams' `rebuildBaseId`: the one string it writes for a number. */
  rebuild: (n: number) => string;
}

function idKind(code: number, name: string, season: boolean, anime: boolean): IdKind {
  return {
    code,
    season,
    anime,
    base: new RegExp(`^${name}(\\d+)$`),
    episode: new RegExp(`^(${name}\\d+):(\\d+)${season ? ":(\\d+)" : ""}$`),
    // IMDb pads to seven digits; the rest write the number as it is.
    rebuild: name === "tt" ? (n) => `tt${String(n).padStart(7, "0")}` : (n) => `${name}${n}`,
  };
}

const KINDS: readonly IdKind[] = [
  idKind(1, "tt", true, false),
  idKind(2, "tmdb:", true, false),
  idKind(3, "tvdb:", true, false),
  idKind(4, "kitsu:", false, true),
  idKind(5, "mal:", false, true),
  idKind(6, "anilist:", false, true),
  idKind(7, "anidb:", false, true),
  idKind(8, "simkl:", false, false),
];

const MEDIA_CODES: Record<MediaType, number> = { movie: 1, series: 2, anime: 3, tv: 4, other: 5, channel: 6 };
const MEDIA_BY_CODE: Record<number, MediaType> = {
  1: "movie",
  2: "series",
  3: "anime",
  4: "tv",
  5: "other",
  6: "channel",
};

const NONE16 = 0xffff;
const MAX48 = 2 ** 48 - 1;

/** The id type and the number, only when AIOStreams would rebuild this exact
 * string from them (`tt123` does not: it rebuilds as `tt0000123`; neither does
 * `tmdb:0603`, nor `tmdb-603`). */
function parseBase(id: string): { kind: IdKind; n: number } | null {
  for (const kind of KINDS) {
    const m = kind.base.exec(id);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n > MAX48) return null;
    return kind.rebuild(n) === id ? { kind, n } : null;
  }
  return null;
}

/** AIOStreams' `rebuildBaseId`. Null for a code it has no id type for. */
function rebuildBase(code: number, n: number): string | null {
  return KINDS.find((k) => k.code === code)?.rebuild(n) ?? null;
}

/** The id type of a base id or an episode id, whether or not it would pack. */
function kindOf(id: string): IdKind | undefined {
  return KINDS.find((k) => k.base.test(id) || k.episode.test(id));
}

function validSlot(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < NONE16;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function build(kind: Packed["kind"], idType: IdKind, type: MediaType, n: number, season: number, episode: number): string | null {
  const media = MEDIA_CODES[type];
  if (!media) return null;
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  bytes[0] = MARK_PACKED;
  bytes[1] = (KIND_CODES[kind] << 4) | idType.code;
  bytes[2] = media;
  // The 48 bits as a high uint16 and a low uint32: n is below 2^48, so both
  // halves are exact.
  view.setUint16(3, Math.floor(n / 2 ** 32));
  view.setUint32(5, n % 2 ** 32);
  view.setUint16(9, season);
  view.setUint16(11, episode);
  return toHex(bytes);
}

/** A film's packed id from its BlammyTV id (`tt0111161`, `tmdb:603`, `kitsu:1555`). */
export function packMovie(id: string, type: MediaType = "movie"): string | null {
  const base = parseBase(id);
  return base ? build("movie", base.kind, type, base.n, NONE16, NONE16) : null;
}

/** A show's packed id from its BlammyTV id. */
export function packSeries(id: string, type: MediaType = "series"): string | null {
  const base = parseBase(id);
  return base ? build("series", base.kind, type, base.n, NONE16, NONE16) : null;
}

/**
 * An episode's packed id from its BlammyTV episode id: `tt…:S:E`,
 * `tmdb:N:S:E` or `tvdb:N:S:E` (the id carries its season, and `opts.season`
 * is ignored), or `kitsu:N:E`, `mal:N:E`, `anilist:N:E`, `anidb:N:E` or
 * `simkl:N:E` (no season in the id, so it takes `opts.season`, default 1).
 * `type` is the Stremio type the meta was fetched under: `series` by default,
 * and a caller with an anime title passes `anime`, because the type is part
 * of the id. Null for any form AIOStreams would not pack (a zero-padded
 * number, a season or episode of 65535 or more, an id with the wrong number
 * of parts for its kind: `tmdb:603:7`, `mal:16498:1:4`).
 */
export function packEpisode(episodeId: string, opts: { type?: MediaType; season?: number } = {}): string | null {
  const type = opts.type ?? "series";
  for (const kind of KINDS) {
    const m = kind.episode.exec(episodeId);
    if (!m) continue;
    const base = parseBase(m[1]);
    const season = kind.season ? Number(m[2]) : (opts.season ?? 1);
    const episode = Number(kind.season ? m[3] : m[2]);
    if (!base || !validSlot(season) || !validSlot(episode)) return null;
    // AIOStreams' isRebuildableVideoId: the id must be exactly what it would
    // generate from the numbers.
    const generated = kind.season ? `${m[1]}:${season}:${episode}` : `${m[1]}:${episode}`;
    if (generated !== episodeId) return null;
    return build("episode", base.kind, type, base.n, season, episode);
  }
  return null;
}

/**
 * A packed id read back. Uppercase and hyphenated GUID form are normalised
 * first, as AIOStreams does (playstate.ts, `idFrom`). Null for anything that
 * is not a packed id of one of the eight id types: wrong length, not hex,
 * another mark (views, genres, hashed ids), an id type code it has no row for.
 */
export function unpack(hex: string | null | undefined): Packed | null {
  if (typeof hex !== "string") return null;
  const flat = hex.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(flat)) return null;
  const bytes = Uint8Array.from(flat.match(/../g) ?? [], (h) => parseInt(h, 16));
  if (bytes[0] !== MARK_PACKED) return null;
  const kind = KIND_BY_CODE[bytes[1] >> 4];
  const code = bytes[1] & 0x0f;
  const type = MEDIA_BY_CODE[bytes[2]];
  if (!kind || !type) return null;
  const view = new DataView(bytes.buffer);
  const n = view.getUint16(3) * 2 ** 32 + view.getUint32(5);
  const id = rebuildBase(code, n);
  if (!id) return null;
  const season = view.getUint16(9);
  const episode = view.getUint16(11);
  const out: Packed = { kind, type, id };
  if (kind === "season" || kind === "episode") {
    if (season !== NONE16) out.season = season;
  }
  if (kind === "episode" && episode !== NONE16) out.episode = episode;
  return out;
}

/**
 * BlammyTV's id for what was unpacked: the base id for a film or a show, and
 * for an episode the form its id type is written in: `tt…:S:E` (IMDb, TMDB and
 * TVDB), or `kitsu:N:E` (Kitsu, MAL, AniList, AniDB and Simkl drop the
 * season, as their ids do). Null for a season, a collection, an episode with
 * no number, or one of a season-carrying type with no season.
 */
export function blammyId(p: Packed): string | null {
  if (p.kind === "movie" || p.kind === "series") return p.id;
  if (p.kind !== "episode" || p.episode === undefined) return null;
  const kind = kindOf(p.id);
  if (!kind) return null;
  if (!kind.season) return `${p.id}:${p.episode}`;
  return p.season === undefined ? null : `${p.id}:${p.season}:${p.episode}`;
}

/** The Stremio type a show or an episode packs under. `series` is the app's
 * word for a show, but an anime-only id (Kitsu, MAL, AniList, AniDB) is served
 * under `anime`, and the type is part of the packed id: report.ts `packedFor`
 * decides the same for a Kitsu episode. */
function showType(id: string, type: string): MediaType | null {
  if (type === "anime") return "anime";
  if (type !== "series") return null;
  return kindOf(id)?.anime ? "anime" : "series";
}

/**
 * The packed Jellyfin id for a Stremio id, computed with no lookup. `type` is
 * the Stremio type the title is held under: `movie` for a film, `series` for
 * a show, `anime` when it is known to be one. An episode id (any of the forms
 * `packEpisode` takes) packs as an episode of its show, and a Kitsu-style one
 * takes `opts.season`, default 1. Null for what AIOStreams would not pack
 * (the caller then falls back to the ids it was handed in a list), and for a
 * type that cannot be told apart: `tv`, `channel`, `other`, `anime.series`.
 */
export function jellyfinIdOf(stremioId: string, type: string, opts: { season?: number } = {}): string | null {
  if (KINDS.some((k) => k.episode.test(stremioId))) {
    const media = showType(stremioId, type);
    return media && packEpisode(stremioId, { type: media, ...(opts.season != null ? { season: opts.season } : {}) });
  }
  if (type === "movie") return packMovie(stremioId);
  const media = showType(stremioId, type);
  return media && packSeries(stremioId, media);
}

/**
 * AIOStreams' packed Jellyfin item ids (plan 023, B2).
 *
 * AIOStreams answers as a Jellyfin server, and names every film, show and
 * episode by a 16-byte id shown as 32 lowercase hex. For an id it can rebuild
 * from the title's own id, the bytes are the id itself, so no lookup is
 * needed: this file computes them from the ids BlammyTV already holds, and
 * reads them back. Ported from AIOStreams v2.35.9, `core/src/jellyfin/ids.ts`
 * (`tryPack`, `unpack`, the code tables) and the IMDb and Kitsu rows of
 * `core/src/utils/id-parser.ts`:
 *
 *   byte 0       0xa1, "packed content"
 *   byte 1       (kind << 4) | id type
 *   byte 2       the Stremio media type
 *   bytes 3-8    the numeric id, uint48 big-endian
 *   bytes 9-10   season, uint16 BE (0xffff for none)
 *   bytes 11-12  episode, uint16 BE (0xffff for none)
 *   bytes 13-15  zero
 *
 * Only the two id types BlammyTV has are handled: IMDb (`tt1234567`) and
 * Kitsu (`kitsu:1234`). Every other id type, and every id AIOStreams would
 * hash instead of pack, comes back null. No Buffer: this runs in the webview.
 */

export type MediaType = "movie" | "series" | "anime" | "tv" | "other" | "channel";

export interface Packed {
  kind: "movie" | "series" | "season" | "episode" | "boxset";
  type: MediaType;
  /** The base id: `tt…` or `kitsu:N`. */
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

/** AIOStreams' id type codes (`ID_TYPE_CODES`), the two BlammyTV has. */
const ID_IMDB = 1;
const ID_KITSU = 4;

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

/** The numeric id and its type code, only when AIOStreams would rebuild this
 * exact string from them (`tt123` does not: it rebuilds as `tt0000123`). */
function parseBase(id: string): { code: number; n: number } | null {
  const imdb = /^tt(\d+)$/.exec(id);
  if (imdb) {
    const n = Number(imdb[1]);
    if (!Number.isInteger(n) || n > MAX48) return null;
    return rebuildBase(ID_IMDB, n) === id ? { code: ID_IMDB, n } : null;
  }
  const kitsu = /^kitsu:(\d+)$/.exec(id);
  if (kitsu) {
    const n = Number(kitsu[1]);
    if (!Number.isInteger(n) || n > MAX48) return null;
    return rebuildBase(ID_KITSU, n) === id ? { code: ID_KITSU, n } : null;
  }
  return null;
}

/** AIOStreams' `rebuildBaseId`, for the two id types we read. */
function rebuildBase(code: number, n: number): string | null {
  if (code === ID_IMDB) return `tt${String(n).padStart(7, "0")}`;
  if (code === ID_KITSU) return `kitsu:${n}`;
  return null;
}

function validSlot(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < NONE16;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function build(kind: Packed["kind"], code: number, type: MediaType, n: number, season: number, episode: number): string | null {
  const media = MEDIA_CODES[type];
  if (!media) return null;
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  bytes[0] = MARK_PACKED;
  bytes[1] = (KIND_CODES[kind] << 4) | code;
  bytes[2] = media;
  // The 48 bits as a high uint16 and a low uint32: n is below 2^48, so both
  // halves are exact.
  view.setUint16(3, Math.floor(n / 2 ** 32));
  view.setUint32(5, n % 2 ** 32);
  view.setUint16(9, season);
  view.setUint16(11, episode);
  return toHex(bytes);
}

/** A film's packed id from its BlammyTV id (`tt0111161`, `kitsu:1555`). */
export function packMovie(id: string, type: MediaType = "movie"): string | null {
  const base = parseBase(id);
  return base ? build("movie", base.code, type, base.n, NONE16, NONE16) : null;
}

/** A show's packed id from its BlammyTV id. */
export function packSeries(id: string, type: MediaType = "series"): string | null {
  const base = parseBase(id);
  return base ? build("series", base.code, type, base.n, NONE16, NONE16) : null;
}

/**
 * An episode's packed id from its BlammyTV episode id: `tt…:S:E`, or
 * `kitsu:N:E`. A Kitsu id carries no season, so it takes `opts.season`
 * (default 1); an IMDb one carries its own and `opts.season` is ignored.
 * `type` is the Stremio type the meta was fetched under: `series` by default,
 * and a caller with an anime title passes `anime`, because the type is part
 * of the id. Null for any form AIOStreams would not pack (a zero-padded
 * number, a season or episode of 65535 or more).
 */
export function packEpisode(episodeId: string, opts: { type?: MediaType; season?: number } = {}): string | null {
  const type = opts.type ?? "series";
  const imdb = /^(tt\d+):(\d+):(\d+)$/.exec(episodeId);
  if (imdb) {
    const base = parseBase(imdb[1]);
    const season = Number(imdb[2]);
    const episode = Number(imdb[3]);
    if (!base || !validSlot(season) || !validSlot(episode)) return null;
    // AIOStreams' isRebuildableVideoId: the id must be exactly what it would
    // generate from the numbers.
    if (`${imdb[1]}:${season}:${episode}` !== episodeId) return null;
    return build("episode", base.code, type, base.n, season, episode);
  }
  const kitsu = /^(kitsu:\d+):(\d+)$/.exec(episodeId);
  if (kitsu) {
    const base = parseBase(kitsu[1]);
    const episode = Number(kitsu[2]);
    const season = opts.season ?? 1;
    if (!base || !validSlot(season) || !validSlot(episode)) return null;
    if (`${kitsu[1]}:${episode}` !== episodeId) return null;
    return build("episode", base.code, type, base.n, season, episode);
  }
  return null;
}

/**
 * A packed id read back. Uppercase and hyphenated GUID form are normalised
 * first, as AIOStreams does (playstate.ts, `idFrom`). Null for anything that
 * is not a packed IMDb or Kitsu id: wrong length, not hex, another mark
 * (views, genres, hashed ids), another id type.
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
 * for an episode `tt…:S:E` (IMDb) or `kitsu:N:E` (Kitsu, which drops the
 * season, as BlammyTV's ids do). Null for a season, a collection, or an
 * episode with no season or number.
 */
export function blammyId(p: Packed): string | null {
  if (p.kind === "movie" || p.kind === "series") return p.id;
  if (p.kind !== "episode" || p.episode === undefined) return null;
  if (p.id.startsWith("kitsu:")) return `${p.id}:${p.episode}`;
  return p.season === undefined ? null : `${p.id}:${p.season}:${p.episode}`;
}

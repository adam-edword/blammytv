/**
 * AIOStreams' Jellyfin answers in the Stremio shapes Stream already reads
 * (plan 024, B2).
 *
 * Signed in, the Stream tab asks AIOStreams' Jellyfin side where it used to
 * ask the manifest: views for catalogs, items for metas, episodes for videos,
 * media sources for streams. Everything downstream (mapper.ts, the screens,
 * Continue Watching, the ledgers, Trakt, MAL) keys a title by its Stremio id
 * and reads the shapes declared at the top of data/stremio.ts, so this file
 * hands those back and nothing else moves. Pure: no network, no storage, no
 * token. The shapes are from AIOStreams v2.35.9, `core/src/jellyfin/dto.ts`,
 * `media.ts` and `types.ts`; the line numbers below are that checkout's.
 *
 * Anything that does not decode comes back null or is left out, never
 * guessed. The ids stay Stremio ids: a title's comes from its `Path`
 * (`dto.ts:555`), an episode's from the id packed in its own (ids.ts), and an
 * episode whose id was hashed gets an opaque `aiojf:<Id>` the wiring routes by.
 */

import type {
  CatalogDef,
  MetaDetail,
  MetaPreview,
  StremioStream,
  StremioVideo,
} from "../../data/stremio";
import { blammyId, unpack } from "./ids";
import { splitPath, stremioIdOf, ticksToSec, type BaseItem } from "./rules";

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

/**
 * One `/UserViews` item as a manifest catalog (`buildView`, dto.ts:335-357).
 * Its `Path` is `/aiostreams/<type>/<catalogId>` (dto.ts:352), so `type` and
 * `id` are the catalog's own; `Name` is its name. Null for a view whose
 * `Path` does not parse.
 *
 * The extras are what the Jellyfin side can do with any catalog, not what the
 * addon declared: `skip` always (every catalog pages with `StartIndex`), and
 * `genre` on every movie and series view, the two types Discover browses.
 * `genres` is the catalog's own options (`/Genres?ParentId=`), listed when
 * there are any; a genre extra with none is how Discover reads "serves any
 * genre" (discover/data.ts `servesGenre`). Leaving it off instead benches the
 * catalog from every genre page, and AIOStreams answers an empty page, not an
 * error, for a genre a catalog cannot serve (library.ts `getCatalogPage`). The
 * other types claim one only with options or when
 * `aiostreams.genreRequired` (dto.ts:354) makes it required, which keeps the
 * catalog off the browse rows as it does in the manifest. No `search` extra on
 * a view: search is `SEARCH_CATALOGS`.
 */
export function catalogOf(view: BaseItem, genres?: readonly string[]): CatalogDef | null {
  const p = splitPath(view.Path);
  if (!p || !p.rest) return null;
  const required = view.aiostreams?.genreRequired === true;
  const options = (genres ?? []).filter((g): g is string => typeof g === "string" && g.length > 0);
  const extra: NonNullable<CatalogDef["extra"]> = [];
  if (options.length > 0 || required || p.type === "movie" || p.type === "series") {
    extra.push({
      name: "genre",
      ...(required ? { isRequired: true } : {}),
      ...(options.length > 0 ? { options } : {}),
    });
  }
  extra.push({ name: "skip" });
  return { type: p.type, id: p.rest, name: view.Name || p.rest, extra };
}

/**
 * The catalogs search is asked of, one per type Discover searches. Each has a
 * required `search` extra and nothing else, so both halves hold in the code
 * that reads a manifest: `pickSearchCatalogs` (discover/data.ts) takes every
 * movie or series catalog with a `search` extra, and `pickCatalogs` there, the
 * Stream tab's rows and the hero's `catalogsFromManifest` all leave out a
 * catalog with a required extra, so none ever shows as a row. The ids start
 * `aiojf.` so they cannot clash with a catalog from a config.
 */
export const SEARCH_CATALOGS: CatalogDef[] = [
  { type: "movie", id: "aiojf.search.movie", name: "Search movies", extra: [{ name: "search", isRequired: true }] },
  { type: "series", id: "aiojf.search.series", name: "Search series", extra: [{ name: "search", isRequired: true }] },
];

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

/** `${base}/Items/<id>/Images/<kind>?tag=<tag>`. Images need no token (server
 * images.ts:234-264); the tag carries the image's address. Undefined when the
 * item has no such image. `base` is the Jellyfin mount (`aiojf_status`). */
function imageUrl(base: string, itemId: string | undefined, kind: string, tag: string | undefined): string | undefined {
  if (!itemId || !tag) return undefined;
  return `${base.replace(/\/+$/, "")}/Items/${encodeURIComponent(itemId)}/Images/${kind}?tag=${encodeURIComponent(tag)}`;
}

/** "129 min", the form mapper's `parseRuntime` reads. Undefined under a minute
 * or when there is no runtime. */
function runtimeOf(ticks: number | undefined): string | undefined {
  const minutes = Math.round(ticksToSec(ticks ?? 0) / 60);
  return minutes > 0 ? `${minutes} min` : undefined;
}

/**
 * A film or show as a catalog entry. `poster`, `background` and `logo` are the
 * item's images by tag (`imageTagsFor`, images.ts:86-97); `imdbRating` is
 * `CommunityRating` (dto.ts:519), `releaseInfo` the year (dto.ts:516),
 * `runtime` the ticks as minutes (dto.ts:523), and `description` and `genres`
 * the synopsis and genre names (dto.ts:514, :524). A field the item lacks is
 * left out. Null when the item is not a title that reads (`stremioIdOf`) or
 * has no name.
 */
export function metaPreviewOf(item: BaseItem, base: string): MetaPreview | null {
  const ref = stremioIdOf(item);
  if (!ref || !item.Name) return null;
  const poster = imageUrl(base, item.Id, "Primary", item.ImageTags?.Primary);
  const background = imageUrl(base, item.Id, "Backdrop/0", item.BackdropImageTags?.[0]);
  const logo = imageUrl(base, item.Id, "Logo", item.ImageTags?.Logo);
  const rating = item.CommunityRating;
  const year = item.ProductionYear;
  const runtime = runtimeOf(item.RunTimeTicks);
  const genres = (item.Genres ?? []).filter((g): g is string => typeof g === "string" && g.length > 0);
  return {
    id: ref.id,
    type: ref.type,
    name: item.Name,
    ...(poster ? { poster } : {}),
    ...(background ? { background } : {}),
    ...(logo ? { logo } : {}),
    // IMDb's lowest rating is 1.0: a zero is a missing one.
    ...(typeof rating === "number" && Number.isFinite(rating) && rating > 0 ? { imdbRating: rating } : {}),
    ...(typeof year === "number" && Number.isFinite(year) ? { releaseInfo: String(year) } : {}),
    ...(runtime ? { runtime } : {}),
    ...(item.Overview ? { description: item.Overview } : {}),
    ...(genres.length > 0 ? { genres } : {}),
  };
}

/**
 * A title's full detail: `metaPreviewOf`, plus `cast` as the names of the
 * `People` who act (`Type: "Actor"`, dto.ts:274-292; mapper takes the first
 * 20), and for a show `videos` from its `/Shows/{id}/Episodes` items. Null
 * when the item does not read as a title.
 */
export function metaDetailOf(item: BaseItem, episodes: readonly BaseItem[], base: string): MetaDetail | null {
  const preview = metaPreviewOf(item, base);
  if (!preview) return null;
  const cast = (item.People ?? [])
    .filter((p) => p.Type === "Actor" && typeof p.Name === "string" && p.Name.length > 0)
    .map((p) => p.Name as string);
  const detail: MetaDetail = { ...preview, ...(cast.length > 0 ? { cast } : {}) };
  if (item.Type === "Series") {
    detail.videos = episodes.flatMap((ep) => {
      const v = videoOf(ep, base);
      return v ? [v] : [];
    });
  }
  return detail;
}

/**
 * One `/Shows/{id}/Episodes` item (`buildEpisode`, dto.ts:714-) as a video.
 *
 * `id` is the Stremio episode id when the item's own id is packed
 * (`blammyId(unpack(Id))`: `tt…:S:E`, `kitsu:N:E` and the rest), else
 * `aiojf:<Id>`, which only the wiring can route. `season` and `episode` are
 * `ParentIndexNumber` and `IndexNumber` (dto.ts:750-751), or the packed id's
 * when the server sent none; an episode with neither is left out.
 *
 * `available` stays unset, an unaired episode (`LocationType: "Virtual"`,
 * dto.ts:748) included. mapper.ts `mapSeasons` drops a video only on an
 * explicit `available: false`, and AIOStreams' Stremio side sends whatever
 * `available` the addon had and adds none (`Virtual` is something it only
 * says to Jellyfin clients). Setting it here would hide episodes the manifest
 * path shows, with their air date.
 */
function videoOf(ep: BaseItem, base: string): StremioVideo | null {
  if (ep.Type !== "Episode" || !ep.Id) return null;
  const packed = unpack(ep.Id);
  const id = (packed ? blammyId(packed) : null) ?? `aiojf:${ep.Id}`;
  const season = typeof ep.ParentIndexNumber === "number" ? ep.ParentIndexNumber : packed?.season;
  const episode = typeof ep.IndexNumber === "number" ? ep.IndexNumber : packed?.episode;
  if (season === undefined || episode === undefined) return null;
  const thumbnail = imageUrl(base, ep.Id, "Primary", ep.ImageTags?.Primary);
  return {
    id,
    season,
    episode,
    ...(ep.Name ? { title: ep.Name } : {}),
    ...(ep.PremiereDate ? { released: ep.PremiereDate } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    ...(ep.Overview ? { overview: ep.Overview } : {}),
  };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** AIOStreams' extension on a media source (`AiostreamsSourceExtension`,
 * types.ts, built by `extensionFor`, media.ts:133-163): the fields read. */
interface SourceExtension {
  /** The formatter's name part, as the Stremio side's `name`. */
  name?: string;
  /** The formatter's description part, as its `description`. */
  description?: string;
  service?: string;
  cached?: boolean;
  /** `debrid`, `http`, `usenet`, `live` and so on: the stream's type. */
  type?: string;
  bingeGroup?: string;
  filename?: string;
}

/** One entry of what `aiojf_sources` returns, a Jellyfin `MediaSourceInfo`
 * (`buildMediaSource`, media.ts:576-615) with AIOStreams' extension on it. */
export interface SourceItem {
  Id?: string;
  /** The stream's own URL (media.ts:597). */
  Path?: string;
  /** The formatter's name and description joined (label.ts:45-56). */
  Name?: string;
  /** `Default` for a source (media.ts:598), `Placeholder` for a notice, an
   * error or a statistic (media.ts:580-587). */
  Type?: string;
  Size?: number;
  Container?: string;
  RunTimeTicks?: number;
  IsInfiniteStream?: boolean;
  aiostreams?: SourceExtension;
}

/** The test mapper.ts `mapStreams` applies to a stream's URL. */
function isHttp(s: unknown): s is string {
  if (typeof s !== "string") return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * `aiojf_sources` into the streams `mapStreams` reads, in the server's order
 * (it ranks them and this app never re-sorts). Only `Type: "Default"` sources
 * with an http(s) `Path` are kept: placeholders carry notices, and the rest
 * are not playable by mpv.
 *
 * Each stream is what the Stremio side's `/stream` hands over: `url` is the
 * `Path`, `name` and `description` are the formatter's two parts from the
 * extension (the joined `Name` is only a fallback for a source without one),
 * `behaviorHints` carries `bingeGroup` and `filename` and `videoSize` (the
 * source's `Size`), and `streamData` the stream's type and its service with
 * `cached`, which mapper.ts trusts over the text. Both sides make `bingeGroup`
 * with the same `generateBingeGroup` (core transformers/stremio.ts:65-67, server
 * resolve.ts:315), so the quality badge reads it as it does today.
 */
export function streamsOf(sources: readonly SourceItem[]): StremioStream[] {
  const out: StremioStream[] = [];
  for (const s of sources) {
    if (s.Type !== "Default" || !isHttp(s.Path)) continue;
    const a = s.aiostreams;
    const hasName = typeof a?.name === "string";
    const name = hasName ? a?.name : s.Name;
    const description = typeof a?.description === "string" ? a.description : undefined;
    const bingeGroup = typeof a?.bingeGroup === "string" && a.bingeGroup ? a.bingeGroup : undefined;
    const filename = typeof a?.filename === "string" && a.filename ? a.filename : undefined;
    const serviceId = typeof a?.service === "string" && a.service ? a.service : undefined;
    const cached = typeof a?.cached === "boolean" ? a.cached : undefined;
    const type = typeof a?.type === "string" && a.type ? a.type : undefined;
    const service = serviceId !== undefined || cached !== undefined
      ? { ...(serviceId !== undefined ? { id: serviceId } : {}), ...(cached !== undefined ? { cached } : {}) }
      : undefined;
    out.push({
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      url: s.Path,
      behaviorHints: {
        ...(bingeGroup ? { bingeGroup } : {}),
        ...(filename ? { filename } : {}),
        ...(typeof s.Size === "number" && Number.isFinite(s.Size) ? { videoSize: s.Size } : {}),
      },
      ...(type !== undefined || service ? { streamData: { ...(type !== undefined ? { type } : {}), ...(service ? { service } : {}) } } : {}),
    });
  }
  return out;
}

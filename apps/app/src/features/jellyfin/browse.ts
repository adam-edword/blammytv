/**
 * A Jellyfin server's libraries and titles in the Stremio shapes Stream
 * already reads (plan 027, batch 2): a view is a catalog, a film or show a
 * meta, an episode a video. Everything downstream keys a title by its
 * Stremio id (ids.ts), so mapper.ts, the screens, Continue Watching, the
 * ledgers, Trakt and MAL do not move.
 *
 * `…Query` builders are the `jf_request` queries for each read, with the
 * names the server's own OpenAPI spells (`/Items`: `parentId`, `fields`,
 * `includeItemTypes`, `startIndex`, ...; the server binds them without regard
 * to case). Every `/Items` call passes `IncludeItemTypes`: without it
 * `Recursive` returns the library's folders, seasons and episodes too (259
 * `Folder` items in each of Adam's libraries, plans/027-api-facts.md #4).
 * `userId` is the session's own, read from `jf_status`.
 */

import type { CatalogDef, MetaDetail, MetaPreview, StremioVideo } from "../../data/stremio";
import { ticksToSec } from "../aiojf/rules";
import { imageUrl, type JfItem } from "./items";
import { episodeKey, titleKey } from "./ids";

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

/** The Stremio type a library's `CollectionType` is, or null for one Stream
 * does not show: music, books, boxsets, home videos, live TV, and a mixed
 * library (which has no `CollectionType`, and holds items of any kind). */
export function catalogType(view: JfItem): "movie" | "series" | null {
  if (view.CollectionType === "movies") return "movie";
  if (view.CollectionType === "tvshows") return "series";
  return null;
}

/**
 * One `/UserViews` item as a catalog: its own id, its name, its type. Every
 * catalog pages (`skip`) and claims a `genre` extra with no options, which is
 * how Discover reads "serves any genre" (discover/data.ts `servesGenre`); the
 * server filters on `genres`. No `search` extra: search is `SEARCH_CATALOGS`'s.
 * Null for a view that is not a movies or shows library.
 */
export function catalogOf(view: JfItem): CatalogDef | null {
  const type = catalogType(view);
  if (!type || !view.Id || !view.Name) return null;
  return { type, id: view.Id, name: view.Name, extra: [{ name: "genre" }, { name: "skip" }] };
}

/** The catalogs search is asked of, one per type Discover searches, as the
 * AIOStreams side does it (aiojf/browse.ts `SEARCH_CATALOGS`). Their ids start
 * `jf.` and a Jellyfin id is hex, so none can clash with a library's. */
export const SEARCH_CATALOGS: CatalogDef[] = [
  { type: "movie", id: "jf.search.movie", name: "Search movies", extra: [{ name: "search", isRequired: true }] },
  { type: "series", id: "jf.search.series", name: "Search series", extra: [{ name: "search", isRequired: true }] },
];

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** What a list asks for besides the item itself. */
const FIELDS = "ProviderIds,Genres,Overview,People,CommunityRating,PremiereDate,ProductionYear,RunTimeTicks";
/** Posters, backdrops and logos, one of each: a list needs no more. */
const IMAGES = { EnableImageTypes: "Primary,Backdrop,Logo", ImageTypeLimit: "1" };

export const PAGE = 50;

export interface PageOpts {
  skip?: number;
  limit?: number;
  genre?: string;
  search?: string;
}

/** `/Items` for one library's page: the library's own type only, by name,
 * a genre or a search term when given. */
export function catalogQuery(
  userId: string,
  view: CatalogDef,
  opts: PageOpts = {},
): Record<string, string> {
  return itemsQuery(userId, view.type === "movie" ? "Movie" : "Series", { ParentId: view.id }, opts);
}

/** `/Items` across every library, for a search or a genre page over all of
 * them: a library is not named. */
export function searchQuery(userId: string, type: "movie" | "series", opts: PageOpts): Record<string, string> {
  return itemsQuery(userId, type === "movie" ? "Movie" : "Series", {}, opts);
}

function itemsQuery(
  userId: string,
  include: "Movie" | "Series",
  extra: Record<string, string>,
  opts: PageOpts,
): Record<string, string> {
  const q: Record<string, string> = {
    userId,
    Recursive: "true",
    IncludeItemTypes: include,
    SortBy: "SortName",
    SortOrder: "Ascending",
    Fields: FIELDS,
    EnableUserData: "true",
    StartIndex: String(Math.max(0, Math.floor(opts.skip ?? 0))),
    Limit: String(Math.max(1, Math.floor(opts.limit ?? PAGE))),
    ...IMAGES,
    ...extra,
  };
  if (opts.genre) q.Genres = opts.genre;
  if (opts.search) q.SearchTerm = opts.search;
  return q;
}

/** `/Items/{id}` is read with `userId` alone: the detail fields come on the
 * item without a `Fields` list. */
export function itemQuery(userId: string): Record<string, string> {
  return { userId };
}

/** `/Shows/{id}/Episodes`: every season's episodes in order. */
export function episodesQuery(userId: string): Record<string, string> {
  return { userId, Fields: FIELDS, EnableUserData: "true", EnableImageTypes: "Primary", ImageTypeLimit: "1" };
}

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

/** "129 min", the form mapper's `parseRuntime` reads. Undefined under a minute
 * or when there is no runtime. */
function runtimeOf(ticks: number | undefined): string | undefined {
  const minutes = Math.round(ticksToSec(ticks ?? 0) / 60);
  return minutes > 0 ? `${minutes} min` : undefined;
}

/**
 * A film or show as a catalog entry. `poster`, `background` and `logo` are the
 * item's images by tag, `imdbRating` is `CommunityRating`, `releaseInfo` the
 * year, `runtime` the ticks as minutes, `description` the synopsis. A field the
 * item lacks is left out. Null when the item is not a film or show, or has no
 * name or usable id.
 */
export function metaPreviewOf(item: JfItem, base: string): MetaPreview | null {
  const id = titleKey(item);
  if (!id || !item.Name) return null;
  const type = item.Type === "Movie" ? "movie" : "series";
  const poster = imageUrl(base, item.Id, "Primary", item.ImageTags?.Primary);
  const background = imageUrl(base, item.Id, "Backdrop/0", item.BackdropImageTags?.[0]);
  const logo = imageUrl(base, item.Id, "Logo", item.ImageTags?.Logo);
  const rating = item.CommunityRating;
  const year = item.ProductionYear;
  const runtime = runtimeOf(item.RunTimeTicks);
  const genres = (item.Genres ?? []).filter((g): g is string => typeof g === "string" && g.length > 0);
  return {
    id,
    type,
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
 * `People` who act, and for a show `videos` from its episodes. A series with no
 * IMDb id gets each episode its own `jf:` id (ids.ts `episodeKey`). Null when
 * the item does not read as a title.
 */
export function metaDetailOf(item: JfItem, episodes: readonly JfItem[], base: string): MetaDetail | null {
  const preview = metaPreviewOf(item, base);
  if (!preview) return null;
  const cast = (item.People ?? [])
    .filter((p) => p.Type === "Actor" && typeof p.Name === "string" && p.Name.length > 0)
    .map((p) => p.Name as string);
  const detail: MetaDetail = { ...preview, ...(cast.length > 0 ? { cast } : {}) };
  if (item.Type === "Series") {
    detail.videos = episodes.flatMap((ep) => {
      const v = videoOf(ep, preview.id, base);
      return v ? [v] : [];
    });
  }
  return detail;
}

/**
 * One `/Shows/{id}/Episodes` item as a video under its show's key `seriesKey`.
 * `season` and `episode` are `ParentIndexNumber` and `IndexNumber`; an episode
 * with neither, or with no usable id, is left out. `available` stays unset, as
 * on the AIOStreams side: mapper.ts drops a video only on an explicit `false`,
 * and an unaired episode shows with its air date.
 */
export function videoOf(ep: JfItem, seriesKey: string, base: string): StremioVideo | null {
  if (ep.Type !== "Episode") return null;
  const id = episodeKey(ep, seriesKey);
  if (!id || typeof ep.ParentIndexNumber !== "number" || typeof ep.IndexNumber !== "number") return null;
  const thumbnail = imageUrl(base, ep.Id, "Primary", ep.ImageTags?.Primary);
  const runtime = runtimeOf(ep.RunTimeTicks);
  return {
    id,
    season: ep.ParentIndexNumber,
    episode: ep.IndexNumber,
    ...(ep.Name ? { title: ep.Name } : {}),
    ...(ep.PremiereDate ? { released: ep.PremiereDate } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    ...(ep.Overview ? { overview: ep.Overview } : {}),
    ...(runtime ? { runtime } : {}),
  };
}

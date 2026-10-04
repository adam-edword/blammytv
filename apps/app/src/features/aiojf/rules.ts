/**
 * From AIOStreams' Jellyfin answers to BlammyTV's shapes (plan 023, B2).
 *
 * AIOStreams v2.35.9 answers as a Jellyfin server: items with packed ids,
 * ticks for time, `UserData` for what was watched. Each function here takes
 * one of those answers and returns what Stream stores or shows, in
 * BlammyTV's own ids (`tt…`, `tt…:S:E`, `kitsu:N`, `kitsu:N:E`). Pure: no
 * network, no storage. The shapes are from `core/src/jellyfin/dto.ts`, the
 * routes in `server/src/routes/jellyfin/library.ts` and `segments.ts`.
 *
 * Anything that does not decode comes back null or is left out, never
 * guessed. The caller counts what was left out for its log line.
 */

import type { SkipRange } from "../stream/aniskip";
import type { WatchEntry } from "../stream/watching";
import { blammyId, unpack } from "./ids";

/** A Jellyfin tick is 100 ns. */
const TICKS_PER_SEC = 10_000_000;

export function ticksToSec(t: number): number {
  return Number.isFinite(t) && t > 0 ? t / TICKS_PER_SEC : 0;
}

/** Whole ticks, never negative. */
export function secToTicks(s: number): number {
  return Number.isFinite(s) && s > 0 ? Math.round(s * TICKS_PER_SEC) : 0;
}

/**
 * The body for `/Sessions/Playing`, `/Sessions/Playing/Progress` and
 * `/Sessions/Playing/Stopped`. `PositionTicks` is always there: on a real
 * Jellyfin a stop without one marks the item played, and AIOStreams reads the
 * position from it the same way (playstate.ts). `PlaySessionId` and
 * `MediaSourceId` are optional there, so they are left out.
 */
export function reportBody(packedId: string, posSec: number, paused = false) {
  return {
    ItemId: packedId,
    PositionTicks: secToTicks(posSec),
    IsPaused: paused,
    CanSeek: true,
    PlayMethod: "DirectPlay",
  };
}

/** A Jellyfin `BaseItemDto`, the fields read. Everything is optional: it is
 * parsed JSON from a server that may be a different version. */
export interface BaseItem {
  Id?: string;
  Type?: string;
  Name?: string;
  SeriesId?: string;
  SeriesName?: string;
  /** The episode's number. */
  IndexNumber?: number;
  /** The episode's season. */
  ParentIndexNumber?: number;
  ProductionYear?: number;
  PremiereDate?: string;
  RunTimeTicks?: number;
  ProviderIds?: Record<string, string>;
  ImageTags?: Record<string, string>;
  SeriesPrimaryImageTag?: string;
  UserData?: {
    PlaybackPositionTicks?: number;
    Played?: boolean;
    LastPlayedDate?: string;
  };
}

/** What an item is, in BlammyTV's ids. `id` is always the title's id, the key
 * Continue Watching and the ledgers use: a film's or a show's own, and for an
 * episode its series' (so it equals `seriesId`). */
export interface ItemRef {
  id: string;
  episodeId?: string;
  seriesId?: string;
  kind: "movie" | "series" | "episode";
}

const IMDB = /^tt\d+$/;

interface EpisodeParts {
  seriesId: string;
  episodeId: string;
  season: number;
  episode: number;
}

/** An episode item taken apart, or null when its id does not decode. The
 * series comes from `SeriesId`; an item without a readable one falls back to
 * the base id inside the episode's own, which is the same title. */
function episodeParts(item: BaseItem): EpisodeParts | null {
  const ep = unpack(item.Id);
  if (!ep || ep.kind !== "episode") return null;
  const episodeId = blammyId(ep);
  if (!episodeId || ep.season === undefined || ep.episode === undefined) return null;
  const series = unpack(item.SeriesId);
  const seriesId = (series ? blammyId(series) : null) ?? ep.id;
  return {
    seriesId,
    episodeId,
    season: typeof item.ParentIndexNumber === "number" ? item.ParentIndexNumber : ep.season,
    episode: typeof item.IndexNumber === "number" ? item.IndexNumber : ep.episode,
  };
}

/**
 * A film's or show's id: its IMDb id when the item carries one, else the id
 * packed in its own. Not for an episode, whose `ProviderIds.Imdb` is the
 * episode's, not the show's.
 */
function titleId(item: BaseItem): string | null {
  const imdb = item.ProviderIds?.Imdb;
  if (typeof imdb === "string" && IMDB.test(imdb)) return imdb;
  const p = unpack(item.Id);
  return p && (p.kind === "movie" || p.kind === "series") ? p.id : null;
}

/** An item in BlammyTV's ids. Null for anything that is not a film, a show
 * or an episode, and for one whose id does not decode (a hashed id only the
 * server can read, an id type BlammyTV does not have). */
export function itemRef(item: BaseItem): ItemRef | null {
  if (item.Type === "Movie" || item.Type === "Series") {
    const id = titleId(item);
    return id ? { id, kind: item.Type === "Movie" ? "movie" : "series" } : null;
  }
  if (item.Type === "Episode") {
    const ep = episodeParts(item);
    return ep ? { id: ep.seriesId, seriesId: ep.seriesId, episodeId: ep.episodeId, kind: "episode" } : null;
  }
  return null;
}

/** How Continue Watching labels an episode (`S1 · E3: Title`, trakt/progress.ts
 * and the Stream screen), the title left off when there is none. */
export function episodeLabel(season: number, episode: number, title?: string): string {
  return `S${season} · E${episode}${title ? `: ${title}` : ""}`;
}

/** A resume point from AIOStreams, carrying what Continue Watching needs to
 * make an entry of it when the title is not there yet. */
export interface Resume {
  /** The title's id; an episode's series. */
  id: string;
  episodeId?: string;
  posSec: number;
  durSec?: number;
  /** Epoch ms of `UserData.LastPlayedDate`, else when the sync ran. */
  at: number;
  title: string;
  kind: "movie" | "series";
  year?: number;
  season?: number;
  episode?: number;
  epTitle?: string;
}

function parsedAt(iso: string | undefined): number | null {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? at : null;
}

/**
 * `/UserItems/Resume` into resume points. An item with no position, one that
 * does not decode, or one with no title is left out. `RunTimeTicks` becomes
 * the duration when the server has one (it comes from the title's meta, so
 * it is a stand-in until the player knows the file's own).
 */
export function resumeFrom(items: readonly BaseItem[], nowMs: number): Resume[] {
  const out: Resume[] = [];
  for (const item of items) {
    const ref = itemRef(item);
    if (!ref || ref.kind === "series") continue;
    const posSec = ticksToSec(item.UserData?.PlaybackPositionTicks ?? 0);
    if (posSec <= 0) continue;
    const dur = ticksToSec(item.RunTimeTicks ?? 0);
    const at = parsedAt(item.UserData?.LastPlayedDate) ?? nowMs;
    const base = { id: ref.id, posSec, ...(dur > 0 ? { durSec: dur } : {}), at };
    if (ref.kind === "movie") {
      if (!item.Name) continue;
      out.push({
        ...base,
        title: item.Name,
        kind: "movie",
        ...(typeof item.ProductionYear === "number" ? { year: item.ProductionYear } : {}),
      });
      continue;
    }
    const ep = episodeParts(item);
    if (!ep || !item.SeriesName) continue;
    out.push({
      ...base,
      episodeId: ep.episodeId,
      title: item.SeriesName,
      kind: "series",
      season: ep.season,
      episode: ep.episode,
      ...(item.Name ? { epTitle: item.Name } : {}),
    });
  }
  return out;
}

/** Same cap as the store's (watching.ts). */
const CAP = 20;

/**
 * Where you left off, from AIOStreams into Continue Watching (plan 023, A3).
 *
 * Each resume point meets this app's entry for the same title, and the newest
 * position wins, by when it was played (D3), whichever side it came from.
 * Continue Watching keeps one entry per title (an episode replaces its
 * sibling), so a series' entry moves to the episode played most recently.
 * A title not in the list comes in the same way and the cap decides: past 20
 * the oldest goes, so a resume point older than everything kept is dropped.
 *
 * Mirrors `mergeProgress` (trakt/progress.ts). Pure: the entries and the
 * resume points in, the new entries out.
 */
export function mergeAioProgress(entries: readonly WatchEntry[], incoming: readonly Resume[]): WatchEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  // Newest first, so a series with two resume points takes the later.
  const items = [...incoming].sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  for (const r of items) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const prev = byId.get(r.id);
    // This side is newer or the same age: it stays as it is.
    if (prev && prev.at >= r.at) continue;
    const sameThing = prev !== undefined && prev.episodeId === r.episodeId;
    // The player's own duration beats the meta's runtime, for the same episode.
    const durSec = (sameThing ? prev.durSec : undefined) ?? r.durSec;
    const next: WatchEntry = {
      ...(prev ?? {}),
      id: r.id,
      title: r.title,
      kind: r.kind,
      at: r.at,
      ...(prev?.year == null && r.year != null ? { year: r.year } : {}),
      posSec: r.posSec,
      durSec,
    };
    if (r.episodeId) {
      next.episodeId = r.episodeId;
      next.season = r.season;
      next.episode = r.episode;
      // Another episode's title and label must not outlive it.
      if (r.epTitle) {
        next.epTitle = r.epTitle;
        next.label = episodeLabel(r.season ?? 0, r.episode ?? 0, r.epTitle);
      } else {
        delete next.epTitle;
        delete next.label;
      }
    }
    if (durSec == null) delete next.durSec;
    byId.set(r.id, next);
  }
  return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, CAP);
}

/** What AIOStreams counts as played, in the shape of `malWatched`
 * (stream/watched.ts): series id to episode ids, plus the films. The ledger
 * is stored apart from Trakt's, replaced whole on each sync (plan 023, D3).
 * `skipped` counts the films and episodes that did not decode. */
export interface Played {
  episodes: Record<string, string[]>;
  films: string[];
  skipped: number;
}

/** Season then number, from `tt…:S:E` or `kitsu:N:E` (no season). */
function episodeOrder(id: string): [number, number] {
  const parts = id.split(":");
  const episode = Number(parts[parts.length - 1]);
  return [id.startsWith("kitsu:") ? 0 : Number(parts[1]), episode];
}

/**
 * `/Items?Recursive=true&IsPlayed=true` into the played ledger. Shows,
 * seasons and collections are not entries of it and are passed over. Episodes
 * and films sort, so two syncs of the same answer store the same list.
 */
export function playedFrom(items: readonly BaseItem[]): Played {
  const episodes: Record<string, string[]> = {};
  const films = new Set<string>();
  let skipped = 0;
  for (const item of items) {
    if (item.UserData?.Played === false) continue;
    if (item.Type !== "Movie" && item.Type !== "Episode") continue;
    const ref = itemRef(item);
    if (!ref) {
      skipped++;
    } else if (ref.kind === "movie") {
      films.add(ref.id);
    } else if (ref.seriesId && ref.episodeId) {
      const list = (episodes[ref.seriesId] ??= []);
      if (!list.includes(ref.episodeId)) list.push(ref.episodeId);
    }
  }
  for (const list of Object.values(episodes)) {
    list.sort((a, b) => {
      const [as, ae] = episodeOrder(a);
      const [bs, be] = episodeOrder(b);
      return as - bs || ae - be;
    });
  }
  return { episodes, films: [...films].sort(), skipped };
}

/** A card for the Next Up or Upcoming row. */
export interface UpNextCard {
  seriesId: string;
  episodeId: string;
  seriesTitle: string;
  /** `S2 · E5: Title`, as Continue Watching labels an episode. */
  label: string;
  /** Relative to the AIOStreams Jellyfin base: the series' poster, from the
   * tag the item carries. Images need no token. */
  imagePath?: string;
  /** Epoch ms of the episode's premiere. */
  airsAt?: number;
}

/**
 * `/Shows/NextUp` and `/Shows/Upcoming` into row cards, in the server's
 * order. Upcoming can hold a film that premieres ahead; a film has no
 * episode and no series, so it is left out with anything that does not
 * decode or has no series title.
 */
export function upNextFrom(items: readonly BaseItem[]): UpNextCard[] {
  const out: UpNextCard[] = [];
  for (const item of items) {
    if (item.Type !== "Episode" || !item.SeriesName) continue;
    const ep = episodeParts(item);
    if (!ep) continue;
    const tag = item.SeriesPrimaryImageTag;
    const airsAt = parsedAt(item.PremiereDate);
    out.push({
      seriesId: ep.seriesId,
      episodeId: ep.episodeId,
      seriesTitle: item.SeriesName,
      label: episodeLabel(ep.season, ep.episode, item.Name),
      ...(item.SeriesId && tag
        ? { imagePath: `/Items/${item.SeriesId}/Images/Primary?tag=${encodeURIComponent(tag)}` }
        : {}),
      ...(airsAt != null ? { airsAt } : {}),
    });
  }
  return out;
}

/** AIOStreams' segment types to the overlay's skip types (aniskip.ts). Any
 * other type (Commercial, Preview) has no button and is dropped. */
const SEGMENT_TYPES = new Map([
  ["Intro", "op"],
  ["Recap", "recap"],
  ["Outro", "ed"],
]);

/**
 * `/MediaSegments/{id}` into the overlay's skip ranges: Intro as `op`, Recap
 * as `recap`, Outro as `ed`, ticks as seconds, sorted by start. A marker
 * whose end is not after its start (AIOStreams drops open-ended ones, but a
 * different version might not) is dropped.
 */
export function skipsFrom(json: unknown): SkipRange[] {
  const items = (json as { Items?: unknown } | null | undefined)?.Items;
  if (!Array.isArray(items)) return [];
  const out: SkipRange[] = [];
  for (const raw of items) {
    const s = raw as { Type?: unknown; StartTicks?: unknown; EndTicks?: unknown } | null;
    const type = typeof s?.Type === "string" ? SEGMENT_TYPES.get(s.Type) : undefined;
    const a = s?.StartTicks;
    const b = s?.EndTicks;
    if (!type || typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    const start = ticksToSec(a);
    const end = ticksToSec(b);
    if (end > start) out.push({ type, start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * From a real Jellyfin's answers to BlammyTV's shapes (plan 027, batch 5): what
 * a play reports, where you left off, what counts as played, what is next.
 * The sibling of aiojf/rules.ts, which does the same for AIOStreams' Jellyfin
 * side, and shares its shapes (`Resume`, `Played`, `UpNextCard`) so one merge
 * serves both. Pure: no network, no storage.
 *
 * What the server says is watched is its `UserData.Played` flag and nothing
 * else. `PlayCount` rises on every stop, the 3% ones too (plans/027-api-facts.md
 * #6), so it is never read as a watch.
 *
 * Anything that does not decode is left out and counted, never guessed.
 */

import { episodeLabel, secToTicks, ticksToSec, type Played, type Resume, type UpNextCard } from "../aiojf/rules";
import { refOf, type SeriesKeyOf } from "./ids";
import type { JfItem } from "./items";

/**
 * The body for `/Sessions/Playing`, `/Progress` and `/Stopped`: the fields
 * the 12.2 server took (api-facts #8). `PositionTicks` is always there, since
 * the server's stop rules (api-facts #6) work from it. The media source and
 * the play session are the ones the file was looked up under, when known.
 */
export function reportBody(
  play: { itemId: string; mediaSourceId?: string; playSessionId?: string },
  posSec: number,
  paused = false,
) {
  return {
    ItemId: play.itemId,
    ...(play.mediaSourceId ? { MediaSourceId: play.mediaSourceId } : {}),
    ...(play.playSessionId ? { PlaySessionId: play.playSessionId } : {}),
    PositionTicks: secToTicks(posSec),
    IsPaused: paused,
    CanSeek: true,
    PlayMethod: "DirectPlay",
  };
}

/** The `mediaSourceId` a stream address of ours carries (sources.ts builds it),
 * or undefined. */
export function mediaSourceOf(streamUrl: string | undefined): string | undefined {
  if (!streamUrl) return undefined;
  try {
    const id = new URL(streamUrl).searchParams.get("mediaSourceId");
    return id && /^[0-9a-f]{32}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

const parsedAt = (iso: string | undefined): number | null => {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? at : null;
};

/** What did not decode: not a film, a show or an episode whose show is known. */
export const undecoded = (items: readonly JfItem[], seriesKeyOf: SeriesKeyOf): number =>
  items.filter((i) => refOf(i, seriesKeyOf) === null).length;

/** The key Continue Watching files a resume point under: the title's, and an
 * episode's after a bar. */
export const resumeKey = (id: string, episodeId?: string): string => `${id}|${episodeId ?? ""}`;

/**
 * `/UserItems/Resume` into resume points, and the Jellyfin item each is on
 * (`jids`, by `resumeKey`). An item with no position, one that does not
 * decode, or one with no title is left out. `RunTimeTicks` is the duration
 * until the player knows the file's own.
 */
export function resumeFrom(
  items: readonly JfItem[],
  seriesKeyOf: SeriesKeyOf,
  nowMs: number,
): { points: Resume[]; jids: Record<string, string> } {
  const points: Resume[] = [];
  const jids: Record<string, string> = {};
  for (const item of items) {
    const ref = refOf(item, seriesKeyOf);
    if (!ref || ref.kind === "series" || !item.Id) continue;
    const posSec = ticksToSec(item.UserData?.PlaybackPositionTicks ?? 0);
    if (posSec <= 0) continue;
    const dur = ticksToSec(item.RunTimeTicks ?? 0);
    const at = parsedAt(item.UserData?.LastPlayedDate) ?? nowMs;
    const base = { id: ref.id, posSec, ...(dur > 0 ? { durSec: dur } : {}), at };
    if (ref.kind === "movie") {
      if (!item.Name) continue;
      points.push({
        ...base,
        title: item.Name,
        kind: "movie",
        ...(typeof item.ProductionYear === "number" ? { year: item.ProductionYear } : {}),
      });
      jids[resumeKey(ref.id)] = item.Id;
      continue;
    }
    if (!ref.episodeId || !item.SeriesName) continue;
    points.push({
      ...base,
      episodeId: ref.episodeId,
      title: item.SeriesName,
      kind: "series",
      season: ref.season,
      episode: ref.episode,
      ...(item.Name ? { epTitle: item.Name } : {}),
    });
    jids[resumeKey(ref.id, ref.episodeId)] = item.Id;
  }
  return { points, jids };
}

/** Season then number from `tt…:S:E`, or null for an id that carries none
 * (an opaque `jf:` episode). */
function order(id: string): [number, number] | null {
  const m = /^tt\d+:(\d+):(\d+)$/.exec(id);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * `/Items?Recursive=true&IsPlayed=true` into the played ledger: the films, and
 * the episodes by show. Only `UserData.Played` counts. Episodes sort where an
 * id says where it sits, so two syncs of the same answer store the same list.
 */
export function playedFrom(items: readonly JfItem[], seriesKeyOf: SeriesKeyOf): Played {
  const episodes: Record<string, string[]> = {};
  const films = new Set<string>();
  let skipped = 0;
  for (const item of items) {
    if (item.UserData?.Played !== true) continue;
    if (item.Type !== "Movie" && item.Type !== "Episode") continue;
    const ref = refOf(item, seriesKeyOf);
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
      const x = order(a);
      const y = order(b);
      return x && y ? x[0] - y[0] || x[1] - y[1] : 0;
    });
  }
  return { episodes, films: [...films].sort(), skipped };
}

/** `/Shows/NextUp` into row cards, in the server's order. Anything that is not
 * an episode with a known show and a title is left out. */
export function upNextFrom(items: readonly JfItem[], seriesKeyOf: SeriesKeyOf): UpNextCard[] {
  const out: UpNextCard[] = [];
  for (const item of items) {
    if (item.Type !== "Episode" || !item.SeriesName) continue;
    const ref = refOf(item, seriesKeyOf);
    if (!ref?.seriesId || !ref.episodeId || ref.season === undefined || ref.episode === undefined) continue;
    const tag = item.SeriesPrimaryImageTag;
    const airsAt = parsedAt(item.PremiereDate);
    out.push({
      seriesId: ref.seriesId,
      episodeId: ref.episodeId,
      seriesTitle: item.SeriesName,
      label: episodeLabel(ref.season, ref.episode, item.Name),
      ...(item.SeriesId && tag
        ? { imagePath: `/Items/${item.SeriesId}/Images/Primary?tag=${encodeURIComponent(tag)}` }
        : {}),
      ...(airsAt != null ? { airsAt } : {}),
    });
  }
  return out;
}

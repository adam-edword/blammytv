/**
 * Skip markers from AIOStreams (plan 023, A4 and D4): `GET /MediaSegments/{id}`
 * gives Intro, Recap and Outro ranges from IntroDB, AniSkip and PMDB, which
 * the player's skip button and credits window already know how to use (the
 * same `SkipRange` AniSkip's answers are). AIOStreams reads the title, season
 * and episode to those providers; that is the instance's own setting.
 *
 * Anime keeps BlammyTV's AniSkip first, as before: AIOStreams' AniSkip needs a
 * runtime it will not have for a play it did not start. Whatever AniSkip has
 * nothing for (every film and show, and anime it lacks) is asked of
 * AIOStreams, when its sync is connected. A failure is silent: the overlay
 * falls back to its chapter heuristics, as it always has.
 */

import { getAniskipRanges, type SkipRange } from "../stream/aniskip";
import type { VodItem } from "../stream/model";
import { aioCall } from "./account";
import { aiojfStatus } from "./client";
import { packedFor } from "./report";
import { skipsFrom } from "./rules";

/** Session cache, empty answers included: one round trip per title. A failed
 * one is not kept, so a retry can succeed. */
const cache = new Map<string, SkipRange[]>();

export async function getAioSkips(
  item: Pick<VodItem, "id" | "kind">,
  episodeId: string | null | undefined,
  season?: number,
): Promise<SkipRange[]> {
  const packed = packedFor({ itemId: item.id, kind: item.kind, episodeId: episodeId ?? undefined, season });
  if (!packed) return [];
  const hit = cache.get(packed);
  if (hit) return hit;
  if (!(await aiojfStatus()).connected) return [];
  const r = await aioCall<unknown>("GET", `/MediaSegments/${packed}`, {
    query: { includeSegmentTypes: "Intro,Recap,Outro" },
  });
  if (r.status !== 200 || r.data == null) return [];
  const ranges = skipsFrom(r.data);
  cache.set(packed, ranges);
  if (ranges.length) console.info(`[aiojf] skips: ${ranges.map((s) => s.type).join(", ")}`);
  return ranges;
}

/** The skip ranges for what is about to play: AniSkip's, else AIOStreams'. */
export async function playSkips(
  item: VodItem,
  episodeId: string | null | undefined,
  season?: number,
): Promise<SkipRange[]> {
  const exact = await getAniskipRanges(item, episodeId).catch(() => []);
  if (exact.length) return exact;
  return getAioSkips(item, episodeId, season).catch(() => []);
}

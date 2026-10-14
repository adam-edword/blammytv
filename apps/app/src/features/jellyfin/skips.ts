/**
 * Skip markers from your own Jellyfin (plan 027): `GET /MediaSegments/{id}`
 * gives Intro, Recap, Outro and Preview ranges for the item, which the
 * player's skip button and credits window already know how to use (the same
 * `SkipRange` AniSkip's answers are). They are the markers made for the file
 * the server holds, so they land on the right frames for that file, which an
 * addon's or AIOStreams' would not.
 *
 * A server without the plugin that makes them answers an empty list, and every
 * failure is silent: the overlay falls back to its chapter heuristics.
 */

import type { SkipRange } from "../stream/aniskip";
import type { VodItem } from "../stream/model";
import { skipsFrom } from "../aiojf/rules";
import { jfCall } from "./account";
import { loadJfConn } from "./store";
import { jfItemIdFor } from "./vod";

/** Session cache, empty answers included: one round trip per item. A failed
 * one is not kept, so a retry can succeed. */
const cache = new Map<string, SkipRange[]>();

export async function getJfSkips(
  item: Pick<VodItem, "id" | "kind">,
  episodeId: string | null | undefined,
): Promise<SkipRange[]> {
  const conn = loadJfConn();
  if (!conn) return [];
  const key = item.kind === "movie" ? item.id : episodeId;
  if (!key) return [];
  const jid = await jfItemIdFor(item.kind, key);
  if (!jid) return [];
  const at = `${conn.key}|${jid}`;
  const hit = cache.get(at);
  if (hit) return hit;
  // No type filter: the server's default is every type, and `skipsFrom` keeps
  // the four the overlay has a button for.
  const r = await jfCall<unknown>("GET", `/MediaSegments/${jid}`);
  if (r.status !== 200 || r.data == null) return [];
  const ranges = skipsFrom(r.data);
  cache.set(at, ranges);
  if (ranges.length) console.info(`[jellyfin] skips: ${ranges.map((s) => s.type).join(", ")}`);
  return ranges;
}

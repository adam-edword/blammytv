/**
 * What a show's Jellyfin id is called here, for the lists that name an episode's
 * show only by `SeriesId` (Resume, Next Up, a played list). See ids.ts
 * `SeriesKeyOf`: the key of an unread show is never guessed from the episode,
 * so the sync reads the shows it needs once (`readSeries`), remembers them
 * (idmap.ts for the ones with an IMDb id), and only then decodes.
 */

import { jfCall } from "./account";
import { jfKeyFor, rememberJfIds } from "./idmap";
import { titleKey, type SeriesKeyOf } from "./ids";
import { HEX32, type JfItem } from "./items";
import type { JfConn } from "./store";

/** A show's key as read this session, `null` for one that is not a title. The
 * ones with an IMDb id are on disk too (idmap.ts); a `jf:` key is its id, so
 * it is only worth keeping from a read to the next. */
const read = new Map<string, string | null>();
const at = (conn: JfConn, jid: string): string => `${conn.key}|${jid}`;

export function seriesKeyOf(conn: JfConn): SeriesKeyOf {
  return (jid) => {
    const hit = read.get(at(conn, jid));
    if (hit !== undefined) return hit;
    return jfKeyFor(conn.base, jid) ?? undefined;
  };
}

/** The shows an episode list names that this device has not read yet. */
export function unreadSeries(conn: JfConn, items: readonly JfItem[]): string[] {
  const out = new Set<string>();
  const known = seriesKeyOf(conn);
  for (const it of items)
    if (it.Type === "Episode" && it.SeriesId && HEX32.test(it.SeriesId) && known(it.SeriesId) === undefined)
      out.add(it.SeriesId);
  return [...out];
}

/** The most shows asked for in one request. */
const BATCH = 40;

/** Read the shows in `jids` (one `/Items` call per `BATCH`) and remember their
 * keys. A show the server did not answer for stays unread, so the episodes
 * under it do not decode and are counted as such, and the next sync asks
 * again. Rejects on a non-200, so a pass can say what it hit. */
export async function readSeries(conn: JfConn, jids: readonly string[]): Promise<void> {
  for (let i = 0; i < jids.length; i += BATCH) {
    const ids = jids.slice(i, i + BATCH);
    const r = await jfCall<{ Items?: JfItem[] }>("GET", "/Items", {
      query: {
        userId: conn.userId,
        Ids: ids.join(","),
        IncludeItemTypes: "Series",
        Fields: "ProviderIds",
        Recursive: "true",
      },
    });
    if (r.status !== 200 || !r.data) throw new Error(`Jellyfin answered ${r.status}`);
    const pairs: [string, string][] = [];
    for (const s of r.data.Items ?? []) {
      if (!s.Id || !ids.includes(s.Id)) continue;
      const key = titleKey(s);
      read.set(at(conn, s.Id), key);
      if (key) pairs.push([key, s.Id]);
    }
    rememberJfIds(conn.base, pairs);
  }
}

/** Forget what was read (a sign-out, or a test). */
export function forgetSeries(): void {
  read.clear();
}

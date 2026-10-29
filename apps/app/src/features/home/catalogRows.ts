import type { StreamRow } from "../stream/model";
import { peekVod } from "../stream/source";
import { peekJfVod } from "../jellyfin/vod";
import { peekXtVod } from "../xtvod/vod";

/**
 * The catalog rows as the last builds have them, in Stream's own order: the
 * addon's, then your Jellyfin's, then your playlists'. Any age, nothing
 * fetched: the first rows Home is seeded with, and the names Settings → Home
 * lists them under (a row's own name is the catalog's, never stored).
 */
export function peekCatalogRows(): StreamRow[] {
  return [peekVod(), peekJfVod(), peekXtVod()].flatMap((d) => d?.rows ?? []);
}

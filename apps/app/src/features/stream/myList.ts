/**
 * The pre-009 saved-titles record.
 *
 * `lists.ts` supersedes it: everything that saves, removes, or asks whether
 * a title is saved goes through user lists now. What survives here is the
 * ENTRY SHAPE, which lists.ts stores unchanged, and the storage key it
 * migrates from once (`lists.ts` reads that key directly).
 *
 * The mutators are gone on purpose. They wrote to a key the Library does
 * not read, so after the one-time migration a save made through them
 * silently disappeared. Leaving them here would let that come back.
 */

import type { VodFrom } from "./model";

export interface ListEntry {
  id: string;
  /** Saved from the user's own Jellyfin (plan 027) or an Xtream playlist (plan
   * 028): the card opens it there. Absent for the addon. */
  from?: VodFrom;
  title: string;
  kind: "movie" | "series";
  poster?: string;
  backdrop?: string;
  logo?: string;
  year?: number;
  rating?: number;
  runtimeMin?: number;
  /** Saved-at (grid order). */
  at: number;
}

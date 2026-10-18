import { extractQuality } from "../live/quality";
import { offPlaylist } from "../live/mvGrid";
import type { Channel, Quality } from "../live/model";
import type { Game } from "./model";

/**
 * NFL RedZone: when it is on the air, and which of your channels is it.
 *
 * Pure, so the rule and the pick are tested without a board or a catalog.
 * Sports' toolbar and Multi-view's scores strip both read it.
 */

/** The NFL's catalog path, the leagueKey of every one of its games. */
export const NFL = "football/nfl";

/**
 * Whether RedZone is on: two or more NFL games in progress right now.
 *
 * Two, not one. RedZone only runs on Sunday afternoons, when games overlap.
 * Thursday, Sunday and Monday night are one game each and the channel is off
 * the air then, so one live game would point at a dead stream (Adam's call).
 * "In progress" is the board's own word for it: `state === "live"`.
 */
export function redzoneOn(games: readonly Game[]): boolean {
  return games.filter((g) => g.leagueKey === NFL && g.state === "live").length >= 2;
}

/** "Red Zone" or "RedZone", any case. Anchored at the front so a word that
 * only ends in "red" ("Bored Zone") is not one. */
const RED_ZONE = /\bred\s*zone\b/i;
const SAYS_NFL = /\bnfl\b/i;

/** Better first. extractQuality's own order: 4K beats HDR beats FHD beats HD. */
const RANK: Record<Quality, number> = { "4K": 4, HDR: 3, FHD: 2, HD: 1 };

/**
 * The channel that is RedZone, or null when none of yours is.
 *
 * `channels` is the catalog's visible list, in playlist order: the adult
 * filter and the folders you hid are already out of it, and a hidden folder
 * stays out on purpose (a button on the board must not quietly offer what
 * someone muted). `enabled` is the enabled playlists' ids, because a
 * catalog can still hold a playlist's channels for a moment after it is
 * switched off, and a channel on a line that is off must not be offered.
 *
 * Prefers a name that also says NFL, then the best quality, then whichever
 * comes first in the list (a strict `>` keeps the earlier of two equals).
 */
export function redzoneChannel(
  channels: readonly Channel[],
  enabled: readonly string[],
): Channel | null {
  let best: Channel | null = null;
  let bestScore = -1;
  for (const c of channels) {
    if (!RED_ZONE.test(c.name) || offPlaylist(enabled, c.id)) continue;
    const q = extractQuality(c.name);
    const score = (SAYS_NFL.test(c.name) ? 10 : 0) + (q ? RANK[q] : 0);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/**
 * How long a guide snapshot is served, and how much schedule it therefore
 * has to carry. One file because these two numbers are only correct
 * relative to each other.
 *
 * The disk cache exists so the first launch of the day paints a guide
 * instantly instead of sitting through a ~97MB xmltv download (measured at
 * 76.7s on a real provider). That only works if the snapshot still has
 * programmes covering the moment it is opened. Keeping 12h of future
 * listings behind a 40h cache would hydrate a guide that is entirely in the
 * past: instant, and empty, which is the failure the cache was built to
 * avoid.
 *
 * So: keep the cache age, plus the guide's own visible window, so even a
 * snapshot at the very end of its life still fills the screen.
 */

/** Longest a disk snapshot may be and still hydrate the guide. */
export const DISK_MAX_AGE_MS = 40 * 3600_000;

/** The guide shows now..now+4h. */
export const VISIBLE_WINDOW_MS = 4 * 3600_000;

/** Future listings a snapshot retains, from the moment it was fetched.
 *
 * The cost is storage, not time: the parser already reads the whole
 * document either way, and this only decides what survives the parse. A
 * wider horizon means a bigger record in IndexedDB, and a failed write
 * costs the cache rather than the app (see storage's swallow).
 */
export const EPG_KEEP_AHEAD_MS = DISK_MAX_AGE_MS + VISIBLE_WINDOW_MS;

/** How long a source's downloaded guide is reused before the next load
 * downloads it again. Per source, and it only skips the GUIDE half of a load:
 * the channel list still reloads on every launch and every stale remount, so
 * a provider that renames event channels during the day is read fresh.
 *
 * The guide is the expensive half (about 95MB of xmltv on a big provider, 60
 * to 77s), and it used to be downloaded again on every launch. Its schedule
 * runs days ahead, so twelve hours old is still a guide. Telly re-downloads
 * once every 24 hours.
 *
 * It pairs with the two above. A launch inside this window rewrites the disk
 * record with a fresh `at` and the SAME guide, so a guide can be older than
 * the record that holds it. `source.ts` ages the guide by its own `guideAt`,
 * and a guide older than `EPG_KEEP_AHEAD_MS - VISIBLE_WINDOW_MS` has less
 * schedule left than the screen shows, so it hydrates with the pending note
 * (as a snapshot that no longer covers now does) and is downloaded. */
export const GUIDE_REFRESH_MS = 12 * 3600_000;

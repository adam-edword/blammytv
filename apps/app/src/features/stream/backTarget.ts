/**
 * Where Back goes from an episode's source list.
 *
 * There are two ways to reach that screen and they leave different histories
 * behind, which is why Back could not simply pop:
 *
 *   drilled in    series -> episode list -> pick an episode -> sources.
 *                 The episode list is on the stack, so popping is right and
 *                 restores its scroll position too.
 *   dropped in    Continue Watching resumes an episode directly. When none
 *                 of its sources are cached the app lands this same screen
 *                 so the pick is deliberate, and the episode list was never
 *                 shown. Popping returned to the home rows and left the user
 *                 looking at the sources for one episode of a series with no
 *                 route to any of the others.
 *
 * So Back means "the page above" here, not "the page I came from". Only for
 * an EPISODE's sources: a film's source list has no list above it.
 */

/** Just the shape this decision needs, so the View union can move freely. */
export interface BackFrom {
  at: string;
  episodeId?: string;
  item?: { id: string; kind?: string };
}

/**
 * True when Back should swap in the series' episode list instead of popping
 * history. Replacing rather than pushing keeps a second Back going wherever
 * the user actually came from, rather than bouncing between the two screens.
 */
export function wantsEpisodeList(
  current: BackFrom | null | undefined,
  previous: BackFrom | null | undefined,
): boolean {
  if (!current || current.at !== "sources") return false;
  if (!current.episodeId) return false; // a film has no list above it
  if (current.item?.kind !== "series") return false;
  // Already there: pop normally, which also restores its scroll.
  const already =
    previous?.at === "episodes" &&
    !!previous.item &&
    !!current.item &&
    previous.item.id === current.item.id;
  return !already;
}

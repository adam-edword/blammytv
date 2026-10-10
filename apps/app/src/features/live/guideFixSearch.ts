import { tokens } from "../sports/matcher";
import type { GuideChannel } from "./model";
import { loose } from "./xmltv";

/**
 * What the Fix guide dialog lists, and in what order (guideFix.ts is what it
 * saves).
 *
 * A guide holds thousands of channels and the one you want is usually named
 * almost like yours, so the list opens on the closest names rather than the
 * first alphabetical ones. "Closest" is the sports matcher's own word set
 * (`tokens`), which already drops the country prefix and the quality badge
 * a playlist adds to a name and the guide never has: "US: ESPN 2 FHD" and
 * "ESPN 2" are the same two words.
 */

/** How many rows the dialog draws. A bare letter matches thousands. */
export const FIX_LIST_CAP = 50;

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** A guide channel, with what ranking it needs worked out once. */
export interface Candidate {
  channel: GuideChannel;
  /** Lower-cased name and id, what a search looks in. */
  hay: string;
  low: string;
  /** Its words, read the first time a ranking asks. */
  words?: Set<string>;
}

export function candidates(list: readonly GuideChannel[]): Candidate[] {
  return list.map((channel) => {
    const low = channel.name.toLowerCase();
    return { channel, low, hay: `${low} ${channel.id.toLowerCase()}` };
  });
}

/**
 * The rows to show for `query`, and how many more there would be.
 *
 * With nothing typed, every channel, the closest names to `ownName` first:
 * most words in common, then fewest words that are not in common ("ESPN"
 * before "ESPN 2" for a channel called ESPN), then by name. Channels with no
 * word in common follow, by name.
 *
 * With a query, only the channels whose name or id holds every word of it,
 * the ones whose name starts with it first, then a word of the name, then
 * anywhere, and the same closeness inside each.
 */
export function rankGuideChannels(
  all: readonly Candidate[],
  ownName: string,
  query: string,
  cap = FIX_LIST_CAP,
): { rows: GuideChannel[]; more: number } {
  const own = tokens(ownName);
  const q = query.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const scored: { c: Candidate; tier: number; shared: number; extras: number }[] = [];
  for (const c of all) {
    if (terms.some((t) => !c.hay.includes(t))) continue;
    const words = (c.words ??= tokens(c.channel.name));
    let shared = 0;
    for (const w of words) if (own.has(w)) shared++;
    scored.push({
      c,
      tier: !q || c.low.startsWith(q) ? 0 : c.low.includes(` ${q}`) ? 1 : 2,
      shared,
      extras: shared ? words.size - shared : 0,
    });
  }
  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      b.shared - a.shared ||
      a.extras - b.extras ||
      collator.compare(a.c.channel.name, b.c.channel.name),
  );
  return {
    rows: scored.slice(0, cap).map((s) => s.c.channel),
    more: Math.max(0, scored.length - cap),
  };
}

/** Where a channel stands with its guide, for the line under the dialog's
 * title. A fix wins over what the provider gave. */
export type Standing =
  | { kind: "fixed"; id: string; name: string }
  | { kind: "matched"; id: string; name: string }
  | { kind: "none" };

/**
 * `fixedId` is the guide channel the user chose, `epgId` the one the
 * provider gave. The provider's counts as matched when the guide declares
 * it, to the letter or as the parse reads it (case and spacing folded,
 * xmltv.ts#loose): that is the rule the programmes were matched by.
 */
export function guideStanding(
  list: readonly GuideChannel[],
  epgId: string | undefined,
  fixedId: string | undefined,
): Standing {
  if (fixedId) {
    const hit = list.find((g) => g.id === fixedId);
    return { kind: "fixed", id: fixedId, name: hit?.name ?? fixedId };
  }
  if (epgId) {
    const key = loose(epgId);
    const hit = list.find((g) => g.id === epgId) ?? list.find((g) => loose(g.id) === key);
    if (hit) return { kind: "matched", id: hit.id, name: hit.name };
  }
  return { kind: "none" };
}

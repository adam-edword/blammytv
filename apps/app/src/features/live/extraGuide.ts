import type { GuideChannel, Programme } from "./model";

/**
 * A playlist's extra guide (plan 025, P5): an XMLTV address that FILLS THE
 * GAPS in its provider's guide. The provider's guide wins wherever it has
 * programmes; the extra one is asked only about the channels the provider's
 * left empty, and what it gives for them is kept. Adam, 2026-10-12.
 *
 * What is pure lives here, apart from source.ts (whose tests replace
 * settings/playlists wholesale, so nothing in this file may reach for it):
 *
 *  - which channels are gaps, as the index the extra guide is parsed with;
 *  - the merge, which never lets the extra guide replace the provider's;
 *  - the channel list the Fix guide dialog offers, the provider's first.
 *
 * source.ts does the downloading and the parsing (on the worker, as the
 * provider's is), and doLoad does the merge.
 */

/** The address to download, or undefined for none. An address that is not
 * http or https is none, whatever the save says: it is what the page asks the
 * native side to fetch, and native fetches what it is told. */
export function extraGuideUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? t : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a channel has programmes: the whole meaning of "gap". A list that
 * exists and is empty is a gap too. */
export const hasProgrammes = (
  programmes: ReadonlyMap<string, readonly Programme[]>,
  channelId: string,
): boolean => (programmes.get(channelId)?.length ?? 0) > 0;

/**
 * The provider's guide index (guide id to our channel ids, the fixes in it)
 * cut down to the channels whose lane is empty. It is what the extra guide is
 * parsed with, so a programme for a channel the provider already covers is
 * skipped at its opening tag and never held: the memory of an extra guide is
 * the gaps it fills and nothing else.
 *
 * A guide id whose channels are all covered is out of it; one with some
 * covered and some not keeps only the ones that are not. The input is left as
 * it was.
 */
export function gapIndex(
  index: ReadonlyMap<string, readonly string[]>,
  covered: (channelId: string) => boolean,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [guideId, ids] of index) {
    const gaps = ids.filter((id) => !covered(id));
    if (gaps.length) out.set(guideId, gaps);
  }
  return out;
}

/**
 * Put the extra guide's programmes into `into`, the provider's, on the
 * channels that have none. A channel that has any keeps them whatever the
 * extra guide says, and a channel in neither stays as it was. `into` is
 * changed and returned. `prepare` is how a list is made ready to draw
 * (source.ts passes normalizeProgrammes), applied to the ones that go in.
 */
export function fillGaps(
  into: Map<string, Programme[]>,
  fills: ReadonlyMap<string, Programme[]> | undefined,
  prepare: (list: Programme[]) => Programme[] = (l) => l,
): Map<string, Programme[]> {
  if (!fills) return into;
  for (const [id, list] of fills) {
    if (hasProgrammes(into, id) || list.length === 0) continue;
    into.set(id, prepare(list));
  }
  return into;
}

/**
 * The channels the Fix guide dialog lists: the provider's guide's, then the
 * extra guide's that the first did not already name. An id is listed once,
 * the provider's entry standing. `base` may be undefined (a playlist whose
 * guide was never read) and `extra` empty (nothing to add).
 */
export function listBothGuides(
  base: readonly GuideChannel[] | undefined,
  extra: readonly GuideChannel[] | undefined,
): GuideChannel[] {
  const out = [...(base ?? [])];
  if (!extra?.length) return out;
  const seen = new Set(out.map((c) => c.id));
  for (const c of extra) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

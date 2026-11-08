import { groupSources } from "../../stream/mapper";
import type { StreamSource } from "../../stream/model";

/**
 * What Fluent's source list shows of a title's sources: the pills above it
 * and the order under the Sort box. Pure, over the same StreamSource the
 * addon's list is, so nothing here can change what plays: the list hands the
 * ORIGINAL array's order on as the fallback queue (SourceListView).
 */

export type SourceSort = "best" | "quality";

/** "All", then each quality the list has (highest first), then "Cached" when
 * any source is. Built from the data, so a list of 1080p only has no 4K pill. */
export function filterPills(sources: StreamSource[]): { key: string; label: string }[] {
  const seen = [...new Set(sources.map((s) => s.quality))];
  seen.sort((a, b) => rank(b) - rank(a));
  return [
    { key: "all", label: "All" },
    ...seen.map((q) => ({ key: `q:${q}`, label: q })),
    ...(sources.some((s) => s.cache === "cached") ? [{ key: "cached", label: "Cached" }] : []),
  ];
}

/** The resolution as a number, 0 for a label that has none ("SD"). */
function rank(quality: string): number {
  const m = /(\d{3,4})p/i.exec(quality);
  return m ? Number(m[1]) : 0;
}

/** The rows to draw. Best Match is what the list has always drawn (cached
 * first, the addon's order inside each group, see groupSources); Quality is
 * the resolution, highest first, keeping that order between equals. */
export function viewSources(sources: StreamSource[], filter: string, sort: SourceSort): StreamSource[] {
  const best = groupSources(sources).flatMap((g) => g.sources);
  const kept = best.filter((s) =>
    filter === "all" ? true : filter === "cached" ? s.cache === "cached" : `q:${s.quality}` === filter,
  );
  return sort === "quality" ? [...kept].sort((a, b) => rank(b.quality) - rank(a.quality)) : kept;
}

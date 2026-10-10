/**
 * The keys of a tablist, shared by the two controls that wear one: Segmented
 * (a row, `role="tabs"`) and Rail (a column, Settings' pages).
 *
 * Arrows step to the next or previous option and wrap, Home and End jump to
 * the ends. Both axes work in both orientations, as they always have on the
 * segmented row, so a tablist never has a dead arrow. Returns the index to
 * move to, or null for a key that is not ours (the caller then leaves the
 * event alone).
 */
export function tabKeyTarget(key: string, from: number, count: number): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (from + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (from - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

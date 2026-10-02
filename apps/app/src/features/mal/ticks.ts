import { useEffect, useState } from "react";
import { malWatchedEpisodes } from "../stream/animemap";
import type { VodItem } from "../stream/model";
import { setMalWatched } from "../stream/watched";
import { MAL_SYNCED, loadMal } from "./store";
import { indexesFor } from "./sync";

/**
 * A series page's episodes that MAL counts as watched (plan 021, D2 b),
 * written where loadWatched reads them. Runs when the page's seasons are
 * in and again after each MAL sync; the number it returns changes when the
 * ticks did, for the page to re-read.
 */
export function useMalTicks(item: Pick<VodItem, "id" | "genres" | "seasons">): number {
  const [version, bump] = useState(0);
  useEffect(() => {
    if (!item.seasons.length) return;
    let live = true;
    const run = async () => {
      const { lastSync, counts } = loadMal();
      if (!lastSync) return;
      const idx = await indexesFor(item.id, item);
      if (!idx || !live) return;
      const byMal = new Map(Object.entries(counts).map(([k, n]) => [Number(k), n]));
      if (setMalWatched(item.id, malWatchedEpisodes(item.id, item.seasons, idx, byMal))) bump((n) => n + 1);
    };
    const onSynced = () => void run();
    void run();
    window.addEventListener(MAL_SYNCED, onSynced);
    return () => {
      live = false;
      window.removeEventListener(MAL_SYNCED, onSynced);
    };
  }, [item]);
  return version;
}

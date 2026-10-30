import { useEffect, useState } from "react";
import { discoverKey, itemKey, loadDiscover, searchDiscover, type DiscoverConfig } from "../discover/data";
import type { VodItem } from "../stream/model";

/**
 * Titles in the palette: the search Discover runs, asked from Ctrl+K.
 *
 * It is `searchDiscover` itself, with the "all" filter, so a title found here
 * is the one Discover would list first, and a playlist's library comes with
 * it (Discover's search reads the Xtream libraries in memory). Nothing is
 * copied. What is new is only when to ask: after a pause in typing, never
 * twice at once, and never letting an older answer stand in for a newer
 * question.
 */

/** The pause after the last key before the network is asked. */
export const TITLE_DELAY_MS = 300;
/** The most titles one query lists. */
export const TITLE_ROWS = 5;
/** Two letters, as Discover's own search needs. */
export const TITLE_MIN = 2;

/** How long a loaded Discover config is reused. Its sources can move without
 * the key moving (a library that lands late), so it is not kept for good. */
const CONFIG_TTL_MS = 5 * 60_000;
let held: { key: string; at: number; cfg: Promise<DiscoverConfig> } | null = null;

/**
 * Discover's config (the manifest, the libraries), loaded once and reused
 * while the same sources are signed in. `loadDiscover` is a manifest fetch
 * and a library read: too much to repeat on every pause in typing. Throws
 * when there is nothing to search, as it does for Discover.
 */
function config(): Promise<DiscoverConfig> {
  const key = discoverKey();
  if (held && held.key === key && Date.now() - held.at < CONFIG_TTL_MS) return held.cfg;
  const cfg = loadDiscover();
  const mine = { key, at: Date.now(), cfg };
  held = mine;
  // A failure is not kept: signing in later must not meet the old "no".
  cfg.catch(() => {
    if (held === mine) held = null;
  });
  return cfg;
}

const askDiscover = (q: string): Promise<VodItem[]> => config().then((cfg) => searchDiscover(cfg, "all", q));

/** What one query came back with. A failed ask has no items and says so, so
 * the palette never reads a source it couldn't reach as "nothing matches". */
export interface TitleAnswer {
  q: string;
  items: VodItem[];
  failed?: boolean;
}

/**
 * Ask for `q` after the pause. Returns the cancel: calling it drops the
 * pending ask AND any answer still on its way, so a slow answer for an old
 * query can never be delivered after a newer one was asked. Pure of React so
 * the guard has a unit test.
 */
export function runTitleSearch(
  q: string,
  ask: (q: string) => Promise<VodItem[]>,
  done: (a: TitleAnswer) => void,
  delay = TITLE_DELAY_MS,
): () => void {
  let stale = false;
  const t = setTimeout(() => {
    ask(q).then(
      (items) => !stale && done({ q, items }),
      () => !stale && done({ q, items: [], failed: true }),
    );
  }, delay);
  return () => {
    stale = true;
    clearTimeout(t);
  };
}

/** The first `n` titles that the palette does not already list. */
export function pickTitles(items: VodItem[], have: ReadonlySet<string>, n = TITLE_ROWS): VodItem[] {
  return items.filter((i) => !have.has(itemKey(i))).slice(0, n);
}

/** One array, so a render with no answer does not look like a new one. */
const NONE: VodItem[] = [];

/**
 * The titles for `q` ("" is not searching). `searching` is true from the
 * first key until the answer FOR THIS QUERY lands: the answer is held with the
 * query it was asked for, so a late one for another query is never shown.
 */
export function useTitleSearch(q: string): { searching: boolean; failed: boolean; items: VodItem[] } {
  const [got, setGot] = useState<TitleAnswer | null>(null);
  useEffect(() => {
    // An answer is for this ask only: cleared when the query changes or the
    // palette closes ("" is closed), so reopening never shows an old one.
    setGot(null);
    return q ? runTitleSearch(q, askDiscover, setGot) : undefined;
  }, [q]);
  const answer = q && got?.q === q ? got : null;
  return { searching: !!q && !answer, failed: !!answer?.failed, items: answer?.items ?? NONE };
}

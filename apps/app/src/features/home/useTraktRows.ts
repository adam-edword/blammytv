import { useEffect, useState } from "react";
import { loadRowCap } from "../settings/rowCap";
import { traktStatus } from "../trakt/client";
import { TRAKT_SYNCED } from "../trakt/store";
import type { ListEntry } from "../stream/myList";
import { TRAKT_LISTS, type HomeRow, type TraktList } from "./layout";
import { fetchTraktRow } from "./traktRows";

/**
 * The titles behind Home's Trakt rows (plan 033, phase 3), asked for only
 * while Home is up and only for a row that is on, and only when signed in to
 * Trakt: no row, no request. No polling. An answer is kept for ten minutes, so
 * Back from a title (which draws Home again) does not ask four more times; one
 * that failed is not kept, and the next visit asks again. What is kept is the
 * request itself, so two readers at once (StrictMode's second effect, a Home
 * drawn again) share one.
 */

const TTL = 10 * 60_000;
const kept = new Map<TraktList, { at: number; entries: Promise<ListEntry[] | null> }>();

export type TraktRows = Partial<Record<TraktList, ListEntry[]>>;

export function useTraktRows(layout: readonly HomeRow[] | undefined, onHome: boolean): TraktRows {
  const wanted = TRAKT_LISTS.filter((l) => onHome && layout?.some((r) => r.kind === "trakt" && r.list === l && r.on));
  const key = wanted.join();
  const [data, setData] = useState<TraktRows>({});
  // A sign-in or sign-out in Settings, over Home: ask again (answers are kept,
  // so this costs no request while signed in).
  const [account, setAccount] = useState(0);
  useEffect(() => {
    const bump = () => setAccount((n) => n + 1);
    window.addEventListener(TRAKT_SYNCED, bump);
    return () => window.removeEventListener(TRAKT_SYNCED, bump);
  }, []);
  useEffect(() => {
    if (!key) return;
    let live = true;
    void (async () => {
      const s = await traktStatus();
      if (!s.configured || !s.connected) {
        // Signed out since the last visit: what was kept goes with the sign-in.
        kept.clear();
        if (live) setData({});
        return;
      }
      const limit = loadRowCap();
      await Promise.all(
        key.split(",").map(async (l) => {
          const list = l as TraktList;
          let hit = kept.get(list);
          if (!hit || Date.now() - hit.at >= TTL) {
            hit = { at: Date.now(), entries: fetchTraktRow(list, limit) };
            kept.set(list, hit);
          }
          const entries = await hit.entries;
          // A failure is not kept: the next visit asks again.
          if (!entries && kept.get(list) === hit) kept.delete(list);
          if (live) setData((d) => ({ ...d, [list]: entries ?? [] }));
        }),
      );
    })();
    return () => {
      live = false;
    };
  }, [key, account]);
  return data;
}

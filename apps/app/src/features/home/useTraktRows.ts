import { useEffect, useState } from "react";
import { loadRowCap } from "../settings/rowCap";
import { traktStatus } from "../trakt/client";
import { TRAKT_SYNCED } from "../trakt/store";
import type { ListEntry } from "../stream/myList";
import { TRAKT_LISTS, type HomeRow, type TraktList } from "./layout";
import { forgetRows, keptRow } from "./traktRows";

/**
 * The titles behind Home's Trakt rows (plan 033, phase 3), asked for only
 * while Home is up and only for a row that is on, and only when signed in to
 * Trakt: no row, no request. No polling. An answer is kept for ten minutes
 * (`keptRow`), so Back from a title (which draws Home again) does not ask four
 * more times, and two readers at once (StrictMode's second effect, a Home
 * drawn again) share one request.
 */

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
        forgetRows();
        if (live) setData({});
        return;
      }
      const limit = loadRowCap();
      await Promise.all(
        key.split(",").map(async (l) => {
          const list = l as TraktList;
          const entries = await keptRow(list, limit);
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

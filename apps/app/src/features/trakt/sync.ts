/**
 * One sync with Trakt (plan 015, B4 and B5): what was watched elsewhere,
 * where you left off, and the watchlist. It runs at launch, when the window
 * comes back after a while away, and from Sync now.
 *
 * Each pass opens with `/sync/last_activities`, one call that stamps every
 * section, and fetches only the sections whose stamp moved since the last
 * pass (Trakt's own advice: "cache these dates locally and compare them
 * before syncing"). The rules themselves are pure and tested elsewhere:
 * history.ts, progress.ts, merge.ts. This file carries them out and writes
 * down what actually happened.
 */

import { useEffect } from "react";
import { loadLists, removeFromList, addEntries, ensureTraktList, TRAKT_LIST, TRAKT_LIST_CHANGED } from "../stream/lists";
import type { ListEntry } from "../stream/myList";
import { loadLedger, replaceLedger } from "../stream/watched";
import { loadWatching, onWatchingCleared, replaceWatching, retiredFromContinue } from "../stream/watching";
import { traktJson, traktStatus } from "./client";
import { historyToPush, ledgerFromTrakt, moviesFromTrakt, withQueued, type HistoryBody, type WatchedMovie, type WatchedShow } from "./history";
import { imdbOf, type TraktIds } from "./ids";
import { mergeWatchlist } from "./merge";
import { mergeProgress, type Playback } from "./progress";
import { dropFromQueue, forgetCount, loadQueue, loadTrakt, saveTrakt, settled, TRAKT_SYNCED } from "./store";

/** `/sync/watchlist/:type`, the fields used. */
interface WatchlistItem {
  listed_at: string;
  type: "movie" | "show";
  movie?: { title?: string; year?: number; ids: TraktIds };
  show?: { title?: string; year?: number; ids: TraktIds };
}

export interface SyncResult {
  ok: boolean;
  /** Something a screen shows changed. */
  changed: boolean;
  problem?: string;
}

/** `{ movies: { watched_at } }` → `{ "movies.watched_at": … }`. */
export function flatten(activities: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [section, v] of Object.entries(activities)) {
    if (typeof v === "string") out[section] = v;
    else if (v && typeof v === "object")
      for (const [k, t] of Object.entries(v)) if (typeof t === "string") out[`${section}.${k}`] = t;
  }
  return out;
}

/** Whether any of these stamps moved (or were never seen). */
export function moved(before: Record<string, string> | undefined, now: Record<string, string>, keys: string[]): boolean {
  if (!before) return true;
  return keys.some((k) => before[k] !== now[k]);
}

/** Send the queued watches, one history entry each, and answer with the ones
 * Trakt settled (store.ts `settled`). The rest stay queued for the next pass. */
export async function sendQueued(queue: readonly HistoryBody[]): Promise<HistoryBody[]> {
  const sent: HistoryBody[] = [];
  for (const body of queue) {
    const r = await traktJson("POST", "/sync/history", body).catch(() => null);
    if (r && settled(r.status)) sent.push(body);
  }
  return sent;
}

let running: Promise<SyncResult> | null = null;

/** One pass. Concurrent callers share it. Never throws. */
export function syncTrakt(): Promise<SyncResult> {
  if (!running) running = pass().finally(() => (running = null));
  return running;
}

async function pass(): Promise<SyncResult> {
  const status = await traktStatus();
  if (!status.connected) return { ok: false, changed: false, problem: "not connected" };
  // A sign-out while this pass waits on Trakt: stop, and write nothing back
  // into the store it just cleared (a Trakt Watchlist list would come back
  // that nothing can remove).
  const gen = forgetCount();
  const gone = () => forgetCount() !== gen;
  const overtaken: SyncResult = { ok: false, changed: false, problem: "signed out" };
  let changed = false;
  try {
    // Watches that finished while Trakt could not be reached go first, so
    // the ledger that comes back includes them.
    const queue = loadQueue();
    if (queue.length) {
      const sent = await sendQueued(queue);
      if (gone()) return overtaken;
      dropFromQueue(sent);
    }

    const acts = await traktJson<Record<string, unknown>>("GET", "/sync/last_activities");
    if (gone()) return overtaken;
    if (acts.status === 401 || !acts.data) return fail(acts.status === 401 ? "Signed out of Trakt" : `Trakt answered ${acts.status}`);
    const now = flatten(acts.data);
    const local = loadTrakt();
    const before = local.activities;

    // What was watched (T3). The first pass sends what was ticked here
    // first, once; after that, Trakt is the ledger.
    if (!local.pushedHistory || moved(before, now, ["episodes.watched_at", "movies.watched_at"])) {
      let shows = await traktJson<WatchedShow[]>("GET", "/sync/watched/shows");
      let films = await traktJson<WatchedMovie[]>("GET", "/sync/watched/movies");
      if (!shows.data || !films.data) return fail(`Trakt answered ${shows.status}`);
      if (!local.pushedHistory) {
        const finished = new Map(
          loadWatching()
            .filter((e) => e.kind === "movie" && retiredFromContinue(e))
            .map((e) => [e.id, e.at] as const),
        );
        const body = historyToPush(loadLedger(), ledgerFromTrakt(shows.data), finished, moviesFromTrakt(films.data));
        if (body) {
          const r = await traktJson("POST", "/sync/history", body);
          if (r.status >= 300) return fail(`Trakt refused the watched history (${r.status})`);
          shows = await traktJson<WatchedShow[]>("GET", "/sync/watched/shows");
          films = await traktJson<WatchedMovie[]>("GET", "/sync/watched/movies");
          if (!shows.data || !films.data) return fail(`Trakt answered ${shows.status}`);
        }
        if (gone()) return overtaken;
        saveTrakt({ pushedHistory: true });
      }
      if (gone()) return overtaken;
      replaceLedger(withQueued(ledgerFromTrakt(shows.data), loadQueue()));
      saveTrakt({ movies: moviesFromTrakt(films.data) });
      changed = true;
    }

    // Where you left off (T4).
    if (moved(before, now, ["movies.paused_at", "episodes.paused_at"])) {
      const pb = await traktJson<Playback[]>("GET", "/sync/playback?extended=full");
      if (gone()) return overtaken;
      if (pb.data) {
        replaceWatching(mergeProgress(loadWatching(), pb.data));
        changed = true;
      }
    }

    // The watchlist (T5, D2, D3). Run every pass: a change made here has no
    // stamp on Trakt's side, and the merge is cheap when nothing moved.
    if (await syncWatchlist(gone)) changed = true;
    if (gone()) return overtaken;

    saveTrakt({ lastSync: Date.now(), activities: now, problem: undefined });
    if (changed) window.dispatchEvent(new Event(TRAKT_SYNCED));
    return { ok: true, changed };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  function fail(problem: string): SyncResult {
    if (gone()) return overtaken;
    saveTrakt({ problem });
    if (changed) window.dispatchEvent(new Event(TRAKT_SYNCED));
    return { ok: false, changed, problem };
  }
}

async function syncWatchlist(gone: () => boolean): Promise<boolean> {
  if (gone()) return false;
  ensureTraktList();
  const movies = await traktJson<WatchlistItem[]>("GET", "/sync/watchlist/movies");
  const shows = await traktJson<WatchlistItem[]>("GET", "/sync/watchlist/shows");
  if (gone() || !movies.data || !shows.data) return false;

  const remote = new Map<string, number>();
  const remoteInfo = new Map<string, ListEntry>();
  for (const it of [...movies.data, ...shows.data]) {
    const m = it.type === "movie" ? it.movie : it.show;
    const id = m?.ids.imdb ? imdbOf(m.ids.imdb) : null;
    if (!m || !id) continue;
    const at = Date.parse(it.listed_at) || 0;
    remote.set(id, at);
    remoteInfo.set(id, {
      id,
      title: m.title ?? id,
      kind: it.type === "movie" ? "movie" : "series",
      ...(m.year != null ? { year: m.year } : {}),
      at,
    });
  }
  const list = loadLists().find((l) => l.id === TRAKT_LIST);
  const mine = new Map((list?.entries ?? []).filter((e) => imdbOf(e.id)).map((e) => [e.id, e.at] as const));
  const kindOf = new Map((list?.entries ?? []).map((e) => [e.id, e.kind] as const));
  const plan = mergeWatchlist(loadTrakt().watchlistBase ?? null, mine, remote);

  const body = (ids: string[]) => {
    const films = ids.filter((id) => kindOf.get(id) !== "series").map((id) => ({ ids: { imdb: id } }));
    const series = ids.filter((id) => kindOf.get(id) === "series").map((id) => ({ ids: { imdb: id } }));
    return { ...(films.length ? { movies: films } : {}), ...(series.length ? { shows: series } : {}) };
  };
  const refused = new Set<string>();
  const unremoved = new Set<string>();
  if (plan.addRemote.length) {
    const r = await traktJson<{ not_found?: { movies?: { ids: TraktIds }[]; shows?: { ids: TraktIds }[] } }>(
      "POST",
      "/sync/watchlist",
      body(plan.addRemote),
    );
    if (r.status === 420) {
      plan.addRemote.forEach((id) => refused.add(id));
      saveTrakt({ capped: { count: plan.addRemote.length, limit: r.reply.account_limit ?? null } });
    } else if (r.status >= 300) {
      plan.addRemote.forEach((id) => refused.add(id));
    } else {
      for (const nf of [...(r.data?.not_found?.movies ?? []), ...(r.data?.not_found?.shows ?? [])])
        if (nf.ids.imdb) refused.add(nf.ids.imdb);
      saveTrakt({ capped: undefined });
    }
  }
  if (plan.removeRemote.length) {
    // Kinds of titles gone from here are unknown now; Trakt's own copy
    // says which they were.
    const films = plan.removeRemote.filter((id) => remoteInfo.get(id)?.kind === "movie").map((id) => ({ ids: { imdb: id } }));
    const series = plan.removeRemote.filter((id) => remoteInfo.get(id)?.kind === "series").map((id) => ({ ids: { imdb: id } }));
    const r = await traktJson("POST", "/sync/watchlist/remove", {
      ...(films.length ? { movies: films } : {}),
      ...(series.length ? { shows: series } : {}),
    });
    // Not taken: they stay in the agreed copy, so the next pass removes
    // them again. Left out, a title still on Trakt and gone from the copy
    // reads as newly added there, and would come back here.
    if (r.status >= 300) plan.removeRemote.forEach((id) => unremoved.add(id));
  }
  if (gone()) return false;
  if (plan.addLocal.length) addEntries(TRAKT_LIST, plan.addLocal.map((id) => remoteInfo.get(id)!).filter(Boolean));
  for (const id of plan.removeLocal) removeFromList(TRAKT_LIST, id);

  saveTrakt({ watchlistBase: { ids: [...plan.final.filter((id) => !refused.has(id)), ...unremoved], at: Date.now() } });
  return plan.addLocal.length > 0 || plan.removeLocal.length > 0;
}

/**
 * Clear Trakt's paused positions for titles cleared here. Looked up by
 * title at the time rather than by the id the entry learned at the last
 * sync: playing a title here rewrites its entry, and a pause since then
 * has a new id on Trakt the entry has not seen yet. A series' card takes
 * every paused episode of it.
 */
export async function forgetPaused(gone: readonly { id: string }[]): Promise<void> {
  const ids = new Set(gone.map((e) => e.id).filter((id) => imdbOf(id)));
  if (!ids.size || !(await traktStatus()).connected) return;
  const pb = await traktJson<Playback[]>("GET", "/sync/playback");
  for (const p of pb.data ?? []) {
    const imdb = p.type === "episode" ? p.show?.ids.imdb : p.movie?.ids.imdb;
    if (imdb && ids.has(imdb)) await traktJson("DELETE", `/sync/playback/${p.id}`);
  }
}

/** How long away before coming back syncs again. */
const AWAY_MS = 15 * 60_000;

/** After a save to the Trakt Watchlist, how long before it is sent, so a
 * few in a row go together. */
const SOON_MS = 5000;

/** Sync at launch, when the window comes back after a while, and soon after
 * the Trakt Watchlist changes here. Mounted once, at the root. Does nothing
 * until Trakt is connected. */
export function useTraktSync(): void {
  useEffect(() => {
    void syncTrakt();
    const onFocus = () => {
      const last = loadTrakt().lastSync ?? 0;
      if (Date.now() - last > AWAY_MS) void syncTrakt();
    };
    let soon = 0;
    const onList = () => {
      window.clearTimeout(soon);
      soon = window.setTimeout(() => void syncTrakt(), SOON_MS);
    };
    // A card cleared here: its paused position goes on Trakt too.
    const offCleared = onWatchingCleared((gone) => void forgetPaused(gone).catch(() => {}));
    window.addEventListener("focus", onFocus);
    window.addEventListener(TRAKT_LIST_CHANGED, onList);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(TRAKT_LIST_CHANGED, onList);
      window.clearTimeout(soon);
      offCleared();
    };
  }, []);
}

/**
 * One sync with AIOStreams (plan 023, A3 and A5): what was watched in its
 * other apps, where you left off, and what is next. It runs at launch, when
 * the window comes back after a while away, and from Sync now.
 *
 * AIOStreams has no "changed since", so every pass reads the lists whole.
 * Every one is a LIST route with `Fields=ProviderIds`: never `GET /Items/{id}`
 * on a film or an episode, which runs AIOStreams' whole stream search, the
 * same work as pressing play. The rules that turn its answers into this
 * app's shapes are pure and tested in rules.ts; this file carries them out
 * and writes down what happened. Each pass, in order:
 *
 *  1. the played marks that could not be sent go first;
 *  2. resume points join Continue Watching (newest wins, D3);
 *  3. the played list, read a page at a time, replaces `aioWatched`, the
 *     AIOStreams ticks (D3);
 *  4. Next Up and Upcoming are stored for the rows under Continue Watching;
 *  5. one log line: counts, and how many items did not decode.
 */

import { useEffect } from "react";
import { isFinished, loadWatching, onWatchingCleared, replaceWatching, type WatchEntry } from "../stream/watching";
import { loadAioWatched, replaceAioWatched } from "../stream/watched";
import { TRAKT_SYNCED } from "../trakt/store";
import { scrubbedMessage } from "../../lib/errors";
import { aioCall, readSignIn } from "./account";
import { aiojfStatus } from "./client";
import { packedFor } from "./report";
import { itemRef, mergeAioProgress, playedFrom, resumeFrom, upNextFrom, type BaseItem } from "./rules";
import {
  AIOJF_SYNCED,
  dropFromQueue,
  forgetAiojf,
  forgetCount,
  loadAiojf,
  loadQueue,
  playedSettled,
  saveAiojf,
  type AiojfLocal,
} from "./store";

export interface SyncResult {
  ok: boolean;
  /** Something a screen shows changed. */
  changed: boolean;
  problem?: string;
}

/** The most played items one pass reads. AIOStreams reads at most 500 played
 * rows per user (watch-state.ts `listPlayed`) and answers any one request with
 * no more than its `browseLimit`: 250 by default, 100 when the instance sets
 * `maxCatalogItems` to 0 (library.ts). One request is not the whole list, so
 * it is read a page at a time (`readPlayed`). */
export const PLAYED_MAX = 500;
/** Continue Watching keeps 20 (watching.ts), AIOStreams answers 12 unasked. */
const RESUME_LIMIT = "20";
const UP_LIMIT = "20";

/** Send the queued played marks, and answer with the ones AIOStreams settled
 * (store.ts `playedSettled`). The rest stay queued for the next pass. A 401
 * ends it: the rest would all be refused. */
export async function sendQueued(
  queue: readonly string[],
  post: (packedId: string) => Promise<{ status: number } | null>,
): Promise<string[]> {
  const sent: string[] = [];
  for (const id of queue) {
    const r = await post(id).catch(() => null);
    if (r?.status === 401) break;
    if (r && playedSettled(r.status)) sent.push(id);
  }
  return sent;
}

let running: Promise<SyncResult> | null = null;

/** One pass. Concurrent callers share it. Never throws. */
export function syncAiojf(): Promise<SyncResult> {
  if (!running) running = pass().finally(() => (running = null));
  return running;
}

interface Listed {
  items: BaseItem[] | null;
  status: number;
  /** `TotalRecordCount`, when the answer had one. */
  total?: number;
}

async function list(path: string, query: Record<string, string>): Promise<Listed> {
  const r = await aioCall<{ Items?: BaseItem[]; TotalRecordCount?: number }>("GET", path, { query });
  const total = r.data?.TotalRecordCount;
  return {
    items: Array.isArray(r.data?.Items) ? r.data.Items : null,
    status: r.status,
    ...(typeof total === "number" ? { total } : {}),
  };
}

/**
 * The played list, a page at a time: `StartIndex` from 0, each page's items
 * added, until a page comes back empty, the total is reached, or `PLAYED_MAX`
 * items are in. A page that fails ends the read with no list at all, never a
 * partial one: the caller replaces the ledger whole, and the missing pages
 * would un-tick everything past them.
 */
export async function readPlayed(page: (startIndex: number, limit: number) => Promise<Listed>): Promise<Listed> {
  const items: BaseItem[] = [];
  let status = 200;
  while (items.length < PLAYED_MAX) {
    const r = await page(items.length, PLAYED_MAX - items.length);
    status = r.status;
    if (!r.items) return { items: null, status };
    items.push(...r.items);
    if (r.items.length === 0 || (r.total !== undefined && items.length >= r.total)) break;
  }
  return { items: items.slice(0, PLAYED_MAX), status };
}

/** What did not decode: not a film, a show or an episode in this app's ids. */
const undecoded = (items: readonly BaseItem[]) => items.filter((i) => itemRef(i) === null).length;

async function pass(): Promise<SyncResult> {
  // Also brings the sign-in this device holds (plan 024) in step with it.
  const status = await readSignIn();
  if (!status.connected) {
    // The vault is empty but this device still holds an account's data: the
    // token was dropped outside the app (or a 401 was missed).
    if (status.supported && (loadAiojf().lastSync || loadQueue().length)) {
      forgetAiojf();
      window.dispatchEvent(new Event(AIOJF_SYNCED));
    }
    return { ok: false, changed: false, problem: "not connected" };
  }
  // A sign-out while this pass waits on AIOStreams: stop, and write nothing
  // back into the store it just cleared.
  const gen = forgetCount();
  const gone = () => forgetCount() !== gen;
  const overtaken: SyncResult = { ok: false, changed: false, problem: "signed out" };
  // The token already names the user; the id rides along as Jellyfin apps send it.
  const user: Record<string, string> = status.userId ? { userId: status.userId } : {};
  const fields: Record<string, string> = { Fields: "ProviderIds" };
  let changed = false;
  let watchingChanged = false;
  let problem: string | undefined;
  const note = (what: string, status: number) => {
    problem ??= status === 401 ? "Signed out of AIOStreams" : `AIOStreams answered ${status} for ${what}`;
  };
  try {
    // 1. Marks that could not be sent go first, so the played list that
    // comes back includes them.
    const queue = loadQueue();
    if (queue.length) {
      const sent = await sendQueued(queue, (id) => aioCall("POST", `/UserPlayedItems/${id}`));
      if (gone()) return overtaken;
      dropFromQueue(sent);
    }

    // 2. Where you left off.
    const resume = await list("/UserItems/Resume", { ...user, ...fields, Limit: RESUME_LIMIT });
    if (gone()) return overtaken;
    if (resume.status === 401) return fail("Signed out of AIOStreams");
    let skipped = 0;
    let resumed = 0;
    if (resume.items) {
      const points = resumeFrom(resume.items, Date.now());
      resumed = points.length;
      skipped += undecoded(resume.items);
      const now = loadWatching();
      const next = mergeAioProgress(now, points);
      if (JSON.stringify(next) !== JSON.stringify(now)) {
        replaceWatching(next);
        watchingChanged = true;
        changed = true;
      }
    } else note("what you were watching", resume.status);

    // 3. What was watched. Replaced whole, so un-marking elsewhere un-ticks.
    const played = await readPlayed((startIndex, limit) =>
      list("/Items", {
        ...user,
        ...fields,
        Recursive: "true",
        IsPlayed: "true",
        IncludeItemTypes: "Movie,Episode",
        StartIndex: String(startIndex),
        Limit: String(limit),
      }),
    );
    if (gone()) return overtaken;
    if (played.status === 401) return fail("Signed out of AIOStreams");
    let ticks = 0;
    let films = 0;
    if (played.items) {
      const p = playedFrom(played.items);
      skipped += p.skipped;
      films = p.films.length;
      ticks = Object.values(p.episodes).reduce((n, l) => n + l.length, 0);
      if (replaceAioWatched({ episodes: p.episodes, films: p.films })) changed = true;
    } else note("what you watched", played.status);

    // 4. What is next. Kept for the home rows, with the base their art is
    // fetched from (images need no token).
    const nextUp = await list("/Shows/NextUp", { ...user, ...fields, Limit: UP_LIMIT });
    const upcoming = await list("/Shows/Upcoming", { ...user, ...fields, Limit: UP_LIMIT });
    if (gone()) return overtaken;
    if (nextUp.status === 401 || upcoming.status === 401) return fail("Signed out of AIOStreams");
    const patch: Partial<AiojfLocal> = {};
    let ups = 0;
    if (nextUp.items) {
      patch.nextUp = upNextFrom(nextUp.items);
      ups += patch.nextUp.length;
      skipped += undecoded(nextUp.items);
    } else note("Next Up", nextUp.status);
    if (upcoming.items) {
      patch.upcoming = upNextFrom(upcoming.items);
      ups += patch.upcoming.length;
      // A film that premieres ahead is not an episode and has no card; it did
      // decode, so only the episodes are counted against.
      skipped += undecoded(upcoming.items.filter((i) => i.Type === "Episode"));
    } else note("Upcoming", upcoming.status);
    if (status.base) patch.base = status.base;
    const prev = loadAiojf();
    const rows = (l: Partial<AiojfLocal>) => JSON.stringify([l.nextUp, l.upcoming, l.base]);
    if (rows({ ...prev, ...patch }) !== rows(prev)) changed = true;
    saveAiojf({ ...patch, lastSync: Date.now(), problem });

    // 5. What it did, for a first run to read: how many items AIOStreams had
    // that this app has no id for, and how many plays could not be reported.
    console.info(
      `[aiojf] sync: ${resumed} resume, ${ticks} episodes and ${films} films played, ${ups} next up and upcoming; ` +
        `${skipped} didn't decode, ${loadAiojf().unpackable ?? 0} plays had no id to report`,
    );

    if (watchingChanged) window.dispatchEvent(new Event(TRAKT_SYNCED));
    window.dispatchEvent(new Event(AIOJF_SYNCED));
    return { ok: !problem, changed, ...(problem ? { problem } : {}) };
  } catch (e) {
    return fail(scrubbedMessage(e));
  }

  function fail(why: string): SyncResult {
    if (gone()) return overtaken;
    saveAiojf({ problem: why });
    if (watchingChanged) window.dispatchEvent(new Event(TRAKT_SYNCED));
    window.dispatchEvent(new Event(AIOJF_SYNCED));
    return { ok: false, changed, problem: why };
  }
}

/**
 * Clear AIOStreams' resume point for the cards cleared here, or the next sync
 * brings them back (as trakt/sync.ts `forgetPaused` does for Trakt: a card
 * cleared here clears there). A stop at position 0 is how a Jellyfin client
 * clears one, and AIOStreams records it as that (playstate.ts, local-provider.ts
 * `stopPatch`). The id is the episode's for a show, else the title's.
 *
 * Never for a finished card, one with no position, or one AIOStreams has as
 * played: a stop below the line writes `played: false`, and a played mark is
 * never removed from here (plan 023, D3). Best effort: a
 * failure is silent, and nothing goes out when not signed in.
 */
export async function forgetResume(gone: readonly WatchEntry[]): Promise<void> {
  // Only a card with a position to clear. One AIOStreams counts as played is
  // left alone too: a stop at 0 on it would un-play it there (D3).
  const played = loadAioWatched();
  const playedThere = (e: WatchEntry) =>
    e.episodeId ? (played.episodes[e.id] ?? []).includes(e.episodeId) : played.films.includes(e.id);
  const open = gone.filter((e) => !!e.posSec && !isFinished(e) && !playedThere(e));
  if (!open.length) return;
  const status = await aiojfStatus();
  if (!status.connected) return;
  for (const e of open) {
    const id = packedFor(
      {
        itemId: e.id,
        kind: e.episodeId || e.kind === "series" ? "series" : "movie",
        episodeId: e.episodeId,
        season: e.season,
      },
      status.base,
    );
    if (id) await aioCall("POST", `/UserItems/${id}/UserData`, { body: { PlaybackPositionTicks: 0 } }).catch(() => null);
  }
}

/** How long away before coming back syncs again. */
const AWAY_MS = 15 * 60_000;

/** Sync at launch and when the window comes back after a while. Mounted once,
 * at the root. Does nothing until AIOStreams' sync is connected. */
export function useAiojfSync(): void {
  useEffect(() => {
    void syncAiojf();
    const onFocus = () => {
      const last = loadAiojf().lastSync ?? 0;
      if (Date.now() - last > AWAY_MS) void syncAiojf();
    };
    // A card cleared here: its resume point goes on AIOStreams too.
    const offCleared = onWatchingCleared((gone) => void forgetResume(gone).catch(() => {}));
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      offCleared();
    };
  }, []);
}

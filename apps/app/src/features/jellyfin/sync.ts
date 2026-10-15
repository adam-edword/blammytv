/**
 * One sync with your own Jellyfin server (plan 027, D5): what was watched
 * elsewhere, where you left off, and what is next. It runs at launch, when the
 * window comes back after a while away, after signing in, and from Sync now.
 * The sibling of aiojf/sync.ts, and the same shape.
 *
 * Jellyfin has no "changed since", so every pass reads the lists whole. Each
 * pass, in order:
 *
 *  1. the lists: Resume, the played list (a page at a time) and Next Up;
 *  2. the shows those lists name only by id, read once (series.ts), so an
 *     episode is never keyed on a guess;
 *  3. resume points join Continue Watching, newest wins, one card per title
 *     whichever side it came from (aiojf/rules.ts `mergeAioProgress`);
 *  4. the played list replaces `jfWatched` (stream/watched.ts), so un-marking
 *     it on the server un-ticks here too;
 *  5. Next Up is stored for the row on the Stream home;
 *  6. one log line: counts, and how many items did not decode.
 *
 * What it never does: send anything to Trakt or MAL. `jfWatched` is read by the
 * ticks and by nothing that pushes (trakt/sync.ts pushes the local ledger and
 * nothing else), so an episode that Jellyfin and Trakt both know shows one tick
 * and is counted once in each. Only `UserData.Played` is a watch: `PlayCount`
 * rises on every stop (plans/027-api-facts.md #6).
 */

import { useEffect } from "react";
import { scrubbedMessage } from "../../lib/errors";
import { mergeAioProgress, type UpNextCard } from "../aiojf/rules";
import { readPlayed, type Listed } from "../aiojf/sync";
import { loadJfWatched, replaceJfWatched } from "../stream/watched";
import { isFinished, loadWatching, onWatchingCleared, replaceWatching, type WatchEntry } from "../stream/watching";
import { TRAKT_SYNCED } from "../trakt/store";
import { jfCall, readSignIn } from "./account";
import { rememberJfIds } from "./idmap";
import { titleKey } from "./ids";
import type { JfItem } from "./items";
import { playedFrom, resumeFrom, resumeKey, undecoded, upNextFrom } from "./rules";
import { readSeries, seriesKeyOf, unreadSeries } from "./series";
import { forgetCount, forgetJf, JF_CHANGED, JF_SYNCED, loadJf, loadJfConn, saveJf, type JfConn } from "./store";

export interface SyncResult {
  ok: boolean;
  /** Something a screen shows changed. */
  changed: boolean;
  problem?: string;
}

/** The most played items one pass reads, newest played first. Replacing the
 * ledger whole means anything past this would un-tick, so it is high, and a
 * server with more says so in the log. */
export const PLAYED_MAX = 5000;
/** The most asked for in one request. */
const PAGE = 500;
/** Continue Watching keeps 20 (watching.ts). */
const LIMIT = "20";

let running: Promise<SyncResult> | null = null;

/** One pass. Concurrent callers share it. Never throws. */
export function syncJf(): Promise<SyncResult> {
  if (!running) running = pass().finally(() => (running = null));
  return running;
}

async function list(conn: JfConn, path: string, query: Record<string, string>): Promise<Listed<JfItem>> {
  const r = await jfCall<{ Items?: JfItem[]; TotalRecordCount?: number }>("GET", path, {
    query: { userId: conn.userId, ...query },
  });
  const total = r.data?.TotalRecordCount;
  return {
    items: r.status === 200 && Array.isArray(r.data?.Items) ? r.data.Items : null,
    status: r.status,
    ...(typeof total === "number" ? { total } : {}),
  };
}

async function pass(): Promise<SyncResult> {
  // Also brings the sign-in this device holds in step with the native side.
  const status = await readSignIn();
  const conn = status.connected ? loadJfConn() : null;
  if (!conn) {
    // The vault is empty but this device still holds an account's data: the
    // token was dropped outside the app (or a 401 was missed).
    if (status.supported && !status.connected && loadJf().lastSync) {
      forgetJf();
      window.dispatchEvent(new Event(JF_CHANGED));
      window.dispatchEvent(new Event(JF_SYNCED));
    }
    return { ok: false, changed: false, problem: "not connected" };
  }
  // A sign-out while this pass waits on the server: stop, and write nothing
  // back into the store it just cleared.
  const gen = forgetCount();
  const gone = () => forgetCount() !== gen || loadJfConn()?.key !== conn.key;
  const overtaken: SyncResult = { ok: false, changed: false, problem: "signed out" };
  const fields = { Fields: "ProviderIds" };
  let changed = false;
  let watchingChanged = false;
  let problem: string | undefined;
  const note = (what: string, code: number) => {
    problem ??= code === 401 ? "Signed out of Jellyfin" : `Jellyfin answered ${code} for ${what}`;
  };
  try {
    // 1. The lists. Next Up passes EnableResumable=false: an episode you are
    // part way through is Continue Watching's, and the server lists it here
    // too (it is a flag, default true).
    const resume = await list(conn, "/UserItems/Resume", { ...fields, Limit: LIMIT });
    if (gone()) return overtaken;
    if (resume.status === 401) return fail("Signed out of Jellyfin");
    const played = await readPlayed<JfItem>(
      (startIndex, limit) =>
        list(conn, "/Items", {
          ...fields,
          Recursive: "true",
          IsPlayed: "true",
          IncludeItemTypes: "Movie,Episode",
          SortBy: "DatePlayed",
          SortOrder: "Descending",
          StartIndex: String(startIndex),
          Limit: String(limit),
        }),
      { max: PLAYED_MAX, chunk: PAGE },
    );
    if (gone()) return overtaken;
    if (played.status === 401) return fail("Signed out of Jellyfin");
    const nextUp = await list(conn, "/Shows/NextUp", { ...fields, Limit: LIMIT, EnableResumable: "false" });
    if (gone()) return overtaken;
    if (nextUp.status === 401) return fail("Signed out of Jellyfin");

    // 2. The shows these name only by id. When that read fails, the ledger is
    // kept as it was: replacing it from episodes that could not be keyed would
    // un-tick every one of them.
    let showsRead = true;
    try {
      await readSeries(conn, unreadSeries(conn, [...(resume.items ?? []), ...(played.items ?? []), ...(nextUp.items ?? [])]));
    } catch (e) {
      showsRead = false;
      problem ??= scrubbedMessage(e);
    }
    if (gone()) return overtaken;
    const keyOf = seriesKeyOf(conn);
    let skipped = 0;

    // 3. Where you left off.
    let resumed = 0;
    let jids: Record<string, string> | undefined;
    if (resume.items) {
      const r = resumeFrom(resume.items, keyOf, Date.now());
      resumed = r.points.length;
      jids = r.jids;
      skipped += undecoded(resume.items, keyOf);
      // A film's key is its IMDb id when it has one, and the key does not say
      // which item it is: remember it, so the card opens that item.
      rememberJfIds(
        conn.base,
        resume.items.flatMap((i): [string, string][] => {
          const k = i.Type === "Movie" ? titleKey(i) : null;
          return k && i.Id ? [[k, i.Id]] : [];
        }),
      );
      const points = r.points.map((p) => ({ ...p, from: "jf" as const }));
      const now = loadWatching();
      const next = mergeAioProgress(now, points);
      if (JSON.stringify(next) !== JSON.stringify(now)) {
        replaceWatching(next);
        watchingChanged = true;
        changed = true;
      }
    } else note("what you were watching", resume.status);

    // 4. What was watched. Replaced whole, so un-marking elsewhere un-ticks.
    let ticks = 0;
    let films = 0;
    if (played.items && showsRead) {
      const p = playedFrom(played.items, keyOf);
      skipped += p.skipped;
      films = p.films.length;
      ticks = Object.values(p.episodes).reduce((n, l) => n + l.length, 0);
      if (replaceJfWatched({ episodes: p.episodes, films: p.films })) changed = true;
      if (played.capped) console.info(`[jellyfin] sync: the played list was cut at ${PLAYED_MAX}`);
    } else if (!played.items) note("what you watched", played.status);

    // 5. What is next, with the base its art is fetched from.
    let cards: UpNextCard[] | undefined;
    if (nextUp.items) {
      cards = upNextFrom(nextUp.items, keyOf);
      skipped += undecoded(nextUp.items, keyOf);
    } else note("Next Up", nextUp.status);

    const prev = loadJf();
    const rows = (l: { nextUp?: UpNextCard[] }) => JSON.stringify(l.nextUp ?? null);
    if (cards && rows({ nextUp: cards }) !== rows(prev)) changed = true;
    saveJf({
      ...(cards ? { nextUp: cards } : {}),
      ...(jids ? { resumeJids: jids } : {}),
      lastSync: Date.now(),
      problem,
    });

    // 6. What it did, for a first run to read.
    console.info(
      `[jellyfin] sync: ${resumed} resume, ${ticks} episodes and ${films} films played, ${cards?.length ?? 0} next up; ` +
        `${skipped} didn't decode`,
    );

    if (watchingChanged) window.dispatchEvent(new Event(TRAKT_SYNCED));
    window.dispatchEvent(new Event(JF_SYNCED));
    return { ok: !problem, changed, ...(problem ? { problem } : {}) };
  } catch (e) {
    return fail(scrubbedMessage(e));
  }

  function fail(why: string): SyncResult {
    if (gone()) return overtaken;
    saveJf({ problem: why });
    if (watchingChanged) window.dispatchEvent(new Event(TRAKT_SYNCED));
    window.dispatchEvent(new Event(JF_SYNCED));
    return { ok: false, changed, problem: why };
  }
}

/**
 * A play reported from here is on the server as `jid` (the id the server's own
 * lists gave, report.ts): file it where `forgetResume` looks, so the card it
 * leaves in Continue Watching can be cleared before any sync has run since the
 * play. `gen` is `forgetCount()` from before `jid` was looked up: a sign-out
 * since then means nothing is written. The next sync replaces `resumeJids` whole.
 */
export function noteResumeJid(itemId: string, episodeId: string | undefined, jid: string, gen: number): void {
  if (forgetCount() !== gen) return;
  saveJf({ resumeJids: { ...loadJf().resumeJids, [resumeKey(itemId, episodeId)]: jid } });
}

/**
 * Clear the server's resume point for the cards cleared here, or the next sync
 * brings them back (as aiojf/sync.ts `forgetResume` does for AIOStreams). A
 * position of 0 is how Jellyfin's own clients clear one.
 *
 * Only for a card the last sync saw a resume point for, or a play made since
 * reported (`resumeJids`, ids the server gave), one with a position and not
 * finished, and not one the server counts as played: the reset writes
 * `Played: false`, and a played mark is never removed from here. Best effort: a
 * failure is silent, and nothing goes out when not signed in.
 */
export async function forgetResume(gone: readonly WatchEntry[]): Promise<void> {
  const conn = loadJfConn();
  const jids = loadJf().resumeJids;
  if (!conn || !jids) return;
  const played = loadJfWatched();
  const playedThere = (e: WatchEntry) =>
    e.episodeId ? (played.episodes[e.id] ?? []).includes(e.episodeId) : played.films.includes(e.id);
  for (const e of gone) {
    const jid = jids[resumeKey(e.id, e.episodeId)];
    if (!jid || !e.posSec || isFinished(e) || playedThere(e)) continue;
    await jfCall("POST", `/UserItems/${jid}/UserData`, {
      body: { PlaybackPositionTicks: 0, Played: false },
    }).catch(() => null);
  }
}

/** How long away before coming back syncs again. */
const AWAY_MS = 15 * 60_000;

/** Sync at launch and when the window comes back after a while. Mounted once,
 * at the root. Does nothing until a server is signed in. */
export function useJfSync(): void {
  useEffect(() => {
    void syncJf();
    const onFocus = () => {
      const last = loadJf().lastSync ?? 0;
      if (Date.now() - last > AWAY_MS) void syncJf();
    };
    // A card cleared here: its resume point goes on the server too.
    const offCleared = onWatchingCleared((gone) => void forgetResume(gone).catch(() => {}));
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      offCleared();
    };
  }, []);
}

/**
 * What you watch here goes to Trakt (plan 015, T2): start when a film or
 * an episode begins, pause when it sits still, start again when it moves,
 * and stop with the real percentage when it ends or you leave it.
 *
 * Trakt decides what counts: a stop above 80% is a watch (it answers
 * `action: "scrobble"`), 1% to 79% is saved as paused progress, under 1% is
 * refused. When Trakt says it counted, the app counts it too, so the two
 * never disagree about the line: the episode ticks, the film gets its mark.
 * A finished watch that cannot reach Trakt is queued and sent later as a
 * history entry dated when it happened (sync.ts sends the queue first).
 *
 * Its own 10s look at the player rather than hooks into the overlay's
 * buttons: a pause from the keyboard, the overlay or the pop-out all look
 * the same from here, a position that stopped moving.
 */

import { useEffect, useRef } from "react";
import { tauriMpvStatus } from "../../lib/tauri";
import { markWatched } from "../stream/watched";
import { loadWatching } from "../stream/watching";
import { traktJson, traktStatus } from "./client";
import type { HistoryBody } from "./history";
import { episodeRef, imdbOf } from "./ids";
import { loadTrakt, queueWatch, saveTrakt } from "./store";

export interface ScrobbleTarget {
  itemId: string;
  kind: "movie" | "series";
  title: string;
  year?: number;
  episodeId?: string;
  /** In the pop-out: the in-app player is not the one playing. */
  popped?: boolean;
}

/** Percent through, or null without a duration. Clamped to 0..100. */
export function percent(pos: number | null | undefined, dur: number | null | undefined): number | null {
  if (pos == null || dur == null || !(dur > 0)) return null;
  return Math.max(0, Math.min(100, (pos / dur) * 100));
}

/** Trakt's item for a scrobble, or null for a title it cannot know (D5).
 * An episode needs its own Trakt id, which `episodeTraktId` looks up. */
export function scrobbleItem(
  t: Pick<ScrobbleTarget, "itemId" | "kind" | "title" | "year" | "episodeId">,
  episodeTrakt?: number,
): Record<string, unknown> | null {
  if (t.kind === "movie") {
    const imdb = imdbOf(t.itemId);
    if (!imdb) return null;
    return { movie: { title: t.title, ...(t.year != null ? { year: t.year } : {}), ids: { imdb } } };
  }
  if (!t.episodeId || episodeTrakt == null) return null;
  return { episode: { ids: { trakt: episodeTrakt } } };
}

/** The watch to queue when a finished one could not be sent. */
export function historyFor(t: Pick<ScrobbleTarget, "itemId" | "kind" | "episodeId">, when: number): HistoryBody | null {
  const watched_at = new Date(when).toISOString();
  if (t.kind === "movie") {
    const imdb = imdbOf(t.itemId);
    return imdb ? { movies: [{ ids: { imdb }, watched_at }] } : null;
  }
  const ref = t.episodeId ? episodeRef(t.episodeId) : null;
  if (!ref) return null;
  return {
    shows: [{ ids: { imdb: ref.show }, seasons: [{ number: ref.season, episodes: [{ number: ref.number, watched_at }] }] }],
  };
}

const episodeIds = new Map<string, number | null>();

/** An episode's own Trakt id, from the show's IMDb id and its numbers. */
async function episodeTraktId(episodeId: string): Promise<number | null> {
  if (episodeIds.has(episodeId)) return episodeIds.get(episodeId)!;
  const ref = episodeRef(episodeId);
  if (!ref) return null;
  const r = await traktJson<{ ids?: { trakt?: number } }>(
    "GET",
    `/shows/${ref.show}/seasons/${ref.season}/episodes/${ref.number}`,
  );
  const id = r.data?.ids?.trakt ?? null;
  if (r.status === 200 || r.status === 404) episodeIds.set(episodeId, id);
  return id;
}

/** How often the player is looked at. */
const TICK_MS = 10_000;

export function useTraktScrobble(t: ScrobbleTarget | null): void {
  const key = t ? `${t.itemId}|${t.episodeId ?? ""}` : null;
  // Read live: popping out and back is the same watch, not a new one, so
  // it must not end the session (a stop) the way a dependency would.
  const popped = useRef(false);
  popped.current = !!t?.popped;
  useEffect(() => {
    if (!t) return;
    const target = t;
    let alive = true;
    let item: Record<string, unknown> | null = null;
    let state: "idle" | "playing" | "paused" = "idle";
    let lastPos: number | null = null;
    let lastPct: number | null = null;
    const ready: Promise<boolean> = (async () => {
      if (!(await traktStatus()).connected) return false;
      const ep = target.kind === "series" && target.episodeId ? await episodeTraktId(target.episodeId) : undefined;
      item = scrobbleItem(target, ep ?? undefined);
      return item != null;
    })().catch(() => false);

    const send = (action: "start" | "pause" | "stop", pct: number) =>
      traktJson<{ action?: string }>("POST", `/scrobble/${action}`, { ...item, progress: Math.round(pct * 100) / 100 });

    const tick = async () => {
      if (!alive || !(await ready) || popped.current) return;
      const st = await tauriMpvStatus().catch(() => null);
      if (!st || st.buffering) return;
      const pct = percent(st.pos, st.dur);
      if (pct == null) return;
      lastPct = pct;
      const still = lastPos != null && st.pos != null && Math.abs(st.pos - lastPos) < 0.5;
      lastPos = st.pos;
      if (pct < 1) return;
      if (state !== "playing" && !still) {
        state = "playing";
        await send("start", pct).catch(() => {});
      } else if (state === "playing" && still) {
        state = "paused";
        await send("pause", pct).catch(() => {});
      }
    };
    const id = window.setInterval(() => void tick(), TICK_MS);
    void tick();

    return () => {
      alive = false;
      window.clearInterval(id);
      // The end of this item: the watch entry has the last position from
      // either player (the in-app tick and the pop-out's both write it),
      // and a natural end sets it to the full duration.
      const e = loadWatching().find((w) => w.id === target.itemId && (w.episodeId ?? "") === (target.episodeId ?? ""));
      const pct = percent(e?.posSec, e?.durSec) ?? lastPct;
      void ready.then(async (ok) => {
        if (!ok || pct == null || pct < 1) return;
        const r = await send("stop", pct).catch(() => null);
        if (r && r.status < 300) {
          if (r.data?.action === "scrobble") counted(target);
          return;
        }
        // Trakt could not be reached, or refused for now: a finished
        // watch is kept and sent later, dated now. A 409 is Trakt saying
        // it already has this one.
        if (pct > 80 && (!r || r.status >= 500 || r.status === 429)) {
          const body = historyFor(target, Date.now());
          if (body) queueWatch(body);
          counted(target);
        }
      });
    };
    // One session per title and episode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Trakt counted it as watched: so does the app. */
function counted(t: ScrobbleTarget): void {
  if (t.kind === "series" && t.episodeId) markWatched(t.itemId, t.episodeId);
  else if (imdbOf(t.itemId)) saveTrakt({ movies: { ...(loadTrakt().movies ?? {}), [t.itemId]: Date.now() } });
}

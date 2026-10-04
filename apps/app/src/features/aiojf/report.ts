/**
 * What you watch here goes to AIOStreams (plan 023, A2): a start when a film
 * or an episode begins, a progress report every 10 seconds (paused or not),
 * and a stop with the position when it ends or you leave it. AIOStreams
 * names the title by a packed id this app computes from the ids it already
 * has (ids.ts); a title whose id cannot pack is not reported, and counted.
 *
 * The played mark is explicit. AIOStreams' own line for "played" is a stop
 * past 90% of the runtime its meta gives, which is not this file's runtime,
 * and a stop under that line CLEARS the mark (local-provider.ts, stopPatch).
 * So at BlammyTV's own line (watching.ts `isFinished`, the 90% the episode
 * ticks at) the stop goes first and the mark after it, and then the session
 * is over: nothing more is sent, or a later stop would clear what was just
 * set. The mark is queued when it cannot be sent (store.ts) and goes at the
 * next sync (D3: only ever added from here).
 *
 * The same shape as trakt/scrobble.ts: its own 10s look at the player rather
 * than hooks into the overlay's buttons, one session per title and episode,
 * and a popped-out play reports from the position the pop-out writes to
 * Continue Watching. A failure never reaches playback.
 */

import { useEffect, useRef } from "react";
import { tauriMpvStatus } from "../../lib/tauri";
import { isFinished, loadWatching } from "../stream/watching";
import { aioCall } from "./account";
import { aiojfStatus } from "./client";
import { packEpisode, packMovie } from "./ids";
import { reportBody } from "./rules";
import { loadAiojf, playedSettled, queuePlayed, saveAiojf } from "./store";

export interface ReportTarget {
  itemId: string;
  kind: "movie" | "series";
  episodeId?: string;
  /** The season the episode sits in. A Kitsu id carries none of its own. */
  season?: number;
  /** In the pop-out: the in-app player is not the one playing. */
  popped?: boolean;
}

/**
 * AIOStreams' packed id for what is playing, or null for one it cannot
 * pack. A Kitsu episode is packed as `anime`, because the Stremio type is
 * part of the id and its meta is served under that type.
 */
export function packedFor(t: Pick<ReportTarget, "itemId" | "kind" | "episodeId" | "season">): string | null {
  if (t.kind === "movie") return packMovie(t.itemId);
  if (!t.episodeId) return null;
  return packEpisode(t.episodeId, {
    ...(t.season != null ? { season: t.season } : {}),
    ...(t.episodeId.startsWith("kitsu:") ? { type: "anime" as const } : {}),
  });
}

/** How often the player is looked at. AIOStreams treats a playback with no
 * report for 5 minutes as over (its default idle timeout), so this is well
 * inside it, and a paused play keeps reporting. */
const TICK_MS = 10_000;

const PATH = { start: "/Sessions/Playing", progress: "/Sessions/Playing/Progress", stop: "/Sessions/Playing/Stopped" };

/** Send the played mark for a packed id; queue it when it did not settle. */
export async function markPlayed(packedId: string): Promise<void> {
  const r = await aioCall("POST", `/UserPlayedItems/${packedId}`).catch(() => null);
  if (!r || !playedSettled(r.status)) queuePlayed(packedId);
}

export function useAiojfReport(t: ReportTarget | null): void {
  const key = t ? `${t.itemId}|${t.episodeId ?? ""}` : null;
  // Read live: popping out and back is the same watch, not a new one, so it
  // must not end the session (a stop) the way a dependency would.
  const popped = useRef(false);
  popped.current = !!t?.popped;
  // The play that was last counted as unreportable: StrictMode runs an effect
  // twice, and the same watch must not count twice for it.
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (!t) {
      counted.current = null;
      return;
    }
    const target = t;
    let alive = true;
    let packed: string | null = null;
    let started = false;
    /** The watch has been reported to its end: nothing more is sent for it. */
    let done = false;
    let lastPos: number | null = null;
    const ready: Promise<boolean> = (async () => {
      if (!(await aiojfStatus()).connected) return false;
      packed = packedFor(target);
      if (!packed) {
        if (counted.current !== key) {
          counted.current = key;
          saveAiojf({ unpackable: (loadAiojf().unpackable ?? 0) + 1 });
        }
        return false;
      }
      return true;
    })().catch(() => false);

    const entry = () =>
      loadWatching().find((w) => w.id === target.itemId && (w.episodeId ?? "") === (target.episodeId ?? ""));

    /** Where the watch is: the player's own clock, or, in the pop-out, the
     * position it writes to Continue Watching every second. */
    const read = async (): Promise<{ pos: number; dur: number | null } | null> => {
      if (popped.current) {
        const e = entry();
        return e?.posSec != null ? { pos: e.posSec, dur: e.durSec ?? null } : null;
      }
      const st = await tauriMpvStatus().catch(() => null);
      return st && !st.buffering && st.pos != null ? { pos: st.pos, dur: st.dur } : null;
    };

    const send = async (action: keyof typeof PATH, pos: number, paused = false) => {
      await aioCall("POST", PATH[action], { body: reportBody(packed!, pos, paused) }).catch(() => null);
    };

    /** The end of the watch as AIOStreams hears it: a stop, then the mark. */
    const finish = async (pos: number) => {
      done = true;
      await send("stop", pos);
      await markPlayed(packed!);
    };

    const tick = async () => {
      if (!alive || done) return;
      if (!(await ready)) return;
      const cur = await read();
      if (!alive || done || !cur) return;
      const still = lastPos != null && Math.abs(cur.pos - lastPos) < 0.5;
      lastPos = cur.pos;
      if (isFinished({ posSec: cur.pos, durSec: cur.dur ?? undefined })) return void (await finish(cur.pos));
      if (!started) {
        started = true;
        await send("start", cur.pos);
        return;
      }
      // A position that stopped moving is a pause; moving again is the
      // resume. Reported on every tick either way, which also keeps the
      // session alive.
      await send("progress", cur.pos, still);
    };
    const id = window.setInterval(() => void tick(), TICK_MS);
    void tick();

    return () => {
      alive = false;
      window.clearInterval(id);
      if (done) return;
      // The end of this item: Continue Watching has the last position from
      // either player (the in-app tick and the pop-out's both write it), and
      // a natural end sets it to the full duration. Past the line since the
      // last tick (a seek to the end, a next-episode jump) is a finish, as
      // Trakt's scrobble reads it; a restart writes no progress
      // (keptProgress), so an old finish can't pass for this one.
      const e = entry();
      const pos = e?.posSec ?? lastPos;
      const finished = !!e && isFinished(e);
      void ready.then(async (ok) => {
        if (!ok || done || pos == null) return;
        if (finished) return void (await finish(pos));
        if (started) await send("stop", pos);
      });
    };
    // One session per title and episode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

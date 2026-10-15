/**
 * What you watch from your own Jellyfin goes back to it (plan 027, D5): a start
 * when a film or an episode begins, a progress report every 10 seconds (paused
 * or not), and a stop with the position when it ends or you leave it. The
 * server does the rest by its own rules (plans/027-api-facts.md #6): a stop
 * under its low line resets the position, between the lines it keeps it for
 * Continue Watching, past the high line it marks the item played. So nothing
 * here marks anything played: the stop carries the real position, and the next
 * sync reads the flag back (sync.ts).
 *
 * The same shape as aiojf/report.ts and trakt/scrobble.ts: its own 10s look at
 * the player rather than hooks into the overlay's buttons, one session per
 * title and episode, and a popped-out play reports from the position the
 * pop-out writes to Continue Watching. A failure never reaches playback.
 */

import { useEffect, useRef } from "react";
import { tauriMpvStatus } from "../../lib/tauri";
import { isFinished, loadWatching } from "../stream/watching";
import { jfCall } from "./account";
import { mediaSourceOf, reportBody } from "./rules";
import { forgetCount, loadJfConn } from "./store";
import { noteResumeJid } from "./sync";
import { jfItemIdFor, playSessionOf } from "./vod";

export interface JfReportTarget {
  itemId: string;
  kind: "movie" | "series";
  episodeId?: string;
  /** The address being played: it names the file (`mediaSourceId`). */
  streamUrl?: string;
  /** In the pop-out: the in-app player is not the one playing. */
  popped?: boolean;
}

/** How often the player is looked at. A paused play keeps reporting, which
 * also keeps the server's session for it alive. */
const TICK_MS = 10_000;

const PATH = { start: "/Sessions/Playing", progress: "/Sessions/Playing/Progress", stop: "/Sessions/Playing/Stopped" };

export function useJfReport(t: JfReportTarget | null): void {
  const key = t ? `${t.itemId}|${t.episodeId ?? ""}` : null;
  // Read live: popping out and back is the same watch, not a new one.
  const popped = useRef(false);
  popped.current = !!t?.popped;
  const streamUrl = useRef<string | undefined>(undefined);
  // Kept past the end of the watch: the last report names the file too.
  if (t?.streamUrl) streamUrl.current = t.streamUrl;
  useEffect(() => {
    if (!t) return;
    const target = t;
    let alive = true;
    let jid: string | null = null;
    let started = false;
    /** The watch has been reported to its end: nothing more is sent for it. */
    let done = false;
    let lastPos: number | null = null;
    const ready: Promise<boolean> = (async () => {
      if (!loadJfConn()) return false;
      const gen = forgetCount();
      jid = await jfItemIdFor(target.kind, target.kind === "movie" ? target.itemId : (target.episodeId ?? ""));
      // The card this play leaves is cleared on the server by this id, with no
      // sync needed in between (sync.ts `forgetResume`).
      if (jid) noteResumeJid(target.itemId, target.episodeId, jid, gen);
      return jid !== null;
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
      const body = reportBody(
        { itemId: jid!, mediaSourceId: mediaSourceOf(streamUrl.current), playSessionId: playSessionOf(jid!) },
        pos,
        paused,
      );
      await jfCall("POST", PATH[action], { body }).catch(() => null);
    };

    const tick = async () => {
      if (!alive || done) return;
      if (!(await ready)) return;
      const cur = await read();
      if (!alive || done || !cur) return;
      const still = lastPos != null && Math.abs(cur.pos - lastPos) < 0.5;
      lastPos = cur.pos;
      if (isFinished({ posSec: cur.pos, durSec: cur.dur ?? undefined })) {
        // Past BlammyTV's own line: the stop goes with the real position and
        // the session is over, so nothing later can contradict it.
        done = true;
        return void (await send("stop", cur.pos));
      }
      if (!started) {
        started = true;
        await send("start", cur.pos);
        return;
      }
      // A position that stopped moving is a pause; moving again is the resume.
      // Reported on every tick either way.
      await send("progress", cur.pos, still);
    };
    const id = window.setInterval(() => void tick(), TICK_MS);
    void tick();

    return () => {
      alive = false;
      window.clearInterval(id);
      if (done) return;
      // The end of this item: Continue Watching has the last position from
      // either player, and a natural end sets it to the full duration.
      const pos = entry()?.posSec ?? lastPos;
      void ready.then(async (ok) => {
        if (!ok || done || pos == null || !started) return;
        await send("stop", pos);
      });
    };
    // One session per title and episode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

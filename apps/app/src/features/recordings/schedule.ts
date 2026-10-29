import type { Recording } from "./store";

/**
 * Record a programme from the Guide (plan 029, Phase 3), the pure half: what
 * the right-click menu offers, and whether the line has room.
 *
 * Native keeps the schedule and its clock (rec.rs); this decides what to ask
 * it for, and says no when the line cannot hold it.
 */

/** A minute either side of a programme, for a guide that runs late. The same
 * number as rec.rs's PAD_MS, which adds it; this counts a line's connections
 * over the span native will really hold them. */
export const PAD_MS = 60_000;

/** A scheduled programme, as the Guide marks it. */
export const scheduleKey = (channelId: string, startMs: number): string =>
  `${channelId}\n${startMs}`;

/** When a recording holds a connection on its line: from when it starts to
 * when it stops, or for good if nothing ends it. Null for one that holds none
 * (it is over, or it reads the player's own buffer). */
function holds(r: Recording): { from: number; to: number } | null {
  if (r.buffer) return null;
  if (r.status === "scheduled") return { from: r.startAt ?? r.startedAt, to: r.stopAt ?? Infinity };
  if (r.status === "recording") return { from: r.startedAt, to: r.stopAt ?? Infinity };
  return null;
}

/** How many of the app's recordings hold a connection on this playlist's line
 * at some moment between `from` and `to`. */
export function overlapping(
  list: readonly Recording[],
  playlistId: string,
  from: number,
  to: number,
): number {
  return list.filter((r) => {
    const h = r.playlistId === playlistId ? holds(r) : null;
    return !!h && h.from < to && from < h.to;
  }).length;
}

/**
 * Why the line cannot take one more recording between `from` and `to`, as a
 * clause for the notice ("2 other recordings overlap this one, and your line
 * allows 2 streams at once"), or null when it can. A line that reports no
 * limit (Stalker, M3U, a panel that does not say) is never refused: the
 * attempt shows what the provider thinks, as Record in the player does.
 */
export function clash(
  list: readonly Recording[],
  line: { max: number } | null | undefined,
  playlistId: string,
  from: number,
  to: number,
): string | null {
  if (!line) return null;
  const n = overlapping(list, playlistId, from, to);
  if (n + 1 <= line.max) return null;
  const others = n === 1 ? "1 other recording overlaps" : `${n} other recordings overlap`;
  return `${others} this one, and your line allows ${line.max} ${line.max === 1 ? "stream" : "streams"} at once`;
}

/** What the right-click menu says about a programme: Record, Cancel Recording
 * for one that is scheduled, a disabled "Recording" for the channel being
 * recorded right now, or nothing for a programme that is over. */
export type ProgrammeAction =
  | { kind: "record"; label: "Record" }
  | { kind: "cancel"; label: "Cancel Recording"; id: string }
  | { kind: "recording"; label: "Recording" }
  | null;

export function programmeAction(
  list: readonly Recording[],
  p: { channelId: string; playlistId: string; channel: string; start: number; end: number },
  now: number,
): ProgrammeAction {
  if (p.end <= now) return null;
  const scheduled = list.find(
    (r) => r.status === "scheduled" && r.channelId === p.channelId && r.startedAt === p.start,
  );
  if (scheduled) return { kind: "cancel", label: "Cancel Recording", id: scheduled.id };
  const on = p.start <= now;
  const running = list.some(
    (r) => r.status === "recording" && r.playlistId === p.playlistId && r.channel === p.channel,
  );
  if (on && running) return { kind: "recording", label: "Recording" };
  return { kind: "record", label: "Record" };
}

import type { Recording } from "./store";

/**
 * Record a programme from the Guide (plan 029, Phase 3), the pure half: what
 * the right-click menu offers, and whether the line has room.
 *
 * Native keeps the schedule and its clock (rec.rs); this decides what to ask
 * it for, and says no when the line cannot hold it.
 */

/** A minute either side of a programme, for a guide that runs late. The same
 * number as rec.rs's PAD_MS, which adds it. Padding never causes a clash: a
 * line's connections are counted over the programmes' own times (`holds`), and
 * when a start comes due while an earlier recording is still in its padding,
 * that one is stopped at its programme's end (`handOver`). */
export const PAD_MS = 60_000;

/** A scheduled programme, as the Guide marks it. */
export const scheduleKey = (channelId: string, startMs: number): string =>
  `${channelId}\n${startMs}`;

/** When a recording holds a connection on its line, by its programme's own
 * times and not its padding: from the programme's start to its end, or for
 * good if nothing ends it. Null for one that holds none (it is over, or it
 * reads the player's own buffer). */
function holds(r: Recording): { from: number; to: number } | null {
  if (r.buffer || (r.status !== "scheduled" && r.status !== "recording")) return null;
  return { from: r.startedAt, to: r.stopAt == null ? Infinity : r.stopAt - PAD_MS };
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

/** The recordings running on this line whose programme is over by `start`,
 * soonest first: the ones that would still hold a connection when a recording
 * of a programme starting then begins its padding. */
export function endsBefore(list: readonly Recording[], playlistId: string, start: number): Recording[] {
  return list
    .filter(
      (r) =>
        r.status === "recording" &&
        !r.buffer &&
        r.playlistId === playlistId &&
        r.stopAt != null &&
        r.stopAt - PAD_MS <= start,
    )
    .sort((a, b) => (a.stopAt as number) - (b.stopAt as number));
}

/**
 * A scheduled start has come on a line that is full only because earlier
 * recordings are in their padding: which of them to stop, and when (their
 * programmes' end, Unix ms), so this one can begin. Null when the line has
 * room, reports no limit, or would still be full after stopping them (the
 * start then says why it cannot, as ever).
 */
export function handOver(
  list: readonly Recording[],
  line: { max: number } | null | undefined,
  playlistId: string,
  start: number,
): { stop: string[]; at: number } | null {
  if (!line) return null;
  const held = list.filter((r) => r.status === "recording" && !r.buffer && r.playlistId === playlistId);
  const need = held.length + 1 - line.max;
  const early = endsBefore(list, playlistId, start);
  if (need <= 0 || early.length < need) return null;
  const stop = early.slice(0, need);
  return { stop: stop.map((r) => r.id), at: Math.max(...stop.map((r) => (r.stopAt as number) - PAD_MS)) };
}

/** What the right-click menu says about a programme: Record, Cancel Recording
 * for one that is scheduled, a disabled "Recording" for the channel being
 * recorded during it, or nothing for a programme that is over. */
export type ProgrammeAction =
  | { kind: "record"; label: "Record" }
  | { kind: "cancel"; label: "Cancel Recording"; id: string }
  | { kind: "recording"; label: "Recording" }
  | null;

/**
 * A record of this channel covers the programme when its own times meet the
 * programme's, not when the starts match: native starts a scheduled one a
 * minute early (the record then has no channel id, only the name), and a guide
 * refresh can move a programme's start. Both used to offer Record again and
 * record it twice. One with no end (Record in the player) covers only a
 * programme that is on, so a later programme is still worth keeping.
 */
function covers(
  r: Recording,
  p: { channelId: string; playlistId: string; channel: string; start: number; end: number },
  now: number,
): boolean {
  const same =
    r.channelId != null
      ? r.channelId === p.channelId
      : r.playlistId === p.playlistId && r.channel === p.channel;
  const open = r.stopAt == null;
  const to = r.stopAt == null ? Infinity : r.stopAt - PAD_MS;
  return same && r.startedAt < p.end && p.start < to && (!open || p.start <= now);
}

export function programmeAction(
  list: readonly Recording[],
  p: { channelId: string; playlistId: string; channel: string; start: number; end: number },
  now: number,
): ProgrammeAction {
  if (p.end <= now) return null;
  const scheduled = list.find((r) => r.status === "scheduled" && covers(r, p, now));
  if (scheduled) return { kind: "cancel", label: "Cancel Recording", id: scheduled.id };
  if (list.some((r) => r.status === "recording" && covers(r, p, now))) {
    return { kind: "recording", label: "Recording" };
  }
  return { kind: "record", label: "Record" };
}

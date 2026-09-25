import type { Channel, LiveData } from "./model";

/**
 * What is in the multi-view grid, and what the line has room for (plan 017,
 * P3). Pure, for the reason mvLayout gives: these are rules about numbers.
 *
 * THE COUNT FOLLOWS THE CHANNELS (decision M8). There is no 2 / 3 / 4 pick
 * any more: add one and the grid grows, close one and it shrinks. The only
 * ceiling is the line, and four.
 */

/** One channel in the grid. The id is the identity: the same channel twice
 * would be two connections spent on one stream. */
export interface Pick {
  channelId: string;
  /** What the tile is called: the game, or the channel. */
  label: string;
  /** A game picked as a game: its fixture id, for the score on its tile. */
  gameId?: string;
  /** And its league, so the score is asked for while it is on the grid. */
  league?: string;
}

/** 013's ceiling, and most lines cap below it. */
export const MAX_TILES = 4;

/**
 * How many cells the grid lays out for `n` streams.
 *
 * Nothing yet: one cell, the place to add the first. Then exactly the
 * streams: adding more is the bar's Add, or A. One stream fills the stage
 * (Adam, 2026-09-25); it used to sit beside a place for the next (017's
 * frame E), half the size it could be for a tile that was mostly waiting.
 */
export function cellsFor(n: number): number {
  return Math.max(1, n);
}

/** What the line has room for, from its limit and what it reports in use. */
export interface Room {
  /** The line's limit, or null when the provider does not report one. */
  max: number | null;
  /** Streams open on the line that are not this grid's: another device,
   * the popout. Zero until the panel's count has settled. */
  elsewhere: number;
  /** This grid's streams. */
  used: number;
  /** How many more can be added. */
  left: number;
}

/**
 * Room on the line.
 *
 * `active` is the panel's own count, which includes this grid's streams, so
 * what is in use ELSEWHERE is the difference. But a panel takes seconds to
 * count a new stream and up to about 20 to notice one has gone
 * (connections.ts), so a reading taken soon after the grid changed would
 * blame a stream this grid just closed on "another device". Until the
 * count has had time to settle, nothing is in use elsewhere.
 *
 * No limit reported (Stalker, M3U): anything up to four is offered, and a
 * refusal shows on the tile instead.
 */
export function roomOn(
  line: { max: number; active: number } | null,
  used: number,
  settled: boolean,
): Room {
  const max = line?.max ?? null;
  const elsewhere = line && settled ? Math.max(0, line.active - used) : 0;
  const ceiling = Math.min(MAX_TILES, max === null ? MAX_TILES : max - elsewhere);
  return { max, elsewhere, used, left: Math.max(0, ceiling - used) };
}

/**
 * The meter's words: the LINE's total first, the way the Guide's pill
 * shows it ("3 of 3 streams in use"), then how many of those are somewhere
 * else. It used to lead with this grid's count ("2 of 3 streams"), which
 * read as the line's total and was not (Adam, on v0.9.109: "verify the
 * stream line thing is pulling from total current streams, and not just
 * the multiview? same as how guide does it").
 *
 * The total is the grid's streams plus what the panel reports on top of
 * them, which is the panel's own count once it has settled (roomOn). With
 * no limit reported there is no line to count against, only the grid.
 */
export function meterLine(room: Room): string {
  if (room.max === null) return `${room.used} ${room.used === 1 ? "stream" : "streams"}`;
  const total = room.used + room.elsewhere;
  const line = `${total} of ${room.max} ${room.max === 1 ? "stream" : "streams"} in use`;
  return room.elsewhere > 0 ? `${line} · ${room.elsewhere} elsewhere` : line;
}

/** Why Add is off, for its tooltip. Null while there is room. */
export function fullReason(room: Room): string | null {
  if (room.left > 0) return null;
  if (room.max === null || room.used >= MAX_TILES) return "Four is the most multi-view shows";
  if (room.elsewhere > 0)
    return `Your line allows ${room.max}, and ${room.elsewhere} ${room.elsewhere === 1 ? "is" : "are"} in use elsewhere`;
  return `Your line allows ${room.max}`;
}

/** The picker's footer: what is left. */
export function leftLine(room: Room): string {
  if (room.left === 0) return "Your line is full";
  if (room.max === null) return "Your provider doesn’t report a limit";
  return room.left === 1 ? "1 more fits on your line" : `${room.left} more fit on your line`;
}

/** Add at the end. Never twice, never past the room. */
export function addPick(list: Pick[], pick: Pick, room: Room): Pick[] {
  if (room.left <= 0) return list;
  if (list.some((p) => p.channelId === pick.channelId)) return list;
  return [...list, pick];
}

/**
 * Swap one stream for another in the same place. The old one's tile goes
 * in the same commit the new one's arrives, and React runs every cleanup
 * before any new effect, so the old connection is handed back before the
 * new one is opened: a replace never needs a spare connection.
 */
export function replacePick(list: Pick[], oldId: string, pick: Pick): Pick[] {
  if (list.some((p) => p.channelId === pick.channelId)) return list;
  return list.map((p) => (p.channelId === oldId ? pick : p));
}

export function removePick(list: Pick[], id: string): Pick[] {
  return list.filter((p) => p.channelId !== id);
}

/** What a channel sent from elsewhere does to the grid (`arrive`). */
export type Arrival =
  | { kind: "here" }
  | { kind: "add"; picks: Pick[] }
  | { kind: "full" };

/**
 * A channel sent from the Guide or the player (plan 017, P6b). It joins the
 * grid you left rather than replacing it (the grid is remembered on
 * purpose, M7), and takes the sound either way, so in Focus it is the big
 * tile. Already there, it only takes the sound. With no room left, the grid
 * asks which tile it replaces: nothing is dropped without you choosing.
 * An empty grid always takes it, since there is no tile to choose; a line
 * that refuses it says so on the tile.
 */
export function arrive(list: Pick[], pick: Pick, room: Room): Arrival {
  if (list.some((p) => p.channelId === pick.channelId)) return { kind: "here" };
  if (list.length === 0) return { kind: "add", picks: [pick] };
  if (room.left > 0) return { kind: "add", picks: [...list, pick] };
  return { kind: "full" };
}

/**
 * Focus's big spot is the sound tile's (decision M2): choosing a small tile
 * SWAPS it with the big one, so the one it displaces takes its old place
 * and nothing else moves. Moving it to the front instead would shuffle
 * every tile between them.
 */
export function swapToFront(list: Pick[], id: string): Pick[] {
  const i = list.findIndex((p) => p.channelId === id);
  if (i <= 0) return list;
  const next = [...list];
  [next[0], next[i]] = [next[i], next[0]];
  return next;
}

/**
 * The tile ← or → moves the sound to: `step` places along, wrapping, past
 * any tile that can't take it (a failed one has nothing to hear). Null
 * when no other tile can.
 */
export function stepSound(
  ids: readonly string[],
  dead: ReadonlySet<string>,
  current: string | null,
  step: 1 | -1,
): string | null {
  const n = ids.length;
  // With nothing current, → starts at the first tile and ← at the last.
  const found = current ? ids.indexOf(current) : -1;
  const at = found >= 0 ? found : step === 1 ? -1 : n;
  for (let k = 1; k <= n; k++) {
    const id = ids[(((at + step * k) % n) + n) % n];
    if (id !== current && !dead.has(id)) return id;
  }
  return null;
}

/** Names lowercased once per catalog (audit perf 8), not per keystroke. */
const INDEXES = new WeakMap<LiveData, Array<[Channel, string]>>();

function indexOf(live: LiveData): Array<[Channel, string]> {
  let index = INDEXES.get(live);
  if (!index) {
    index = live.channels.map((c) => [c, c.name.toLowerCase()]);
    INDEXES.set(live, index);
  }
  return index;
}

/**
 * Channels matching a query: its number first when it is one, then names
 * that contain it, in the catalog's order. Capped, because a bare query can
 * match thousands and 40 rows are enough to find it.
 */
export function searchChannels(live: LiveData, query: string, limit = 40): Channel[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: Channel[] = [];
  const num = /^\d+$/.test(q) ? Number(q) : null;
  const index = indexOf(live);
  if (num !== null) {
    for (const [c] of index) if (c.number === num) out.push(c);
  }
  for (const [c, lower] of index) {
    if (out.length >= limit) break;
    if (lower.includes(q) && !(num !== null && c.number === num)) out.push(c);
  }
  return out.slice(0, limit);
}

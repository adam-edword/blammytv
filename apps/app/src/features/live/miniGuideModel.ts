import { load, save } from "../../lib/storage";
import type { Channel, Programme } from "./model";

/**
 * The mini-guide's plain parts (plan 036): the shape it remembers, the wrap
 * of PageUp and PageDown, the window of a long list that is drawn, and what a
 * card says about a channel. MiniGuide.tsx is the part that draws.
 */

/** One channel of the Guide's current list, with its listings. */
export interface MiniChannel {
  channel: Channel;
  programmes: readonly Programme[];
}

/** What the player hands the mini-guide: the Guide's list as the Guide shows
 * it, the name that list goes by, the channel playing, and how to tune. */
export interface MiniGuideData {
  channels: readonly MiniChannel[];
  listName: string;
  playingId: string | undefined;
  onTune: (id: string) => void;
}

export type MiniShape = "strip" | "list";

const KEY = "miniGuide";
const VERSION = 1;

export function loadShape(): MiniShape {
  return load<MiniShape>(KEY, VERSION, "strip") === "list" ? "list" : "strip";
}

export function saveShape(shape: MiniShape): void {
  save(KEY, VERSION, shape);
}

/** `i` moved by `by` around a list of `len`, wrapping at both ends. */
export function wrap(i: number, by: number, len: number): number {
  return (((i + by) % len) + len) % len;
}

/** Where PageUp (-1) or PageDown (1) lands from `from`, the index of the
 * channel playing, or -1 when it is not in this list: that goes to the first
 * going down and the last going up, not to a neighbour of nothing. */
export function stepFrom(from: number, dir: 1 | -1, len: number): number {
  if (from < 0) return dir === 1 ? 0 : len - 1;
  return wrap(from, dir, len);
}

/**
 * The slice of a long list that is drawn: `radius` either side of `sel`,
 * pulled in at the ends. A folder can hold thousands of channels and the
 * strip shows a handful, so the rest are a spacer's width, not a card each.
 */
export function windowAround(len: number, sel: number, radius: number): [number, number] {
  if (len <= 0) return [0, 0];
  const at = Math.min(Math.max(sel, 0), len - 1);
  return [Math.max(0, at - radius), Math.min(len, at + radius + 1)];
}

/** "34 min left", "1 hr 6 min left", "2 hr left". Under a minute is one. */
export function timeLeft(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) return `${mins} min left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min left` : `${h} hr left`;
}

/** What is on at `now`, and the programme after it. The listings come in start
 * order (epg.ts normalizeProgrammes), so the next is the first to start later. */
export function airing(
  programmes: readonly Programme[],
  now: Date,
): { now: Programme | undefined; next: Programme | undefined } {
  const t = now.getTime();
  return {
    now: programmes.find((p) => p.start.getTime() <= t && t < p.end.getTime()),
    next: programmes.find((p) => p.start.getTime() > t),
  };
}

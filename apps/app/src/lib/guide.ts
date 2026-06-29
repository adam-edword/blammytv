import type { LiveChannel, EpgProgram } from "@blammytv/shared";
import { blockGeometry, type GuideWindow } from "./epg";

/** One laid-out programme block on a channel lane. */
export interface Block {
  p: EpgProgram;
  left: number;
  width: number;
}

/** A channel row: the channel plus its non-overlapping programme blocks, in
 * time order. An empty `blocks` means the provider gave no EPG for it (the row
 * renders a single selectable "No Information" cell). */
export interface Lane {
  ch: LiveChannel;
  blocks: Block[];
}

/** Build the per-channel lanes for a guide window. Shared by the guide
 * (rendering) and the live screen (remote navigation), so the navigable cells
 * are exactly the ones drawn. */
export function buildLanes(
  channels: LiveChannel[],
  programs: EpgProgram[],
  win: GuideWindow,
): Lane[] {
  const byChannel = groupByChannel(programs);
  return channels.map((ch) => {
    const own = byChannel[ch.id] ?? [];
    return {
      ch,
      blocks: dropOverlaps(
        own
          .map((p) => ({ p, ...blockGeometry(win, p) }))
          .filter((b) => b.width > 0)
          .sort((a, b) => a.left - b.left),
      ),
    };
  });
}

/** Selectable-cell count for a lane (the "No Information" cell counts as one). */
export function laneColumns(lane: Lane): number {
  return Math.max(1, lane.blocks.length);
}

function groupByChannel(programs: EpgProgram[]): Record<string, EpgProgram[]> {
  const out: Record<string, EpgProgram[]> = {};
  for (const p of programs) (out[p.channelId] ??= []).push(p);
  for (const list of Object.values(out))
    list.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return out;
}

/** Keep only non-overlapping blocks (input sorted by `left`): the first of any
 * overlapping run wins, the rest are dropped. A safety net for messy provider
 * EPGs where programmes overlap and would otherwise stack on top of each other. */
function dropOverlaps<T extends { left: number; width: number }>(
  blocks: T[],
): T[] {
  const out: T[] = [];
  let right = -Infinity;
  for (const b of blocks) {
    if (b.left + 0.5 >= right) {
      out.push(b);
      right = b.left + b.width;
    }
  }
  return out;
}

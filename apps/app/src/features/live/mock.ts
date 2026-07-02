import { windowStart } from "./guide";

/**
 * Deterministic demo catalog for building the EPG against the Figma frame
 * (which is World Cup-themed). Everything derives from index hashes — no
 * randomness — so layouts are stable across reloads and tests.
 */

export type Quality = "4K" | "FHD" | "HD" | "HDR";

export interface MockChannel {
  id: string;
  name: string;
  quality: Quality;
  folder: string;
  /** Channels with no programme data render a single "No Information" cell. */
  noInfo?: boolean;
}

export interface Programme {
  title: string;
  synopsis: string;
  start: Date;
  end: Date;
}

export const MOCK_PLAYLIST_NAME = "Meteor";

export const MOCK_FOLDERS = [
  "World Cup 2026",
  "FIFA World Cup 2026 Men",
  "FIFA Women's World Cup",
  "UEFA Euro 2024",
  "Copa America 2024",
  "AFC Asian Cup 2023",
  "United States",
  "Africa Cup of Nations",
  "FIFA Club World Cup",
  "Olympic Football",
  "UEFA Nations League",
  "MLS Cup 2023",
  "Premier League 2023-24",
  "La Liga 2023-24",
  "Serie A 2023-24",
];

const CHANNELS: Array<[string, Quality, boolean?]> = [
  ["ESPN", "4K"],
  ["NBC Sports Network", "4K"],
  ["TNT Sports Live", "4K"],
  ["Sky Sports Main Event", "4K"],
  ["NFL Network", "4K"],
  ["CBS Sports HQ", "FHD"],
  ["beIN Sports", "FHD", true],
  ["Discovery Sports Channel", "FHD"],
  ["FS2", "FHD"],
  ["BT Sport Ultra", "HDR"],
  ["TSN 1", "HD"],
  ["Eurosport 1", "HD"],
  ["DAZN 1", "FHD"],
  ["Premier Sports", "HD"],
];

export const MOCK_CHANNELS: MockChannel[] = CHANNELS.map(
  ([name, quality, noInfo], i) => ({
    id: `ch${i}`,
    name,
    quality,
    folder: MOCK_FOLDERS[i % MOCK_FOLDERS.length],
    noInfo,
  }),
);

const GROUPS = "ABCDEFGH";
const TEAMS = [
  ["Brazil", "Morocco"],
  ["Argentina", "Spain"],
  ["France", "Germany"],
  ["England", "Portugal"],
  ["USA", "Paraguay"],
  ["Japan", "Mexico"],
  ["Netherlands", "Italy"],
  ["Serbia", "Ecuador"],
  ["Australia", "Uruguay"],
  ["Ghana", "South Korea"],
  ["Colombia", "Nigeria"],
  ["Egypt", "Norway"],
  ["Qatar", "Iran"],
  ["Tunisia", "Saudi Arabia"],
  ["Costa Rica", "Wales"],
  ["Ivory Coast", "Peru"],
];

/** Small deterministic hash for stable pseudo-variety. */
function hash(...ns: number[]): number {
  let h = 2166136261;
  for (const n of ns) {
    h ^= n + 1;
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const DURATIONS = [45, 75, 90, 135];

/** Programme blocks for one channel, tiled back from the guide window's
 * start so the first cell usually began before the window (like real EPG). */
export function programmesFor(
  channelIndex: number,
  now: Date,
  hours = 5,
): Programme[] {
  const start = windowStart(now);
  const out: Programme[] = [];
  // Begin one long slot before the window.
  let t = new Date(
    start.getTime() - DURATIONS[hash(channelIndex, 99) % 4] * 60_000,
  );
  for (let slot = 0; t.getTime() < start.getTime() + hours * 3_600_000; slot++) {
    const minutes = DURATIONS[hash(channelIndex, slot) % 4];
    const end = new Date(t.getTime() + minutes * 60_000);
    const match = TEAMS[hash(channelIndex, slot, 7) % TEAMS.length];
    const group = GROUPS[hash(channelIndex, slot, 13) % GROUPS.length];
    out.push({
      title: `Group ${group}: ${match[0]} vs. ${match[1]}`,
      synopsis: `${match[0]} meet ${match[1]} with top spot in Group ${group} on the line. Full buildup, the match, and reaction.`,
      start: t,
      end,
    });
    t = end;
  }
  return out;
}

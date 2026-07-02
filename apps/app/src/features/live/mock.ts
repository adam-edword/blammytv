import { windowStart } from "./epg";
import type { LiveData, Programme, Quality } from "./model";

/**
 * Deterministic demo catalog for building the EPG against the Figma frame
 * (which is World Cup-themed). Everything derives from index hashes — no
 * randomness — so layouts are stable across reloads and tests. Loads only
 * when no real playlist is configured (see source.ts).
 */

export const MOCK_PLAYLIST_NAME = "Meteor";

/* A few titles carry emojis the way real provider categories do, to
 * exercise the emoji-icon path; the rest fall back to the tv icon. */
export const MOCK_FOLDERS = [
  "🏆 World Cup 2026",
  "FIFA World Cup 2026 Men",
  "FIFA Women's World Cup",
  "⚽ UEFA Euro 2024",
  "Copa America 2024",
  "AFC Asian Cup 2023",
  "🇺🇸 United States",
  "🌍 Africa Cup of Nations",
  "FIFA Club World Cup",
  "Olympic Football",
  "UEFA Nations League",
  "MLS Cup 2023",
  "Premier League 2023-24",
  "La Liga 2023-24",
  "Serie A 2023-24",
];

/** [name, quality, noInfo?] — noInfo channels get no programme data, so the
 * "No Information" lane path stays exercised. */
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

/** The mock catalog in the live model's shape. */
export function mockLive(now: Date): LiveData {
  const channels = CHANNELS.map(([name, quality], i) => ({
    id: `ch${i}`,
    name,
    quality: quality as Quality | null,
    folderId: MOCK_FOLDERS[i % MOCK_FOLDERS.length],
  }));
  const programmes = new Map<string, Programme[]>();
  CHANNELS.forEach(([, , noInfo], i) => {
    // 12 hours of listings so long dev sessions don't outrun the tiles.
    if (!noInfo) programmes.set(`ch${i}`, programmesFor(i, now, 12));
  });
  return {
    groups: [
      {
        id: "mock",
        name: MOCK_PLAYLIST_NAME,
        folders: MOCK_FOLDERS.map((f) => ({ id: f, name: f })),
      },
    ],
    channels,
    programmes,
  };
}

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

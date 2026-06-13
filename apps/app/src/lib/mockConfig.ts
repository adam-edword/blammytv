import type {
  ConfigBlob,
  EpgProgram,
  LiveChannel,
  ChannelGroup,
} from "@blammytv/shared";

/**
 * Stand-in for the not-yet-built backend.
 *
 * Once the config API exists, delete this file and point `fetchConfig` at the
 * real endpoint — nothing else in the app changes, because the app only ever
 * sees a validated ConfigBlob.
 *
 * EPG times are generated relative to *now* so the guide's "now" indicator and
 * the live programs always line up whenever the skeleton is run.
 */

const MIN = 60_000;

const GROUPS: ChannelGroup[] = [
  { id: "g-wc", name: "FIFA World Cup 2026 ⚽ 🏆", hidden: false, order: 0 },
  { id: "g-wc-events", name: "FIFA World Cup Events 2026 ⚽ 🏆", hidden: false, order: 1 },
  { id: "g-replay", name: "Replay  |  World Cup", hidden: false, order: 2 },
  { id: "g-4k", name: "4K / UHD Channels", hidden: false, order: 3 },
  { id: "g-ppv", name: "Live Pay-Per-View", hidden: false, order: 4 },
  { id: "g-nfl", name: "NFL Game Pass", hidden: false, order: 5 },
  { id: "g-usa-sports", name: "USA  |  Sports", hidden: false, order: 6 },
  { id: "g-usa-movies", name: "USA  |  Movies", hidden: false, order: 7 },
  { id: "g-usa-series", name: "USA  |  Series", hidden: false, order: 8 },
];

const CHANNELS: LiveChannel[] = [
  chan("c-fs1", "FOX Sports 1", "g-wc"),
  chan("c-fs2", "FOX Sports 2", "g-wc"),
  chan("c-tsn1", "TSN 1", "g-wc"),
  chan("c-tsn4", "TSN 4", "g-wc"),
  chan("c-fifa1", "FIFA WC 1", "g-wc"),
  chan("c-fs1b", "FOX Sports 1", "g-wc"),
  chan("c-bbc1", "BBC One", "g-wc"),
  chan("c-ss1", "SuperSport", "g-wc"),
  chan("c-ss2", "SuperSport 2", "g-wc"),
];

/** Channels with no EPG data — they render the guide's "No info" state
 * (offline feeds, or channels the provider sends no programme info for). */
const NOINFO_CHANNELS: LiveChannel[] = [
  chan("c-ppv1", "Pop-Up PPV 1", "g-wc"),
  chan("c-barker", "Barker Channel", "g-wc"),
  chan("c-101", "Channel 101", "g-wc"),
  chan("c-studio", "Studio Feed (Offline)", "g-wc"),
];

/** A few hand-authored slots so the featured row reads like the design; the
 * rest are filled programmatically. */
const FEATURED_TITLE = "FIFA World Cup 2026 : Group D: USA vs. Paraguay Live";

export function mockConfig(deviceName: string): ConfigBlob {
  const now = Date.now();
  // Window the guide from 30 min ago, on a clean half-hour boundary.
  const gridStart = floorToHalfHour(now) - 30 * MIN;

  const programs: EpgProgram[] = [];
  for (const ch of CHANNELS) {
    programs.push(...generateRow(ch.id, gridStart));
  }

  // Make the featured channel's currently-airing program the marquee match.
  const tsn1Live = programs.find(
    (p) =>
      p.channelId === "c-tsn1" &&
      Date.parse(p.start) <= now &&
      Date.parse(p.stop) > now,
  );
  if (tsn1Live) {
    tsn1Live.title = FEATURED_TITLE;
    tsn1Live.description =
      "The United States meet Paraguay at MetLife Stadium with top spot in Group D on the line. Pulisic captains the hosts in front of a sold-out crowd.";
  }

  return {
    version: 1,
    deviceName,
    updatedAt: new Date(now).toISOString(),
    live: {
      groups: GROUPS,
      // No-info channels render below the scheduled ones; we intentionally
      // generate no programs for them.
      channels: [...CHANNELS, ...NOINFO_CHANNELS],
      programs,
      featuredChannelId: "c-tsn1",
    },
    movies: [
      vod("m1", "The Grand Budapest Hotel", 2014, "movie"),
      vod("m2", "Dune: Part Two", 2024, "movie"),
      vod("m3", "Everything Everywhere All at Once", 2022, "movie"),
      vod("m4", "Sinners", 2025, "movie"),
      vod("m5", "Oppenheimer", 2023, "movie"),
      vod("m6", "Past Lives", 2023, "movie"),
    ],
    series: [
      vod("s1", "Severance", 2022, "series"),
      vod("s2", "The Bear", 2022, "series"),
      vod("s3", "Slow Horses", 2022, "series"),
      vod("s4", "Shogun", 2024, "series"),
      vod("s5", "Andor", 2022, "series"),
    ],
    favorites: ["c-tsn1", "c-bbc1", "m2", "s1"],
  };
}

// Pseudo-random but deterministic per channel so reloads are stable-ish.
function generateRow(channelId: string, gridStart: number): EpgProgram[] {
  const titles = ROW_TITLES[channelId] ?? GENERIC_TITLES;
  const out: EpgProgram[] = [];
  let cursor = gridStart;
  const end = gridStart + 5 * 60 * MIN; // fill ~5 hours
  let i = 0;
  while (cursor < end) {
    const durMin = [30, 45, 60, 90, 120][(seed(channelId) + i) % 5];
    const stop = cursor + durMin * MIN;
    out.push({
      id: `${channelId}-p${i}`,
      channelId,
      title: titles[i % titles.length],
      start: new Date(cursor).toISOString(),
      stop: new Date(stop).toISOString(),
    });
    cursor = stop;
    i++;
  }
  return out;
}

const ROW_TITLES: Record<string, string[]> = {
  "c-tsn1": ["Pre-Match Build-Up", FEATURED_TITLE, "World Cup Tonight"],
  "c-fifa1": ["Group C: Brazil vs. Morocco", "World Cup Tonight", "Highlights"],
  "c-tsn4": ["SportsCentre", "SC", "SC", "SC", "SC"],
  "c-bbc1": ["The One Show", "EastEnders", "Match of the Day"],
  "c-ss1": ["Football Today", "Live: La Liga", "SuperSport Tonight"],
};

const GENERIC_TITLES = [
  "Studio Analysis",
  "Live Coverage",
  "Post-Game Show",
  "Magazine",
  "Replay",
];

function chan(id: string, name: string, groupId: string): LiveChannel {
  return {
    id,
    name,
    groupId,
    streamUrl: `https://example.invalid/stream/${id}.m3u8`,
  };
}

function vod(id: string, title: string, year: number, kind: "movie" | "series") {
  return { id, title, year, kind };
}

function floorToHalfHour(ms: number): number {
  return Math.floor(ms / (30 * MIN)) * 30 * MIN;
}

function seed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

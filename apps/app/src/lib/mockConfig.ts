import type {
  ConfigBlob,
  EpgProgram,
  LiveChannel,
  ChannelGroup,
  VodItem,
  StreamSource,
  Season,
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
  { id: "g-replay", name: "Replay  |  World Cup ⏪", hidden: false, order: 2 },
  { id: "g-4k", name: "4K / UHD Channels 📺", hidden: false, order: 3 },
  { id: "g-ppv", name: "Live Pay-Per-View 💸", hidden: false, order: 4 },
  { id: "g-nfl", name: "NFL Game Pass 🏈", hidden: false, order: 5 },
  { id: "g-usa-sports", name: "USA  |  Sports 🏀", hidden: false, order: 6 },
  { id: "g-usa-movies", name: "USA  |  Movies 🎬", hidden: false, order: 7 },
  { id: "g-usa-series", name: "USA  |  Series 🎞️", hidden: false, order: 8 },
  { id: "g-news", name: "News  |  Worldwide 📰", hidden: false, order: 9 },
  { id: "g-uk", name: "UK  |  Entertainment 🎭", hidden: false, order: 10 },
  { id: "g-kids", name: "Kids & Family 🧸", hidden: false, order: 11 },
];

const CHANNELS: LiveChannel[] = [
  // FIFA World Cup 2026 — the default view.
  chan("c-fs1", "FOX Sports 1", "g-wc"),
  chan("c-fs2", "FOX Sports 2", "g-wc"),
  chan("c-tsn1", "TSN 1", "g-wc"),
  chan("c-tsn4", "TSN 4", "g-wc"),
  chan("c-tsn5", "TSN 5", "g-wc"),
  chan("c-fifa1", "FIFA WC 1", "g-wc"),
  chan("c-fifa2", "FIFA WC 2", "g-wc"),
  chan("c-bbc1", "BBC One", "g-wc"),
  chan("c-itv1", "ITV 1", "g-wc"),
  chan("c-ss1", "SuperSport", "g-wc"),
  chan("c-ss2", "SuperSport 2", "g-wc"),
  chan("c-bein1", "beIN SPORTS 1", "g-wc"),
  chan("c-telemundo", "Telemundo", "g-wc"),
  chan("c-univision", "Univision", "g-wc"),
  chan("c-deportes", "ESPN Deportes", "g-wc"),
  chan("c-optus", "Optus Sport", "g-wc"),

  // USA | Sports
  chan("c-espn", "ESPN", "g-usa-sports"),
  chan("c-espn2", "ESPN 2", "g-usa-sports"),
  chan("c-nbatv", "NBA TV", "g-usa-sports"),
  chan("c-mlb", "MLB Network", "g-usa-sports"),
  chan("c-golf", "Golf Channel", "g-usa-sports"),

  // 4K / UHD
  chan("c-4ksport", "4K Sports", "g-4k"),
  chan("c-4kcine", "4K Cinema", "g-4k"),
  chan("c-uhdnat", "UHD Nature", "g-4k"),
  chan("c-4kdemo", "4K Demo Reel", "g-4k"),

  // NFL Game Pass
  chan("c-redzone", "NFL RedZone", "g-nfl"),
  chan("c-nflnet", "NFL Network", "g-nfl"),
  chan("c-gamepass", "Game Pass HD", "g-nfl"),
  chan("c-nflreplay", "NFL Replay", "g-nfl"),

  // News
  chan("c-cnn", "CNN International", "g-news"),
  chan("c-bbcnews", "BBC News", "g-news"),
  chan("c-skynews", "Sky News", "g-news"),
  chan("c-aljazeera", "Al Jazeera", "g-news"),

  // UK | Entertainment
  chan("c-bbc2", "BBC Two", "g-uk"),
  chan("c-ch4", "Channel 4", "g-uk"),
  chan("c-itv2", "ITV 2", "g-uk"),
  chan("c-ch5", "Channel 5", "g-uk"),

  // USA | Movies
  chan("c-hbo", "HBO", "g-usa-movies"),
  chan("c-showtime", "Showtime", "g-usa-movies"),
  chan("c-starz", "Starz", "g-usa-movies"),

  // USA | Series
  chan("c-amc", "AMC", "g-usa-series"),
  chan("c-fx", "FX", "g-usa-series"),
  chan("c-usanet", "USA Network", "g-usa-series"),

  // Replay | World Cup
  chan("c-wcreplay1", "WC Replay 1", "g-replay"),
  chan("c-wcreplay2", "WC Replay 2", "g-replay"),
  chan("c-classics", "Classic Matches", "g-replay"),

  // Live Pay-Per-View
  chan("c-ppvmain", "PPV Main Event", "g-ppv"),
  chan("c-ppvbox", "PPV Boxing", "g-ppv"),
  chan("c-ppvufc", "PPV UFC", "g-ppv"),

  // Kids & Family
  chan("c-cartoon", "Cartoon Network", "g-kids"),
  chan("c-nick", "Nickelodeon", "g-kids"),
  chan("c-disney", "Disney Channel", "g-kids"),

  // FIFA World Cup Events
  chan("c-wcopen", "Opening Ceremony", "g-wc-events"),
  chan("c-wcfan", "Fan Zone Live", "g-wc-events"),
  chan("c-wcdraw", "Draw & Press Room", "g-wc-events"),
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
    movies: MOVIES.map(decorate),
    series: SERIES.map(decorate),
    stream: STREAM,
    favorites: ["c-tsn1", "c-bbc1", "c-espn", "c-redzone", "m2", "s1"],
  };
}

/** Attach detail-page metadata (genres, cast) and a backend-ranked source list
 * to a catalog item. Real values come from the backend; these are stand-ins. */
function decorate(item: VodItem): VodItem {
  const g = seed(item.id);
  const isSeries = item.kind === "series";
  return {
    ...item,
    genres: [
      GENRE_POOL[g % GENRE_POOL.length],
      GENRE_POOL[(g + 2) % GENRE_POOL.length],
      GENRE_POOL[(g + 4) % GENRE_POOL.length],
    ],
    cast: CAST,
    // Movies carry sources directly; series carry them per-episode.
    sources: isSeries ? [] : SOURCES,
    seasons: isSeries ? makeSeasons(item.id) : [],
  };
}

const EP_TITLES = [
  "The Long Awaited Reunion",
  "A Promise Kept",
  "Into the Unknown",
  "Echoes of the Past",
  "No Way Back",
  "The Gathering Storm",
  "Smoke and Mirrors",
  "Crossing the Line",
  "Burning Bridges",
  "The Reckoning",
  "Last Light",
  "Homecoming",
];

/** A few seasons of placeholder episodes; the backend supplies the real ones. */
function makeSeasons(itemId: string): Season[] {
  const seasonCount = 3 + (seed(itemId) % 3); // 3–5 seasons
  return Array.from({ length: seasonCount }, (_, s) => {
    const epCount = 10 + ((seed(itemId) + s) % 9); // 10–18 episodes
    return {
      id: `${itemId}-s${s + 1}`,
      number: s + 1,
      name: `Season ${s + 1}`,
      episodes: Array.from({ length: epCount }, (_, e) => ({
        id: `${itemId}-s${s + 1}e${e + 1}`,
        number: e + 1,
        title: EP_TITLES[(seed(itemId) + e) % EP_TITLES.length],
        airDate: "Apr 30, 2026",
        sources: SOURCES,
      })),
    };
  });
}

const GENRE_POOL = [
  "Horror",
  "Suspense",
  "Thriller",
  "Drama",
  "Action",
  "Sci-Fi",
  "Mystery",
];

const CAST = [
  "John Mith",
  "Sharon Green",
  "Marcus Reed",
  "Elena Cole",
  "Sharon Green",
  "David Park",
  "Sharon Green",
  "Nadia Frost",
  "Sharon Green",
];

/** Placeholder source list — the backend supplies and ranks the real ones. */
const SOURCES: StreamSource[] = [
  src("2160p", true, ["☁︎ HDR · Remux", "🗣 English · Italian", "◧ 84.2 Mb/s · 4d", "★★★★★"]),
  src("1080p", true, ["☁︎ BluRay", "🗣 English · Italian", "◧ 54.8 Mb/s · 10d", "★★★★★"]),
  src("1080p", true, ["☁︎ WEB-DL", "🗣 English", "◧ 41.3 Mb/s · 22d", "★★★★☆"]),
  src("1080p", true, ["☁︎ BluRay", "🗣 English · French", "◧ 38.9 Mb/s · 15d", "★★★★☆"]),
  src("720p", true, ["☁︎ WEB-DL", "🗣 English", "◧ 18.6 Mb/s · 31d", "★★★★☆"]),
  src("1080p", false, ["⬇ Torrent · 312 seeders", "🗣 English · Italian", "◧ 51.0 Mb/s · 8d", "★★★★☆"]),
  src("2160p", false, ["⬇ Torrent · 88 seeders", "🗣 English", "◧ 79.4 Mb/s · 6d", "★★★☆☆"]),
  src("480p", true, ["☁︎ WEB-DL", "🗣 English", "◧ 7.2 Mb/s · 44d", "★★★☆☆"]),
];

function src(
  quality: string,
  cached: boolean,
  lines: string[],
): StreamSource {
  return {
    id: `${quality}-${seed(lines.join())}`,
    quality,
    cached,
    lines,
    streamUrl: `https://example.invalid/source/${seed(lines.join())}.mkv`,
  };
}

// Pseudo-random but deterministic per channel so reloads are stable-ish.
function generateRow(channelId: string, gridStart: number): EpgProgram[] {
  const titles = ROW_TITLES[channelId] ?? GENERIC_TITLES;
  const offset = seed(channelId);
  const out: EpgProgram[] = [];
  let cursor = gridStart;
  const end = gridStart + 5 * 60 * MIN; // fill ~5 hours
  let i = 0;
  while (cursor < end) {
    const durMin = [30, 45, 60, 90, 120][(offset + i) % 5];
    const stop = cursor + durMin * MIN;
    out.push({
      id: `${channelId}-p${i}`,
      channelId,
      // Offset the starting title per channel so adjacent rows differ.
      title: titles[(offset + i) % titles.length],
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
  "c-fifa2": ["Group E: Spain vs. Japan", "Match Replay", "Around the Grounds"],
  "c-tsn4": ["SportsCentre", "SC", "SC", "SC", "SC"],
  "c-bbc1": ["The One Show", "EastEnders", "Match of the Day"],
  "c-ss1": ["Football Today", "Live: La Liga", "SuperSport Tonight"],
  "c-redzone": ["NFL RedZone Live", "Every Touchdown", "Postgame"],
  "c-cnn": ["CNN Newsroom", "World Report", "Quest Means Business"],
  "c-cartoon": ["Adventure Time", "Teen Titans Go!", "Gumball"],
};

const GENERIC_TITLES = [
  "Studio Analysis",
  "Live Coverage",
  "Post-Game Show",
  "Magazine",
  "Replay",
  "Breaking News",
  "The Roundup",
  "Tonight Live",
  "Feature Documentary",
  "Highlights Reel",
  "Talk of the Day",
  "Late Night",
];

function chan(id: string, name: string, groupId: string): LiveChannel {
  return {
    id,
    name,
    groupId,
    streamUrl: `https://example.invalid/stream/${id}.m3u8`,
  };
}

// ---------- Stream catalog (movies + series) ----------
// Artwork is intentionally absent so cards render the placeholder treatment —
// the real backend hands back poster/backdrop URLs.

type Vod = Omit<VodItem, "kind" | "genres" | "cast" | "sources" | "seasons">;

function movie(item: Vod): VodItem {
  return { ...item, kind: "movie", genres: [], cast: [], sources: [], seasons: [] };
}
function series(item: Vod): VodItem {
  return { ...item, kind: "series", genres: [], cast: [], sources: [], seasons: [] };
}

const MOVIES: VodItem[] = [
  movie({ id: "m1", title: "The Grand Budapest Hotel", year: 2014, rating: 9.1, runtimeMin: 100 }),
  movie({ id: "m2", title: "Dune: Part Two", year: 2024, rating: 8.8, runtimeMin: 166, synopsis: "Paul Atreides unites with the Fremen to wage war against the Harkonnen and claim his destiny on Arrakis." }),
  movie({ id: "m3", title: "Everything Everywhere All at Once", year: 2022, rating: 8.9, runtimeMin: 139 }),
  movie({ id: "m4", title: "Sinners", year: 2025, rating: 8.2, runtimeMin: 137 }),
  movie({ id: "m5", title: "Oppenheimer", year: 2023, rating: 8.6, runtimeMin: 180, synopsis: "The story of J. Robert Oppenheimer and the Manhattan Project's race to build the atomic bomb." }),
  movie({ id: "m6", title: "Past Lives", year: 2023, rating: 8.4, runtimeMin: 106 }),
  movie({ id: "m7", title: "Blade Runner 2049", year: 2017, rating: 8.5, runtimeMin: 164 }),
  movie({ id: "m8", title: "Mad Max: Fury Road", year: 2015, rating: 8.7, runtimeMin: 120, synopsis: "On the fringes of a post-apocalyptic wasteland, two rebels just might be able to restore order." }),
  movie({ id: "m9", title: "Parasite", year: 2019, rating: 8.9, runtimeMin: 132, synopsis: "Greed and class discrimination threaten the newly formed bond between two very different families." }),
  movie({ id: "m10", title: "The Substance", year: 2024, rating: 7.8, runtimeMin: 141 }),
  movie({ id: "m11", title: "John Wick: Chapter 4", year: 2023, rating: 7.9, runtimeMin: 169 }),
  movie({ id: "m12", title: "Sicario", year: 2015, rating: 8.0, runtimeMin: 121 }),
];

const SERIES: VodItem[] = [
  series({ id: "s1", title: "Severance", year: 2022, rating: 8.7, runtimeMin: 50, synopsis: "Mark leads a team whose memories are surgically divided between their work and personal lives." }),
  series({ id: "s2", title: "The Bear", year: 2022, rating: 8.6, runtimeMin: 30 }),
  series({ id: "s3", title: "Slow Horses", year: 2022, rating: 8.3, runtimeMin: 45 }),
  series({ id: "s4", title: "Shogun", year: 2024, rating: 8.7, runtimeMin: 60, synopsis: "In feudal Japan, a stranded English pilot becomes a pawn in a ruthless lord's bid for power." }),
  series({ id: "s5", title: "Andor", year: 2022, rating: 8.4, runtimeMin: 45 }),
  series({ id: "s6", title: "The Last of Us", year: 2023, rating: 8.7, runtimeMin: 55, synopsis: "Twenty years after a fungal outbreak, a hardened survivor escorts a teenage girl across a ravaged America." }),
  series({ id: "s7", title: "Fallout", year: 2024, rating: 8.4, runtimeMin: 60 }),
  series({ id: "s8", title: "Reacher", year: 2022, rating: 8.1, runtimeMin: 50 }),
  series({ id: "s9", title: "Dark", year: 2017, rating: 8.7, runtimeMin: 60 }),
  series({ id: "s10", title: "Breaking Bad", year: 2008, rating: 9.5, runtimeMin: 49 }),
];

const STREAM = {
  featured: ["m2", "s6", "m9", "s4", "m5", "s1", "m8"],
  rows: [
    {
      id: "row-continue",
      title: "Continue Watching",
      layout: "landscape" as const,
      itemIds: ["s2", "m2", "s1", "m5", "s4", "m9"],
    },
    {
      id: "row-action-movie",
      title: "Action - Movie",
      layout: "poster" as const,
      itemIds: ["m2", "m8", "m11", "m12", "m7", "m4", "m1", "m3"],
    },
    {
      id: "row-action-series",
      title: "Action - Series",
      layout: "poster" as const,
      itemIds: ["s6", "s7", "s8", "s5", "s4", "s3", "s1", "s9"],
    },
    {
      id: "row-drama-movie",
      title: "Drama - Movie",
      layout: "poster" as const,
      itemIds: ["m5", "m9", "m6", "m3", "m10", "m1", "m4", "m7"],
    },
  ],
};

function floorToHalfHour(ms: number): number {
  return Math.floor(ms / (30 * MIN)) * 30 * MIN;
}

function seed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

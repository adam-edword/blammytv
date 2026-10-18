// A tiny fake Xtream Codes panel for end-to-end wiring tests.
// Serves player_api.php + xmltv.php with CORS open (the browser fallback
// path in lib/http.ts uses plain fetch).
//
//   node scripts/fake-panel.mjs        → panel on :8081
//
// Point the app at it by seeding localStorage before load (Playwright
// addInitScript): blammytv.playlists = {v:1, data:[{kind:"xtream", id:"t",
// name:"Test", enabled:true, server:"http://localhost:8081",
// username:"u", password:"p"}]}. Covers: categories, a hidden folder, a
// dead logo host (lettermark fallback), a no-EPG channel (No-Information
// lane), and filler programmes that must be dropped. And, for the user "vod"
// only (plan 028), movies and shows: folders (one flagged adult with an
// innocent name, one caught by name), a movie held twice (a 4K copy and a plain
// one, one TMDB id), movies with no TMDB id, a show in two seasons with a 4K
// copy of its first, the info call for each, and /movie/ and /series/ play
// routes. Every other user is answered as before: [] for any action it does
// not know, so no other harness sees a Stream library appear.
import http from "node:http";

const PORT = 8081;
/** Connection counters for the sidebar pill, "active/max". Overridable so a
 * harness can ask for the under-cap case: PANEL_CONNS=1/3 node fake-panel.mjs */
const PANEL_CONNS = (process.env.PANEL_CONNS ?? "3/3")
  .split("/")
  .map((n) => Number(n));

const CATEGORIES = [
  { category_id: "1", category_name: "🏆 Sports", parent_id: 0 },
  { category_id: "2", category_name: "News", parent_id: 0 },
  { category_id: "3", category_name: "Hidden Stuff", parent_id: 0 },
  // Adult-filter coverage: flagged by the panel (innocent name), caught by
  // name (no flag), and the classic false positive that must stay visible.
  { category_id: "5", category_name: "VIP Extra", parent_id: 0, is_adult: "1" },
  { category_id: "6", category_name: "XXX Movies", parent_id: 0 },
  { category_id: "7", category_name: "Adult Swim", parent_id: 0 },
];

const STREAMS = [
  {
    num: 1,
    name: "Fake ESPN 4K",
    stream_type: "live",
    stream_id: 101,
    stream_icon: `http://localhost:${PORT}/logo.png`,
    epg_channel_id: "espn.fake",
    category_id: "1",
  },
  {
    num: 2,
    name: "Fake Sky Sports FHD",
    stream_type: "live",
    stream_id: 102,
    stream_icon: "http://localhost:9/broken.png", // dead host → fallback path
    epg_channel_id: "sky.fake",
    category_id: "1",
  },
  {
    num: 3,
    name: "Fake News Channel",
    stream_type: "live",
    stream_id: 103,
    stream_icon: null,
    epg_channel_id: null, // no EPG id → "No Information" lane
    category_id: "2",
  },
  {
    num: 4,
    name: "Should Be Hidden HD",
    stream_type: "live",
    stream_id: 104,
    stream_icon: null,
    epg_channel_id: "hidden.fake",
    category_id: "3", // hidden category → dropped entirely
  },
  {
    num: 5,
    name: "Panel Flagged Channel",
    stream_type: "live",
    stream_id: 105,
    stream_icon: null,
    epg_channel_id: null,
    category_id: "5", // panel-flagged adult category
  },
  {
    num: 6,
    name: "Name Caught Channel",
    stream_type: "live",
    stream_id: 106,
    stream_icon: null,
    epg_channel_id: null,
    category_id: "6", // name-pattern adult category
  },
  {
    num: 7,
    name: "Sneaky Flagged Stream",
    stream_type: "live",
    stream_id: 107,
    stream_icon: null,
    epg_channel_id: null,
    category_id: "2", // innocent category, but the STREAM is flagged
    is_adult: "1",
  },
  {
    num: 8,
    name: "Toonami Reruns",
    stream_type: "live",
    stream_id: 108,
    stream_icon: null,
    epg_channel_id: null,
    category_id: "7", // Adult Swim — must survive the name filter
  },
];

// XMLTV times formatted "YYYYMMDDHHMMSS +0000".
const fmt = (ms) =>
  new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";

function xmltv() {
  // FAKE_NOW pins the guide to a moment (scripts/screens.mjs), so two
  // captures an hour apart draw the same programmes.
  const now = Number(process.env.FAKE_NOW) || Date.now();
  const HOUR = 3600_000;
  // Half-hour-aligned blocks so cells land on clean guide slots.
  const base = Math.floor(now / (30 * 60_000)) * 30 * 60_000;
  const progs = [];
  const add = (ch, startMs, endMs, title, desc) =>
    progs.push(
      `<programme start="${fmt(startMs)}" stop="${fmt(endMs)}" channel="${ch}">` +
        `<title>${title}</title><desc>${desc}</desc></programme>`,
    );
  // Out to +26h, so a programme 10+ hours ahead exists for the guide's
  // 24 hour window (verify-guide-window).
  for (let i = -1; i < 27; i++) {
    add(
      "espn.fake",
      base + i * HOUR,
      base + (i + 1) * HOUR,
      `ESPN Hour ${i + 2}`,
      `Wall-to-wall coverage, hour ${i + 2}.`,
    );
  }
  // SPELLED DIFFERENTLY ON PURPOSE. The panel calls this channel
  // "sky.fake"; the guide calls it "Sky.Fake". Real providers disagree with
  // themselves about case exactly like this, and exact-equality matching
  // dropped those channels silently while the data sat in the download.
  // verify-m3u asserts Sky still gets a guide, which only holds if the
  // parser normalises. Leave the case mismatch in.
  for (let i = -1; i < 5; i++) {
    add(
      "Sky.Fake",
      base + i * 1.5 * HOUR,
      base + (i + 1) * 1.5 * HOUR,
      `Sky Block ${i + 2}`,
      `Sky programming block ${i + 2}.`,
    );
  }
  // Filler that must be dropped.
  add("espn.fake", base - HOUR, base + 8 * HOUR, "To Be Announced", "filler");
  // Programme for the hidden channel — must never appear.
  add("hidden.fake", base, base + 8 * HOUR, "Hidden Show", "should not render");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><tv>` +
    `<channel id="espn.fake"><display-name>ESPN</display-name></channel>` +
    `<channel id="Sky.Fake"><display-name>Sky Sports</display-name></channel>` +
    progs.join("") +
    `</tv>`
  );
}

// 1x1 red PNG for the logo endpoint.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

// username "dups": a line where a stream is filed under two categories,
// as real panels do, so the same stream_id is listed twice, side by side.
// Three hundred of them, every other one repeated: what verify-guide-dups
// scrolls through (the Guide's "Maximum update depth" crash).
const DUPS = [];
for (let i = 0; i < 300; i++) {
  const s = { num: i + 1, name: `Dup Channel ${i + 1}`, stream_type: "live", stream_id: 5000 + i, stream_icon: null, epg_channel_id: null, category_id: "1" };
  DUPS.push(s);
  if (i % 2 === 0) DUPS.push({ ...s, category_id: "2" });
}

// username "pins": forty channels with a guide each, what verify-guide-pins
// scrolls through. Programme lengths vary per channel so every lane hands
// its pin to the next cell at a different scroll, and titles run from one
// word to far wider than any cell, so a pinned title is sometimes faded
// and sometimes not.
const PINS = Array.from({ length: 40 }, (_, i) => ({
  num: i + 1,
  name: `Pin Channel ${i + 1}`,
  stream_type: "live",
  stream_id: 6000 + i,
  stream_icon: null,
  epg_channel_id: `pin${i}.fake`,
  category_id: "1",
}));
const PIN_TITLES = [
  "News",
  "Late Movie",
  "The Extraordinarily Long Evening Documentary Series",
  "Match of the Day: Extended Highlights and Analysis",
  "Quiz",
];
const PIN_MINUTES = [25, 40, 55, 30, 45];

function pinsXmltv() {
  const now = Number(process.env.FAKE_NOW) || Date.now();
  const MIN = 60_000;
  const base = Math.floor(now / (30 * MIN)) * 30 * MIN;
  const progs = [];
  PINS.forEach((s, i) => {
    let t = base - 60 * MIN - ((i * 7) % 25) * MIN;
    for (let k = 0; t < base + 6 * 60 * MIN; k++) {
      const len = PIN_MINUTES[(i + k) % PIN_MINUTES.length] * MIN;
      const title = PIN_TITLES[(i * 3 + k) % PIN_TITLES.length];
      progs.push(
        `<programme start="${fmt(t)}" stop="${fmt(t + len)}" channel="${s.epg_channel_id}">` +
          `<title>${title}</title><desc>Programme ${k + 1}.</desc></programme>`,
      );
      t += len;
    }
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?><tv>` +
    PINS.map((s) => `<channel id="${s.epg_channel_id}"><display-name>${s.name}</display-name></channel>`).join("") +
    progs.join("") +
    `</tv>`
  );
}

// username "fix": a line with ONE channel whose guide id matches nothing in
// its guide, what verify-guide-fix hand-matches. The guide has the right
// listings under another id ("mm.guide", named "Mismatched News"), beside a
// few decoys, and one channel that matches properly (the control).
const FIX = [
  {
    num: 1,
    name: "Fix Matched Sports HD",
    stream_type: "live",
    stream_id: 7000,
    stream_icon: null,
    epg_channel_id: "fixsports.fake",
    category_id: "1",
  },
  {
    num: 2,
    name: "US: Mismatched News FHD",
    stream_type: "live",
    stream_id: 7001,
    stream_icon: null,
    epg_channel_id: "news.wrong.id", // the guide has no channel by this id
    category_id: "1",
  },
];
const FIX_GUIDE = [
  ["fixsports.fake", "Fix Matched Sports", "Matched Hour"],
  ["mm.guide", "Mismatched News", "Mapped Hour"],
  ["news.wire", "News Wire", "Wire Hour"],
  ["weather.guide", "Weather Now", "Weather Hour"],
  ["cooking.guide", "Cooking Hour", "Cooking Show"],
  ["movies.guide", "Retro Movies", "Retro Feature"],
];

// username "fixev": one EVENT channel, named for what is on it as a real
// provider's are ("NFHS Network 01: ... @ 11 Oct 08:00 AM ET": 96 characters
// that do not wrap), whose guide id matches nothing. verify-guide-fix opens
// its Fix guide dialog for the two things a name like that broke: the card
// the dialog sits in, and the order the guide's channels are offered in. The
// guide holds four event channels, listed in neither the order they should
// rank nor alphabetically: the same station and number as the channel, the
// same network with another number, the number only, and none of it.
const FIXEV = [
  {
    num: 1,
    name: "NFHS Network 01: Portsmouth Abbey School Middle School Girls Ice Hockey @ 11 Oct 08:00 AM ET",
    stream_type: "live",
    stream_id: 7100,
    stream_icon: null,
    epg_channel_id: "nfhs.wrong.id", // the guide has no channel by this id
    category_id: "1",
  },
];
const FIXEV_GUIDE = [
  ["sn01.guide", "Sportsnet+ 01: Sportsnet Central: Oct. 11 @ 12 Oct 05:00 AM ET", "Sportsnet Hour"],
  ["dazn.guide", "DAZN 1: Boxing Night: Oct. 11 @ 11 Oct 08:00 AM ET", "DAZN Hour"],
  ["nfhs05.guide", "NFHS Network 05: Ridgewood Boys Soccer @ 11 Oct 08:00 AM ET", "NFHS Five Hour"],
  ["nfhs01.guide", "NFHS Network 01: Brewster Academy Girls Lacrosse @ 12 Oct 07:00 PM ET", "NFHS One Hour"],
];

// username "extra": a line whose provider guide leaves two channels empty,
// what verify-guide-extra fills from a second guide (plan 025, P5). "Covered"
// has programmes in the provider's guide; "Gap Filled" and "Gap Empty" have
// none. /extra.xml is the second guide: it covers the first gap, and also
// "Covered", with other titles, which must NOT replace the provider's.
const EXTRA = [
  { num: 1, name: "Extra Covered", stream_type: "live", stream_id: 9001, stream_icon: null, epg_channel_id: "cov.fake", category_id: "1" },
  { num: 2, name: "Extra Gap Filled", stream_type: "live", stream_id: 9002, stream_icon: null, epg_channel_id: "gap1.fake", category_id: "1" },
  { num: 3, name: "Extra Gap Empty", stream_type: "live", stream_id: 9003, stream_icon: null, epg_channel_id: "gap2.fake", category_id: "1" },
];
const EXTRA_PROVIDER_GUIDE = [["cov.fake", "Covered", "Provider Hour"]];
const EXTRA_SECOND_GUIDE = [
  ["gap1.fake", "Gap One", "Extra Hour"],
  ["cov.fake", "Covered", "Extra Cov Hour"],
];

// username "redzone": a line with NFL RedZone on it, what verify-redzone offers
// on Sports and in Multi-view. A worse copy of it ("RedZone HD", no NFL in the
// name) sits first, so the pick has something to prefer it over. Three plain
// channels beside them fill the panel's three connections.
const REDZONE = [
  { num: 1, name: "RedZone HD", stream_type: "live", stream_id: 9100, stream_icon: null, epg_channel_id: null, category_id: "1" },
  { num: 2, name: "US: NFL Redzone", stream_type: "live", stream_id: 9101, stream_icon: null, epg_channel_id: null, category_id: "1" },
  { num: 3, name: "RZ Filler One", stream_type: "live", stream_id: 9102, stream_icon: null, epg_channel_id: null, category_id: "2" },
  { num: 4, name: "RZ Filler Two", stream_type: "live", stream_id: 9103, stream_icon: null, epg_channel_id: null, category_id: "2" },
  { num: 5, name: "RZ Filler Three", stream_type: "live", stream_id: 9104, stream_icon: null, epg_channel_id: null, category_id: "2" },
];

function fixXmltv(guide = FIX_GUIDE) {
  const now = Number(process.env.FAKE_NOW) || Date.now();
  const HOUR = 3600_000;
  const base = Math.floor(now / (30 * 60_000)) * 30 * 60_000;
  const progs = [];
  for (const [id, , title] of guide)
    for (let i = -1; i < 27; i++)
      progs.push(
        `<programme start="${fmt(base + i * HOUR)}" stop="${fmt(base + (i + 1) * HOUR)}" channel="${id}">` +
          `<title>${title} ${i + 2}</title><desc>${title}, hour ${i + 2}.</desc></programme>`,
      );
  return (
    `<?xml version="1.0" encoding="UTF-8"?><tv>` +
    guide.map(([id, name]) => `<channel id="${id}"><display-name>${name}</display-name></channel>`).join("") +
    progs.join("") +
    `</tv>`
  );
}

// username "vod": a provider's movies and shows (plan 028), shaped like the
// answers Adam's real panel sent (plans/028-xtream-vod.md, "The data"): ids as
// numbers where the panel sends numbers and strings where it sends strings,
// `added` a string of unix seconds, `tmdb_id` a number. Folder ids are small
// numbers and a movie folder and a show folder share two of them ("12", "13"),
// as they can on a real panel: they are two lists, and the app keys them apart.
const IMG = `http://localhost:${PORT}/logo.png`;
const folder = (id, name, extra = {}) => ({ category_id: id, category_name: name, parent_id: 0, ...extra });

const VOD_CATEGORIES = [
  folder("11", "4K Movies"),
  folder("12", "Action"),
  folder("13", "Comedy"),
  folder("14", "Premium Vault", { is_adult: "1" }), // flagged by the panel, innocent name
  folder("15", "XXX Movies"), // caught by its name
];
const SERIES_CATEGORIES = [folder("12", "Drama"), folder("13", "Sitcoms")];

const movie = (stream_id, name, category_id, extra = {}) => ({
  num: stream_id - 3000,
  name,
  stream_type: "movie",
  stream_id,
  tmdb_id: stream_id + 900000,
  stream_icon: IMG,
  rating: "6.8",
  rating_5based: 3.4,
  added: String(1760000000 + stream_id),
  is_adult: "0",
  category_id,
  container_extension: "mkv",
  custom_sid: "",
  direct_source: "",
  ...extra,
});

const VOD_STREAMS = [
  // One movie twice: a 4K copy in 4K Movies and a plain one in Action, one TMDB id.
  movie(3001, "4K The Fantastic 4: First Steps (2025)", "11", { tmdb_id: 617126, rating: "7.2", rating_5based: 3.6 }),
  movie(3002, "The Fantastic 4: First Steps (2025)", "12", { tmdb_id: 617126, rating: "7.2", rating_5based: 3.6, container_extension: "mp4" }),
  // No TMDB id: the field absent on one (undefined drops out of the JSON), 0 on
  // another. Each is keyed by its stream id.
  movie(3003, "Home Movie Night (2019)", "13", { tmdb_id: undefined }),
  movie(3004, "Kitchen Sink Story (2021)", "12", { tmdb_id: 0 }),
  // A panel that spells it `tmdb`, and as a string.
  movie(3005, "Other Panel Spelling (2020)", "13", { tmdb_id: undefined, tmdb: "98765" }),
  // Adult three ways: the title flagged in an ordinary folder, and a title in each adult folder.
  movie(3006, "Flagged In Plain Sight (2022)", "12", { is_adult: 1 }),
  movie(3007, "Vault Feature (2021)", "14"),
  movie(3008, "Name Caught Feature (2020)", "15"),
  // Plain movies, so a row has something in it.
  movie(3010, "The Long Road Home (2023)", "12"),
  movie(3011, "Paper Moon Rising (2022)", "12"),
  movie(3012, "Laugh Track (2021)", "13"),
  movie(3013, "Second Wind (2019)", "13"),
  movie(3014, "Midnight Express Lane (2024)", "12"),
  movie(3015, "4K Skyline Run (2024)", "11"),
  movie(3016, "Quiet Harbor (2020)", "13"),
];

const show = (series_id, name, category_id, extra = {}) => ({
  num: series_id - 4000,
  name,
  series_id,
  tmdb_id: series_id + 70000,
  cover: IMG,
  plot: `The plot of ${name}.`,
  cast: "Ada Ames, Ben Bright, Cy Cole",
  director: "Dee Drew",
  genre: "Comedy, War & Politics",
  releaseDate: "2023-03-04",
  last_modified: String(1760000000 + series_id),
  rating: "7.5",
  rating_5based: 3.75,
  backdrop_path: [IMG],
  youtube_trailer: "",
  episode_run_time: "30",
  is_adult: "0",
  category_id,
  ...extra,
});

// A show in two seasons and a 4K copy of it with the first season only (one
// TMDB id), so an episode's sources are gathered from two copies.
const SERIES = [
  show(4001, "Two Season Show (2023)", "12", { tmdb_id: 70001 }),
  show(4002, "4K Two Season Show (2023)", "13", { tmdb_id: 70001 }),
  show(4003, "Show Without Backdrop (2020)", "13", { backdrop_path: [] }),
  show(4004, "Plain Series (2021)", "12"),
];

// Episodes by series id: { season: how many }. An episode's id is its series
// id times 100 plus a running number, as a string, the way the panel sends it.
const SERIES_EPISODES = { 4001: { 1: 3, 2: 2 }, 4002: { 1: 3 }, 4003: { 1: 2 }, 4004: { 1: 2 } };

function seriesInfo(id) {
  const s = SERIES.find((x) => String(x.series_id) === id);
  if (!s) return []; // an unknown id: a panel answers with an empty array, never an error
  const { tmdb_id: _t, ...info } = s; // the info repeats the list's fields, with no tmdb_id
  const episodes = {};
  let n = 0;
  for (const [season, count] of Object.entries(SERIES_EPISODES[s.series_id])) {
    episodes[season] = Array.from({ length: count }, (_, i) => ({
      id: String(s.series_id * 100 + ++n),
      episode_num: i + 1,
      title: `${s.name.replace(/^4K /, "").replace(/ \(\d{4}\)$/, "")} S0${season}E0${i + 1}`,
      container_extension: "mkv",
      info: {
        movie_image: IMG,
        releaseDate: `2023-0${season}-0${i + 1}`,
        plot: `Season ${season}, episode ${i + 1}.`,
        rating: "7.1",
        duration_secs: 1800,
        duration: "00:30:00",
      },
      custom_sid: "",
      added: s.last_modified,
      season: Number(season),
      direct_source: "",
    }));
  }
  return { info, episodes };
}

function vodInfo(id) {
  const m = VOD_STREAMS.find((x) => String(x.stream_id) === id);
  if (!m) return []; // an unknown id: an empty array, as seriesInfo answers
  const year = /\((\d{4})\)$/.exec(m.name)?.[1] ?? "2020";
  return {
    info: {
      movie_image: m.stream_icon,
      name: m.name,
      tmdb_id: m.tmdb_id ?? m.tmdb ?? 0,
      backdrop: IMG,
      backdrop_path: [],
      youtube_trailer: "",
      genre: "Action, Adventure",
      plot: `The plot of ${m.name}.`,
      cast: "Ada Ames, Ben Bright, Cy Cole",
      rating: m.rating,
      director: "Dee Drew",
      releasedate: `${year}-07-23`,
      duration_secs: 6900,
      duration: "01:55:00",
    },
    movie_data: {
      stream_id: m.stream_id,
      name: m.name,
      added: m.added,
      category_id: m.category_id,
      container_extension: m.container_extension,
      custom_sid: "",
      direct_source: "",
    },
  };
}

// The user "vod"'s answer to a movie or show action, or undefined for an action
// that is not one (the live ones, which it gets like everybody).
function vodAnswer(action, params) {
  if (action === "get_vod_categories") return VOD_CATEGORIES;
  if (action === "get_series_categories") return SERIES_CATEGORIES;
  if (action === "get_vod_streams") return VOD_STREAMS;
  if (action === "get_series") return SERIES;
  if (action === "get_vod_info") return vodInfo(params.get("vod_id"));
  if (action === "get_series_info") return seriesInfo(params.get("series_id"));
  return undefined;
}

const LINES = { dups: DUPS, pins: PINS, fix: FIX, fixev: FIXEV, extra: EXTRA, redzone: REDZONE };

// Every request the panel has answered, with the User-Agent it came with, so a
// harness can say what was asked and as whom (verify-guide-extra). Read at
// /__log and emptied by /__log?clear=1; nothing else looks at it.
const LOG = [];

/** decodeURIComponent that leaves a malformed escape as it came, so a bad path
 * is a 404 and not a crashed panel. */
function unescapeSafe(s) {
  if (s === undefined) return undefined;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (url.pathname === "/__log") {
      res.setHeader("Content-Type", "application/json");
      const body = JSON.stringify(LOG);
      if (url.searchParams.get("clear")) LOG.length = 0;
      return res.end(body);
    }
    // A play route carries the user in its path, not a query (/movie/<user>/...).
    const playUser = unescapeSafe(/^\/(?:movie|series)\/([^/]+)\//.exec(url.pathname)?.[1]);
    LOG.push({
      path: url.pathname,
      action: url.searchParams.get("action"),
      user: url.searchParams.get("username") ?? playUser ?? null,
      ua: req.headers["user-agent"] ?? null,
    });
    if (LOG.length > 4000) LOG.shift();
    if (url.pathname === "/player_api.php") {
      const action = url.searchParams.get("action");
      res.setHeader("Content-Type", "application/json");
      if (!action)
        return res.end(
          JSON.stringify({
            // active_cons/max_connections are what the sidebar's connection
            // pill reads (parseConnections in data/xtream.ts returns null
            // without BOTH). They were missing here, so the pill could never
            // render and verify-conns — whose entire subject is that pill —
            // had nothing to find. At the cap on purpose: that is the state
            // worth showing, and the one the harness accents.
            user_info: {
              auth: 1,
              status: "Active",
              active_cons: PANEL_CONNS[0],
              max_connections: PANEL_CONNS[1],
            },
            server_info: {},
          }),
        );
      if (url.searchParams.get("username") === "vod") {
        const answer = vodAnswer(action, url.searchParams);
        if (answer !== undefined) return res.end(JSON.stringify(answer));
      }
      // The user "novod": a live-only panel that fails the movie and show
      // calls outright instead of answering [] (verify-xtvod).
      if (url.searchParams.get("username") === "novod" && vodAnswer(action, url.searchParams) !== undefined) {
        res.statusCode = 500;
        return res.end("no such action");
      }
      if (action === "get_live_categories")
        return res.end(JSON.stringify(CATEGORIES));
      if (action === "get_live_streams")
        return res.end(JSON.stringify(LINES[url.searchParams.get("username")] ?? STREAMS));
      return res.end("[]");
    }
    if (url.pathname === "/xmltv.php") {
      res.setHeader("Content-Type", "application/xml");
      const user = url.searchParams.get("username");
      return res.end(
        user === "pins"
          ? pinsXmltv()
          : user === "fix"
            ? fixXmltv()
            : user === "fixev"
              ? fixXmltv(FIXEV_GUIDE)
              : user === "extra"
                ? fixXmltv(EXTRA_PROVIDER_GUIDE)
                : xmltv(),
      );
    }
    if (url.pathname === "/extra.xml") {
      res.setHeader("Content-Type", "application/xml");
      return res.end(fixXmltv(EXTRA_SECOND_GUIDE));
    }
    if (url.pathname === "/extra-broken.xml") {
      res.statusCode = 500;
      return res.end("the second guide is down");
    }
    // The play routes of the user "vod": any id, a tiny body, and the request is
    // in the log (path, user and User-Agent) for a harness to read. Everyone
    // else still gets the 404 below.
    if (playUser === "vod") {
      res.setHeader("Content-Type", "video/mp4");
      return res.end("fake video");
    }
    if (url.pathname === "/logo.png") {
      res.setHeader("Content-Type", "image/png");
      return res.end(PNG);
    }
    res.statusCode = 404;
    res.end("not found");
  })
  .listen(PORT, () => console.log(`fake panel on :${PORT}`));

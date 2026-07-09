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
// lane), and filler programmes that must be dropped.
import http from "node:http";

const PORT = 8081;

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
  const now = Date.now();
  const HOUR = 3600_000;
  // Half-hour-aligned blocks so cells land on clean guide slots.
  const base = Math.floor(now / (30 * 60_000)) * 30 * 60_000;
  const progs = [];
  const add = (ch, startMs, endMs, title, desc) =>
    progs.push(
      `<programme start="${fmt(startMs)}" stop="${fmt(endMs)}" channel="${ch}">` +
        `<title>${title}</title><desc>${desc}</desc></programme>`,
    );
  for (let i = -1; i < 8; i++) {
    add(
      "espn.fake",
      base + i * HOUR,
      base + (i + 1) * HOUR,
      `ESPN Hour ${i + 2}`,
      `Wall-to-wall coverage, hour ${i + 2}.`,
    );
  }
  for (let i = -1; i < 5; i++) {
    add(
      "sky.fake",
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
    progs.join("") +
    `</tv>`
  );
}

// 1x1 red PNG for the logo endpoint.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (url.pathname === "/player_api.php") {
      const action = url.searchParams.get("action");
      res.setHeader("Content-Type", "application/json");
      if (!action)
        return res.end(
          JSON.stringify({
            user_info: { auth: 1, status: "Active" },
            server_info: {},
          }),
        );
      if (action === "get_live_categories")
        return res.end(JSON.stringify(CATEGORIES));
      if (action === "get_live_streams")
        return res.end(JSON.stringify(STREAMS));
      return res.end("[]");
    }
    if (url.pathname === "/xmltv.php") {
      res.setHeader("Content-Type", "application/xml");
      return res.end(xmltv());
    }
    if (url.pathname === "/logo.png") {
      res.setHeader("Content-Type", "image/png");
      return res.end(PNG);
    }
    res.statusCode = 404;
    res.end("not found");
  })
  .listen(PORT, () => console.log(`fake panel on :${PORT}`));

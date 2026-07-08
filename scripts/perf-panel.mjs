// Profiling fake panel: an Xtream Codes panel at real-provider scale, for
// load-pipeline timing work (cold vs disk-hydrated launches, the `[live]`
// stage logs, guide virtualization). By default it SYNTHESIZES the catalog
// at the scale the load-time saga was fought at — ~20k streams and a
// ~50MB xmltv — so no real provider dump is needed:
//
//   node scripts/perf-panel.mjs                  → synthetic, :8090
//   node scripts/perf-panel.mjs streams.json     → real get_live_streams dump
//   STREAMS=220000 node scripts/perf-panel.mjs   → huge-playlist hardening scale
//
// FHD/HD/SD variants share an epg_channel_id (like real playlists), ~10% of
// channel families have none (No-Information lanes).
import http from "node:http";
import fs from "node:fs";

const PORT = Number(process.env.PORT ?? 8090);
const PROGS_PER_CHANNEL = Number(process.env.PROGS_PER_CHANNEL ?? 48);

function synthesize() {
  const n = Number(process.env.STREAMS ?? 20_000);
  const QUAL = ["4K", "FHD", "HD"];
  const streams = [];
  for (let i = 0; i < n; i++) {
    const family = Math.floor(i / 3); // quality variants share a family
    const hasEpg = family % 10 !== 0;
    streams.push({
      num: i + 1,
      name: `Channel ${family} ${QUAL[i % 3]}`,
      stream_type: "live",
      stream_id: 100_000 + i,
      stream_icon: null,
      epg_channel_id: hasEpg ? `ch${family}.fake` : null,
      category_id: String(1 + (family % 60)),
    });
  }
  return streams;
}

const dumpPath = process.argv[2];
const streams = dumpPath
  ? JSON.parse(fs.readFileSync(dumpPath, "utf8"))
  : synthesize();
const STREAMS_RAW = JSON.stringify(streams);
console.log(
  `${streams.length} streams (${(STREAMS_RAW.length / 1e6).toFixed(1)}MB)` +
    (dumpPath ? ` from ${dumpPath}` : " synthesized"),
);

// Categories derived from the streams' category_ids.
const catIds = [
  ...new Set(streams.map((s) => String(s.category_id ?? ""))),
].filter(Boolean);
const CATEGORIES = catIds.map((id) => ({
  category_id: id,
  category_name: `Category ${id}`,
  parent_id: 0,
}));

// A realistic xmltv: for every unique epg id, half-hour programmes across a
// day (starting 24h back so the −1h..+12h parse window is fully covered).
// Generated once and cached in memory.
const fmt = (ms) =>
  new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
function buildXmltv() {
  const epgIds = [
    ...new Set(
      streams.filter((s) => s.epg_channel_id).map((s) => s.epg_channel_id),
    ),
  ];
  const base =
    Math.floor(Date.now() / (30 * 60_000)) * 30 * 60_000 - 24 * 3600_000;
  const HALF = 30 * 60_000;
  const parts = [`<?xml version="1.0" encoding="UTF-8"?><tv>`];
  for (const id of epgIds) {
    parts.push(`<channel id="${id}"><display-name>${id}</display-name></channel>`);
  }
  for (const id of epgIds) {
    for (let i = 0; i < PROGS_PER_CHANNEL; i++) {
      const s = base + i * HALF;
      parts.push(
        `<programme start="${fmt(s)}" stop="${fmt(s + HALF)}" channel="${id}">` +
          `<title>Programme ${i} on ${id}</title>` +
          `<desc>A representative synopsis for slot ${i} on channel ${id}, long enough to be realistic.</desc>` +
          `</programme>`,
      );
    }
  }
  parts.push(`</tv>`);
  return parts.join("");
}
console.log("building xmltv…");
const t = Date.now();
const XMLTV = buildXmltv();
console.log(
  `xmltv built: ${(XMLTV.length / 1e6).toFixed(1)}MB in ${Date.now() - t}ms`,
);

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (url.pathname === "/player_api.php") {
      const action = url.searchParams.get("action");
      res.setHeader("Content-Type", "application/json");
      if (!action)
        return res.end(JSON.stringify({ user_info: { auth: 1, status: "Active" } }));
      if (action === "get_live_categories") return res.end(JSON.stringify(CATEGORIES));
      if (action === "get_live_streams") return res.end(STREAMS_RAW);
      return res.end("[]");
    }
    if (url.pathname === "/xmltv.php") {
      res.setHeader("Content-Type", "application/xml");
      return res.end(XMLTV);
    }
    res.statusCode = 404;
    res.end("not found");
  })
  .listen(PORT, () => console.log(`perf panel on :${PORT}`));

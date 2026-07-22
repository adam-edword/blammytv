// A tiny fake M3U provider for end-to-end wiring tests.
// Serves playlist.m3u + guide.xml with CORS open (the browser fallback
// path in lib/http.ts uses plain fetch).
//
//   node scripts/fake-m3u.mjs        → provider on :8082
//
// Point the app at it by seeding localStorage before load (Playwright
// addInitScript): blammytv.playlists = {v:1, data:[{kind:"m3u", id:"m",
// name:"Test M3U", enabled:true, url:"http://localhost:8082/playlist.m3u"}]}.
// Covers: three named groups, an adult-named group ("XXX Movies") for the
// adult filter, a dead logo host (lettermark fallback), a channel with no
// attributes at all (Ungrouped + URL-hash id), and an EPG feed advertised
// via the header's url-tvg.
import http from "node:http";

const PORT = 8082;

const PLAYLIST = `#EXTM3U url-tvg="http://localhost:${PORT}/guide.xml"
#EXTINF:-1 tvg-id="espn.m3u" tvg-name="Fake ESPN" tvg-logo="http://localhost:${PORT}/logo.png" group-title="🏆 Sports",Fake ESPN 4K
http://localhost:${PORT}/stream/espn.ts
#EXTINF:-1 tvg-id="sky.m3u" tvg-name="Fake Sky Sports" tvg-logo="http://localhost:9/broken.png" group-title="🏆 Sports",Fake Sky Sports FHD
http://localhost:${PORT}/stream/sky.ts
#EXTINF:-1 tvg-id="news.m3u" tvg-logo="http://localhost:${PORT}/logo.png" group-title="News",Fake News Channel
http://localhost:${PORT}/stream/news.ts
#EXTINF:-1 group-title="News",Fake Weather Now
http://localhost:${PORT}/stream/weather.ts
#EXTINF:-1 group-title="XXX Movies",Late Night Feature
http://localhost:${PORT}/stream/latenight.ts
#EXTINF:-1,Mystery Stream
http://localhost:${PORT}/stream/mystery.ts
`;

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
      "espn.m3u",
      base + i * HOUR,
      base + (i + 1) * HOUR,
      `ESPN Hour ${i + 2}`,
      `Wall-to-wall coverage, hour ${i + 2}.`,
    );
  }
  for (let i = -1; i < 5; i++) {
    add(
      "sky.m3u",
      base + i * 1.5 * HOUR,
      base + (i + 1) * 1.5 * HOUR,
      `Sky Block ${i + 2}`,
      `Sky programming block ${i + 2}.`,
    );
  }
  for (let i = -1; i < 4; i++) {
    add(
      "news.m3u",
      base + i * 2 * HOUR,
      base + (i + 1) * 2 * HOUR,
      `News Cycle ${i + 2}`,
      `Rolling headlines, cycle ${i + 2}.`,
    );
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?><tv>` +
    `<channel id="espn.m3u"><display-name>Fake ESPN</display-name></channel>` +
    `<channel id="sky.m3u"><display-name>Fake Sky Sports</display-name></channel>` +
    `<channel id="news.m3u"><display-name>Fake News</display-name></channel>` +
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
    if (url.pathname === "/playlist.m3u") {
      res.setHeader("Content-Type", "application/x-mpegurl");
      return res.end(PLAYLIST);
    }
    if (url.pathname === "/guide.xml") {
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
  .listen(PORT, () => console.log(`fake m3u provider on :${PORT}`));

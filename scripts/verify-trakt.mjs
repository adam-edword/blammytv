// E2E: Trakt (plan 015), with a fake Trakt in this process. The page's
// Trakt commands (trakt.rs in the app) are stubbed to forward to it, the
// way http_get is stubbed to fetch: trakt.rs's own tests cover the tokens,
// the refresh and the pacing; this covers what the app does with Trakt's
// answers.
//
// - The first sync sends the episodes ticked here that Trakt lacks, dated
//   "unknown", and after it Trakt's ticks are the ledger (T3, D3).
// - A film paused on Trakt joins Continue Watching at its position (T4).
// - The watchlist arrives as a list of its own, with no Rename or Delete
//   (D2), and a title saved to it here goes to Trakt within seconds.
// - Playing a film scrobbles it: a start while it plays, a stop past 80%
//   when it is left, and Trakt's "scrobble" answer marks it here (T2).
// - Clearing Continue Watching clears Trakt's paused position too.
//
// Offline, as every harness is: every host but localhost is aborted.
//
//   node scripts/fake-aio.mjs     # :8084
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-trakt.mjs
import http from "node:http";
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const APP = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

// ---------------------------------------------------------------- fake Trakt
const recent = new Date(Date.now() - 3600_000).toISOString();
const state = {
  // Episodes Trakt knows as watched, "tt:season:episode".
  watched: new Set(["tt200001:1:1", "tt200001:1:2"]),
  watchlist: new Map([["tt100003", { title: "Fake Movie Three", year: 2024, listed_at: recent }]]),
  playback: [
    {
      id: 777,
      progress: 40,
      paused_at: recent,
      type: "movie",
      movie: { title: "Fake Movie Two", year: 2024, runtime: 100, ids: { imdb: "tt100002" } },
    },
    {
      id: 888,
      progress: 20,
      paused_at: new Date(Date.now() - 7200_000).toISOString(),
      type: "episode",
      show: { title: "Fake Series One", year: 2023, ids: { imdb: "tt200001" } },
      episode: { season: 1, number: 4, title: "Four", runtime: 45, ids: { trakt: 5004 } },
    },
  ],
};
const calls = [];
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const trakt = http.createServer((rq, rs) => {
  let raw = "";
  rq.on("data", (c) => (raw += c));
  rq.on("end", () => {
    if (rq.method === "OPTIONS") {
      rs.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, PUT, DELETE",
        "access-control-allow-headers": "content-type",
      });
      return rs.end();
    }
    const url = new URL(rq.url, "http://x");
    const path = url.pathname;
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: rq.method, path, body });
    if (path === "/sync/last_activities")
      return json(rs, 200, {
        all: recent,
        movies: { watched_at: recent, paused_at: recent, watchlisted_at: recent },
        episodes: { watched_at: recent, paused_at: recent, watchlisted_at: recent },
        shows: { watchlisted_at: recent },
      });
    if (path === "/sync/watched/shows") {
      const seasons = new Map();
      for (const k of state.watched) {
        const [, s, e] = k.split(":").map(Number);
        seasons.set(s, [...(seasons.get(s) ?? []), { number: e }]);
      }
      return json(rs, 200, [
        {
          show: { title: "Fake Series One", ids: { imdb: "tt200001" } },
          seasons: [...seasons].map(([number, episodes]) => ({ number, episodes })),
        },
      ]);
    }
    if (path === "/sync/watched/movies") return json(rs, 200, []);
    if (path === "/sync/history" && rq.method === "POST") {
      for (const sh of body.shows ?? [])
        for (const se of sh.seasons) for (const ep of se.episodes) state.watched.add(`${sh.ids.imdb}:${se.number}:${ep.number}`);
      return json(rs, 201, { added: { episodes: 1, movies: 0 } });
    }
    if (path === "/sync/playback") return json(rs, 200, state.playback);
    if (path.startsWith("/sync/playback/") && rq.method === "DELETE") {
      state.playback = state.playback.filter((p) => `/sync/playback/${p.id}` !== path);
      return json(rs, 204);
    }
    if (path === "/sync/watchlist/movies")
      return json(rs, 200, [...state.watchlist].map(([imdb, m]) => ({ listed_at: m.listed_at, type: "movie", movie: { title: m.title, year: m.year, ids: { imdb } } })));
    if (path === "/sync/watchlist/shows") return json(rs, 200, []);
    if (path === "/sync/watchlist" && rq.method === "POST") {
      for (const m of body.movies ?? []) state.watchlist.set(m.ids.imdb, { title: m.ids.imdb, year: 2024, listed_at: new Date().toISOString() });
      return json(rs, 201, { added: { movies: (body.movies ?? []).length } });
    }
    if (path === "/sync/watchlist/remove") {
      for (const m of body.movies ?? []) state.watchlist.delete(m.ids.imdb);
      return json(rs, 200, { deleted: { movies: (body.movies ?? []).length } });
    }
    const ep = /^\/shows\/(tt\d+)\/seasons\/(\d+)\/episodes\/(\d+)$/.exec(path);
    if (ep) return json(rs, 200, { season: +ep[2], number: +ep[3], ids: { trakt: 5000 + +ep[3] } });
    const sc = /^\/scrobble\/(start|pause|stop)$/.exec(path);
    if (sc) {
      const scrobbled = sc[1] === "stop" && body.progress > 80;
      // As Trakt does: a watch ends the item's paused position.
      if (scrobbled) state.playback = state.playback.filter((p) => p.movie?.ids.imdb !== body.movie?.ids?.imdb);
      return json(rs, 201, { action: scrobbled ? "scrobble" : sc[1] === "stop" ? "pause" : sc[1], progress: body.progress });
    }
    return json(rs, 404, { error: "fake trakt has no " + path });
  });
});
await new Promise((r) => trakt.listen(0, "127.0.0.1", r));
const PORT = trakt.address().port;
const seen = (method, path) => calls.filter((c) => c.method === method && c.path === path);

// ---------------------------------------------------------------- the page
const stub = ({ port }) => {
  window.__pos = 2400;
  window.__dur = 6000;
  let cb = 0;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (f) => {
      const id = ++cb;
      window["_" + id] = f;
      return id;
    },
    convertFileSrc: (p) => p,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    invoke: (cmd, args) => {
      if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
      if (cmd === "trakt_status") return Promise.resolve({ configured: true, connected: true });
      if (cmd === "trakt_request")
        return fetch(`http://127.0.0.1:${port}${args.path}`, {
          method: args.method,
          headers: { "content-type": "application/json" },
          ...(args.body != null ? { body: args.body } : {}),
        }).then(async (r) => ({ status: r.status, body: await r.text(), retry_after: null, account_limit: null, upgrade_url: null }));
      if (cmd === "mpv_status")
        return Promise.resolve(
          JSON.stringify({ pos: window.__pos, dur: window.__dur, presenting: true, ended: false, buffering: false, seekable: true, audio: [], subs: [], chapters: [] }),
        );
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "stream" }));
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  // Ticked here before connecting: episode 3, which Trakt does not have.
  localStorage.setItem("blammytv.watchedEpisodes", JSON.stringify({ v: 1, data: { tt200001: ["tt200001:1:3"] } }));
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(stub, { port: PORT });
await page.goto(APP, { waitUntil: "domcontentloaded" });
const store = (key) => page.evaluate((k) => JSON.parse(localStorage.getItem(`blammytv.${k}`) ?? "null")?.data ?? null, key);
const waitFor = async (fn, ms = 10_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await page.waitForTimeout(200);
  }
  return false;
};

// ------------------------------------------------------------ the first sync
await waitFor(() => page.evaluate(() => !!JSON.parse(localStorage.getItem("blammytv.trakt") ?? "null")?.data?.lastSync));
const pushed = seen("POST", "/sync/history")[0]?.body;
check(
  "the first sync sends the episodes ticked here that Trakt lacks, dated unknown",
  JSON.stringify(pushed) === JSON.stringify({ shows: [{ ids: { imdb: "tt200001" }, seasons: [{ number: 1, episodes: [{ number: 3, watched_at: "unknown" }] }] }] }),
  JSON.stringify(pushed),
);
const ledger = await store("watchedEpisodes");
check(
  "  and Trakt's ticks, with it, are the ledger after",
  JSON.stringify([...(ledger?.tt200001 ?? [])].sort()) === JSON.stringify(["tt200001:1:1", "tt200001:1:2", "tt200001:1:3"]),
  JSON.stringify(ledger),
);
const cw = await store("watching");
const two = cw?.find((e) => e.id === "tt100002");
check(
  "a film paused on Trakt joins Continue Watching at its position",
  !!two && two.posSec === 2400 && two.durSec === 6000 && two.trakt === 777 && two.title === "Fake Movie Two",
  JSON.stringify(two),
);
await page.locator(".continue-card", { hasText: "Fake Movie Two" }).first().waitFor({ timeout: 10_000 }).catch(() => {});
check(
  "  and it is on the Continue Watching row",
  (await page.locator(".continue-card", { hasText: "Fake Movie Two" }).count()) > 0,
);

// ------------------------------------------------------------ the watchlist
const lists = await store("lists");
const tl = lists?.find((l) => l.id === "__trakt");
check(
  "the Trakt watchlist arrives as a list of its own, My List untouched",
  !!tl && tl.name === "Trakt Watchlist" && tl.entries.map((e) => e.id).join() === "tt100003" && lists.length === 1,
  JSON.stringify(lists?.map((l) => [l.name, l.entries.map((e) => e.id)])),
);
await goTo(page, "mylist");
await page.getByText("Trakt Watchlist").first().click({ timeout: 10_000 });
await page.locator(".library__bar-actions").first().waitFor({ timeout: 5000 }).catch(() => {});
const actions = await page.locator(".library__bar-actions button").allInnerTexts();
check(
  "  it can have a cover, and has no Rename or Delete (it comes and goes with Trakt)",
  actions.includes("Set cover") && !actions.includes("Rename") && !actions.includes("Delete"),
  JSON.stringify(actions),
);

// A title saved to it here goes to Trakt within seconds.
await goTo(page, "discover");
await page.locator('[data-hint="Fake Movie One"]').first().click({ timeout: 15_000 });
await page.getByRole("button", { name: "Choose lists" }).click({ timeout: 10_000 });
await page.getByRole("menuitemcheckbox", { name: /Trakt Watchlist/ }).click();
await page.keyboard.press("Escape");
const sent = await waitFor(() => seen("POST", "/sync/watchlist").some((c) => c.body?.movies?.some((m) => m.ids.imdb === "tt100001")), 12_000);
check("a title saved to it here goes to Trakt within seconds", sent, JSON.stringify(seen("POST", "/sync/watchlist").map((c) => c.body)));
await page.getByRole("button", { name: "Choose lists" }).click({ timeout: 10_000 });
await page.getByRole("menuitemcheckbox", { name: /Trakt Watchlist/ }).click();
await page.keyboard.press("Escape");
const gone = await waitFor(() => seen("POST", "/sync/watchlist/remove").some((c) => c.body?.movies?.some((m) => m.ids.imdb === "tt100001")), 12_000);
check("  and taken off it here, it comes off Trakt", gone, JSON.stringify(seen("POST", "/sync/watchlist/remove").map((c) => c.body)));

// ------------------------------------------------------------ scrobbling
// Out of the film's page (the Stream tab keeps it), back to the rows.
await page.locator(".vod-back").first().click({ timeout: 5000 });
await goTo(page, "home");
const card = page.locator(".continue-card", { hasText: "Fake Movie Two" }).first();
await card.waitFor({ timeout: 10_000 });
await page.waitForTimeout(800);
await card.click();
const started = await waitFor(() => seen("POST", "/scrobble/start").length > 0, 25_000);
const start = seen("POST", "/scrobble/start")[0]?.body;
check(
  "playing a film scrobbles a start with where it is",
  started && start?.movie?.ids?.imdb === "tt100002" && Math.round(start.progress) === 40,
  JSON.stringify(start),
);
// Near the end, then leave it: the stop carries the real percentage, and
// Trakt's "scrobble" answer marks the film watched here.
await page.evaluate(() => (window.__pos = 5700));
// The 5s progress tick writes the position into the watch entry first.
await page.waitForTimeout(6000);
// Wake the chrome and leave by its Back.
const ov = await page.locator(".theater-overlay").first().boundingBox();
await page.mouse.move(ov.x + ov.width / 2, ov.y + ov.height / 2);
await page.mouse.move(ov.x + ov.width / 2 + 20, ov.y + ov.height / 2 + 10);
await page.getByRole("button", { name: "Back", exact: true }).first().click({ timeout: 5000 });
const stopped = await waitFor(() => seen("POST", "/scrobble/stop").length > 0, 10_000);
const stop = seen("POST", "/scrobble/stop")[0]?.body;
check("  leaving it sends a stop past 80%", stopped && stop?.progress >= 80, JSON.stringify(stop));
const marked = await waitFor(async () => !!(await store("trakt"))?.movies?.tt100002, 5000);
check("  and Trakt's scrobble answer marks the film watched here", marked, JSON.stringify((await store("trakt"))?.movies));

// ------------------------------------------------------------ clearing
await goTo(page, "mylist");
// Library comes back into the list you left (the Trakt Watchlist): out to
// its root, then into the built-in history card.
if (await page.locator(".library__bar .vod-back").count()) await page.locator(".library__bar .vod-back").first().click();
await page.locator('.library__card[data-hint="Library"]').first().click({ timeout: 10_000 });
const clear = page.getByRole("button", { name: /Clear history/ });
await clear.click({ timeout: 10_000 });
await page.getByRole("button", { name: /Click again to confirm/ }).click();
const deleted = await waitFor(() => seen("DELETE", "/sync/playback/888").length > 0, 5000);
check(
  "clearing Continue Watching clears Trakt's paused positions too (the series paused elsewhere)",
  deleted && seen("DELETE", "/sync/playback/777").length === 0,
  JSON.stringify(calls.filter((c) => c.method === "DELETE").map((c) => c.path)),
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
trakt.close();
process.exit(fail ? 1 : 0);

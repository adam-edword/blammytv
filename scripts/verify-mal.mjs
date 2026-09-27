// E2E: MyAnimeList (plan 021), with a fake MAL in this process. The page's
// MAL commands (mal.rs in the app) are stubbed to forward to it, the way
// verify-trakt does for Trakt: mal.rs's own tests cover the sign-in, the
// tokens and the pacing; this covers what the app does with MAL's answers.
//
// - MAL's counts tick episodes on a series page, and the next episode
//   follows them (D2 b).
// - Finishing an episode here moves its MAL entry's count up to it (D1),
//   "completed" at the entry's last episode, and never down.
// - Where two entries share a season, the TV one is written (D5).
// - Progress MAL can't take right now waits, and goes at the next sync.
// - Settings → General → Accounts: Connect opens MAL in the browser and
//   notices the approval; a decline says so; Disconnect forgets the
//   counts and their ticks. A build without a MAL key offers nothing.
//
// Fake Series One (tt200001) stands in for an anime: its meta gains the
// Animation genre, and the Fribb dataset is served with rows for it. Every
// host but localhost is aborted, as in every harness.
//
//   node scripts/fake-aio.mjs     # :8084
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mal.mjs
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

// ---------------------------------------------------------------- fake MAL
// Season 1 is MAL 5001 (12 episodes), season 2 is a TV entry (5002, one
// episode) with an OVA (5099) on the same season and offset.
const DATASET = [
  { imdb_id: "tt200001", mal_id: 5001, type: "TV", season: { tvdb: 1 } },
  { imdb_id: "tt200001", mal_id: 5099, type: "OVA", season: { tvdb: 2 } },
  { imdb_id: "tt200001", mal_id: 5002, type: "TV", season: { tvdb: 2 } },
];
const EPISODES = { 5001: 12, 5002: 1, 5099: 2 };
const state = { counts: new Map([[5001, 2]]), down: false };
const calls = [];
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const mal = http.createServer((rq, rs) => {
  let raw = "";
  rq.on("data", (c) => (raw += c));
  rq.on("end", () => {
    if (rq.method === "OPTIONS") {
      rs.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, PATCH, PUT, DELETE",
        "access-control-allow-headers": "content-type",
      });
      return rs.end();
    }
    const url = new URL(rq.url, "http://x");
    const path = url.pathname;
    const form = Object.fromEntries(new URLSearchParams(raw));
    calls.push({ method: rq.method, path, query: Object.fromEntries(url.searchParams), form, type: rq.headers["content-type"] ?? "" });
    if (path === "/users/@me") return json(rs, 200, { id: 1, name: "adam" });
    if (path === "/users/@me/animelist")
      return json(rs, 200, {
        data: [...state.counts].map(([id, n]) => ({ node: { id, title: `Entry ${id}` }, list_status: { status: "watching", num_episodes_watched: n } })),
        paging: {},
      });
    const one = /^\/anime\/(\d+)$/.exec(path);
    if (one && rq.method === "GET") {
      const id = +one[1];
      return json(rs, 200, {
        id,
        num_episodes: EPISODES[id] ?? 0,
        ...(state.counts.has(id) ? { my_list_status: { num_episodes_watched: state.counts.get(id) } } : {}),
      });
    }
    const ls = /^\/anime\/(\d+)\/my_list_status$/.exec(path);
    if (ls && rq.method === "PATCH") {
      if (state.down) return json(rs, 503, { error: "down" });
      state.counts.set(+ls[1], +form.num_watched_episodes);
      return json(rs, 200, { status: form.status, num_episodes_watched: +form.num_watched_episodes });
    }
    return json(rs, 404, { error: "fake mal has no " + path });
  });
});
await new Promise((r) => mal.listen(0, "127.0.0.1", r));
const PORT = mal.address().port;
const patches = () => calls.filter((c) => c.method === "PATCH");

// ---------------------------------------------------------------- the page
const stub = ({ port, configured, connected }) => {
  window.__pos = 100;
  window.__dur = 1000;
  window.__calls = [];
  window.__connected = connected;
  window.__polls = [];
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
      window.__calls.push([cmd, args]);
      if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
      if (cmd === "mal_status") return Promise.resolve({ configured, connected: window.__connected });
      if (cmd === "mal_sign_in_start") return Promise.resolve("https://myanimelist.net/v1/oauth2/authorize?response_type=code");
      if (cmd === "mal_sign_in_poll") {
        const next = window.__polls.shift() ?? "waiting";
        if (next === "approved") window.__connected = true;
        return Promise.resolve({ at: next });
      }
      if (cmd === "mal_disconnect") {
        window.__connected = false;
        return Promise.resolve();
      }
      if (cmd === "mal_request") {
        const q = args.form ? new URLSearchParams(args.form).toString() : "";
        const get = args.method === "GET";
        return fetch(`http://127.0.0.1:${port}${args.path}${get && q ? `?${q}` : ""}`, {
          method: args.method,
          ...(!get && q ? { body: q, headers: { "content-type": "application/x-www-form-urlencoded" } } : {}),
        }).then(async (r) => ({ status: r.status, body: await r.text() }));
      }
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
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
// Registered after, so tried first: the mapping dataset, and an anime genre
// on Fake Series One's meta.
await ctx.route(/raw\.githubusercontent\.com\/Fribb\/anime-lists\//, (r) =>
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DATASET) }),
);
await ctx.route(/localhost:8084\/meta\/series\/tt200001\.json/, async (r) => {
  const res = await r.fetch();
  const body = await res.json();
  body.meta.genres = [...(body.meta.genres ?? []), "Animation"];
  await r.fulfill({ response: res, body: JSON.stringify(body) });
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(stub, { port: PORT, configured: true, connected: true });
await page.goto(APP, { waitUntil: "domcontentloaded" });
const store = (p, key) => p.evaluate((k) => JSON.parse(localStorage.getItem(`blammytv.${k}`) ?? "null")?.data ?? null, key);
const waitFor = async (fn, ms = 10_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await page.waitForTimeout(200);
  }
  return false;
};

// ------------------------------------------------------------ counts in
await waitFor(async () => !!(await store(page, "mal"))?.lastSync);
const list = calls.find((c) => c.path === "/users/@me/animelist");
check(
  "at launch the list is read, all of it (nsfw) and 1,000 a page, and its counts kept",
  list?.query.nsfw === "true" && list?.query.limit === "1000" && list?.query.fields === "list_status" && (await store(page, "mal"))?.counts?.[5001] === 2,
  JSON.stringify({ query: list?.query, counts: (await store(page, "mal"))?.counts }),
);

await goTo(page, "home");
await page.locator(".stream-card", { hasText: "Fake Series One" }).first().click({ timeout: 15_000 });
await page.waitForFunction(() => document.body.innerText.includes("Season 1"), null, { timeout: 15_000 }).catch(() => {});
const ticked = await waitFor(async () => (await page.locator(".episode-card__seen").count()) === 2, 10_000);
const next = await page.locator(".episode-card.is-next").first().innerText().catch(() => "");
check(
  "MAL's count ticks episodes 1 and 2 on the series page, and episode 3 is next",
  ticked && next.includes("S1E3"),
  JSON.stringify({ seen: await page.locator(".episode-card__seen").count(), next: next.slice(0, 40), mal: await store(page, "malWatched") }),
);
check(
  "  kept apart from the ledger Trakt replaces",
  JSON.stringify((await store(page, "malWatched"))?.tt200001) === JSON.stringify(["tt200001:1:1", "tt200001:1:2"]) &&
    !(await store(page, "watchedEpisodes"))?.tt200001,
  JSON.stringify({ mal: await store(page, "malWatched"), ledger: await store(page, "watchedEpisodes") }),
);

// ------------------------------------------------------------ progress out
// Play episode 3 and let it pass 90%: the app ticks it, and MAL hears.
await page.locator(".episode-card").nth(2).click();
await page.locator(".vod-source").first().click({ timeout: 15_000 });
await page.evaluate(() => {
  window.__pos = 950;
});
const sent = await waitFor(() => patches().some((c) => c.path === "/anime/5001/my_list_status"), 20_000);
const p3 = patches().find((c) => c.path === "/anime/5001/my_list_status");
check(
  "finishing episode 3 moves MAL's count to 3, watching, form-encoded",
  sent && p3.form.num_watched_episodes === "3" && p3.form.status === "watching" && p3.type === "application/x-www-form-urlencoded",
  JSON.stringify(p3),
);
check("  once, though the tick repeats every 5 seconds", (await waitFor(async () => false, 6000), patches().length === 1), JSON.stringify(patches().map((c) => c.path)));

// The rest go the same way in (EPISODE_WATCHED, as markWatched says it).
const watched = (episodeId) =>
  page.evaluate((e) => window.dispatchEvent(new CustomEvent("blammytv:episode-watched", { detail: { seriesId: "tt200001", episodeId: e } })), episodeId);
const reads = () => calls.filter((c) => c.method === "GET" && c.path === "/anime/5001").length;
const before = reads();
await watched("tt200001:1:1");
await waitFor(async () => reads() > before, 5000);
await page.waitForTimeout(500);
check(
  "rewatching episode 1 of an entry at 3 reads MAL and sends nothing (never down)",
  reads() > before && patches().length === 1,
  JSON.stringify({ reads: reads() - before, patches: patches().length }),
);

await watched("tt200001:2:1");
const s2 = await waitFor(() => patches().some((c) => c.path.startsWith("/anime/5002/")), 8000);
const p5002 = patches().find((c) => c.path.startsWith("/anime/5002/"));
check(
  "season 2's episode goes to its TV entry, not the OVA beside it, completed at its last episode",
  s2 && p5002.form.status === "completed" && p5002.form.num_watched_episodes === "1" && !patches().some((c) => c.path.startsWith("/anime/5099/")),
  JSON.stringify(patches().map((c) => [c.path, c.form])),
);

state.down = true;
await watched("tt200001:1:4");
const queued = await waitFor(async () => (await store(page, "mal"))?.pending?.[5001] === 4, 8000);
check("progress MAL can't take right now waits", queued, JSON.stringify((await store(page, "mal"))?.pending));
state.down = false;

// ------------------------------------------------------------ Settings
// Out of the player and the page, then Settings: the row names the
// account, and Sync now sends what waited.
const ov = await page.locator(".theater-overlay").first().boundingBox();
if (ov) {
  await page.mouse.move(ov.x + ov.width / 2, ov.y + ov.height / 2);
  await page.mouse.move(ov.x + ov.width / 2 + 20, ov.y + ov.height / 2 + 10);
  await page.getByRole("button", { name: "Back", exact: true }).first().click({ timeout: 5000 }).catch(() => {});
}
await page.getByRole("button", { name: "Settings", exact: true }).first().click({ timeout: 15_000 });
const title = await page
  .locator(".mal-row .customize-row__title", { hasText: "MyAnimeList: adam" })
  .waitFor({ timeout: 8000 })
  .then(() => true, () => false);
await page.locator(".mal-row").getByRole("button", { name: "Sync now" }).click({ timeout: 5000 });
const flushed = await waitFor(
  async () => patches().some((c) => c.path === "/anime/5001/my_list_status" && c.form.num_watched_episodes === "4") && !(await store(page, "mal"))?.pending?.[5001],
  10_000,
);
check("  and goes at the next sync (Sync now, on the account's row)", title && flushed, JSON.stringify({ title, pending: (await store(page, "mal"))?.pending }));

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await page.close();

// ------------------------------------------------------------ connecting
const openSettings = async (p) => {
  await p.getByRole("button", { name: "Settings", exact: true }).first().click({ timeout: 15_000 });
  await p.locator(".mal-row").first().waitFor({ timeout: 10_000 });
};
{
  const keyless = await ctx.newPage();
  await keyless.addInitScript(stub, { port: PORT, configured: false, connected: false });
  await keyless.goto(APP, { waitUntil: "domcontentloaded" });
  await openSettings(keyless);
  const text = await keyless.locator(".mal-row").first().innerText();
  check(
    "a build without a MAL key says so, and offers no Connect",
    /no MyAnimeList key/.test(text) && (await keyless.locator(".mal-row button").count()) === 0,
    text.replace(/\n/g, " | "),
  );
  await keyless.close();

  const p2 = await ctx.newPage();
  p2.on("pageerror", (e) => errors.push(String(e)));
  await p2.addInitScript(stub, { port: PORT, configured: true, connected: false });
  await p2.goto(APP, { waitUntil: "domcontentloaded" });
  await openSettings(p2);
  const row = p2.locator(".mal-row");

  // A decline first.
  await p2.evaluate(() => (window.__polls = ["denied"]));
  await row.getByRole("button", { name: "Connect" }).click();
  const declined = await row.getByText(/you declined/).waitFor({ timeout: 6000 }).then(() => true, () => false);
  check("a declined sign-in says so, and offers Connect again", declined && (await row.getByRole("button", { name: "Connect" }).count()) === 1);

  const before2 = calls.length;
  await p2.evaluate(() => (window.__polls = ["waiting", "approved"]));
  await row.getByRole("button", { name: "Connect" }).click();
  const waiting = await row.getByRole("button", { name: "Open MyAnimeList" }).waitFor({ timeout: 4000 }).then(() => true, () => false);
  const opened = await p2.evaluate(() => window.__calls.filter(([c]) => c === "open_external").map(([, a]) => a.url));
  check(
    "Connect opens MAL's sign-in in the browser, and waits with Open MyAnimeList and Cancel",
    waiting && opened.length === 2 && opened[1].startsWith("https://myanimelist.net/v1/oauth2/authorize") && (await row.getByRole("button", { name: "Cancel" }).count()) === 1,
    JSON.stringify({ waiting, opened }),
  );
  const on = await row
    .locator(".customize-row__title", { hasText: "MyAnimeList: adam" })
    .waitFor({ timeout: 8000 })
    .then(() => true, () => false);
  const synced = calls.slice(before2).some((c) => c.path === "/users/@me/animelist");
  const buttons = await row.locator("button").allInnerTexts();
  if (process.env.SHOT_DIR) await p2.locator(".settings-section", { has: row }).first().screenshot({ path: `${process.env.SHOT_DIR}/mal-connected.png` });
  check(
    "  approved, it names the account, syncs, and offers Sync now and Disconnect",
    on && synced && buttons.includes("Sync now") && buttons.includes("Disconnect"),
    JSON.stringify({ on, synced, buttons }),
  );
  // What a series page would have ticked from MAL, to see it go.
  await p2.evaluate(() => localStorage.setItem("blammytv.malWatched", JSON.stringify({ v: 1, data: { tt200001: ["tt200001:1:1"] } })));
  await row.getByRole("button", { name: "Disconnect" }).click();
  await row.getByRole("button", { name: /Click again to confirm/ }).click();
  const off = await row.getByRole("button", { name: "Connect" }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  const after = await p2.evaluate(() => ({
    disconnect: window.__calls.some(([c]) => c === "mal_disconnect"),
    mal: localStorage.getItem("blammytv.mal"),
    ticks: localStorage.getItem("blammytv.malWatched"),
  }));
  check(
    "Disconnect signs out and forgets the counts and their ticks",
    off && after.disconnect && after.mal === null && after.ticks === null,
    JSON.stringify({ off, ...after }),
  );
  await p2.close();
}
check("no page errors in Settings", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
mal.close();
process.exit(fail ? 1 : 0);

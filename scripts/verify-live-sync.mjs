// E2E: the catalog follows the playlists on every screen (audit LV3).
//
// Only the Guide listened for a playlist change, so a playlist switched on in
// Settings while Multi-view (or Sports) was up loaded nothing: the palette's
// channel search, Multi-view's picker and Sports' rail clicks all read a
// catalog keyed to the OLD playlists until the Guide was opened.
//
// This drives the real app in the plain browser (no IPC stub), with the panel
// as the one enabled line and an M3U provider added in Settings, and counts
// what reaches the network:
// - on Multi-view, switching the M3U on loads it once, the panel's channels
//   with it once, and the palette and the picker find an M3U channel;
// - on the Guide, where its own listener sits beside the app's, switching it
//   off again is still one load.
// And the guide's copy on disk follows the saved playlists: it holds the
// panel's account, so a playlist switched off keeps it, a playlist deleted
// takes it, and a copy no saved playlist owns (one a settings import left, or
// 1.0.1's, with the account itself in it) is gone at the next launch.
//
//   node scripts/fake-panel.mjs   # :8081
//   node scripts/fake-m3u.mjs     # :8082
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-live-sync.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const PLAYLISTS = {
  v: 1,
  data: [
    {
      kind: "xtream",
      id: "t",
      name: "Test",
      enabled: true,
      server: "http://localhost:8081",
      username: "u",
      password: "p",
    },
    {
      kind: "m3u",
      id: "m",
      name: "Test M3U",
      enabled: false,
      url: "http://localhost:8082/playlist.m3u",
    },
  ],
};
// A name only the M3U carries: the panel has no weather channel.
const ONLY_M3U = "Fake Weather Now";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Offline, like every harness: only the fakes on localhost.
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const seen = [];
page.on("request", (r) => seen.push(r.url()));
await page.addInitScript((pl) => {
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
  localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
}, PLAYLISTS);

const count = (re) => seen.filter((u) => re.test(u)).length;
const panelLoads = () => count(/localhost:8081\/player_api\.php.*get_live_streams/);
const m3uLoads = () => count(/localhost:8082\/playlist\.m3u/);

/** Flip a playlist's switch in Settings, then let the burst settle and the
 * load run (800ms, then a fetch or two on localhost). */
async function toggle(name) {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("switch", { name: `${name} enabled` }).click();
  await page.keyboard.press("Escape");
  await page.locator('[role="dialog"]').first().waitFor({ state: "detached", timeout: 5000 });
  await page.waitForTimeout(3000);
}

await page.goto(URL, { waitUntil: "domcontentloaded" });

// ---- On Multi-view, no Guide mounted
await goTo(page, "multiview");
await page.locator(".mvtab").waitFor();
// useLiveData's cold load for the panel, the one thing the screen loads.
const loaded = async () => {
  const end = Date.now() + 15_000;
  while (Date.now() < end && panelLoads() === 0) await page.waitForTimeout(200);
  await page.waitForTimeout(1500);
};
await loaded();
const p0 = panelLoads();
check("on Multi-view the panel's catalog loaded once at mount", p0 === 1, `${p0} loads`);
check("and the M3U, switched off, wasn't fetched", m3uLoads() === 0, `${m3uLoads()} fetches`);
await page.mouse.click(4, 450); // off any control, so a key is the page's

await toggle("Test M3U");
check(
  "switching the M3U on fetched it once, with no Guide mounted",
  m3uLoads() === 1,
  `${m3uLoads()} fetches`,
);
check(
  "and reloaded the panel's channels once with it, not twice",
  panelLoads() === p0 + 1,
  `${panelLoads() - p0} reloads`,
);

// The picker reads useLiveData: it re-reads on the announcement.
await page.keyboard.press("a");
await page.locator(".mvpick__input").waitFor({ timeout: 5000 });
await page.locator(".mvpick__input").fill("Weather");
await page.waitForTimeout(400);
check(
  "Multi-view's picker finds the M3U's channel",
  (await page.locator(".mvpick__row", { hasText: ONLY_M3U }).count()) > 0,
);
await page.keyboard.press("Escape");
await page.locator(".mvpick__input").waitFor({ state: "detached", timeout: 5000 });

// The palette reads lookupLive, whatever screen is up.
await page.keyboard.press("Control+k");
const search = page.locator('input[aria-label="Search BlammyTV"]');
await search.waitFor({ timeout: 5000 });
await search.fill("weather");
await page.waitForTimeout(400);
check(
  "and so does the palette",
  (await page.getByText(ONLY_M3U, { exact: true }).count()) > 0,
);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// ---- On the Guide, the screen's own listener is there too
await goTo(page, "guide");
await page.locator(".guide__channel").first().waitFor({ timeout: 15_000 });
await page.waitForTimeout(1500);
const p1 = panelLoads();
const m1 = m3uLoads();
await toggle("Test M3U");
check(
  "on the Guide, switching the M3U off is one load, with both listeners up",
  panelLoads() === p1 + 1,
  `${panelLoads() - p1} reloads`,
);
check("and the M3U isn't fetched for it", m3uLoads() === m1, `${m3uLoads() - m1} fetches`);

// ---- The guide's copy on disk, and the playlists that own it
/** The guide's record as it is on disk: its key, the ids it names, and its
 * channel count; null when there is none (or no database). */
const liveRecord = (pg = page) =>
  pg.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("blammytv", 1);
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("liveCache")) return resolve(null), db.close();
          const rq = db.transaction("liveCache").objectStore("liveCache").get("live");
          rq.onsuccess = () => {
            const v = rq.result;
            resolve(v ? { key: v.key, ids: v.ids ?? null, channels: v.data?.channels?.length ?? 0 } : null);
            db.close();
          };
          rq.onerror = () => resolve(null);
        };
      }),
  );
const until = async (fn, ms, every = 200) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await page.waitForTimeout(every);
  }
  return false;
};
// The Guide is up on the panel alone: its catalog and guide have landed, and
// the write runs a moment after.
await toggle("Test M3U"); // back on, so the record names two playlists
const wrote = await until(async () => ((await liveRecord())?.ids ?? []).join() === "t,m", 20_000);
const rec = await liveRecord();
check("(control) the guide's copy is on disk, naming both playlists it was built from", wrote, JSON.stringify(rec));
check(
  "  and holds a hash of the playlists' accounts, not the accounts",
  /^[0-9a-f]{64}$/.test(rec?.key ?? "") && !/localhost|8081/.test(rec?.key ?? ""),
  JSON.stringify(rec?.key),
);

// Deleting the M3U: the copy names it, so it goes at once (the panel's load
// writes a fresh one a few seconds on). Caught between the two, polled fast: a
// copy that is merely replaced later would pass a check that only asked
// whether it still named the M3U.
await page.getByRole("button", { name: "Settings", exact: true }).first().click();
await page.getByRole("button", { name: "Delete Test M3U" }).click();
await page.getByRole("button", { name: "Click again to remove Test M3U" }).click();
const dropped = await until(async () => (await liveRecord()) === null, 2000, 50);
check("deleting a playlist the copy was built from drops the copy", dropped, JSON.stringify(await liveRecord()));
const again = await until(async () => ((await liveRecord())?.ids ?? []).join() === "t", 20_000);
check("  and the load that follows writes a copy of the one that is left", again, JSON.stringify(await liveRecord()));

// Switching the last one off is not deleting it: the copy stays.
await page.getByRole("switch", { name: "Test enabled" }).click();
await page.waitForTimeout(3000);
check("a playlist only switched off keeps its copy", (await liveRecord())?.ids?.join() === "t", JSON.stringify(await liveRecord()));

// Deleting the last one: nothing loads after it, so nothing would replace the copy.
await page.getByRole("button", { name: "Delete Test", exact: true }).click();
await page.getByRole("button", { name: "Click again to remove Test" }).click();
const gone = await until(async () => (await liveRecord()) === null, 10_000);
check("deleting the last playlist drops the copy, with no source left to load", gone, JSON.stringify(await liveRecord()));

// And a copy no saved playlist owns is gone at the next launch: here 1.0.1's,
// which names no playlist and holds the account itself. In a context of its own
// whose one saved playlist is switched off, so that nothing loads after the
// launch to write a copy of its own over the planted one.
{
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx2.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  const p2 = await ctx2.newPage();
  await p2.addInitScript((pl) => {
    sessionStorage.setItem("btv:welcome-played", "1");
    localStorage.setItem("btv:onboarded", "1");
    localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
  }, { v: 1, data: [{ kind: "m3u", id: "m", name: "Test M3U", enabled: false, url: "http://localhost:8082/playlist.m3u" }] });
  await p2.goto(URL, { waitUntil: "domcontentloaded" });
  await p2.getByRole("button", { name: "Settings", exact: true }).first().waitFor({ timeout: 15_000 });
  await p2.waitForTimeout(1000); // the launch's own prune has run, on an empty database
  const planted = await p2.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("blammytv", 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains("liveCache")) open.result.createObjectStore("liveCache");
        };
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("liveCache", "readwrite");
          const data = { groups: [], channels: [], programmes: new Map() };
          tx.objectStore("liveCache").put({ key: JSON.stringify([[["t", "http://old.invalid", "olduser", "oldpass", []]], false]), at: 1, data }, "live");
          tx.oncomplete = () => (db.close(), resolve(true));
          tx.onerror = () => resolve(false);
        };
      }),
  );
  check("(control) a copy from before the prune, with the account in its key, is planted", planted && !!(await liveRecord(p2))?.key.includes("oldpass"), JSON.stringify(await liveRecord(p2)));
  await p2.reload({ waitUntil: "domcontentloaded" });
  const swept = await (async () => {
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      if ((await liveRecord(p2)) === null) return true;
      await p2.waitForTimeout(200);
    }
    return false;
  })();
  check("a reload drops a copy that names no saved playlist", swept, JSON.stringify(await liveRecord(p2)));
  await ctx2.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);

// E2E: Settings → App, Clear All Login Info, takes everything it says it
// does and nothing comes back (week of 2026-09-28, the app shell audit).
//
// The Sources pane beside it read its list once, at mount. After a clear it
// still showed the playlist, and its next save (a toggle, an add) wrote the
// playlist and its password back. The guide's copy in IndexedDB, keyed by
// the Xtream server, username and password, stayed too.
//
// Since the five pages (v0.11.26) the button is on the App page and the
// Sources pane is on its own page, so "beside the button" is not a thing
// that can happen: a page is mounted only while it shows. What can still go
// wrong is the same bug a page away: a pane that comes back from the stale
// list. So each pane is opened first, the clear is made from App, and the
// pane is opened again, which is where it has to show nothing.
//
//   node scripts/fake-panel.mjs     # :8081
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-clear-logins.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`);
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
  ],
};
// Nothing listens there: only the field and the storage matter here.
const MANIFEST = "http://localhost:9/secret-config/manifest.json";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Offline, like every harness: only the fake panel on localhost.
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(
  ({ pl, manifest }) => {
    // Once: the reload below must see what the clear left.
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    sessionStorage.setItem("btv:welcome-played", "1");
    localStorage.setItem("btv:onboarded", "1");
    localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
    localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: manifest }));
    localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "live" }));
  },
  { pl: PLAYLISTS, manifest: MANIFEST },
);

const stored = (key) => page.evaluate((k) => JSON.parse(localStorage.getItem(`blammytv.${k}`) ?? "null")?.data, key);
const diskRecord = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("blammytv", 1);
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("liveCache")) return resolve(null), db.close();
          const rq = db.transaction("liveCache").objectStore("liveCache").get("live");
          rq.onsuccess = () => {
            resolve(rq.result ? { channels: rq.result.data.channels.length } : null);
            db.close();
          };
          rq.onerror = () => resolve(null);
        };
      }),
  );
const waitFor = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await page.waitForTimeout(200);
  }
  return false;
};

await page.goto(URL, { waitUntil: "domcontentloaded" });
// The catalog lands and is written to disk: that is the copy to clear.
const cached = await waitFor(async () => (await diskRecord())?.channels > 0, 30_000);
check("the guide's copy is on disk before the clear", cached, JSON.stringify(await diskRecord()));

await page.getByRole("button", { name: "Settings", exact: true }).first().click();
const toggle = page.getByRole("switch", { name: "Test enabled" });
await toggle.waitFor({ timeout: 15_000 });

// `/` (search) under Settings leaves the app where it is. It used to
// switch to Discover behind the modal.
const onTab = () =>
  page.evaluate(() => document.querySelector("[data-dest][aria-current='page']")?.getAttribute("data-dest") ?? "nowhere");
const before = await onTab();
await page.keyboard.press("/");
await page.waitForTimeout(500);
check("`/` under Settings doesn't switch the tab behind it", (await onTab()) === before, `${before} -> ${await onTab()}`);
const goTab = (name) => page.getByRole("tab", { name, exact: true }).click();
const clear = page.getByRole("button", { name: "Clear…" });
await goTab("App");
await clear.click();
await page.getByRole("button", { name: "Click again to confirm" }).click();
await page.waitForTimeout(500);

check("the playlist leaves storage", (await stored("playlists"))?.length === 0, JSON.stringify(await stored("playlists")));
// The pane was showing the playlist (the waitFor above). Back on Sources it
// has to read what the clear left, so nothing there can save it back.
await goTab("Sources");
await page.waitForTimeout(500);
check(
  "and leaves the Sources pane when you go back to it, so nothing there can save it back",
  (await toggle.count()) === 0,
  `${await toggle.count()} "Test enabled" switches`,
);
const gone = await waitFor(async () => (await diskRecord()) === null, 5000);
check("the guide's copy on disk goes too", gone, JSON.stringify(await diskRecord()));

// The Stream pane, cleared while it was the one showing: opened first, so
// it holds the manifest, then the clear from App, then opened again.
await page.getByRole("tab", { name: "Stream" }).click();
const manifest = page.getByPlaceholder(/aiostreams\.example\.com/);
await manifest.waitFor({ timeout: 5000 });
// Put one back first, so the clear below has something to take.
await page.evaluate((m) => localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: m })), MANIFEST);
await page.getByRole("tab", { name: "Live TV" }).click();
await page.getByRole("tab", { name: "Stream" }).click();
await manifest.waitFor({ timeout: 5000 });
const shown = await manifest.inputValue();
await goTab("App");
await clear.click();
await page.getByRole("button", { name: "Click again to confirm" }).click();
await page.waitForTimeout(500);
await goTab("Sources");
await page.getByRole("tab", { name: "Stream" }).click();
await manifest.waitFor({ timeout: 5000 });
check(
  "the manifest leaves storage and the Stream pane showing it",
  shown === MANIFEST && (await stored("aiostreams")) === "" && (await manifest.inputValue()) === "",
  JSON.stringify({ before: shown, stored: await stored("aiostreams"), shown: await manifest.inputValue() }),
);

// And after a restart, nothing is there.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
check(
  "after a reload: no playlist, no manifest, no guide on disk",
  (await stored("playlists"))?.length === 0 && (await stored("aiostreams")) === "" && (await diskRecord()) === null,
  JSON.stringify({ pl: await stored("playlists"), aio: await stored("aiostreams"), disk: await diskRecord() }),
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);

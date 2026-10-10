// E2E: the guide stops re-downloading on every launch (v0.11.22).
//
// A launch used to start a full background reload of the Live TV catalog, the
// ~95MB xmltv included (60 to 77s on a big provider), and so did a Guide
// remount after the 30 minute memory TTL. Now a source reuses its guide for
// 12 hours while the CHANNEL half of the load still runs, so a provider that
// renames an event channel at noon is read fresh. Settings → Sources says
// when the guide was last refreshed and has a Refresh now button.
//
// This drives the real app in the plain browser (no IPC stub), with the fake
// panel as the one line, and counts what reaches it:
// - cold load: one get_live_streams, one xmltv.php;
// - a page reload hydrates from IndexedDB: get_live_streams again, xmltv.php
//   NOT again, and the guide still shows programmes;
// - Settings → Sources says when the guide was last refreshed, to the minute;
// - Refresh now downloads a fresh guide, the button reads Refreshing… until
//   it has landed, and the record's stamp moves on;
// - a record whose guide is 13 hours old (the record itself fresh) downloads
//   on the next launch, and the one after that reuses it again.
//
//   node scripts/fake-panel.mjs     # :8081
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-guide-refresh.mjs
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

const HOUR = 3600_000;
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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Offline, like every harness: only the fake panel on localhost.
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const seen = [];
page.on("request", (r) => seen.push(r.url()));
await page.addInitScript((pl) => {
  // Once: a reload below must see what the app and the harness left.
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
}, PLAYLISTS);

const count = (re) => seen.filter((u) => re.test(u)).length;
const streamLoads = () => count(/localhost:8081\/player_api\.php.*get_live_streams/);
const guideLoads = () => count(/localhost:8081\/xmltv\.php/);
const waitFor = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await page.waitForTimeout(100);
  }
  return false;
};

/** The disk record's `at` and each group's guideAt, as the app wrote them. */
const readRecord = () =>
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
            const v = rq.result;
            db.close();
            resolve(v ? { at: v.at, stamps: v.data.groups.map((g) => g.guideAt ?? null) } : null);
          };
          rq.onerror = () => (db.close(), resolve(null));
        };
      }),
  );
/** Make every group's guide `ms` older, leaving the record's own `at` alone:
 * the guide is old, the record is not. */
const ageGuides = (ms) =>
  page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const open = indexedDB.open("blammytv", 1);
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("liveCache", "readwrite");
          const store = tx.objectStore("liveCache");
          const rq = store.get("live");
          rq.onsuccess = () => {
            const v = rq.result;
            for (const g of v.data.groups) if (g.guideAt) g.guideAt -= ms;
            store.put(v, "live");
          };
          tx.oncomplete = () => (db.close(), resolve(true));
          tx.onerror = () => (db.close(), resolve(false));
        };
      }),
    ms,
  );
const oldest = (rec) => Math.min(...(rec?.stamps ?? []).filter((s) => s !== null));

/** The Guide up, with the panel's programmes drawn. */
async function guideShowsProgrammes() {
  await goTo(page, "guide");
  await page.locator(".guide__channel").first().waitFor({ timeout: 30_000 });
  return waitFor(() => page.locator('.guide__cell[data-hint^="ESPN Hour"]').count().then((n) => n > 0), 20_000);
}

// ---- Cold load
await page.goto(URL, { waitUntil: "domcontentloaded" });
check("the guide draws its programmes on a cold load", await guideShowsProgrammes());
const wrote = await waitFor(async () => (await readRecord())?.stamps.some((s) => s !== null), 15_000);
check("the record on disk carries the guide's stamp", wrote, JSON.stringify(await readRecord()));
await page.waitForTimeout(1000);
check("cold load: one get_live_streams", streamLoads() === 1, `${streamLoads()}`);
check("and one xmltv.php", guideLoads() === 1, `${guideLoads()}`);
const stamp0 = oldest(await readRecord());
check(
  "the stamp is the time the guide landed",
  Math.abs(Date.now() - stamp0) < 120_000,
  `${Math.round((Date.now() - stamp0) / 1000)}s ago`,
);

// ---- A relaunch inside the window
await page.reload({ waitUntil: "domcontentloaded" });
check("a reload hydrates the guide from disk", await guideShowsProgrammes());
const channelsAgain = await waitFor(() => streamLoads() >= 2, 20_000);
check("the channel half still reloads", channelsAgain && streamLoads() === 2, `${streamLoads()} loads`);
// The guide phase lands right behind the channels, and a guide download that
// should not have started would be in the air well inside this.
await page.waitForTimeout(3000);
check("and the guide is NOT downloaded again", guideLoads() === 1, `${guideLoads()} downloads`);
check(
  "the programmes are still on the Guide once the reload has landed",
  (await page.locator('.guide__cell[data-hint^="ESPN Hour"]').count()) > 0 &&
    !(await page.evaluate(() => document.body.innerText.includes("Loading guide"))),
);
const stamp1 = oldest(await readRecord());
check("the stamp is carried, not renewed", stamp1 === stamp0, `${stamp0} -> ${stamp1}`);

// ---- Settings → Sources
await page.getByRole("button", { name: "Settings", exact: true }).first().click();
await page.getByRole("switch", { name: "Test enabled" }).waitFor({ timeout: 15_000 });
const note = page.getByText(/Guides refresh every 12 hours\./);
check("Settings says the guides refresh every 12 hours", (await note.count()) === 1);
const noteText = (await note.first().textContent()) ?? "";
const expected = await page.evaluate(
  (ms) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  stamp0,
);
check(
  "and when the guide was last refreshed, to the minute",
  noteText.includes(`Last refreshed ${expected}.`),
  `${JSON.stringify(noteText)} vs ${expected}`,
);
const button = page.getByRole("button", { name: /^Refresh(ing…| now)$/ });
check("with a Refresh now button", (await button.textContent()) === "Refresh now");

// ---- Refresh now
// Hold the download back, so the button has something to wait for.
await page.route("**/xmltv.php*", async (route) => {
  await new Promise((r) => setTimeout(r, 2000));
  await route.continue();
});
const before = { streams: streamLoads(), guides: guideLoads() };
await button.click();
await waitFor(async () => (await button.textContent()) === "Refreshing…", 3000);
check("the button reads Refreshing… and is disabled while it runs", (await button.textContent()) === "Refreshing…" && (await button.isDisabled()));
await page.waitForTimeout(1200);
check(
  "even after the channels have landed, the guide is still in the air",
  (await button.textContent()) === "Refreshing…" && streamLoads() === before.streams + 1,
  `${await button.textContent()}, ${streamLoads() - before.streams} channel loads`,
);
const back = await waitFor(async () => (await button.textContent()) === "Refresh now", 20_000);
check("then returns once the guide has landed", back && (await button.isEnabled()));
check("Refresh now downloaded a fresh guide, once", guideLoads() === before.guides + 1, `${guideLoads() - before.guides}`);
await page.unroute("**/xmltv.php*");
const renewed = await waitFor(async () => oldest(await readRecord()) > stamp0, 10_000);
check("and the stamp on disk moved on", renewed, `${stamp0} -> ${oldest(await readRecord())}`);
await page.keyboard.press("Escape");
await page.locator('[role="dialog"]').first().waitFor({ state: "detached", timeout: 5000 });

// ---- A guide past the window
await page.waitForTimeout(2000); // nothing of ours left to write over the edit
const stamp2 = oldest(await readRecord());
check("a guide 13 hours old was written back", await ageGuides(13 * HOUR));
const aged = oldest(await readRecord());
check("the record is fresh, only its guide is old", Math.abs(aged - (stamp2 - 13 * HOUR)) < 1000, `${stamp2} -> ${aged}`);
const preAged = { streams: streamLoads(), guides: guideLoads() };
await page.reload({ waitUntil: "domcontentloaded" });
check("the old guide still hydrates", await guideShowsProgrammes());
const refetched = await waitFor(() => guideLoads() > preAged.guides, 20_000);
check("and the next launch downloads it again", refetched && guideLoads() === preAged.guides + 1, `${guideLoads() - preAged.guides}`);
check("with the channels", streamLoads() === preAged.streams + 1, `${streamLoads() - preAged.streams}`);
const fresh = await waitFor(async () => oldest(await readRecord()) > aged + 12 * HOUR, 15_000);
check("which renews the stamp", fresh);

// ---- ...and the launch after that is back to reusing it
await page.waitForTimeout(1500);
const settled = { streams: streamLoads(), guides: guideLoads() };
await page.reload({ waitUntil: "domcontentloaded" });
check("the guide is still drawn", await guideShowsProgrammes());
await waitFor(() => streamLoads() > settled.streams, 20_000);
await page.waitForTimeout(3000);
check("and a launch after the download reuses it", guideLoads() === settled.guides, `${guideLoads() - settled.guides} downloads`);

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);

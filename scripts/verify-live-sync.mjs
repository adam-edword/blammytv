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

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);

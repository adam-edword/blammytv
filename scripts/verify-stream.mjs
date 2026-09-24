// Headless verify: the Stream tab end-to-end against the fake Stremio addon
// (scripts/fake-aio.mjs, :8084) — manifest → rows, hero, detail + sources
// (magnet filtered), series → seasons → episode sources.
//
// Run: node scripts/fake-aio.mjs; pnpm build + preview (:4173);
//      PW_FROM=<dir>/x.js node scripts/verify-stream.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  sessionStorage.setItem("btv:welcome-played", "1");
});
await page.goto("http://localhost:4173/");
await page.getByRole("button", { name: "Stream" }).click();
await page.waitForFunction(() => document.body.innerText.includes("Top Movies"), null, { timeout: 30_000 }).catch(() => {});
let text = await page.evaluate(() => document.body.innerText);

check("catalog rows render", text.includes("Top Movies") && text.includes("Top Series"));
check("search-only catalog excluded", !text.includes("Search"));
check("hero carousel present", await page.locator(".shero").count() > 0);
await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + "/stream-home.png" : "stream-home.png" });

// Keyboard in the hero (v0.9.92). Every slide's buttons were tab stops,
// peeking and off-screen slides included, and autoplay paused for the
// mouse only, so a focused button slid off screen 8s after you reached it.
check(
  "no tab stops on the peeking hero slides",
  (await page
    .locator(".shero__card:not(.shero__card--active) button:not([tabindex='-1'])")
    .count()) === 0,
);
await page.mouse.move(2, 2); // no hover pause: this is the keyboard's case
await page.locator(".shero__card--active button").first().focus();
await page.waitForTimeout(9_000); // one autoplay interval, and a second
const stillHere = await page.evaluate(() => {
  const a = document.activeElement;
  const r = a?.getBoundingClientRect();
  return !!a?.closest(".shero__card--active") && !!r && r.left >= 0 && r.right <= innerWidth;
});
check("autoplay holds while focus is in the hero", stillHere);
await page.evaluate(() => document.activeElement?.blur());

// Movie detail + sources
await page.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
await page.waitForFunction(() => document.body.innerText.includes("Sources"), null, { timeout: 15_000 }).catch(() => {});
await page.waitForTimeout(600);
text = await page.evaluate(() => document.body.innerText);
check("movie detail shows synopsis", text.includes("Full synopsis"));
check("sources render, magnet filtered", (await page.locator(".vod-source").count()) === 2);
check("cached ⚡ + quality parsed", text.includes("2160p") && text.includes("⚡"));
await page.screenshot({ path: (process.env.SHOT_DIR ?? ".") + "/stream-detail.png" });

// Series → episodes → episode sources
await page.locator(".vod-back").click();
await page.locator(".stream-card", { hasText: "Fake Series One" }).first().click();
await page.waitForFunction(() => document.body.innerText.includes("Season 1"), null, { timeout: 15_000 }).catch(() => {});
text = await page.evaluate(() => document.body.innerText);
check("series seasons render", text.includes("Season 1") && text.includes("Season 2"));
await page.locator(".episode-card").first().click();
await page.waitForFunction(() => document.body.innerText.includes("Sources"), null, { timeout: 15_000 }).catch(() => {});
await page.waitForTimeout(600);
check("episode sources resolve (colon id)", (await page.locator(".vod-source").count()) === 2);

await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);

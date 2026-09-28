// E2E: the Guide survives a channel listed twice (week of 2026-09-28, the
// Live TV audit, behind Adam's "Maximum update depth exceeded").
//
// A panel can file one stream under two categories, so one stream_id is
// listed twice and two Guide rows share a channel id. Keyed by that id,
// React kept one old row of the pair as an orphan each time the row window
// moved past it. Orphans piled up in the canvas, and once Chrome anchored
// scrolling to one, every window shift nudged scrollTop, the layout effect
// shifted the window again, and React stopped with "Maximum update depth
// exceeded". The Live auditor reproduced it on the real Guide; this is the
// same thing through the app, against the fake panel's "dups" line.
//
//   node scripts/fake-panel.mjs     # :8081
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-guide-dups.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && /Maximum update depth/.test(m.text())) errors.push(m.text());
});
await page.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem(
    "blammytv.playlists",
    JSON.stringify({
      v: 1,
      data: [{ kind: "xtream", id: "d", name: "Dups", enabled: true, server: "http://localhost:8081", username: "dups", password: "p" }],
    }),
  );
  localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "live" }));
});
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.locator(".guide__row").first().waitFor({ timeout: 30_000 });

const state = () =>
  page.evaluate(() => {
    const g = document.querySelector(".guide");
    const rows = [...document.querySelectorAll(".guide__row")].map((r) => r.dataset.channel);
    return { top: g?.scrollTop ?? -1, rows: rows.length, dup: rows.length - new Set(rows).size };
  });
const first = await state();
check("the line's repeated streams are listed (both copies)", first.dup > 0, JSON.stringify(first));

// Scroll the way the crash needed: small steps through a stretch dense
// with pairs, then a jump, twice over.
// Row counts away from the top, where the window has its full overscan
// on both sides and its size holds steady.
let least = Infinity;
let worst = 0;
let drift = 0;
for (let y = 0; y <= 6000; y += 23) {
  // Guarded: when it crashes, the Guide is gone and the checks say so.
  await page.evaluate((to) => {
    const g = document.querySelector(".guide");
    if (g) g.scrollTop = to;
  }, y);
  await page.waitForTimeout(y % 460 === 0 ? 120 : 16);
  const s = await state();
  if (y >= 1000) {
    least = Math.min(least, s.rows);
    worst = Math.max(worst, s.rows);
  }
  // The window owns the scroll position: where it was put is where it is.
  if (s.top >= 0 && Math.abs(s.top - Math.min(y, s.top)) > 1) drift++;
  if (errors.length) break;
}
for (const to of [200, 9000]) {
  await page.evaluate((y) => {
    const g = document.querySelector(".guide");
    if (g) g.scrollTop = y;
  }, to);
  await page.waitForTimeout(250);
}
await page.waitForTimeout(300);
const end = await state();
least = Math.min(least, end.rows);
worst = Math.max(worst, end.rows);
check(
  "scrolling through them never trips React's update limit",
  errors.length === 0 && end.top >= 0,
  (errors[0] ?? (end.top < 0 ? "the Guide is gone" : "")).slice(0, 200),
);
check(
  "and the row window stays a window: no orphaned rows pile up",
  least > 0 && worst - least <= 2,
  `between ${least} and ${worst} rows while scrolling`,
);
check("nor does the scroll position creep on its own", drift === 0, `${drift} steps moved`);

await browser.close();
process.exit(fail ? 1 : 0);

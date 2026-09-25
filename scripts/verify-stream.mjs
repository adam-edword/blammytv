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

// ---------------------------------------------------------------- the hero
// v0.9.123. The hero painted from catalog previews, which carry no backdrop
// and no logo, so a card was the portrait poster stretched across the
// screen under a plain-text title until the full meta landed; a mirror
// written before it landed kept it that way for a whole session.

/** Each hero card's title, in order: its logo's alt, or the name in type. */
const titles = (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll(".shero__card")].map(
      (c) => c.querySelector(".shero__logo")?.alt ?? c.querySelector(".shero__title")?.textContent ?? "",
    ),
  );
const seed = () => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  sessionStorage.setItem("btv:welcome-played", "1");
};
/** A context that reaches nothing but this machine, with no autoplay (reduced
 * motion stops the hero's), so what is on screen holds still to be read. */
const quietContext = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await ctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
  return ctx;
};
const openStream = async (p) => {
  await p.addInitScript(seed);
  await p.goto("http://localhost:4173/");
  await p.getByRole("button", { name: "Stream" }).click();
};

// A pick whose details fail, or never come, stays out of the hero, and a
// build waits on them for 4 seconds at most. Every movie's meta hangs or
// 404s here, so only the four series can be in it.
{
  const ctx = await quietContext();
  await ctx.route(/localhost:8084\/meta\/movie\/tt1000/, () => {}); // never answers
  await ctx.route(/localhost:8084\/meta\/movie\/tt4000/, (r) => r.fulfill({ status: 404, body: "no" }));
  const p = await ctx.newPage();
  const t0 = Date.now();
  await openStream(p);
  const up = await p.waitForSelector(".shero__card", { timeout: 12_000 }).then(() => true, () => false);
  const took = Date.now() - t0;
  const cards = await p.evaluate(() =>
    [...document.querySelectorAll(".shero__card")].map((c) => ({
      title: c.querySelector(".shero__title")?.textContent ?? "",
      art: c.querySelector(".shero__art")?.getAttribute("src") ?? "",
    })),
  );
  check(
    "the hero leaves out a title whose details fail or never come, rather than showing its preview",
    up && cards.length > 0 && cards.every((c) => c.title.startsWith("Fake Series") && c.art.includes("/bg/")),
    JSON.stringify(cards.map((c) => [c.title, c.art.replace(/^.*\/(\w+\/\w+\.png)$/, "$1")])),
  );
  check("and waits on them for 4 seconds at most", up && took < 9_000, `${took}ms`);
  await ctx.close();
}

// The art fades in once it is decoded, rather than painting in as it
// arrives: hidden while its bytes are held back here, shown after. The
// posters in the rows do the same, over the card's placeholder.
{
  const ctx = await quietContext();
  let release;
  const held = new Promise((r) => (release = r));
  await ctx.route(/localhost:8084\/(bg|poster)\//, async (r) => {
    await held;
    await r.continue();
  });
  const p = await ctx.newPage();
  await openStream(p);
  await p.waitForSelector(".shero__card--active .shero__art", { timeout: 15_000 });
  await p.waitForTimeout(500);
  const style = () =>
    p.evaluate(() => {
      const op = (el) => (el ? Number(getComputedStyle(el).opacity) : -1);
      const art = document.querySelector(".shero__card--active .shero__art");
      const glow = document.querySelector(".shero__glowbox img.shero__glow--lit");
      const poster = document.querySelector(".stream-card__poster");
      const wrap = poster?.closest(".stream-card__tilt");
      return {
        art: op(art),
        loaded: art?.hasAttribute("data-loaded") ?? false,
        glow: op(glow),
        poster: op(poster),
        placeholder: wrap ? getComputedStyle(wrap).backgroundColor : "",
      };
    });
  const before = await style();
  release();
  await p.waitForFunction(() => document.querySelector(".shero__card--active .shero__art")?.hasAttribute("data-loaded"), null, { timeout: 5_000 }).catch(() => {});
  await p.waitForTimeout(800);
  const after = await style();
  check(
    "the hero's art and its light stay hidden until the picture is in, then fade up",
    before.art === 0 && !before.loaded && before.glow === 0 && after.art === 1 && after.loaded && Math.abs(after.glow - 0.7) < 0.01,
    JSON.stringify({ before, after }),
  );
  check(
    "a row's poster does the same, over the card's placeholder",
    before.poster === 0 && !/rgba\(0, 0, 0, 0\)|transparent/.test(before.placeholder) && after.poster === 1,
    JSON.stringify({ before: [before.poster, before.placeholder], after: after.poster }),
  );
  await ctx.close();
}

// A logo that loads is the title; one that fails falls back to the name in
// type, where it used to be the browser's broken-image box. Every meta gets
// a logo here: the series' load, the movies' 404.
{
  const ctx = await quietContext();
  await ctx.route(/localhost:8084\/meta\//, async (r) => {
    const res = await r.fetch();
    const json = await res.json();
    if (json.meta)
      json.meta.logo = `http://localhost:8084/${json.meta.type === "series" ? "poster" : "nope"}/logo.png`;
    await r.fulfill({ response: res, json });
  });
  const p = await ctx.newPage();
  await openStream(p);
  await p.waitForSelector(".shero__card", { timeout: 15_000 });
  await p.waitForTimeout(1000);
  const cards = await p.evaluate(() =>
    [...document.querySelectorAll(".shero__card")].map((c) => {
      const logo = c.querySelector("img.shero__logo");
      return {
        logo: logo ? logo.alt : null,
        loaded: logo?.hasAttribute("data-loaded") ?? false,
        title: c.querySelector("h2.shero__title")?.textContent ?? null,
      };
    }),
  );
  const series = cards.filter((c) => (c.logo ?? c.title ?? "").startsWith("Fake Series"));
  const movies = cards.filter((c) => !(c.logo ?? c.title ?? "").startsWith("Fake Series"));
  check(
    "a hero logo that loads is the title, and one that fails falls back to the name",
    series.length > 0 &&
      movies.length > 0 &&
      series.every((c) => c.loaded && c.title === null) &&
      movies.every((c) => c.logo === null && /^(Fake|Extra) Movie/.test(c.title ?? "")),
    JSON.stringify(cards),
  );
  await ctx.close();
}

// A refresh past the cache's 30 minutes draws a new random set, a second
// after the tab painted the last one. The hero on screen keeps its titles;
// the new ones are what the tab opens on next time.
{
  const ctx = await quietContext();
  const p = await ctx.newPage();
  await openStream(p);
  await p.waitForSelector(".shero__card", { timeout: 15_000 });
  const mirror = () => p.evaluate(() => JSON.parse(localStorage.getItem("blammytv.vodCache") ?? "null")?.data ?? null);
  await p.waitForFunction(() => !!localStorage.getItem("blammytv.vodCache"), null, { timeout: 10_000 });
  // Age the mirror past the TTL, and hold the rebuild's manifest back so
  // the hero from the mirror can be read before the new build lands.
  await p.evaluate(() => {
    const m = JSON.parse(localStorage.getItem("blammytv.vodCache"));
    m.data.at = 0;
    localStorage.setItem("blammytv.vodCache", JSON.stringify(m));
  });
  await ctx.route(/localhost:8084\/manifest\.json/, async (r) => {
    await new Promise((res) => setTimeout(res, 1500));
    await r.continue();
  });
  await p.reload();
  await p.getByRole("button", { name: "Stream" }).click();
  await p.waitForSelector(".shero__card", { timeout: 10_000 });
  const shown = await titles(p);
  const oldPicks = (await mirror()).featured.join();
  await p.waitForFunction(() => (JSON.parse(localStorage.getItem("blammytv.vodCache"))?.data?.at ?? 0) > 0, null, { timeout: 15_000 }).catch(() => {});
  await p.waitForTimeout(600);
  const after = await titles(p);
  const newPicks = ((await mirror())?.featured ?? []).join();
  check(
    "a refresh keeps the hero's titles on screen, and saves its own picks for next time",
    shown.length > 0 && JSON.stringify(after) === JSON.stringify(shown) && newPicks !== "" && newPicks !== oldPicks,
    JSON.stringify({ shown: shown.slice(0, 3), after: after.slice(0, 3), picksChanged: newPicks !== oldPicks }),
  );
  await ctx.close();
}

await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);

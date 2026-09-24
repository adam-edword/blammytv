// E2E: the hover-and-focus reveals v0.9.56's prune took away (v0.9.87).
//
// 1cfcec91 parked this app's reveal rules in styles/old with the button
// paint and left each control's `opacity: 0` (or its always-on state)
// behind. The failures were silent in the way this suite exists to catch:
//
//   - the Guide star was invisible in EVERY state, starred included, while
//     its 32px button still sat at the right edge of each card;
//   - the folder eye covered the end of every folder name, all the time;
//   - row arrows sat on every scrollable row as bare glyphs, painting over
//     the card under them;
//   - Continue Watching's Sources chip sat on every card.
//
// Each is checked at rest, under the pointer, and with keyboard focus
// inside, because a reveal that only answers the mouse hides the control
// from everyone else. The mini preview's Play and Stop got the same fix
// but need a playing stream, which this can't give them.
//
//   node scripts/fake-panel.mjs   # :8081
//   node scripts/fake-aio.mjs     # :8084
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-reveals.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? ` — ${d}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/** Opacity after the transition has had time to finish. */
const opacity = async (loc) => {
  await loc.page().waitForTimeout(350);
  return Number(await loc.evaluate((el) => getComputedStyle(el).opacity));
};
const away = (page) => page.mouse.move(2, 2);

async function open(seed) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  // Nothing external is reachable here; fail fast rather than hang.
  await page.route("**://*.espncdn.com/**", (r) => r.abort());
  await page.route("**://v3-cinemeta.strem.io/**", (r) => r.abort());
  await page.route("**://image.tmdb.org/**", (r) => r.abort());
  await page.addInitScript((s) => {
    localStorage.setItem("btv:onboarded", "1");
    sessionStorage.setItem("btv:welcome-played", "1");
    for (const [k, v] of Object.entries(s))
      localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: 1, data: v }));
  }, seed);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  return { ctx, page };
}

// ---- Live: the Guide star and the folder eye ----------------------------
{
  const { ctx, page } = await open({
    playlists: [
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
    startupTab: "live",
  });
  await page.locator(".guide__channel").first().waitFor({ timeout: 30_000 });
  const card = page.locator(".guide__channel").first();
  const star = card.locator(".guide__fav");

  await away(page);
  check("the Guide star is hidden at rest", (await opacity(star)) === 0);
  await card.hover();
  check("the star shows when its card is hovered", (await opacity(star)) === 1);
  await away(page);
  check("and hides again when the pointer leaves", (await opacity(star)) === 0);
  await card.locator("button").first().focus();
  check("the star shows with keyboard focus in its card", (await opacity(star)) === 1);
  await page.evaluate(() => document.activeElement?.blur());

  await card.hover();
  await star.click();
  await away(page);
  check(
    "a starred channel keeps its star visible at rest",
    (await star.getAttribute("aria-pressed")) === "true" && (await opacity(star)) === 1,
    `aria-pressed=${await star.getAttribute("aria-pressed")}`,
  );

  const row = page.locator(".live-folder-row").first();
  const eye = row.locator(".live-folder__hide");
  await eye.waitFor({ state: "attached", timeout: 10_000 });
  await away(page);
  check("the folder eye is hidden at rest", (await opacity(eye)) === 0);
  await row.hover();
  check("the folder eye shows when its row is hovered", (await opacity(eye)) === 1);
  await away(page);
  await ctx.close();
}

// ---- Stream: row arrows and the Continue Watching Sources chip ----------
{
  const { ctx, page } = await open({
    aiostreams: "http://localhost:8084/manifest.json",
    startupTab: "stream",
    watching: [
      {
        id: "tt1375666",
        title: "A Watched Title",
        label: "Movie",
        kind: "movie",
        posSec: 600,
        durSec: 5400,
        at: Date.now(),
      },
    ],
  });
  const cw = page.locator(".continue-card").first();
  await cw.waitFor({ timeout: 30_000 });
  const chip = cw.locator(".continue-card__sources");
  await away(page);
  check("the Sources chip is hidden at rest", (await opacity(chip)) === 0);
  await cw.hover();
  check("the Sources chip shows when its card is hovered", (await opacity(chip)) === 1);
  await away(page);

  // An arrow only renders when its row can scroll that way. Asserted, so a
  // fixture that stops overflowing fails here rather than passing
  // vacuously below.
  const arrow = page.locator(".media-row__arrow").first();
  const has = await arrow
    .waitFor({ state: "attached", timeout: 15_000 })
    .then(() => true, () => false);
  check("a scrollable row has an arrow to test", has);
  if (has) {
    const viewport = arrow.locator("xpath=ancestor::div[contains(@class,'media-row__viewport')][1]");
    await away(page);
    check("row arrows are hidden at rest", (await opacity(arrow)) === 0);
    await viewport.hover({ position: { x: 200, y: 60 } });
    check("row arrows show when the row is hovered", (await opacity(arrow)) === 1);
    const bg = await arrow.evaluate((el) => getComputedStyle(el).backgroundColor);
    check(
      "and carry a circle behind the glyph, not a bare chevron",
      bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent",
      bg,
    );
  }
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);

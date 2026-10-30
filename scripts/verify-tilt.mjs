// E2E: the poster tilt measures on hover, not on mount (week of 2026-09-28,
// the Live auditor's worst measured cost).
//
// react-parallax-tilt reads each card's rect in componentDidMount, a forced
// layout per card, and Discover's grid and Stream's rows mount hundreds of
// them in one task. ui/Tilt.tsx skips that one measure: the library
// measures again on every mouseenter, and at rest the tilt is flat and the
// glare invisible. Its window-resize measure stays, because Stream's hero
// fires a resize after each slide so a card that slid under a still pointer
// gets a size.
//
// A card that was never measured has a 0px glare, and one hovered unmeasured
// leans to the clamp (the library divides by a width of 0), so both show.
//
//   node scripts/fake-aio.mjs       # :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-tilt.mjs
import { createRequire } from "node:module";
import { goTo } from "./nav-settle.mjs";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${n}${d ? `: ${d}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
// Motion on: under reduced motion the cards don't tilt at all.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
const page = await ctx.newPage();
await page.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1"); localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
});
await page.goto(URL);
await goTo(page, "discover");
await page.locator(".stream-card__tilt .glare").nth(3).waitFor({ state: "attached", timeout: 30_000 });
await page.mouse.move(2, 2);
await page.waitForTimeout(500);

/** Each poster's glare width, and what a measure would make it: the
 * diagonal of its card. The live glare is the card's LAST: under dev's
 * StrictMode the library mounts twice and never removes its first. */
const glares = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".stream-card__tilt")].map((t) => ({
      w: [...t.querySelectorAll(":scope > .glare-wrapper > .glare")].at(-1)?.style.width ?? "",
      diag: Math.hypot(t.offsetWidth, t.offsetHeight),
    })),
  );
const measured = (g) => Math.abs(parseFloat(g.w) - g.diag) < 1;

const rest = await glares();
check(
  "Discover's posters mount without measuring",
  rest.length >= 4 && rest.every((g) => g.w === "0px"),
  `${rest.length} posters, glare ${[...new Set(rest.map((g) => g.w))].join(", ")}`,
);

// Hover one toward its top right and let the 650ms transition land.
const card = page.locator(".stream-card__tilt").nth(1);
const b = await card.boundingBox();
await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.2);
await page.mouse.move(b.x + b.width * 0.85, b.y + b.height * 0.15, { steps: 4 });
await page.waitForTimeout(800);
const lean = await card.evaluate((t) => {
  const m = t.style.transform.match(/rotateX\(([-\d.e]+)deg\) rotateY\(([-\d.e]+)deg\)/);
  const g = [...t.querySelectorAll(":scope > .glare-wrapper > .glare")].at(-1);
  return { x: m ? Number(m[1]) : NaN, y: m ? Number(m[2]) : NaN, glare: Number(g?.style.opacity) };
});
const hovered = (await glares())[1];
check(
  "hovering one measures it, and it leans with the pointer inside the 5° clamp",
  measured(hovered) &&
    Math.abs(lean.x) > 0.5 && Math.abs(lean.x) < 4.9 &&
    Math.abs(lean.y) > 0.5 && Math.abs(lean.y) < 4.9 &&
    lean.glare > 0,
  `glare ${hovered.w} of ${hovered.diag.toFixed(1)}px, rotateX ${lean.x} rotateY ${lean.y}, glare opacity ${lean.glare}`,
);
const others = (await glares()).filter((_, i) => i !== 1);
check("the rest stay unmeasured", others.every((g) => g.w === "0px"));

// The window resize still measures: Stream's hero fires one after each
// slide, for the card that slid under a pointer that never moved.
await page.mouse.move(2, 2);
await page.waitForTimeout(700);
await page.evaluate(() => window.dispatchEvent(new Event("resize")));
const after = await glares();
check(
  "a window resize measures every poster, hovered or not",
  after.length === rest.length && after.every(measured),
  `${after.filter(measured).length} of ${after.length}`,
);

// ---- Continue Watching's picture leans and catches the sheen the posters do
// (v0.11.39, Adam: the cards only lifted). The picture is inside the same
// Tilt, with the card div and the lines under it outside, so the text does
// not rotate; under reduced motion the card stays flat.
const WATCHING = {
  v: 1,
  data: [
    { id: "tt100003", title: "Fake Movie Three", at: 3, posSec: 1200, durSec: 5700, kind: "movie", art: "http://localhost:8084/bg/tt100003.png" },
    { id: "tt100004", title: "Fake Movie Four", at: 2, posSec: 600, durSec: 5700, kind: "movie" },
  ],
};
/** What a Continue Watching card's Tilt is doing now. */
const cardLean = (pg) =>
  pg.evaluate(() => {
    const c = document.querySelector(".continue-card");
    const t = c.querySelector(".continue-card__tilt");
    const m = t.style.transform.match(/rotateX\(([-\d.e]+)deg\) rotateY\(([-\d.e]+)deg\)/);
    const g = [...t.querySelectorAll(":scope > .glare-wrapper > .glare")].at(-1);
    return {
      wraps: !!t.querySelector(":scope > .tile__pic .tile__art"),
      textOutside: !t.contains(c.querySelector(".continue-card__text")) && !t.contains(c.querySelector(".tile__track")),
      x: m ? Number(m[1]) : NaN,
      y: m ? Number(m[2]) : NaN,
      scale: t.style.transform.match(/scale3d\(([\d.]+)/)?.[1] ?? null,
      glareW: g?.style.width ?? null,
      glare: Number(g?.style.opacity ?? 0),
      shadow: getComputedStyle(t).boxShadow,
      cardTransform: getComputedStyle(c).transform,
    };
  });
async function hoverCard(pg) {
  const pic = pg.locator(".continue-card .tile__pic").first();
  await pic.scrollIntoViewIfNeeded();
  await pg.mouse.move(2, 2);
  await pg.waitForTimeout(500);
  const b = await pic.boundingBox();
  await pg.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.2);
  await pg.mouse.move(b.x + b.width * 0.85, b.y + b.height * 0.15, { steps: 4 });
  await pg.waitForTimeout(900);
}
await page.evaluate((w) => localStorage.setItem("blammytv.watching", JSON.stringify(w)), WATCHING);
await goTo(page, "home");
await page.locator(".continue-card").first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(600);
const cwRest = await cardLean(page);
check(
  "Continue Watching's picture is in a Tilt, the text and progress under it are not, and it mounts unmeasured",
  cwRest.wraps && cwRest.textOutside && cwRest.glareW === "0px",
  JSON.stringify({ wraps: cwRest.wraps, textOutside: cwRest.textOutside, glare: cwRest.glareW }),
);
await hoverCard(page);
const cw = await cardLean(page);
check(
  // The card itself stays put: its 3px lift went in 1.0.16 (Adam: "remove
  // the slight shift upwards when hovering a CW card").
  "hovering it leans the picture with the pointer inside the 5° clamp, scales it a hair, catches the sheen and swells the shadow, and the card itself doesn't lift",
  Math.abs(cw.x) > 0.5 && Math.abs(cw.x) < 4.9 && Math.abs(cw.y) > 0.5 && Math.abs(cw.y) < 4.9 && cw.scale === "1.03" && cw.glare > 0 && cw.shadow !== "none" && cw.cardTransform === "none",
  JSON.stringify(cw),
);
await page.mouse.move(2, 2);

{
  // Reduced motion: nothing leans, scales or shines.
  const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await rctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
  const rp = await rctx.newPage();
  await rp.addInitScript((w) => {
    localStorage.setItem("btv:onboarded", "1"); localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
    sessionStorage.setItem("btv:welcome-played", "1");
    localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
    localStorage.setItem("blammytv.watching", JSON.stringify(w));
  }, WATCHING);
  await rp.goto(URL);
  await goTo(rp, "home");
  await rp.locator(".continue-card").first().waitFor({ timeout: 30_000 });
  await rp.waitForTimeout(600);
  await hoverCard(rp);
  const still = await cardLean(rp);
  check(
    "  and under reduced motion it stays flat: no lean, no scale, no sheen",
    !(Math.abs(still.x) > 0.01) && !(Math.abs(still.y) > 0.01) && (still.scale === null || still.scale === "1") && still.glare === 0,
    JSON.stringify(still),
  );
  await rctx.close();
}

await browser.close();
process.exit(fail ? 1 : 0);

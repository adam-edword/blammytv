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
  localStorage.setItem("btv:onboarded", "1");
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

await browser.close();
process.exit(fail ? 1 : 0);

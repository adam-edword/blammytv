// Headless verify: THE NAV'S PRESS FEEDBACK AND THE LOGO SPIN.
//
// Two of these guard failures that are SILENT rather than loud.
//
// The spin only interpolates because --logo-angle is registered with
// @property in tokens.css. Drop that registration and the property is an
// untyped string to the interpolator: the animation still "runs", the
// gradient just jumps to the end angle with nothing in between. Nothing
// throws, nothing logs. So this samples the angle mid-flight and requires
// it to be strictly between the endpoints.
//
// The re-click is the other one. A CSS animation does not restart on an
// element that already carries the class, so without the remove/reflow/add
// dance the second click does nothing — which looks exactly like a
// misfire and is easy to "fix" by adding a duration somewhere.
//
// Run, from the REPO ROOT:
//   node scripts/fake-m3u.mjs                              # :8082
//   cd apps/app && pnpm exec vite --port 4173 --strictPort
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-nav-feedback.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const PLAYLIST = { v: 1, data: [{ kind: "m3u", id: "m1", name: "Test M3U",
  enabled: true, url: "http://localhost:8082/playlist.m3u" }] };

let fail = 0;
const check = (n, ok, d = "") => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? ` ${d}` : ""}`); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript((pl) => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
  sessionStorage.setItem("btv:welcome-played", "1");
}, PLAYLIST);
await page.goto(process.env.APP_URL ?? "http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".navcap", { timeout: 20_000 });
await page.waitForTimeout(2000);

const angle = () => page.evaluate(() =>
  getComputedStyle(document.querySelector(".navcap__mark i"))
    .getPropertyValue("--logo-angle").trim());

check("the mark is a button, not decoration",
  (await page.locator("button.navcap__mark").count()) === 1);
check("and it is reachable by name",
  (await page.getByLabel("BlammyTV").count()) === 1);

const rest = await angle();
check("at rest the gradient sits at the angle logo.svg bakes in",
  rest === "146.36deg", rest);

// Mid-flight. Strictly BETWEEN the endpoints is the whole point: an
// unregistered property would read 506.36 (or 146.36) and nothing else.
await page.locator("button.navcap__mark").click();
await page.waitForTimeout(280);
const mid = await angle();
const midN = parseFloat(mid);
check("mid-spin the angle is interpolating, not jumping",
  midN > 147 && midN < 505, mid);

await page.waitForTimeout(700);
check("and it lands back where it started", (await angle()) === "146.36deg", await angle());

// The re-click, MID-SPIN. This is the case the remove/reflow/add dance in
// AppHeader#spin exists for, and the only one that can catch its absence:
// once a spin finishes the animationend handler has already dropped the
// class, so re-adding it restarts cleanly on its own. Interrupt one
// instead, and without the reflow the class is still there and the second
// click does nothing at all.
//
// The signature of a restart is the angle going DOWN. Left alone it only
// ever climbs toward 506.
await page.locator("button.navcap__mark").click();
await page.waitForTimeout(250);
const before = parseFloat(await angle());
await page.locator("button.navcap__mark").click();
await page.waitForTimeout(60);
const after = parseFloat(await angle());
check("a click DURING a spin restarts it",
  after < before - 40, `${before.toFixed(0)}deg -> ${after.toFixed(0)}deg`);
await page.waitForTimeout(800);

// Press feedback. getBoundingClientRect is the honest read: it is the
// painted box, which is exactly what a press is supposed to change.
//
// Pressed on the ALREADY-ACTIVE item on purpose. Releasing on an inactive
// one navigates, its label opens and the box legitimately triples — the
// spring-back is unmeasurable there because the thing being measured moved
// for a different reason. It is also the case that matters most: pressing
// the tab you are already on is the common "did that register?" moment,
// and it is the one press that changes nothing else on screen.
const item = page.locator('.navcap__item[aria-current="page"]');
const box = await item.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(120);
const pressed = await item.boundingBox();
await page.mouse.up();
await page.waitForTimeout(420);
const released = await item.boundingBox();
check("the active item compresses under the press",
  pressed.width < box.width * 0.97,
  `${box.width.toFixed(1)} -> ${pressed.width.toFixed(1)}`);
check("and springs back on release",
  Math.abs(released.width - box.width) < 0.6,
  `${released.width.toFixed(1)} vs ${box.width.toFixed(1)}`);

// An inactive one compresses too (press only; releasing would navigate).
const idle = page.locator('[data-dest="sports"]');
const ibox = await idle.boundingBox();
await page.mouse.move(ibox.x + ibox.width / 2, ibox.y + ibox.height / 2);
await page.mouse.down();
await page.waitForTimeout(120);
const ipressed = await idle.boundingBox();
await page.mouse.up();
await page.waitForTimeout(500);
check("so does an inactive one",
  ipressed.width < ibox.width * 0.97,
  `${ibox.width.toFixed(1)} -> ${ipressed.width.toFixed(1)}`);

// The mark presses too.
const mbox = await page.locator("button.navcap__mark").boundingBox();
await page.mouse.move(mbox.x + mbox.width / 2, mbox.y + mbox.height / 2);
await page.mouse.down();
await page.waitForTimeout(120);
const mpressed = await page.locator("button.navcap__mark").boundingBox();
await page.mouse.up();
check("so does the mark", mpressed.width < mbox.width * 0.97,
  `${mbox.width.toFixed(1)} -> ${mpressed.width.toFixed(1)}`);

// Hover existed nowhere in the default theme before this.
await page.mouse.move(ibox.x + ibox.width / 2, ibox.y + ibox.height / 2);
await page.waitForTimeout(250);
const hov = await idle.evaluate((el) => getComputedStyle(el).backgroundColor);
check("an item tints on hover", hov !== "rgba(0, 0, 0, 0)" && hov !== "transparent", hov);

// THE ONE THAT MATTERS MOST: none of this may move the capsule. A press is
// a transform, which does not touch offsetWidth, so place() cannot see it.
const drift = await page.evaluate(() => {
  const m = document.querySelector(".navcap__mark");
  const r = m.getBoundingClientRect();
  return +(((r.left + r.width / 2) - innerWidth / 2).toFixed(2));
});
check("and the mark is still on the midline", Math.abs(drift) < 1.5, `${drift}px`);

await ctx.close();

// Reduced motion. The spin is decoration with no state behind it, so it
// does not get a fast version — it does not run at all.
{
  const rctx = await browser.newContext({
    viewport: { width: 1600, height: 900 }, reducedMotion: "reduce",
  });
  const rp = await rctx.newPage();
  await rp.addInitScript((pl) => {
    localStorage.setItem("btv:onboarded", "1");
    localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
    sessionStorage.setItem("btv:welcome-played", "1");
  }, PLAYLIST);
  await rp.goto(process.env.APP_URL ?? "http://localhost:4173/", { waitUntil: "domcontentloaded" });
  await rp.waitForSelector(".navcap", { timeout: 20_000 });
  await rp.waitForTimeout(1500);
  await rp.locator("button.navcap__mark").click();
  await rp.waitForTimeout(250);
  const a = await rp.evaluate(() =>
    getComputedStyle(document.querySelector(".navcap__mark i"))
      .getPropertyValue("--logo-angle").trim());
  check("reduced motion: the gradient does not spin", a === "146.36deg", a);
  await rctx.close();
}

await browser.close();
console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);

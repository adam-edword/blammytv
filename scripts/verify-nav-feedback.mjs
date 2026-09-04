// Headless verify: THE NAV'S PRESS FEEDBACK AND THE LOGO SPIN.
//
// Two of these guard failures that are SILENT rather than loud.
//
// The spin is checked in PIXELS, and that is the whole lesson of v0.9.12.
// The first version of this file read --logo-angle off the element and
// asserted it was interpolating. It was — and the gradient never moved,
// because a custom property is substituted where it is DECLARED. With the
// angle baked into --logo-conic on :root, every element downstream
// inherited a finished string; animating the angle on the mark changed a
// value nothing painted from. The property read passed, the feature was
// dead, and Adam found it by clicking the logo.
//
// So: screenshot the mark, spin it, screenshot again, and require the
// bytes to differ. That claim cannot be satisfied by a number that moves
// somewhere the painter is not looking.
//
// The angle read stays as supporting evidence: it distinguishes "did not
// animate" from "animated but nothing used it", which is the difference
// between the two ways this has broken.
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
import fs from "node:fs";
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

const paintedFrom = () => page.evaluate(() =>
  (getComputedStyle(document.querySelector(".navcap__mark i"))
    .backgroundImage.match(/from ([\d.]+)deg/) || ["", "none"])[1]);
const plate = page.locator("button.navcap__mark b");
const shot = async (n) => {
  const f = `/tmp/verify-spin-${n}.png`;
  await plate.screenshot({ path: f });
  return fs.readFileSync(f);
};

const rest = await angle();
check("at rest the gradient sits at the angle logo.svg bakes in",
  rest === "146.36deg", rest);
const restPx = await shot("rest");

await page.locator("button.navcap__mark").click();
await page.waitForTimeout(280);
const mid = await angle();
const midN = parseFloat(mid);
check("mid-spin the angle is interpolating, not jumping",
  midN > 147 && midN < 505, mid);
// THE ONE THAT MATTERS: the painted gradient, not the property behind it.
const painted = await paintedFrom();
// The two reads are separate round-trips to a still-moving animation, so
// they are never the same number. The tolerance only has to separate
// "tracking the property" from "baked in at :root", and those are ~330deg
// apart — 20 is loose enough to be stable and nowhere near loose enough
// to let the bug through.
check("and the PAINTED gradient is at that angle, not a baked-in one",
  Math.abs(parseFloat(painted) - midN) < 20, `painted from ${painted}deg vs --logo-angle ${midN}deg`);
const midPx = await shot("mid");
check("so the mark actually looks different mid-spin",
  !restPx.equals(midPx), `${restPx.length} vs ${midPx.length} bytes`);

await page.waitForTimeout(700);
check("and it lands back where it started", (await angle()) === "146.36deg", await angle());
// Byte equality is the wrong test for the END state: re-rasterising the
// same gradient is not deterministic to the byte (measured: max channel
// delta 2 across 27 of 1406 pixels, which is nothing). The painted angle
// is exact, so assert that instead.
check("and the painted gradient is back to its rest angle",
  (await paintedFrom()) === "146.36", `from ${await paintedFrom()}deg`);

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

// ---- THE HEADER'S SETTINGS CHIP.
//
// Two things that both went wrong on the way in. Profile was a disabled
// placeholder for a feature that does not exist, and a dimmed control that
// never does anything reads as broken rather than as coming soon — so the
// corner holds exactly one button now.
//
// And the chip is a CIRCLE, which it has to be told: the reset at the top
// of base.css puts `corner-shape: var(--corner)` on everything, so a bare
// `border-radius: 50%` drew a rounded square. Checked in PIXELS rather than
// off the property, because that is the difference between "the rule is
// there" and "the corner is round" — the exact gap that shipped a squircle
// rim over a round fill in v0.9.19.
check("the header holds one action, not a disabled Profile beside it",
  (await page.locator(".header__action").count()) === 1);
check("and it is the Settings button",
  (await page.locator(".header__action").getAttribute("aria-label")) === "Settings");
{
  const gear = page.locator(".header__action");
  const box = await gear.boundingBox();
  check("the chip is square in its box", Math.abs(box.width - box.height) < 1,
    `${box.width} x ${box.height}`);

  // FORCE the shape and require nothing to move. Sampling a corner pixel
  // does NOT work and was the first attempt: at 2px in, a squircle and a
  // circle both leave background there, so the check passed against the
  // squircle it was written to catch. Same shape-agnostic trick the capsule
  // rim uses — it compares the element to itself, so it holds whatever the
  // design settles on.
  const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
  const asIs = await page.screenshot({ clip });
  const forced = await page.addStyleTag({
    content: ".header__action, .header__action::after { corner-shape: round !important }",
  });
  await page.waitForTimeout(200);
  const round = await page.screenshot({ clip });
  await forced.evaluate((el) => el.remove());
  check("and it is round, not the reset's squircle", asIs.equals(round),
    asIs.equals(round) ? "" : "the chip is drawing some other corner");
}

// ---- Row 2's "Any" chip is a CIRCLE ------------------------------------
// Every other chip in that row is a 23px icon in 10px of padding, so they
// all land at 43x43 and render round. "Any" is text, so its intrinsic width
// made it an oval among circles.
//
// Measured, not screenshotted, because the failure mode here is arithmetic:
// this rule has the same specificity as .navcap__item and sits below it on
// source order alone. Put back above, the width still applies and only the
// padding and font-size lose — which looks fine in a picture and leaves the
// text overflowing a 23px content box.
{
  await page.getByRole("button", { name: /^discover$/i }).first().click();
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => {
    const el = document.querySelector(".navcap__item--text");
    const icon = document.querySelector(
      ".navcap__row--sub .navcap__item:not(.navcap__item--text)",
    );
    if (!el || !icon) return null;
    const r = el.getBoundingClientRect();
    const t = el.querySelector(".navcap__lbl > i").getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      w: r.width,
      h: r.height,
      icon: icon.getBoundingClientRect().width,
      inset: (r.width - t.width) / 2,
      radius: cs.borderRadius,
    };
  });
  check("the sub row and its Any chip are reachable", !!m);
  if (m) {
    check("the Any chip is square", Math.abs(m.w - m.h) < 0.5,
      `${m.w.toFixed(1)}x${m.h.toFixed(1)}`);
    check("and the same size as the icon chips beside it",
      Math.abs(m.w - m.icon) < 0.5, `${m.w.toFixed(1)} vs ${m.icon.toFixed(1)}`);
    // A square box only READS as a circle if the radius is at least half of
    // it. 999px is the pill token; anything smaller is a rounded square.
    check("with a radius that makes the square a circle",
      parseFloat(m.radius) >= m.w / 2, m.radius);
    // The icons sit in 10px of padding. Text needs comparable air or the
    // circle reads as crammed — this is what the font-size drop buys, and
    // it is the half of the rule that loses when the cascade is wrong.
    check("and enough air around the label", m.inset >= 6.5,
      `${m.inset.toFixed(2)}px a side`);
  }
}

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

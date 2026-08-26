// Headless verify: SEARCH LIVES ON DISCOVER.
//
// It used to sit in the header, where it was the only control that did not
// apply to wherever you happened to be. It is in Discover's own filter row
// now, beside the All Content / Movies / Series tabs, and gone everywhere
// else.
//
// The check that earns its place is the last one. `/`, Ctrl+K and Ctrl+F
// are handled app-wide, so they fire while DiscoverScreen may not be
// mounted at all -- and App holds the screen swap back by NAV_SETTLE_MS on
// top of that. A dispatched event would land in an empty room and the
// shortcut would silently do nothing from anywhere except Discover itself,
// which is the one place nobody needs it. Hence the mailbox in
// searchQuery.ts, and hence pressing "/" from the GUIDE here rather than
// from somewhere convenient.
//
// Needs BOTH fakes: the m3u for a live source (or the nav has no live
// half) and the AIO addon for a VOD catalog. Without the latter Discover
// renders its empty state, which has no filter row and therefore no field
// -- this file passed a broken build that way once already.
//
// Run, from the REPO ROOT:
//   node scripts/fake-m3u.mjs                              # :8082
//   node scripts/fake-aio.mjs                              # :8084
//   cd apps/app && pnpm exec vite --port 4173 --strictPort
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-discover-search.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM);
const { chromium } = req("playwright-core");
const PLAYLIST = { v:1, data:[{ kind:"m3u", id:"m1", name:"Test M3U", enabled:true, url:"http://localhost:8082/playlist.m3u" }] };
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const errs = []; p.on("pageerror", e => errs.push(String(e)));
await p.addInitScript((pl) => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
}, PLAYLIST);
await p.goto(process.env.APP_URL ?? "http://localhost:4173/", { waitUntil: "domcontentloaded" });
await p.waitForSelector(".navcap", { timeout: 20000 });
await p.waitForTimeout(2000);
let fail = 0;
const check = (n, ok, d = "") => { if (!ok) fail++; console.log(`${ok?"PASS":"FAIL"} ${n}${d?` ${d}`:""}`); };

check("the old header chip is gone",
  (await p.locator(".header__searchchip").count()) === 0);
check("and Discover's own toggle row is gone",
  (await p.locator(".discover__toggle").count()) === 0);

// On a non-Discover tab the field must not exist at all.
await p.locator('[data-dest="home"]').click();
await p.waitForTimeout(900);
// It is always in the DOM so it can be measured and can animate; what
// changes is whether the row it lives in has any height.
check("on Stream the second row is shut",
  (await p.locator(".navcap__row--sub").evaluate((el) => el.offsetHeight)) === 0);

await p.locator('[data-dest="discover"]').click();
await p.waitForTimeout(1200);
check("open on Discover",
  (await p.locator(".navcap__row--sub").evaluate((el) => el.offsetHeight)) > 30);

// It must line up with the filter tabs, not float beside them.
// The capsule's width is ROW 1's business. Row 2 fills it and must never
// widen it -- a flex item contributes its width even while collapsed, so
// without width:0/min-width:100% the bar sits wider on every tab.
const geo = await p.evaluate(() => {
  const n = document.querySelector(".navcap"), cs = getComputedStyle(n);
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const r1 = n.querySelector(".navcap__row--nav"), r2 = n.querySelector(".navcap__row--sub");
  const m = n.querySelector(".navcap__mark").getBoundingClientRect();
  return { nav: +n.offsetWidth.toFixed(1), pad, row1: +r1.offsetWidth.toFixed(1),
           row2: +r2.offsetWidth.toFixed(1),
           off: +(((m.left + m.width / 2) - innerWidth / 2).toFixed(2)) };
});
check("row 1 sets the capsule's width",
  Math.abs(geo.nav - (geo.row1 + geo.pad)) < 1.5, JSON.stringify(geo));
check("row 2 fills it without widening it", geo.row2 <= geo.row1 + 0.5,
  `row2 ${geo.row2} vs row1 ${geo.row1}`);
check("and the mark still holds the midline with both rows open",
  Math.abs(geo.off) < 1.5, `${geo.off}px`);

// Typing has to reach the grid.
// The placeholder promises a scope, and searchDiscover really does keep
// it: it drops every catalog whose type is not the selected one. So the
// copy has to follow the tab, or the field is lying about why a result is
// missing.
for (const [tab, want] of [["all", "Search movies & series…"],
                           ["movie", "Search movies…"],
                           ["series", "Search series…"]]) {
  await p.locator(`.navcap__row--sub [data-key="${tab}"]`).click();
  await p.waitForTimeout(400);
  const ph = await p.locator(".navcap__searchinput").getAttribute("placeholder");
  const al = await p.locator(".navcap__searchinput").getAttribute("aria-label");
  check(`"${tab}" says ${JSON.stringify(want)}`, ph === want, ph ?? "none");
  check(`  and its label matches`, al === want.replace("…", ""), al ?? "none");
}

// THE OPEN CHIP HAS TO PAINT ITS LABEL, and this is a pixel claim on
// purpose. The clip box and the fade are two separate rules: the width is
// driven in JS and the opacity comes from CSS, so they can disagree. They
// did — the fade was written `[aria-current="page"]`, which row 1's
// destinations carry and row 2's type chips (aria-current="true") do not.
// The box opened to a full label width and painted nothing inside it: a
// grey pill the exact size of the word that was missing. Every check above
// passed through all of it, because none of them looks at the glass.
await p.locator('.navcap__row--sub [data-key="all"]').click();
await p.waitForTimeout(500);
const chip = p.locator('.navcap__row--sub [data-key="movie"]');
await chip.click();
await p.waitForTimeout(600);

// Shoot the CLIP BOX, not the chip, and shoot it twice: once as it is, once
// with the text forced out. Anything the word contributes disappears in the
// second shot, so the bytes differ if and only if it was really on the
// glass. Shooting the whole chip does NOT work and was the first attempt:
// the thumb slides in underneath, so the before/after differ on the fill
// alone and the check passed against the blank pill it was written to
// catch.
const box = chip.locator(".navcap__lbl");
const painted = await box.screenshot();
await box.evaluate((el) => { el.firstElementChild.style.visibility = "hidden"; });
await p.waitForTimeout(150);
const blank = await box.screenshot();
await box.evaluate((el) => { el.firstElementChild.style.visibility = ""; });
check("the open type chip paints its label", !painted.equals(blank),
  `${painted.length}B vs ${blank.length}B`);
// Supporting evidence: separates "never opened" from "opened but blank",
// which is the difference between the two ways this has broken.
const lbl = await chip.evaluate((el) => {
  const b = el.querySelector(".navcap__lbl");
  return { w: b.offsetWidth, op: getComputedStyle(b.firstElementChild).opacity };
});
check("  its clip box is open", lbl.w > 20, `${lbl.w}px`);
check("  and the text inside is opaque", Number(lbl.op) === 1, lbl.op);
await p.locator('.navcap__row--sub [data-key="all"]').click();
await p.waitForTimeout(500);

await p.locator(".navcap__searchinput").fill("crime");
await p.waitForTimeout(1200);
const heading = await p.locator(".discover__gridwrap h3").first().textContent();
check("typing drives the results heading", /crime/i.test(heading ?? ""), heading ?? "none");

// The shortcut, from a different screen entirely.
await p.locator('[data-dest="guide"]').click();
await p.waitForTimeout(1000);
await p.keyboard.press("/");
await p.waitForTimeout(1400);
const focused = await p.evaluate(() => document.activeElement?.className ?? "");
check("`/` from the Guide lands in the field", focused.includes("navcap__searchinput"), focused);

if (errs.length) { console.log("ERRORS", errs.slice(0,3)); fail++; }
console.log(fail ? `${fail} FAILURES` : "ALL PASS");
await b.close();
process.exit(fail ? 1 : 0);

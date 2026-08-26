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

check("the header no longer carries a search field",
  (await p.locator(".header__searchchip, .header input[type=search]").count()) === 0);

// On a non-Discover tab the field must not exist at all.
await p.locator('[data-dest="home"]').click();
await p.waitForTimeout(900);
check("and it is absent on Stream", (await p.locator(".disc-search").count()) === 0);

await p.locator('[data-dest="discover"]').click();
await p.waitForTimeout(1200);
check("present on Discover", (await p.locator(".disc-search").count()) === 1);

// It must line up with the filter tabs, not float beside them.
const geo = await p.evaluate(() => {
  const t = document.querySelector(".discover__toggle .chip-tabs").getBoundingClientRect();
  const s = document.querySelector(".disc-search").getBoundingClientRect();
  return { tabs: [t.top, t.height], search: [s.top, s.height], gap: +(s.left - t.right).toFixed(1) };
});
check("sharing the filter row's baseline",
  Math.abs(geo.tabs[0] - geo.search[0]) < 3 && Math.abs(geo.tabs[1] - geo.search[1]) < 3,
  JSON.stringify(geo));

// Typing has to reach the grid.
// The placeholder promises a scope, and searchDiscover really does keep
// it: it drops every catalog whose type is not the selected one. So the
// copy has to follow the tab, or the field is lying about why a result is
// missing.
for (const [tab, want] of [["All Content", "Search movies & series…"],
                           ["Movies", "Search movies…"],
                           ["Series", "Search series…"]]) {
  await p.getByRole("tab", { name: tab }).click().catch(async () => {
    await p.locator(".discover__toggle .chip-tabs__tab", { hasText: tab }).click();
  });
  await p.waitForTimeout(400);
  const ph = await p.locator(".disc-search__input").getAttribute("placeholder");
  const al = await p.locator(".disc-search__input").getAttribute("aria-label");
  check(`"${tab}" says ${JSON.stringify(want)}`, ph === want, ph ?? "none");
  check(`  and its label matches`, al === want.replace("…", ""), al ?? "none");
}

await p.locator(".disc-search__input").fill("crime");
await p.waitForTimeout(1200);
const heading = await p.locator(".discover__gridwrap h3").first().textContent();
check("typing drives the results heading", /crime/i.test(heading ?? ""), heading ?? "none");

// The shortcut, from a different screen entirely.
await p.locator('[data-dest="guide"]').click();
await p.waitForTimeout(1000);
await p.keyboard.press("/");
await p.waitForTimeout(1400);
const focused = await p.evaluate(() => document.activeElement?.className ?? "");
check("`/` from the Guide lands in the field", focused.includes("disc-search__input"), focused);

if (errs.length) { console.log("ERRORS", errs.slice(0,3)); fail++; }
console.log(fail ? `${fail} FAILURES` : "ALL PASS");
await b.close();
process.exit(fail ? 1 : 0);

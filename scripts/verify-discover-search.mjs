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

/**
 * CINEMETA IS ROUTED, not reached. Search now asks Stremio's public
 * metadata addon alongside the configured catalogs, because a curated
 * catalog searches only inside itself — Adam's eight mdblist lists
 * answered "ironman" with a triathlon documentary and no Marvel film,
 * and no score threshold could detect that ("Ironman" and "Iron Man"
 * collapse to the same key, so his wrong answer scored 100).
 *
 * Routing it here does two jobs: the run stays deterministic and offline,
 * and "cachedOnly" below can hold a title the configured catalogs DO NOT
 * carry, which is the only way to prove the merge does anything.
 */
const CINEMETA_ONLY = {
  metas: [
    {
      id: "tt0110912",
      type: "movie",
      name: "Pulp Fiction",
      poster: "http://localhost:8084/poster/tt300001.png",
    },
  ],
};
await p.route(/v3-cinemeta\.strem\.io/, (route) => {
  const url = route.request().url();
  // Only the one query gets an answer. Everything else is an empty index,
  // so the existing checks measure the configured catalogs as they always
  // did rather than quietly passing on Cinemeta's results.
  const body = /search=pulp/i.test(url) ? CINEMETA_ONLY : { metas: [] };
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
});
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

// THE CAPSULE NEVER MOVES THE PAGE.
//
// It is absolutely positioned so it costs the layout nothing, and counting
// the second row into --header-h handed that cost straight back: every
// screen's top padding is driven off it, so the whole page slid down 39px
// as the row unfolded.
//
// Sampled ACROSS the unfold, which is why the click is in here rather than
// on its own line: the failure is a republish DURING the animation, and
// waiting for the row to settle first would step right over it.
const hh = () => p.evaluate(() => getComputedStyle(document.documentElement)
  .getPropertyValue("--header-h").trim());
const seen = new Set([await hh()]);
await p.locator('[data-dest="discover"]').click();
for (let i = 0; i < 24; i++) { seen.add(await hh()); await p.waitForTimeout(20); }
await p.waitForTimeout(900);
seen.add(await hh());
check("open on Discover",
  (await p.locator(".navcap__row--sub").evaluate((el) => el.offsetHeight)) > 30);
check("and --header-h never moved while it opened",
  seen.size === 1, [...seen].join(" -> "));

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
// THE CAPSULE IS SIZED BY WHICHEVER ROW NEEDS MORE, and it used to be row
// 1 alone. That was fine until row 2 gained the REC chip: with row 1
// setting the width, everything row 2 added came out of the search field,
// which crushed to its magnifier while REC hung off the right edge. Adam's
// call was that the capsule should grow instead.
//
// So the check is no longer "row 1 wins", it is "nothing overflows": the
// capsule fits its padding around the WIDER row, and neither row is
// clipped. The mark's midline is asserted separately below, and that is
// the property this was really protecting.
const wider = Math.max(geo.row1, geo.row2);
check("the capsule fits whichever row is wider",
  Math.abs(geo.nav - (wider + geo.pad)) < 1.5, JSON.stringify(geo));
check("and neither row overflows it",
  geo.row1 <= geo.nav - geo.pad + 0.5 && geo.row2 <= geo.nav - geo.pad + 0.5,
  `row1 ${geo.row1} row2 ${geo.row2} inner ${geo.nav - geo.pad}`);
check("and the mark still holds the midline with both rows open",
  Math.abs(geo.off) < 1.5, `${geo.off}px`);

// Both rows hang off the SAME left edge. Nothing else in here would
// notice if row 2 drifted: every check above is about width.
const rail = await p.evaluate(() => {
  const n = document.querySelector(".navcap");
  const L = n.getBoundingClientRect().left;
  const edge = (sel) => {
    const row = n.querySelector(sel);
    const b = Array.from(row.children).find((c) => c.tagName === "BUTTON");
    return [+(b.getBoundingClientRect().left - L).toFixed(2),
            +(row.getBoundingClientRect().right - L).toFixed(2)];
  };
  return { one: edge(".navcap__row--nav"), two: edge(".navcap__row--sub") };
});
check("the two rows share a left rail",
  Math.abs(rail.one[0] - rail.two[0]) < 0.5, `${rail.one[0]} vs ${rail.two[0]}`);
check("  and a right one", Math.abs(rail.one[1] - rail.two[1]) < 0.5,
  `${rail.one[1]} vs ${rail.two[1]}`);

// THE THUMB SITS ON THE ITEM IT IS MARKING.
//
// Nothing in here checked that, and it went wrong the moment the second
// row landed. The thumb is absolutely positioned inside its ROW, but the
// geometry walk still started at the CAPSULE's padding, so every thumb sat
// exactly 14px right of its item, in both rows and every state, with the
// width dead on. The mark stayed on the midline throughout, so the one
// position check in here was perfectly happy.
for (const [tab, row] of [["all", "sub"], ["movie", "sub"], ["series", "sub"]]) {
  await p.locator(`.navcap__row--sub [data-key="${tab}"]`).click();
  await p.waitForTimeout(700);
  const off = await p.evaluate((r) => {
    const q = document.querySelector(`.navcap__row--${r}`);
    const t = q.querySelector(".navcap__pill").getBoundingClientRect();
    const a = q.querySelector("[aria-current]").getBoundingClientRect();
    return { l: +(t.left - a.left).toFixed(2), w: +(t.width - a.width).toFixed(2) };
  }, row);
  check(`the thumb sits on "${tab}"`, Math.abs(off.l) < 1 && Math.abs(off.w) < 1,
    `left off by ${off.l}, width off by ${off.w}`);
}
const off1 = await p.evaluate(() => {
  const q = document.querySelector(".navcap__row--nav");
  const t = q.querySelector(".navcap__pill").getBoundingClientRect();
  const a = q.querySelector("[aria-current]").getBoundingClientRect();
  return { l: +(t.left - a.left).toFixed(2), w: +(t.width - a.width).toFixed(2) };
});
check("and row 1's thumb sits on Discover",
  Math.abs(off1.l) < 1 && Math.abs(off1.w) < 1,
  `left off by ${off1.l}, width off by ${off1.w}`);

// THE RIM AND THE GLARE TRACE THE SAME SHAPE AS THE FILL.
//
// corner-shape does not inherit and `border-radius: inherit` carries only
// the radius, so the ::after hairline and the ::before glare each need the
// capsule's shape spelled out for them. Without it they kept their own,
// and the hairline lifted off the fill and floated outside it in all four
// corners.
//
// Shape-AGNOSTIC on purpose: it reads whatever .navcap computes and forces
// the two layers to that, then requires nothing to move. So it holds for
// the 33px round the capsule uses now, and would still hold if the design
// changed the shape again — it compares the parts to each other, never to
// a hard-coded value.
const shape = await p.evaluate(() =>
  getComputedStyle(document.querySelector(".navcap"))
    .getPropertyValue("corner-shape").trim());
const cornerBox = await p.locator(".navcap").boundingBox();
const clip = { x: cornerBox.x, y: cornerBox.y, width: 60, height: 60 };
const asIs = await p.screenshot({ clip });
const forced = await p.addStyleTag({ content:
  `.navcap::after, .navcap::before { corner-shape: ${shape} !important }` });
await p.waitForTimeout(250);
const matched = await p.screenshot({ clip });
await forced.evaluate((el) => el.remove());
check(`the rim and the glare trace the capsule's own corner (${shape})`,
  asIs.equals(matched), asIs.equals(matched) ? "" : "corner layers disagree");

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

// ---- KEYWORDS. The bug Adam reported: "ironman" showed no results,
// because the catalogs match a SUBSTRING of the title and "Iron Man" does
// not contain that one. Fixed by asking the network something wider when
// the typed query comes back thin, then ranking locally against the real
// titles — so this is the check that the fallback fires AND that its noise
// is filtered back out.
{
  const titles = async (q) => {
    await p.locator(".navcap__searchinput").fill(q);
    await p.waitForTimeout(1400);
    return p.evaluate(() =>
      [...document.querySelectorAll(".disc-grid .stream-card__name")].map((e) =>
        e.textContent.trim(),
      ),
    );
  };

  const run = await titles("ironman");
  check("\"ironman\" finds \"Iron Man\"", run.includes("Iron Man"), run.join(", "));
  check("  and its sequel comes with it", run.includes("Iron Man 2"), run.join(", "));
  check("  with the exact title ranked first",
    run[0] === "Iron Man", run[0] ?? "nothing");
  // The broadened ask was "iron", which a substring catalog answers with
  // anything containing it — here, "The Iron Giant". None of that may
  // survive. NAMING THE REAL NOISE MATTERS: the first version of this
  // listed titles the broadened query never returns, so it passed with the
  // filter switched off.
  check("  and the broadened query's noise is dropped",
    !run.some((t) => /Iron Giant|Dark Knight|Fake Movie/.test(t)), run.join(", "));

  const spaced = await titles("iron man");
  check("the spaced spelling still works", spaced.includes("Iron Man"), spaced.join(", "));

  const unrelated = await titles("zzzznotathing");
  check("a query that matches nothing still returns nothing",
    unrelated.length === 0, unrelated.join(", "));

  // THE CURATED-CATALOG CEILING. fake-aio carries no "Pulp Fiction", so
  // before search asked an index this query returned nothing no matter how
  // well it ranked. This is Adam's bug in miniature: the machinery was
  // working on a corpus that did not contain the answer.
  const indexed = await titles("pulp fiction");
  check("a title the configured catalogs lack still comes back",
    indexed.includes("Pulp Fiction"), indexed.join(", ") || "nothing");
}

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

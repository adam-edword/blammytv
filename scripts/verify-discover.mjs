// E2E: the Discover tab against fake-aio — toggle, genre rail, grid,
// genre filtering, and the hand-off into the Stream tab's detail page.
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const results = [];
const check = (name, ok, extra = "") => {
  results.push(ok);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem(
    "blammytv.aiostreams",
    JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }),
  );
  sessionStorage.setItem("btv:welcome-played", "1");
});
await page.goto("http://localhost:4173/");
// New nav (v0.3.37): Discover is a Stream-section pill, not a top tab —
// enter the section, then pick the page.
await page.getByRole("button", { name: "Stream", exact: true }).click();
await page.getByRole("button", { name: "Discover", exact: true }).click();
await page
  .waitForFunction(() => document.querySelectorAll(".disc-grid .stream-card").length > 0, null, { timeout: 20_000 })
  .catch(() => {});

const gridTitles = () =>
  page.$$eval(".disc-grid .stream-card__name", (els) => els.map((e) => e.textContent));

let names = await gridTitles();
check("all-content grid conglomerates every catalog",
  names.includes("Fake Movie One") && names.includes("Fake Series One") && names.includes("Extra Movie One"),
  `${names.length} cards`);
// All Content always labels the type, whatever the Card Details setting.
const firstMeta = await page.locator(".disc-grid .stream-card__meta").first().textContent();
const seriesCard = page.locator(".disc-grid .stream-card", { hasText: "Fake Series One" });
const seriesMeta = await seriesCard.locator(".stream-card__meta").textContent().catch(() => "");
check("all-content meta shows the kind",
  (firstMeta ?? "").includes("Movie") && (seriesMeta ?? "").includes("Series"),
  `movie="${firstMeta}" series="${seriesMeta}"`);
check("round-robin order across feeds",
  names[0] === "Fake Movie One" && names[1] === "Fake Series One" && names[2] === "Extra Movie One");

const railNames = await page.$$eval(".genre-card__name", (els) => els.map((e) => e.textContent));
check("genre rail = union of catalog genres", JSON.stringify(railNames) === JSON.stringify(["Action", "Comedy", "Drama"]), railNames.join(","));

// Movies-only via the pill toggle.
await page.getByRole("button", { name: "Movies", exact: true }).click();
await page.waitForTimeout(600);
names = await gridTitles();
check("Movies filter drops series", names.length === 10 && !names.some((n) => n.startsWith("Fake Series")), `${names.length} cards`);

// Back to All, then filter by Comedy via the rail card.
await page.getByRole("button", { name: "All Content" }).click();
await page.waitForTimeout(400);
await page.locator(".genre-card", { hasText: "Comedy" }).click();
await page.waitForTimeout(700);
names = await gridTitles();
check("Comedy rail filter narrows both types",
  names.includes("Fake Movie Two") && names.includes("Fake Series Two") &&
  !names.includes("Fake Movie One") && !names.includes("Fake Series One"),
  names.join(", "));
check("genre card marked selected", (await page.locator(".genre-card--on").count()) === 1);

// The rail card's own title leads the genre grid (pin-first).
const NAME_BY_ID = { tt1: "Fake Movie", tt2: "Fake Series", tt4: "Extra Movie" };
const pinned = await page.evaluate(() => {
  const memo = JSON.parse(localStorage.getItem("blammytv.discoverArt") ?? "null");
  return memo?.data?.lastByGenre?.comedy?.id ?? null;
});
if (pinned) {
  const word = ["One","Two","Three","Four","Five","Six","Seven","Eight"][Number(pinned.slice(-1)) - 1];
  const family = NAME_BY_ID[pinned.slice(0, 3)];
  check("card art title leads its grid", names[0] === family + " " + word, "pin=" + pinned + " first=" + names[0]);
} else {
  check("card art title leads its grid", false, "no pinned id in art memo");
}

await page.screenshot({ path: process.env.SHOT_DIR + "/discover.png" });

// Hand-off: click a card → Stream tab detail with sources.
await page.locator(".disc-grid .stream-card", { hasText: "Fake Movie Two" }).click();
await page.waitForFunction(() => document.body.innerText.includes("Sources"), null, { timeout: 15_000 }).catch(() => {});
await page.waitForTimeout(500);
const text = await page.evaluate(() => document.body.innerText);
check("card opens Stream detail", text.includes("Full synopsis for tt100002") || text.includes("A perfectly fake movie"));
check("stream sources render after hand-off", (await page.locator(".vod-source").count()) === 2);
await page.screenshot({ path: process.env.SHOT_DIR + "/discover-handoff.png" });

// Back from the handed-off detail returns to DISCOVER, not Stream home.
await page.getByRole("button", { name: /back/i }).first().click();
await page.waitForTimeout(600);
check("back returns to Discover grid", (await page.locator(".disc-grid").count()) > 0);
check("nav shows Discover pill active under Stream section",
  (await page.locator(".header__rail .chip-tabs__tab--active").textContent()) === "Discover" &&
  (await page.locator(".header__tab--active").textContent()) === "Stream");

// ---- Search: the header PILL owns the input; results merge every
// search catalog (incl. search-only) with type labels intact.
check("header search chip lives in the rail (open)",
  await page.locator(".header__rail:not(.header__rail--off) .header__searchchip").count() === 1);
const tabsBoxBefore = await page.getByRole("button", { name: "Stream", exact: true }).boundingBox();
// The input rests at width 0 inside its chip — focus first (expands it),
// then fill; fill's own visibility auto-wait rides out the width morph.
const typeSearch = async (v) => {
  await page.focus(".header__searchinput");
  await page.fill(".header__searchinput", v);
};
await typeSearch("two");
await page.waitForTimeout(900); // debounce + fetch
let found = await gridTitles();
check("search merges all search catalogs",
  found.includes("Fake Movie Two") && found.includes("Fake Series Two") && found.includes("Genre Movie Two"),
  found.join(", "));
check("search results respect kind labels",
  (await page.locator(".disc-grid .stream-card__meta").first().textContent() ?? "").match(/Movie|Series/) !== null);
await page.focus(".header__searchinput");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check("Escape clears back to browse", (await page.locator(".genre-card").count()) > 0);
check("Escape also blurs the search",
  !(await page.evaluate(() => document.activeElement?.classList.contains("header__searchinput") ?? false)));
// The Discover TAB itself clears an active search too.
await typeSearch("two");
await page.waitForTimeout(900);
check("search active again", (await page.locator(".genre-card").count()) === 0);
await page.getByRole("button", { name: "Discover", exact: true }).click();
await page.waitForTimeout(400);
check("Discover tab click clears search to browse",
  (await page.locator(".genre-card").count()) > 0 &&
  (await page.inputValue(".header__searchinput")) === "");
// Keyboard shortcuts focus the pill on the VOD side.
await page.locator("body").click({ position: { x: 400, y: 500 } });
for (const combo of ["/", "Control+k", "Control+f"]) {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press(combo);
  await page.waitForTimeout(150);
  const hit = await page.evaluate(() => document.activeElement?.classList.contains("header__searchinput") ?? false);
  check("shortcut " + combo + " focuses search", hit);
}
// Typing "/" INSIDE the input must not re-trigger/steal (it just types).
await typeSearch("");
await page.type(".header__searchinput", "a/b");
check("slash inside input just types", (await page.inputValue(".header__searchinput")) === "a/b");
await typeSearch("");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// ---- Thumb-on-search: focusing slides the ChipTabs thumb onto the
// search chip (stretched to its expanded width); Escape/blur sends it
// home to the page pill. streamTab stays "discover" throughout — the
// thumb override is presentation, not navigation.
await page.focus(".header__searchinput");
await page.waitForTimeout(700); // input width morph + thumb glide
const thumbOn = await page.evaluate(() => {
  const t = document.querySelector(".header__rail .chip-tabs__thumb")?.getBoundingClientRect();
  const c = document.querySelector(".header__searchchip")?.getBoundingClientRect();
  return t && c ? { dl: Math.abs(t.left - c.left), dw: Math.abs(t.width - c.width) } : null;
});
check("focus slides the thumb behind the search icon",
  !!thumbOn && thumbOn.dl < 2.5 && thumbOn.dw < 2.5, JSON.stringify(thumbOn));
// The input floats absolutely off the chip — opening search must NOT
// move the nav (the in-flow expansion regression Adam caught).
const tabsBoxFocused = await page.getByRole("button", { name: "Stream", exact: true }).boundingBox();
check("nav does not move while search is open",
  Math.abs((tabsBoxBefore?.x ?? 0) - (tabsBoxFocused?.x ?? 1)) < 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(700); // chip collapse + thumb return
const thumbHome = await page.evaluate(() => {
  const t = document.querySelector(".header__rail .chip-tabs__thumb")?.getBoundingClientRect();
  const c = document.querySelector('.header__rail [data-tab="discover"]')?.getBoundingClientRect();
  return t && c ? { dl: Math.abs(t.left - c.left), dw: Math.abs(t.width - c.width) } : null;
});
check("Escape returns the thumb to the page pill",
  !!thumbHome && thumbHome.dl < 2.5 && thumbHome.dw < 2.5, JSON.stringify(thumbHome));
// Within the VOD side, all the search churn must never move the nav.
const tabsBoxVod = await page.getByRole("button", { name: "Stream", exact: true }).boundingBox();
check("nav static within the VOD side", Math.abs((tabsBoxBefore?.x ?? 0) - (tabsBoxVod?.x ?? 1)) < 1);

// TV side: rail collapses, TV icon swaps in.
await page.getByRole("button", { name: "Live TV" }).click();
await page.waitForTimeout(300);
const tabsBoxAfter = await page.getByRole("button", { name: "Stream", exact: true }).boundingBox();
check("rail collapses on Live, TV icon swaps in",
  await page.locator(".header__rail--off").count() === 1 &&
  await page.locator("button.header__search:not(.header__search--off)").count() === 1);
// TV icon is UNLINKED from VOD search: clicking it must not navigate.
await page.locator("button.header__search").click();
await page.waitForTimeout(400);
check("TV icon does NOT leave Live TV",
  (await page.locator(".header__tab--active").textContent()) === "Live TV");
// Shortcuts are dead on Live.
await page.keyboard.press("/");
await page.waitForTimeout(150);
check("slash does nothing on Live",
  !(await page.evaluate(() => document.activeElement?.classList.contains("header__searchinput") ?? false)));
// Between SECTIONS the nav moves BY DESIGN now: the rail collapses and
// the centered cluster re-centers (phase 2 animates this glide).
check("nav re-centers when the rail collapses",
  Math.abs((tabsBoxBefore?.x ?? 0) - (tabsBoxAfter?.x ?? 0)) > 10,
  `vod x=${tabsBoxBefore?.x} live x=${tabsBoxAfter?.x}`);
// And Stream remembers its page: coming back lands on Discover, not Home.
await page.getByRole("button", { name: "Stream", exact: true }).click();
await page.waitForTimeout(300);
check("Stream remembers its last page across a TV trip",
  (await page.locator(".header__rail .chip-tabs__tab--active").textContent()) === "Discover" &&
  (await page.locator(".disc-grid, .discover").count()) > 0);
// Within the section, the Stream button is the "back to Home" shortcut —
// and once AT Home it's inert (no hover dim).
await page.getByRole("button", { name: "Stream", exact: true }).click();
await page.waitForTimeout(300);
check("Stream button returns to Home from a sub-tab",
  (await page.locator(".header__rail .chip-tabs__tab--active").textContent()) === "Home");
await page.getByRole("button", { name: "Stream", exact: true }).hover();
await page.waitForTimeout(250);
check("Stream button holds full strength on hover at Home",
  (await page.evaluate(() =>
    getComputedStyle([...document.querySelectorAll(".header__tab")]
      .find((b) => b.textContent === "Stream")).opacity)) === "1");

// ---- My List: empty state, save from detail, grid render, hand-off
// whose back-out returns HERE (origin plumbing), then unsave.
await page.locator(".header__rail").getByRole("button", { name: "My List", exact: true }).click();
await page.waitForTimeout(400);
check("My List empty state",
  (await page.evaluate(() => document.body.innerText)).includes("Nothing saved yet"));
await page.getByRole("button", { name: "Home", exact: true }).click();
await page.waitForTimeout(500);
await page.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
await page.waitForTimeout(700);
await page.locator(".vod-save").click();
check("save button flips to saved", (await page.locator(".vod-save--on").count()) === 1);
await page.locator(".header__rail").getByRole("button", { name: "My List", exact: true }).click();
await page.waitForTimeout(500);
check("My List grid shows the saved title",
  (await page.locator(".disc-grid .stream-card", { hasText: "Fake Movie One" }).count()) === 1);
check("My List card carries the kind label",
  ((await page.locator(".disc-grid .stream-card__meta").first().textContent()) ?? "").includes("Movie"));
await page.locator(".disc-grid .stream-card", { hasText: "Fake Movie One" }).click();
await page.waitForTimeout(700);
check("My List card opens Stream detail", (await page.locator(".vod-back").count()) > 0);
await page.locator(".vod-back").click();
await page.waitForTimeout(500);
check("back from hand-off returns to My List",
  (await page.locator(".header__rail .chip-tabs__tab--active").textContent()) === "My List" &&
  (await page.locator(".disc-grid").count()) > 0);
// Unsave via the same detail button → grid empties again.
await page.locator(".disc-grid .stream-card", { hasText: "Fake Movie One" }).click();
await page.waitForTimeout(700);
await page.locator(".vod-save--on").click();
await page.locator(".vod-back").click();
await page.waitForTimeout(500);
check("unsave empties My List",
  (await page.evaluate(() => document.body.innerText)).includes("Nothing saved yet"));

// ---- Cache seeding: with the Stream cache warm, the unfiltered grid
// paints from it with ZERO catalog fetches; scrolling past the cached
// depth resumes skip pagination on the network.
const page2 = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page2.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  sessionStorage.setItem("btv:welcome-played", "1");
});
await page2.goto("http://localhost:4173/");
await page2.getByRole("button", { name: "Stream", exact: true }).click();
await page2.waitForFunction(() => document.body.innerText.includes("Top Movies"), null, { timeout: 20_000 }).catch(() => {});
await page2.waitForTimeout(600); // let the cache settle
let plainFetches = 0, skipFetches = 0;
page2.on("request", (r) => {
  const u = r.url();
  if (!/8084\/catalog\//.test(u)) return;
  if (/skip/.test(u)) skipFetches++;
  else if (!/genre|search/.test(u)) plainFetches++;
});
await page2.getByRole("button", { name: "Discover", exact: true }).click();
await page2.waitForFunction(() => document.querySelectorAll(".disc-grid .stream-card").length > 0, null, { timeout: 10_000 }).catch(() => {});
const seeded = await page2.$$eval(".disc-grid .stream-card__name", (els) => els.map((e) => e.textContent));
check("warm cache seeds the grid instantly",
  seeded.includes("Fake Movie One") && seeded.includes("Fake Series One") && seeded.includes("Extra Movie One"),
  seeded.length + " cards");
check("zero unfiltered catalog fetches on seed", plainFetches === 0, "plain=" + plainFetches);
await page2.evaluate(() => document.querySelector(".discover")?.scrollTo(0, 99999));
await page2.waitForTimeout(900);
check("scroll past cache resumes skip pagination", skipFetches > 0, "skip=" + skipFetches);
await page2.close();

// ---- One-click play (opt-in, v0.3.48): a movie card click resolves
// sources and plays immediately (no detail page); series still browse.
// In the browser the stage itself can't mount (Tauri-only), so the
// proof is the /stream/ resolve firing + no detail navigation.
const page3 = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page3.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  localStorage.setItem("blammytv.oneClickPlay", JSON.stringify({ v: 1, data: true }));
  sessionStorage.setItem("btv:welcome-played", "1");
});
let streamFetches = 0;
page3.on("request", (r) => { if (/8084\/stream\//.test(r.url())) streamFetches++; });
await page3.goto("http://localhost:4173/");
await page3.getByRole("button", { name: "Stream", exact: true }).click();
await page3.waitForSelector(".stream-card", { timeout: 20_000 });
await page3.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
await page3.waitForTimeout(900);
check("one-click: movie card fires a stream resolve", streamFetches > 0, "fetches=" + streamFetches);
check("one-click: no detail page opened", (await page3.locator(".vod-detail").count()) === 0);
await page3.locator(".stream-card", { hasText: "Fake Series One" }).first().click();
await page3.waitForTimeout(700);
check("one-click: series still browses", (await page3.locator(".vod-detail").count()) === 1);
await page3.close();

// ---- Queue #7 (v0.3.49): cast line + More Like This on detail;
// "42m left" on CW cards; finished movies retire from the row.
const page4 = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page4.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.watching", JSON.stringify({
    v: 1,
    data: [
      { id: "tt100003", title: "Fake Movie Three", at: 3, posSec: 1200, durSec: 5700, kind: "movie" },
      { id: "tt100005", title: "Fake Movie Five", at: 2, posSec: 5500, durSec: 5700, kind: "movie" }, // finished → retires
      { id: "tt200001", title: "Fake Series One", at: 1, episodeId: "tt200001:1:2", posSec: 5500, durSec: 5700, kind: "series" },
    ],
  }));
});
await page4.goto("http://localhost:4173/");
await page4.getByRole("button", { name: "Stream", exact: true }).click();
await page4.waitForSelector(".continue-card", { timeout: 20_000 });
const cwTitles = await page4.$$eval(".continue-card .stream-card__name", (els) => els.map((e) => e.textContent));
check("finished movie retired from Continue Watching",
  !cwTitles.includes("Fake Movie Five") && cwTitles.includes("Fake Movie Three") && cwTitles.includes("Fake Series One"),
  cwTitles.join(", "));
const cwMeta = await page4.locator(".continue-card", { hasText: "Fake Movie Three" }).locator(".stream-card__meta").textContent();
check("CW card shows time left", (cwMeta ?? "").includes("75m left"), cwMeta ?? "");
// Detail: cast + More Like This (genre-matched, self excluded).
await page4.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
await page4.waitForSelector(".vod-detail", { timeout: 15_000 });
await page4.waitForTimeout(1200); // full meta + more-like-this fetches
const detailText = await page4.evaluate(() => document.body.innerText);
check("detail shows the cast line", detailText.includes("With Actor A, Actor B"));
const moreTitles = await page4.$$eval(".vod-more__card", (els) => els.map((e) => e.getAttribute("title")));
check("More Like This renders genre neighbors",
  moreTitles.length > 0 && !moreTitles.includes("Fake Movie One"),
  moreTitles.join(", "));
// The shelf lives UNDER the click-transparent body overlay — a card
// click must still land (opens that title's detail).
const firstMore = moreTitles[0];
await page4.locator(".vod-more__card").first().click();
await page4.waitForTimeout(800);
check("shelf card click opens its detail (pointer-events layering)",
  (await page4.evaluate(() => document.body.innerText)).includes(firstMore ?? "@@"));
await page4.screenshot({ path: process.env.SHOT_DIR + "/detail-more.png" });
// Genre pill → Discover with that genre selected — PRIMED WITH AN
// ACTIVE SEARCH first (fleet finding: the hand-off rendered the stale
// search results because the store clear fired before DiscoverScreen's
// subscription existed).
await page4.focus(".header__searchinput");
await page4.fill(".header__searchinput", "two");
await page4.waitForTimeout(900); // debounced results on Discover
await page4.locator(".disc-grid .stream-card", { hasText: "Fake Movie Two" }).click();
await page4.waitForTimeout(800); // hand-off to detail, search still stored
await page4.locator(".vod-detail__pills button", { hasText: "Action" }).click();
await page4.waitForTimeout(900);
check("genre pill lands on Discover",
  (await page4.locator(".header__rail .chip-tabs__tab--active").textContent()) === "Discover");
check("genre pill pre-selects its genre",
  ((await page4.locator(".genre-card--on .genre-card__name").textContent().catch(() => "")) ?? "") === "Action");
check("genre pill wins over a stale search",
  !(await page4.evaluate(() => document.body.innerText)).includes("Results for") &&
  (await page4.inputValue(".header__searchinput")) === "");
// Row-cap fine-tune: click the number, type an exact value, Enter.
await page4.locator("button[aria-label='Settings']").click();
await page4.waitForTimeout(400);
await page4.getByRole("button", { name: "AIOStreams", exact: true }).click();
await page4.waitForTimeout(400);
await page4.locator(".rowcap__value--btn").click();
await page4.fill(".rowcap__value--edit", "37");
await page4.keyboard.press("Enter");
await page4.waitForTimeout(300);
check("row-cap number is click-to-edit (exact 37 sticks)",
  (await page4.locator(".rowcap__value--btn").textContent()) === "37" &&
  (await page4.evaluate(() => JSON.parse(localStorage.getItem("blammytv.rowCap") ?? "{}").data)) === 37);
await page4.close();

// ---- Aurora easter egg (v0.3.55): hidden until Custom is spam-clicked
// x10; the unlock flips the whole app to the gradient live.
const page5 = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page5.addInitScript(() => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  sessionStorage.setItem("btv:welcome-played", "1");
});
await page5.goto("http://localhost:4173/");
await page5.getByRole("button", { name: "Stream", exact: true }).click();
await page5.locator("button[aria-label='Settings']").click();
await page5.waitForTimeout(300);
await page5.getByRole("button", { name: "Customize", exact: true }).click();
await page5.waitForTimeout(400);
check("aurora swatch hidden before unlock",
  (await page5.locator(".accent-swatch--aurora").count()) === 0);
for (let i = 0; i < 10; i++) {
  await page5.locator(".accent-custom").click();
  await page5.waitForTimeout(40);
}
await page5.waitForTimeout(300);
const egg = await page5.evaluate(() => ({
  style: document.documentElement.dataset.accentStyle ?? null,
  unlocked: JSON.parse(localStorage.getItem("blammytv.auroraUnlocked") ?? "{}").data === true,
  stored: JSON.parse(localStorage.getItem("blammytv.accent-style") ?? "{}").data,
}));
check("spam x10 unlocks + flips to aurora",
  egg.style === "aurora" && egg.unlocked && egg.stored === "aurora", JSON.stringify(egg));
check("aurora swatch now in the picker, checked",
  (await page5.locator(".accent-swatch--aurora").count()) === 1 &&
  (await page5.locator(".accent-swatch--aurora .accent-swatch__check").count()) === 1);
await page5.close();

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);

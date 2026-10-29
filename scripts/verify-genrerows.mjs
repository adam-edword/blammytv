// Headless verify: Discover's genre page as rows (plan 034, 1.0.30), against
// the fake addon's /genrerows/ and /genrerows-bare/ worlds (scripts/fake-aio.mjs,
// :8084; read the block above GENRE_ROWS there for what is in them and why).
//
// Picking a genre used to be one interleaved grid of every catalog that could
// take it. It is rows now: TMDB's popular titles (with a key), the titles that
// are only the genre, its series, then the mixes (a row at 6 cards, not 5),
// each with See All, and See All Comedy at the foot for the whole genre. A
// card whose own genres leave the genre out is dropped everywhere, even from a
// catalog that ignores the filter and sends it anyway.
//
// TMDB IS ROUTED, not reached (api.themoviedb.org is unreachable from the dev
// container, and a third party on CI): the genre list, the popular titles and
// the IMDb ids are answered here in the shape tmdb.ts parses, and the addon
// holds six of the eight films and both shows. Every other host is aborted.
//
// Run: node scripts/fake-aio.mjs; vite on :4173;
//      PW_FROM=<dir>/x.js node scripts/verify-genrerows.mjs
import { createRequire } from "node:module";
import { goTo } from "./nav-settle.mjs";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? `: ${extra}` : ""}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/** What the fake world holds, in the order the page should show it. */
const JUST = [
  "GR Pure One", // three catalogs
  "GR Pure Three", // two, best place 2
  "GR Pure Five", // two, best place 3
  "GR Pure Two", // one, place 1, rated 8
  "GR Show One", // one, place 1, unrated
  "GR Show Two",
  "GR Show Three",
  "GR Pure Four", // one, place 16
  "GR Pure Six", // one, place 18
];
const SIX = ["One", "Two", "Three", "Four", "Five", "Six"];
const POPULAR_ANY = [
  "GR Popular One", "GR Popular Show One", "GR Popular Two", "GR Popular Show Two",
  "GR Popular Three", "GR Popular Four", "GR Popular Five", "GR Popular Six",
];
const POPULAR_FILMS = SIX.map((w) => `GR Popular ${w}`);
const PIN = "GR Romance Three"; // what the Comedy card's wallpaper is dealt from

/** A page on the fake world, offline apart from this machine and a TMDB that
 * answers from here. `key` is whether a TMDB key is stored. */
async function open({ addon = "genrerows", key = true, hold = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await ctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
  const page = await ctx.newPage();
  const asked = { tmdb: [], catalog: [] };
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.hostname === "localhost" && u.pathname.includes("/catalog/")) asked.catalog.push(decodeURIComponent(u.pathname));
  });
  const body = (u) => {
    const p = u.pathname;
    if (p.includes("/genre/")) return { genres: [{ id: 35, name: "Comedy" }, { id: 27, name: "Horror" }] };
    if (p.endsWith("/discover/movie"))
      return { results: Array.from({ length: 8 }, (_, i) => ({ id: 701 + i, title: `TMDB Film ${i + 1}`, release_date: "2024-01-01" })) };
    if (p.endsWith("/discover/tv"))
      return { results: [801, 802].map((id) => ({ id, name: `TMDB Show ${id}`, first_air_date: "2024-01-01" })) };
    const m = /\/(movie|tv)\/(\d+)\/external_ids$/.exec(p);
    if (m) return { imdb_id: m[1] === "movie" ? `tt7000${Number(m[2]) - 700}` : `tt7100${Number(m[2]) - 800}` };
    return {};
  };
  await page.route(/api\.themoviedb\.org/, (route) => {
    const u = new URL(route.request().url());
    asked.tmdb.push(u.pathname.replace(/^\/3/, "") + "?" + u.searchParams.toString());
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body(u)) });
  });
  // Slow catalogs, so the skeleton can be seen.
  if (hold) await page.route("**/catalog/**", async (r) => { await new Promise((ok) => setTimeout(ok, hold)); r.continue(); });
  await page.addInitScript(
    ({ addon, key, now }) => {
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: `http://localhost:8084/${addon}/manifest.json` }));
      if (key) localStorage.setItem("blammytv.tmdbKey", JSON.stringify({ v: 1, data: "harness-key" }));
      // The Comedy card is already wearing a title (fresh, so nothing is dealt again).
      localStorage.setItem(
        "blammytv.discoverArt",
        JSON.stringify({ v: 6, data: { byId: {}, lastByGenre: { comedy: { url: "http://localhost:8084/bg/tt61003.png", at: now, n: 1, id: "tt61003" } } } }),
      );
    },
    { addon, key, now: Date.now() },
  );
  await page.goto("http://localhost:4173/");
  await goTo(page, "discover");
  await page.waitForSelector(".genre-card", { timeout: 20_000 });
  return { ctx, page, asked };
}

const pickComedy = (page) => page.locator(".genre-card", { hasText: "Comedy" }).click();
const rowsUp = (page) => page.waitForSelector(".genre-rows .media-row__title", { timeout: 20_000 });
const titles = (page) => page.$$eval(".genre-rows .media-row__title", (els) => els.map((e) => e.textContent));
const row = (page, title) =>
  page.locator(".genre-rows .media-row").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
const names = (loc) => loc.locator(".stream-card__name").evaluateAll((els) => els.map((e) => e.textContent));
const gridNames = (page) => page.$$eval(".disc-grid .stream-card__name", (els) => els.map((e) => e.textContent));
const allNames = (page) => page.$$eval(".stream-card__name", (els) => els.map((e) => e.textContent));
const scrollTop = (page) => page.evaluate(() => document.querySelector(".discover")?.scrollTop ?? -1);
const scrollTo = (page, y) => page.evaluate((y) => { document.querySelector(".discover").scrollTop = y; }, y);
const back = (page) => page.getByRole("button", { name: "Back", exact: true });

// ---- Any, with a TMDB key: the whole page --------------------------------
{
  const { ctx, page, asked } = await open({ hold: 700 });
  await pickComedy(page);
  // While the pool loads: the rows' skeleton, not a grid and not a blank.
  await page.waitForSelector(".genre-rows .disc-skel", { timeout: 5_000 }).catch(() => {});
  const skel = await page.locator(".genre-rows .disc-skel").count();
  check("the rows' skeleton shows while the pool loads", skel > 0 && (await page.locator(".disc-grid").count()) === 0, `${skel} placeholders`);
  await rowsUp(page);
  check("and goes when the rows land", (await page.locator(".genre-rows .disc-skel").count()) === 0);

  check("the rows, in order, named: TMDB, Just, the series, the mixes",
    same(await titles(page), ["Popular Comedy", "Just Comedy", "Comedy Series", "Romantic Comedy", "Comedy and Western"]),
    (await titles(page)).join(" | "));
  check("Horror + Comedy has 5 titles and no row; Romance + Comedy has 6 and one",
    !(await titles(page)).includes("Horror Comedy") && (await titles(page)).includes("Romantic Comedy"));

  // TMDB's row
  check("Popular Comedy is TMDB's titles found in the addons, films and shows alternating, the two it lacks left out",
    same(await names(row(page, "Popular Comedy")), POPULAR_ANY), (await names(row(page, "Popular Comedy"))).join(", "));
  check("only that row says From TMDB",
    same(await page.$$eval(".genre-rows__chip", (els) => els.map((e) => e.textContent)), ["From TMDB"]) &&
      (await row(page, "Popular Comedy").locator(".genre-rows__chip").count()) === 1);
  check("it asked TMDB for the genre by popularity, films and shows",
    asked.tmdb.some((a) => a.startsWith("/discover/movie?") && a.includes("with_genres=35") && a.includes("sort_by=popularity.desc")) &&
      asked.tmdb.some((a) => a.startsWith("/discover/tv?") && a.includes("with_genres=35")), asked.tmdb.slice(0, 4).join(" "));

  // Ranking and what is in a row
  check("Just Comedy holds only titles that are only Comedy, the most seen first",
    same(await names(row(page, "Just Comedy")), JUST), (await names(row(page, "Just Comedy"))).join(", "));
  check("Comedy Series is the shows with Comedy, the one with Drama too last",
    same(await names(row(page, "Comedy Series")), ["GR Show One", "GR Show Two", "GR Show Three", "GR Show Four"]));
  check("the title the Comedy card is wearing leads the first row it is in",
    same(await names(row(page, "Romantic Comedy")), [PIN, ...SIX.filter((w) => w !== "Three").map((w) => `GR Romance ${w}`)]),
    (await names(row(page, "Romantic Comedy"))).join(", "));
  check("a pair with no name in the table is Comedy and the other",
    same(await names(row(page, "Comedy and Western")), SIX.map((w) => `GR Western ${w}`)));

  // The off-genre drop, with the catalog that sent them proved to have done so
  const log = await page.evaluate(() => window.btvGenreGrid());
  const loose = log.catalogs["movie:gr-loose"];
  const everywhere = await allNames(page);
  check("the catalog that ignores the filter did send off-genre titles",
    !!loose && loose.got === 5 && loose.tagged === 1, JSON.stringify(loose));
  check("an off-genre title is in no row",
    !everywhere.some((n) => n.startsWith("GR Off")), everywhere.filter((n) => n.startsWith("GR Off")).join(", "));
  check("neither is a title with no genres",
    !everywhere.some((n) => n.startsWith("GR Blank")));

  // Stream's row markup: 240 posters, details on hover
  const card = row(page, "Just Comedy").locator(".stream-card").first();
  const w = await card.locator(".stream-card__poster").evaluate((el) => el.offsetWidth);
  const meta = card.locator(".stream-card__meta");
  const before = await meta.evaluate((el) => getComputedStyle(el).opacity);
  await card.hover();
  await page.waitForTimeout(300);
  const after = await meta.evaluate((el) => getComputedStyle(el).opacity);
  check("posters are Stream's 240 and the details wait for a hover", w === 240 && before === "0" && after === "1", `w=${w} ${before} -> ${after}`);
  check("the rail stays, on its genre, with the type filter and the foot",
    (await page.locator(".genre-card").count()) === 3 &&
      (await page.locator(".genre-card--on .genre-card__name").textContent()) === "Comedy" &&
      (await page.getByRole("button", { name: "See All Comedy", exact: true }).count()) === 1);

  // See All on a row, and Back to where the rows were
  await scrollTo(page, 300);
  await page.waitForTimeout(150);
  const y = await scrollTop(page);
  const seen = asked.catalog.length;
  await page.getByRole("button", { name: "See All Just Comedy", exact: true }).click();
  await page.waitForSelector(".library__heading");
  await page.waitForTimeout(700);
  check("See All on a row opens that row as a grid, under its name",
    (await page.locator(".library__heading").textContent()) === "Just Comedy" && same(await gridNames(page), JUST) &&
      (await page.locator(".genre-rows").count()) === 0, (await gridNames(page)).length + " cards");
  check("a row's grid pages nothing in behind it", asked.catalog.length === seen && (await page.locator(".discover__sentinel").count()) === 0);
  await back(page).click();
  await rowsUp(page);
  await page.waitForTimeout(400);
  check("Back returns to the rows", same(await titles(page), ["Popular Comedy", "Just Comedy", "Comedy Series", "Romantic Comedy", "Comedy and Western"]));
  const y2 = await scrollTop(page);
  check("at the scroll position they were left at", Math.abs(y2 - y) <= 4 && y > 100, `${y} -> ${y2}`);

  // See All Comedy: today's grid, off-genre gone, ranked, pinned, paged on
  await scrollTo(page, 99999);
  await page.getByRole("button", { name: "See All Comedy", exact: true }).click();
  await page.waitForSelector(".library__heading");
  await page.waitForTimeout(700);
  const FIRST = [
    PIN, ...JUST,
    "GR Romance One", "GR Show Four", "GR Romance Two", "GR Romance Four", "GR Romance Five", "GR Romance Six",
    ...SIX.slice(0, 5).map((w) => `GR Horror ${w}`), ...SIX.map((w) => `GR Western ${w}`),
    "GR Trio", "GR Blank One", "GR Blank Two",
  ];
  const first = await gridNames(page);
  check("See All Comedy is the pool, off-genre dropped, ranked: the card's title, the pure ones, the pairs, the trio (rated 9.9), then the unknown",
    same(first, FIRST), first.length + " cards: " + first.slice(0, 12).join(", "));
  check("it is titled for the genre", (await page.locator(".library__heading").textContent()) === "All Comedy");
  check("a title with no genres is here, though in no row", first.includes("GR Blank One"));
  // Scrolling brings the next page of the catalogs, ranked on its own and added at the end
  await scrollTo(page, 99999);
  await page.waitForFunction(() => document.querySelectorAll(".disc-grid .stream-card").length > 30, null, { timeout: 10_000 }).catch(() => {});
  const more = await gridNames(page);
  check("scrolling adds the next batch at the end: what is on screen does not move, the late 9.5 does not jump the queue",
    more.length === 31 && same(more.slice(0, 30), FIRST) && more[30] === "GR Pure Late", `${more.length}, last ${more.at(-1)}`);
  await back(page).click();
  await rowsUp(page);
  check("Back from it returns to the rows", (await titles(page)).length === 5);

  // A tab flip keeps the rows without asking again
  const genreAsks = () => asked.catalog.filter((c) => c.includes("genre=Comedy")).length;
  const asks = genreAsks();
  await goTo(page, "home");
  await page.waitForSelector(".stream__rows .stream-card", { timeout: 20_000 });
  await goTo(page, "discover");
  await rowsUp(page);
  await page.waitForTimeout(500);
  check("leaving Discover and coming back restores the rows without asking again",
    same(await titles(page), ["Popular Comedy", "Just Comedy", "Comedy Series", "Romantic Comedy", "Comedy and Western"]) &&
      genreAsks() === asks && (await page.locator(".genre-card--on").count()) === 1, `${asks} -> ${genreAsks()}`);
  await ctx.close();
}

// ---- Movies: no Series row, TMDB asks for films only ----------------------
{
  const { ctx, page, asked } = await open();
  await page.getByRole("button", { name: "Movies", exact: true }).click();
  await pickComedy(page);
  await rowsUp(page);
  check("on Movies there is no Series row",
    same(await titles(page), ["Popular Comedy", "Just Comedy", "Romantic Comedy", "Comedy and Western"]), (await titles(page)).join(" | "));
  check("TMDB's row is the six films, and it asked for no shows",
    same(await names(row(page, "Popular Comedy")), POPULAR_FILMS) && !asked.tmdb.some((a) => a.startsWith("/discover/tv")));
  check("Just Comedy is the films only", same(await names(row(page, "Just Comedy")), JUST.filter((n) => !n.startsWith("GR Show"))));
  await ctx.close();
}

// ---- Series: no TMDB row at all, and no Series row either -----------------
{
  const { ctx, page, asked } = await open();
  await page.getByRole("button", { name: "Series", exact: true }).click();
  await pickComedy(page);
  await rowsUp(page);
  await page.waitForTimeout(600);
  check("on Series there is no TMDB row and nothing asked of TMDB",
    same(await titles(page), ["Just Comedy"]) && asked.tmdb.length === 0, (await titles(page)).join(" | ") + " / " + asked.tmdb.length + " asks");
  check("and Just Comedy is the shows that are only Comedy", same(await names(row(page, "Just Comedy")), ["GR Show One", "GR Show Two", "GR Show Three"]));
  await ctx.close();
}

// ---- No key: no TMDB row, no chip, nothing asked --------------------------
{
  const { ctx, page, asked } = await open({ key: false });
  await pickComedy(page);
  await rowsUp(page);
  check("without a TMDB key there is no TMDB row, no chip and no ask",
    same(await titles(page), ["Just Comedy", "Comedy Series", "Romantic Comedy", "Comedy and Western"]) &&
      (await page.locator(".genre-rows__chip").count()) === 0 && asked.tmdb.length === 0);
  await ctx.close();
}

// ---- Cards that carry no genres: today's grid, ranked ---------------------
{
  const { ctx, page } = await open({ addon: "genrerows-bare", key: false });
  await pickComedy(page);
  // Until the genre's pool is in. Not "a grid with Comedy over it": for a frame
  // the all-content grid is still up under the new heading, and it has twelve
  // cards too. The log says whose cards these are, and the skeleton has gone.
  await page
    .waitForFunction(
      () => window.btvGenreGrid().genre === "Comedy" && window.btvGenreGrid().cards.length === 12 &&
        document.querySelectorAll(".disc-grid .stream-card").length === 12 && !document.querySelector(".disc-skel"),
      null,
      { timeout: 20_000 },
    )
    .catch(() => {});
  const n = await gridNames(page);
  check("when the cards carry no genres the page is the one grid, with no rows and no See All",
    n.length === 12 && (await page.locator(".genre-rows").count()) === 0 &&
      (await page.getByRole("button", { name: /^See All/ }).count()) === 0 &&
      (await page.locator(".discover__gridwrap .media-row__title").textContent()) === "Comedy", `${n.length} cards`);
  check("in the order the catalog gave them", same(n, Array.from({ length: 12 }, (_, i) => `Bare ${i + 1}`)));
  await ctx.close();
}

await browser.close();
const pass = results.filter(([, ok]) => ok).length;
console.log(`\n${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);

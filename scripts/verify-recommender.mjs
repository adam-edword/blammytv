// Headless verify: the REC page — keyword chips in, one title out.
//
// TMDB IS ROUTED, not reached. api.themoviedb.org is unreachable from this
// repo (the egress proxy answers 403 to CONNECT) and would be a flaky
// third party even where it is not, so the two endpoints the chain uses are
// answered here in the shape tmdb.ts parses. That makes this a test of the
// CHAIN and the screen, not of their API; `probeTmdb()` covers the other
// half on a machine that can reach them.
//
// The chain under test, and every link can break independently:
//
//   words -> keyword ids -> candidates -> pick ONE -> its IMDb id
//         -> resolveVodItem against the configured addon -> a card
//
// Run, from the REPO ROOT:
//   node scripts/fake-aio.mjs                              # :8084
//   node scripts/fake-m3u.mjs                              # :8082
//   cd apps/app && pnpm exec vite --port 4173 --strictPort
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-recommender.mjs

import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? ` ${d}` : ""}`);
};

const PLAYLIST = {
  v: 1,
  data: [{ kind: "m3u", id: "m1", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" }],
};

/** Which words TMDB has a tag for. "cosy" deliberately has none, so the
 * screen has to say it was ignored rather than silently answering a
 * different question. */
const KEYWORDS = { space: 9882, heist: 10051 };
/** Horror is a GENRE at TMDB, not a keyword, which is exactly what sent
 * Adam's "space horror" to The Super Mario Galaxy Movie: it went through
 * keyword search, matched something tangential, found nothing, relaxed to
 * OR and answered with a film that merely has "space". */
const GENRES = [{ id: 27, name: "Horror" }, { id: 878, name: "Science Fiction" }];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/**
 * @param opts.imdb   what external_ids hands back (null models a TMDB title
 *                    with no IMDb id, which the roll must walk past)
 * @param opts.strict whether the AND query returns anything
 */
async function open(opts = {}) {
  const { imdb = "tt100001", strict = true } = opts;
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.addInitScript((pl) => {
    localStorage.setItem("btv:onboarded", "1");
    sessionStorage.setItem("btv:welcome-played", "1");
    localStorage.setItem("blammytv.playlists", JSON.stringify(pl));
    localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
    localStorage.setItem("blammytv.tmdbKey", JSON.stringify({ v: 1, data: "harness-key" }));
  }, PLAYLIST);

  const asked = [];
  await page.route(/api\.themoviedb\.org/, (route) => {
    const u = new URL(route.request().url());
    asked.push(u.pathname + "?" + u.searchParams.toString());
    let body = {};
    if (u.pathname.includes("/genre/")) {
      body = { genres: GENRES };
    } else if (u.pathname.endsWith("/search/keyword")) {
      const id = KEYWORDS[u.searchParams.get("query")];
      body = { results: id ? [{ id, name: u.searchParams.get("query") }] : [] };
    } else if (u.pathname.includes("/discover/")) {
      const terms = (u.searchParams.get("with_keywords") ?? "") + (u.searchParams.get("with_genres") ?? "");
      const wide = terms.includes("|");
      body = {
        results: strict || wide
          ? [
              { id: 348, title: "Alien", release_date: "1979-05-25" },
              { id: 607, title: "Event Horizon", release_date: "1997-08-15" },
            ]
          : [],
      };
    } else if (u.pathname.includes("external_ids")) {
      body = { imdb_id: imdb };
    }
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  // Unreachable here, and search asks it on every query since v0.9.41.
  await page.route(/v3-cinemeta\.strem\.io/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ metas: [] }) }));

  await page.goto(process.env.APP_URL ?? "http://localhost:4173/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap", { timeout: 20_000 });
  await page.getByRole("button", { name: /^discover$/i }).first().click();
  await page.waitForTimeout(2200);
  await page.locator(".navcap__rec").click();
  await page.waitForSelector(".rec", { timeout: 8000 });
  return { page, errs, asked };
}

const type = async (page, ...ws) => {
  for (const w of ws) {
    await page.locator(".rec__input").fill(w);
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(250);
};

// ---- The happy path ----------------------------------------------------
{
  const { page, errs, asked } = await open();
  check("the REC chip opens the page", (await page.locator(".rec").count()) === 1);
  check("the Find button starts disabled", await page.locator(".rec__go").isDisabled());

  await type(page, "space", "horror");
  check("Enter turns a word into a chip",
    (await page.locator(".rec__chip").allInnerTexts()).join("|").includes("space"));
  check("and a second one", (await page.locator(".rec__chip").count()) === 2);
  check("Find is live once there is a chip",
    !(await page.locator(".rec__go").isDisabled()));

  await page.locator(".rec__go").click();
  const got = await page.waitForSelector(".rec__card", { timeout: 12_000 })
    .then(() => true).catch(() => false);
  check("Find returns ONE title, not a grid", got &&
    (await page.locator(".rec__card").count()) === 1);
  check("  resolved through the configured addon, not TMDB",
    (await page.locator(".rec__cardname").innerText()).startsWith("Fake Movie One"),
    await page.locator(".rec__cardname").innerText());
  // Strict first: two words means one AND query, not two separate asks.
  const discovers = asked.filter((a) => a.includes("/discover/"));
  check("  from a single ALL query", discovers.length === 1,
    JSON.stringify(discovers));
  // THE FIX FOR ADAM'S REPORT. "horror" must go to with_genres, not to
  // keyword search; sending it to keywords is what made space+horror
  // relax to OR and answer with a film that merely has space in it.
  check("  with horror as a GENRE, not a keyword",
    /with_genres=27/.test(discovers[0] ?? "") && /with_keywords=9882(&|$)/.test(discovers[0] ?? ""),
    discovers[0] ?? "");
  check("  and no keyword search was spent on it",
    !asked.some((a) => a.includes("/search/keyword") && a.includes("horror")),
    JSON.stringify(asked.filter((a) => a.includes("/search/keyword"))));

  // A duplicate word would ask TMDB the same thing twice and narrow nothing.
  await type(page, "space");
  check("a repeated word does not add a second chip",
    (await page.locator(".rec__chip").count()) === 2);

  check("no page errors", errs.length === 0, errs.join(" | "));
  await page.close();
}

// ---- Words TMDB has no tag for ----------------------------------------
{
  const { page } = await open();
  await type(page, "space", "cosy");
  await page.locator(".rec__go").click();
  await page.waitForSelector(".rec__card", { timeout: 12_000 }).catch(() => {});
  const note = await page.locator(".rec__note").first().innerText().catch(() => "");
  // Silently dropping it leaves the user reading results for a query they
  // did not make, with no clue which half was ignored.
  check("an unknown word is named, not swallowed", /cosy/.test(note), note);
  await page.close();
}

// ---- Nothing carries all of them --------------------------------------
{
  const { page } = await open({ strict: false });
  await type(page, "heist", "space");
  await page.locator(".rec__go").click();
  await page.waitForSelector(".rec__card", { timeout: 12_000 }).catch(() => {});
  const note = await page.locator(".rec__note").first().innerText().catch(() => "");
  check("a relaxed search says it relaxed", /one of them/.test(note), note);
  await page.close();
}

// ---- A candidate with no IMDb id --------------------------------------
{
  const { page } = await open({ imdb: null });
  await type(page, "space");
  await page.locator(".rec__go").click();
  await page.waitForTimeout(4000);
  // Every candidate fails to convert, so the roll runs out. It must say so
  // rather than sit on "Looking…" forever or show a blank card.
  check("a title with no IMDb id ends in an honest empty, not a hang",
    (await page.locator(".rec__card").count()) === 0 &&
      /Nothing came back/.test(await page.locator(".rec__note").first().innerText().catch(() => "")),
    await page.locator(".rec__note").first().innerText().catch(() => "(no note)"));
  await page.close();
}

// ---- Leaving ------------------------------------------------------------
{
  const { page } = await open();
  await page.evaluate(() => {
    for (const t of ["mousedown", "mouseup"])
      window.dispatchEvent(new MouseEvent(t, { button: 3, buttons: 8, bubbles: true }));
  });
  await page.waitForTimeout(900);
  // The page is a view-stack entry, which is the whole reason back works
  // without the screen knowing anything about it.
  check("mouse-back leaves the recommender", (await page.locator(".rec").count()) === 0);
  check("  and lands on the grid", (await page.locator(".discover").count()) === 1);
  await page.close();
}

await browser.close();
console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);

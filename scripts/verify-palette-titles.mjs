// E2E: Ctrl+K finds titles, not only the app's own places.
//
// Typing a film or show into the palette runs the search Discover runs (the
// "all" filter of searchDiscover, features/palette/titleSearch.ts) after a
// 300ms pause, and lists the first five under "More Films and Series", below what the
// app matched itself (Settings, Go To, channels). While the answer is out a
// disabled "Searching…" row says so; the last row there is always "Search
// Discover for “…”", which fills Discover's search and goes there.
//
// The checks that could pass on an empty page are paired with their positive
// twin (the note is absent WHILE the search is held, and present once it has
// come back empty; a stale answer is held back until a newer one has landed
// and only then let go).
//
// Everything is offline: the fake AIOStreams serves the catalogs, Cinemeta is
// routed, every other host is aborted. A search is HELD by routing its
// requests and answering them when the check says so.
//
//   node scripts/fake-aio.mjs     # :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-palette-titles.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const APP = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const AIO = { v: 1, data: "http://localhost:8084/manifest.json" };
const SEEDED = { aiostreams: AIO, startupTab: { v: 1, data: "stream" } };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/** Cinemeta knows one more title than the fake addon does, for "subtitle". */
const CINEMETA = { subtitle: { id: "tt9990001", type: "movie", name: "Subtitle Man", poster: "http://localhost:8084/poster/tt300001.png" } };

async function open({ store = SEEDED, reducedMotion = "no-preference" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", reducedMotion });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  await ctx.route(/v3-cinemeta\.strem\.io/, (route) => {
    const url = route.request().url();
    if (!/\/catalog\//.test(url)) return route.fulfill({ status: 404, body: "" });
    const hit = Object.entries(CINEMETA).find(([k]) => url.includes(`search=${k}`));
    route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ metas: hit && /movie/.test(url) ? [hit[1]] : [] }) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  // Every search the addon is asked, by the words in it.
  const asked = [];
  page.on("request", (r) => {
    const m = /localhost:8084\/catalog\/\w+\/[\w-]+\/search=([^.]*)\.json/.exec(r.url());
    if (m) asked.push(decodeURIComponent(m[1]));
  });
  await page.addInitScript((store) => {
    localStorage.setItem("btv:onboarded", "1");
    sessionStorage.setItem("btv:welcome-played", "1");
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify(v));
    }
  }, store);
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap", { timeout: 20_000 });
  return { ctx, page, asked };
}

/** Hold every addon search whose words match `re` until `release()`. */
async function hold(ctx, re) {
  const waiting = [];
  let released = false;
  let hit;
  const hitP = new Promise((r) => (hit = r));
  await ctx.route(new RegExp(`localhost:8084/catalog/.*/search=${re.source}`, "i"), async (route) => {
    hit();
    if (!released) await new Promise((r) => waiting.push(r));
    await route.continue().catch(() => {});
  });
  return {
    hit: hitP,
    release() {
      released = true;
      waiting.splice(0).forEach((r) => r());
    },
  };
}

const palette = (page) => page.locator(".palette");
async function ask(page, q, delay = 0) {
  await page.keyboard.press("Control+k");
  await palette(page).waitFor({ timeout: 4000 });
  if (q) await page.keyboard.type(q, { delay });
}
const groups = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".palette .mvpick__group")].map((g) => ({
      name: g.querySelector(".mvpick__sec")?.textContent,
      rows: [...g.querySelectorAll(".mvpick__row")].map((r) => ({
        kind: r.getAttribute("data-kind"),
        label: r.querySelector(".mvpick__nametext")?.textContent,
        sub: r.querySelector(".mvpick__sub")?.textContent ?? null,
        hi: r.hasAttribute("data-highlighted"),
        disabled: r.hasAttribute("data-disabled"),
        poster: !!r.querySelector(".palette__poster img"),
      })),
    })),
  );
const found = async (page) => (await groups(page)).find((g) => g.name === "More Films and Series");
const note = (page) => page.locator(".palette .mvpick__empty").count();
const labels = async (page) => (await found(page))?.rows.map((r) => r.label) ?? [];
/** Wait until the More Films and Series group has a title row (or `gone` the Searching row). */
const landed = (page) =>
  page.waitForFunction(() => !document.querySelector(".palette .mvpick__row[data-kind='busy']") && document.querySelector(".palette .mvpick__row[data-kind='title']"), null, { timeout: 8000 });
const screen = (page) => page.locator("main").getAttribute("data-screen");
const back = (page) => page.getByRole("button", { name: "Back", exact: true }).first();

// ----------------------------------------------------- a title, held in flight
{
  const { ctx, page } = await open();
  await goTo(page, "home");
  const h = await hold(ctx, /dark/);
  await ask(page, "dark knight");
  await h.hit;
  const g = await groups(page);
  const f = g.find((x) => x.name === "More Films and Series");
  const busy = f?.rows.find((r) => r.kind === "busy");
  check("while the search is out, More Films and Series has a Searching… row", busy?.label === "Searching…", JSON.stringify(f));
  check("  which is not a choice (disabled)", busy?.disabled === true);
  check("  and carries the app's busy dot, moving", await page.evaluate(() => {
    const d = document.querySelector(".palette .mvpick__row[data-kind='busy'] .buffering__dot");
    return !!d && getComputedStyle(d).animationName !== "none";
  }));
  check("  with Search Discover for “dark knight” still last", f?.rows.at(-1)?.label === "Search Discover for “dark knight”", JSON.stringify(f?.rows.map((r) => r.label)));
  check("“Nothing matches that.” is not shown while it is searching", (await note(page)) === 0);
  check("  and the Discover row is what is highlighted (the Searching row is skipped)", f?.rows.at(-1)?.hi === true, JSON.stringify(f?.rows));
  h.release();
  await landed(page);
  const after = await found(page);
  check("when it lands the Searching… row goes", !after.rows.some((r) => r.kind === "busy"), JSON.stringify(after.rows));
  check("  and The Dark Knight is listed, as a Movie", after.rows[0]?.label === "The Dark Knight" && after.rows[0].sub?.startsWith("Movie"), JSON.stringify(after.rows[0]));
  check("  Discover's row is still last", after.rows.at(-1)?.kind === "go" && after.rows.at(-1).label === "Search Discover for “dark knight”");
  check("  and the title is the highlighted one, so Enter opens it", after.rows[0].hi === true, JSON.stringify(after.rows.map((r) => r.hi)));
  check("  the group is the last of the list", (await groups(page)).at(-1).name === "More Films and Series");
  check("  no “Nothing matches that.”", (await note(page)) === 0);
  await ctx.close();
}

// And a title Stream's rows already hold is listed once: in Films and Series,
// which the app matched itself, not again under More Films and Series.
{
  const { ctx, page } = await open();
  await goTo(page, "home");
  await page.waitForSelector(".stream__rows .stream-card", { timeout: 20_000 });
  await ask(page, "fake movie two");
  await page.waitForTimeout(1500);
  const g = await groups(page);
  const own = g.find((x) => x.name === "Films and Series");
  const f = g.find((x) => x.name === "More Films and Series");
  check("a title Stream already holds is listed once, under Films and Series", own?.rows.some((r) => r.label === "Fake Movie Two") && !f?.rows.some((r) => r.label === "Fake Movie Two"), JSON.stringify(g.map((x) => [x.name, x.rows.map((r) => r.label)])));
  await ctx.close();
}

// ---------------------------------------------- the pause: one ask per query
{
  const { ctx, page, asked } = await open();
  await goTo(page, "home");
  await ask(page, "dark knight", 40);
  await landed(page);
  await page.waitForTimeout(400);
  check("typing letter by letter asks the addon for the finished words only", asked.length > 0 && asked.every((q) => q === "dark knight"), JSON.stringify([...new Set(asked)]));
  await ctx.close();
}

// -------------------------------------------------- the app's matches come first
{
  const { ctx, page } = await open();
  await goTo(page, "home");
  const h = await hold(ctx, /subtitle/);
  await ask(page, "subtitle");
  await h.hit;
  const early = await groups(page);
  const setting = early.find((x) => x.name === "Settings");
  check("“subtitle” lists the setting at once, titles still out", !!setting && early.some((x) => x.name === "More Films and Series"), JSON.stringify(early.map((x) => x.name)));
  check("  Subtitle Size is the highlighted row", setting?.rows[0]?.label === "Subtitle Size" && setting.rows[0].hi === true);
  h.release();
  await landed(page);
  const late = await groups(page);
  const names = late.map((x) => x.name);
  check("  and the titles come in below Settings", names.indexOf("More Films and Series") > names.indexOf("Settings") && names.indexOf("Settings") >= 0, JSON.stringify(names));
  const man = (await found(page)).rows.find((r) => r.label === "Subtitle Man");
  check("  with Cinemeta’s Subtitle Man in them, a small poster beside it, as a Movie", !!man && man.poster && man.sub?.startsWith("Movie"), JSON.stringify(man));
  const first = late.flatMap((x) => x.rows)[0];
  const hi = late.flatMap((x) => x.rows).find((r) => r.hi);
  check("  and the highlight did not move when they landed: Enter still takes the setting", hi?.label === "Subtitle Size" && first.label === hi.label, JSON.stringify(hi));
  await ctx.close();
}

// ------------------------------- Enter on a title opens it, Back returns to Discover
{
  const { ctx, page } = await open();
  await goTo(page, "discover");
  await ask(page, "dark knight");
  await landed(page);
  await page.keyboard.press("Enter");
  await page.locator(".vod-detail").first().waitFor({ timeout: 10_000 });
  check("Enter on a found title opens its page", await page.waitForFunction(() => /synopsis for tt300003/.test(document.querySelector(".vod-detail")?.textContent ?? ""), null, { timeout: 8000 }).then(() => true, () => false), (await page.locator(".vod-detail").first().innerText()).replace(/\s+/g, " ").slice(0, 120));
  await back(page).click({ timeout: 5000 });
  await page.locator("main[data-screen='discover']").waitFor({ timeout: 10_000 }).catch(() => {});
  check("  Back goes to Discover, where Ctrl+K was pressed", (await screen(page)) === "discover", await screen(page));
  await ctx.close();
}
{
  const { ctx, page } = await open();
  await goTo(page, "hub");
  await ask(page, "dark knight");
  await landed(page);
  await palette(page).locator(".mvpick__row[data-kind='title']").first().click();
  await page.locator(".vod-detail").first().waitFor({ timeout: 10_000 });
  check("a click on a found title opens its page too", await page.waitForFunction(() => /synopsis for tt300003/.test(document.querySelector(".vod-detail")?.textContent ?? ""), null, { timeout: 8000 }).then(() => true, () => false), (await page.locator(".vod-detail").first().innerText()).replace(/\s+/g, " ").slice(0, 120));
  await back(page).click({ timeout: 5000 });
  await page.locator("main[data-screen='hub']").waitFor({ timeout: 10_000 }).catch(() => {});
  check("  and Back from Home’s Ctrl+K goes to Home (the hub), not to Stream", (await screen(page)) === "hub", await screen(page));
  await ctx.close();
}

// ---------------------------------------------- Search Discover for “…”
{
  const { ctx, page } = await open();
  await goTo(page, "hub");
  await ask(page, "dark knight");
  await landed(page);
  await page.keyboard.press("ArrowDown");
  const hi = (await found(page)).rows.find((r) => r.hi);
  check("one arrow down from the title is the Discover row", hi?.label === "Search Discover for “dark knight”", JSON.stringify(hi));
  await page.keyboard.press("Enter");
  await page.locator("main[data-screen='discover']").waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForSelector(".navcap__searchinput", { timeout: 10_000 });
  check("Enter on it goes to Discover", (await screen(page)) === "discover", await screen(page));
  check("  with the words in Discover’s search field", (await page.locator(".navcap__searchinput").inputValue()) === "dark knight");
  await page.waitForSelector(".discover__gridwrap h3", { timeout: 10_000 });
  check("  and Discover is showing results for them", (await page.locator(".discover__gridwrap h3").innerText()) === "Results for “dark knight”");
  await ctx.close();
}

// ----------------------------------------- a stale answer never shows under a newer query
{
  const { ctx, page } = await open();
  await goTo(page, "home");
  const slow = await hold(ctx, /iron/);
  await ask(page, "iron");
  await slow.hit;
  // The words change while "iron" is still out.
  await page.keyboard.press("Control+a");
  await page.keyboard.type("dark knight");
  await landed(page);
  check("the newer query’s titles show while the older one is still out", (await labels(page)).includes("The Dark Knight"), JSON.stringify(await labels(page)));
  slow.release();
  await page.waitForTimeout(800);
  const l = await labels(page);
  check("  and when the old answer arrives it changes nothing", l.includes("The Dark Knight") && !l.some((x) => /Iron/.test(x)) && !l.includes("Searching…"), JSON.stringify(l));
  check("  the field still holds the newer words", (await page.locator(".palette .mvpick__input").inputValue()) === "dark knight");
  await ctx.close();
}

// ------------------------------- “Nothing matches that.”: only when it is settled
{
  const { ctx, page } = await open();
  await goTo(page, "home");
  const h = await hold(ctx, /zzzz/);
  await ask(page, "zzzz");
  await h.hit;
  check("with nothing the app matches and the search still out, there is no “Nothing matches that.”", (await note(page)) === 0);
  check("  but there is the Searching… row", (await labels(page)).includes("Searching…"));
  h.release();
  await page.waitForSelector(".palette .mvpick__empty", { timeout: 8000 });
  const g = await found(page);
  check("once it comes back empty, it says so", (await note(page)) === 1 && !g.rows.some((r) => r.kind === "busy"));
  check("  and Search Discover for “zzzz” is still there, alone", g.rows.length === 1 && g.rows[0].label === "Search Discover for “zzzz”", JSON.stringify(g));
  check("  and the note is a status for screen readers", (await page.locator(".palette [role=status] .mvpick__empty").count()) === 1);
  await page.keyboard.press("Enter");
  await page.locator("main[data-screen='discover']").waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForSelector(".navcap__searchinput", { timeout: 10_000 });
  check("  Enter on it fills Discover with “zzzz”", (await page.locator(".navcap__searchinput").inputValue()) === "zzzz");
  await ctx.close();
}

// ------------------------------------------ one letter, and the palette’s own matches
{
  const { ctx, page, asked } = await open();
  await goTo(page, "home");
  await ask(page, "d");
  await page.waitForTimeout(700);
  check("one letter asks nothing and lists no More Films and Series", asked.length === 0 && !(await found(page)), JSON.stringify(asked));
  await ctx.close();
}

// ---------------------------------------------------------------- reduced motion
{
  const { ctx, page } = await open({ reducedMotion: "reduce" });
  await goTo(page, "home");
  const h = await hold(ctx, /dark/);
  await ask(page, "dark knight");
  await h.hit;
  const dot = await page.evaluate(() => {
    const row = document.querySelector(".palette .mvpick__row[data-kind='busy']");
    const d = row?.querySelector(".buffering__dot");
    return { text: row?.textContent, anim: d ? getComputedStyle(d).animationName : null };
  });
  check("with reduced motion the busy dot stops and the words stay", dot.text === "Searching…" && dot.anim === "none", JSON.stringify(dot));
  h.release();
  await ctx.close();
}

// ----------------------------------------------------------------- no source
{
  const { ctx, page, asked } = await open({ store: {} });
  await ask(page, "dark knight");
  await page.waitForTimeout(900);
  const g = await groups(page);
  check("with no source there is no More Films and Series, no Searching… row and no Discover row", !g.some((x) => x.name === "More Films and Series") && !(await page.locator(".palette .mvpick__row[data-kind='busy']").count()), JSON.stringify(g.map((x) => x.name)));
  check("  nothing was asked, and the palette says nothing matches", asked.length === 0 && (await note(page)) === 1);
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(fail ? `${fail} FAILED` : "ALL PASSED");
process.exit(fail ? 1 : 0);

// E2E: Home, the page behind the logo (plan 033, phase 1).
//
// The mark in the middle of the nav goes Home and still spins. Home is a second
// root of StreamScreen: the same rows as Stream's page, in the order Settings
// → Home gives them, so a title opened from it opens there and Back returns
// to it. The checks:
//
//   - the mark: data-dest "hub", aria-label "Home", the screen "hub", the
//     glow at 40% once its fade has run, no tab current and the pill hidden;
//     another tab takes the glow away and gives the pill back;
//   - the seed: a fresh profile's rows are Stream's, in Stream's order, and
//     the carousel starts as Appearance's switch is; a catalog row that is
//     new since the seed is added once, at the end, switched on;
//   - Stream does not move: switching a row off on Home leaves Stream's page
//     alone;
//   - Settings → Home: reorder, rename, switch off each land on Home with
//     Settings still open; the carousel is pinned and only switches; the
//     rows are still there after a reload;
//   - a title opened from Home, then Back: Home again, at its scroll; the mark
//     pressed on Home, or on a title opened from it, goes to Home's top;
//   - with every row off: "Nothing on Home" and an Edit Home that opens
//     Settings on the Home page;
//   - Start On: Home is the first of four, picked and launched on; the default
//     is still Live TV.
//
//   node scripts/fake-panel.mjs   # :8081
//   node scripts/fake-aio.mjs     # :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-home.mjs
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

const XTREAM = { v: 1, data: [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" }] };
const AIO = { v: 1, data: "http://localhost:8084/manifest.json" };
/** The fake addon's browse rows, in its manifest's order. */
const AIO_ROWS = ["Top Movies", "Top Series", "More Movies"];
const SEEDED = { aiostreams: AIO, playlists: XTREAM };
const WATCHING = { v: 1, data: [{ id: "tt555", title: "Odd Movie", kind: "movie", at: Date.now() - 3 * 86400_000, posSec: 1200, durSec: 6000 }] };
const UP_NEXT = {
  v: 1,
  data: {
    nextUp: [{ seriesId: "tt200001", episodeId: "tt200001:1:2", seriesTitle: "Fake Series One", label: "S1 · E2: Two" }],
    upcoming: [{ seriesId: "tt200002", episodeId: "tt200002:1:1", seriesTitle: "Fake Series Two", label: "S1 · E1: One", airsAt: Date.now() + 86400_000 }],
  },
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/**
 * A page of its own, in a context of its own, reaching nothing but this
 * machine. `store` is { key: envelope } under blammytv.*, written once: a
 * reload in a check must see what the check left.
 */
async function open({ store = SEEDED, width = 1440, height = 900, reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: "dark", reducedMotion: reduced ? "reduce" : "no-preference" });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
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
  return { ctx, page };
}

/** Home's rows, once there are cards in them. */
const rowsReady = (page) => page.waitForSelector(".stream__rows .stream-card", { timeout: 20_000 });
const titles = (page) => page.locator(".stream__rows .media-row__title").allInnerTexts();
const screen = (page) => page.locator("main").getAttribute("data-screen");
const stored = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("blammytv.homeRows");
    return raw ? JSON.parse(raw).data : null;
  });
const ids = async (page) => (await stored(page))?.map((r) => r.id) ?? null;

/** The mark's state: what a user can tell, read from the page as it is now. */
const mark = (page) =>
  page.evaluate(() => {
    const m = document.querySelector("[data-dest='hub']");
    const pill = document.querySelector(".navcap__row--nav > .navcap__pill");
    return {
      label: m?.getAttribute("aria-label") ?? null,
      current: m?.getAttribute("aria-current") ?? null,
      on: m?.classList.contains("navcap__mark--on") ?? false,
      glow: m ? Number(getComputedStyle(m, "::before").opacity) : null,
      wash: m ? getComputedStyle(m.querySelector("b")).backgroundImage.startsWith("radial-gradient") : null,
      pill: pill ? Number(getComputedStyle(pill).opacity) : null,
      tabs: [...document.querySelectorAll(".navcap__row--nav .navcap__item[aria-current]")].map((e) => e.dataset.dest),
      screen: document.querySelector("main")?.dataset.screen ?? null,
    };
  });
/** Wait for the glow's fade and the pill's to finish, then read. */
const markSettled = async (page, { glow, pill }) => {
  await page
    .waitForFunction(
      ({ glow, pill }) => {
        const m = document.querySelector("[data-dest='hub']");
        const p = document.querySelector(".navcap__row--nav > .navcap__pill");
        return m && p && Math.abs(Number(getComputedStyle(m, "::before").opacity) - glow) < 0.005 && Math.abs(Number(getComputedStyle(p).opacity) - pill) < 0.005;
      },
      { glow, pill },
      { timeout: 4000 },
    )
    .catch(() => {});
  return mark(page);
};

const gear = (page) => page.getByRole("button", { name: "Settings", exact: true }).first();
const openSettings = async (page, tab = "Home") => {
  await gear(page).click();
  await page.locator(".settings__body").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(300);
  if (tab) await page.getByRole("tablist", { name: "Settings", exact: true }).getByRole("tab", { name: tab, exact: true }).click();
  await page.waitForTimeout(200);
};
const settingsUp = (page) => page.locator(".settings").count().then((n) => n > 0);
const closeSettings = async (page) => {
  await page.keyboard.press("Escape");
  await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
};
/** The editor's rows, in the order shown: name field, kind, switch. */
const editor = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".settings__body .xtrow")].map((r) => ({
      name: r.querySelector(".homerows__title")?.value ?? r.querySelector(".xtrow__name")?.textContent ?? null,
      kind: r.querySelector(".xtrow__kind")?.textContent ?? null,
      on: r.querySelector("[role=switch]")?.getAttribute("aria-checked") === "true",
      grip: !!r.querySelector("button[aria-label^='Reorder']"),
    })),
  );
/** Lift a row by its handle, move it with the arrows, drop it. */
const liftAndMove = async (page, name, keys) => {
  await page.getByRole("button", { name: `Reorder ${name}`, exact: true }).focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(150);
  }
  await page.keyboard.press("Space");
  await page.waitForTimeout(450);
};
/** Stream's own page, entered by its tab (data-dest "home" is Stream's). */
const stream = async (page) => {
  await goTo(page, "home");
  await rowsReady(page);
};

// ----------------------------------------------------------- the mark, Home
{
  const { ctx, page } = await open({ store: { ...SEEDED, watching: WATCHING } });
  await goTo(page, "hub");
  await rowsReady(page);
  const home = await markSettled(page, { glow: 0.4, pill: 0 });
  check("the mark goes Home: the screen is hub, and the mark is named Home and is the current page", home.screen === "hub" && home.label === "Home" && home.current === "page", JSON.stringify(home));
  check("  its glow is at 40% once the fade has run, and the centre is washed", home.on && Math.abs(home.glow - 0.4) < 0.005 && home.wash, JSON.stringify(home));
  check("  no tab is current, and the pill is hidden", home.tabs.length === 0 && home.pill === 0, JSON.stringify(home));
  check("  the page is Home's: the carousel and the rows", (await page.locator(".shero, .lhero").count()) > 0 && (await titles(page)).length > 0);

  const spun = await page.evaluate(() => {
    const m = document.querySelector("[data-dest='hub']");
    return new Promise((done) => {
      m.click();
      requestAnimationFrame(() => done({ spinning: m.classList.contains("is-spinning"), still: m.getAttribute("aria-current") }));
    });
  });
  check("pressed again, the mark still spins, and stays Home", spun.spinning && spun.still === "page", JSON.stringify(spun));

  // Another tab takes the glow away and gives the pill back: faded, not cut.
  const fade = await page.evaluate(
    () =>
      new Promise((done) => {
        const m = document.querySelector("[data-dest='hub']");
        const seen = [];
        const t0 = performance.now();
        document.querySelector("[data-dest='home']").click();
        const tick = () => {
          seen.push(Number(getComputedStyle(m, "::before").opacity));
          if (performance.now() - t0 < 700) requestAnimationFrame(tick);
          else done(seen);
        };
        tick();
      }),
  );
  check("leaving Home fades the glow out: some frame has it part way, and it ends at nothing", fade.some((o) => o > 0.02 && o < 0.38) && fade.at(-1) === 0, JSON.stringify(fade.filter((_, i) => i % 6 === 0)));
  await goTo(page, "home");
  const away = await markSettled(page, { glow: 0, pill: 1 });
  check("another tab takes the glow away: the mark is no longer current, the class is gone", away.current === null && !away.on && away.glow === 0, JSON.stringify(away));
  check("  and the pill is back on that tab, alone", away.tabs.join() === "home" && away.pill === 1 && !away.wash, JSON.stringify(away));
  await goTo(page, "hub");
  const back = await markSettled(page, { glow: 0.4, pill: 0 });
  check("  and Home gives it back", back.on && Math.abs(back.glow - 0.4) < 0.005 && back.tabs.length === 0, JSON.stringify(back));
  await ctx.close();
}

{
  // Reduced motion: the fade is 1ms, like the rest of the capsule, and the spin does not run.
  const { ctx, page } = await open({ reduced: true });
  await goTo(page, "hub");
  const d = await page.evaluate(() => {
    const m = document.querySelector("[data-dest='hub']");
    m.click();
    return { fade: getComputedStyle(m, "::before").transitionDuration, anim: getComputedStyle(m, "::before").animationName };
  });
  check("under reduced motion the glow's fade is 1ms and its spin does not run", d.fade === "0.001s" && d.anim === "none", JSON.stringify(d));
  await ctx.close();
}

// ---------------------------------------------------------------- the seed
{
  const { ctx, page } = await open({ store: { ...SEEDED, watching: WATCHING, aiojf: UP_NEXT } });
  await stream(page);
  const onStream = await titles(page);
  await goTo(page, "hub");
  await rowsReady(page);
  const onHome = await titles(page);
  check("a fresh profile's Home is Stream's rows, in Stream's order", onHome.length === 6 && JSON.stringify(onHome) === JSON.stringify(onStream), JSON.stringify({ onHome, onStream }));
  check("  Continue Watching, then Up Next's two, then the catalog's", JSON.stringify(onHome) === JSON.stringify(["Continue Watching", "Next Up", "Upcoming", ...AIO_ROWS]), JSON.stringify(onHome));
  const layout = await ids(page);
  check(
    "  and what is stored is the carousel, Continue Watching, Up Next, then each catalog row, once",
    JSON.stringify(layout) === JSON.stringify(["carousel", "continue", "upnext", "aio:top-movies", "aio:top-series", "aio:more-movies"]),
    JSON.stringify(layout),
  );
  const raw = await stored(page);
  check("  all of them on, the carousel as Featured Carousel was (on)", raw.every((r) => r.on === true));
  await ctx.close();
}
{
  // Appearance's Featured Carousel switch off at the first open: Home's carousel starts off.
  const { ctx, page } = await open({ store: { ...SEEDED, showHero: { v: 1, data: false } } });
  await goTo(page, "hub");
  await rowsReady(page);
  const raw = await stored(page);
  check("with the Featured Carousel off, Home's carousel row starts off, and none is drawn", raw?.[0]?.kind === "carousel" && raw[0].on === false && (await page.locator(".shero, .lhero").count()) === 0, JSON.stringify(raw?.[0]));
  await ctx.close();
}
{
  // A catalog row that is new since the seed: added once, at the end, switched on.
  const old = ["carousel", "continue", "upnext", "aio:top-movies", "aio:top-series"].map((kind) =>
    kind.startsWith("aio:") ? { id: kind, kind: "catalog", on: true } : { id: kind, kind, on: true },
  );
  const { ctx, page } = await open({ store: { ...SEEDED, homeRows: { v: 1, data: old } } });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForFunction(() => document.querySelectorAll(".stream__rows .media-row__title").length >= 3, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  const once = await stored(page);
  const count = (list) => list.filter((r) => r.id === "aio:more-movies").length;
  check(
    "a catalog row new since Home was set up is added once, at the end, switched on",
    count(once) === 1 && once.at(-1).id === "aio:more-movies" && once.at(-1).on === true && once.length === 6,
    JSON.stringify(once.map((r) => r.id)),
  );
  check("  and Home draws it last", JSON.stringify(await titles(page)) === JSON.stringify(AIO_ROWS));
  // Away and back, and Stream's own tab in between: still once.
  await stream(page);
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForTimeout(500);
  const twice = await stored(page);
  check("  and not again after leaving Home and coming back", count(twice) === 1 && twice.length === 6, JSON.stringify(twice.map((r) => r.id)));
  await ctx.close();
}

// ------------------------------------------------- Settings → Home, live
{
  const { ctx, page } = await open({ store: { ...SEEDED, watching: WATCHING, aiojf: UP_NEXT } });
  await goTo(page, "hub");
  await rowsReady(page);
  await openSettings(page);
  const rows = await editor(page);
  check(
    "Settings → Home lists the rows: the carousel pinned, the rest with a handle each",
    rows.length === 6 &&
      rows[0].name === "Featured Carousel" &&
      !rows[0].grip &&
      rows.slice(1).every((r) => r.grip) &&
      JSON.stringify(rows.slice(1).map((r) => r.name)) === JSON.stringify(["Continue Watching", "Up Next", ...AIO_ROWS]),
    JSON.stringify(rows.map((r) => r.name)),
  );
  check("  each with its kind in grey and a switch, all on", rows.every((r) => r.kind && r.on), JSON.stringify(rows.map((r) => r.kind)));
  check("  Home is drawn behind it", (await settingsUp(page)) && (await titles(page)).length === 6);

  // Reorder: Top Series up one place. Home follows, and Settings stays up.
  await liftAndMove(page, "Top Series", ["ArrowUp"]);
  const order = await titles(page);
  check(
    "reordering a row moves it on Home, behind Settings, which stays open",
    (await settingsUp(page)) && JSON.stringify(order) === JSON.stringify(["Continue Watching", "Next Up", "Upcoming", "Top Series", "Top Movies", "More Movies"]),
    JSON.stringify(order),
  );
  check("  and the editor's order is the stored one", JSON.stringify((await ids(page)).slice(3)) === JSON.stringify(["aio:top-series", "aio:top-movies", "aio:more-movies"]), JSON.stringify(await ids(page)));

  // Rename: More Movies.
  const field = page.getByRole("textbox", { name: "Name of More Movies", exact: true });
  await field.fill("Weekend Picks");
  await page.waitForTimeout(250);
  check("renaming a row retitles it on Home, behind Settings, which stays open", (await settingsUp(page)) && (await titles(page)).at(-1) === "Weekend Picks", JSON.stringify(await titles(page)));
  check("  the editor says the new name, and the layout keeps it as a title", (await editor(page)).at(-1).name === "Weekend Picks" && (await stored(page)).at(-1).title === "Weekend Picks");
  // Emptying the field puts the row's own name back when the field is left.
  await field.fill("");
  await field.blur();
  await page.waitForTimeout(250);
  check("  emptied and left, the row's own name comes back, and no title is kept", (await titles(page)).at(-1) === "More Movies" && (await stored(page)).at(-1).title === undefined && (await editor(page)).at(-1).name === "More Movies");
  await field.fill("Weekend Picks");
  await page.waitForTimeout(150);

  // Up Next's name is the Next Up row's; Upcoming keeps its own.
  await page.getByRole("textbox", { name: "Name of Up Next", exact: true }).fill("Coming Up");
  await page.waitForTimeout(250);
  const up = await titles(page);
  check("renaming Up Next retitles its Next Up row, and Upcoming keeps its name", up.includes("Coming Up") && !up.includes("Next Up") && up.includes("Upcoming"), JSON.stringify(up));

  // Switch off.
  await page.getByRole("switch", { name: "Top Movies", exact: true }).click();
  await page.waitForTimeout(250);
  const off = await titles(page);
  check("switching a row off takes it off Home, behind Settings, which stays open", (await settingsUp(page)) && !off.includes("Top Movies") && off.includes("Top Series"), JSON.stringify(off));
  check("  the row stays in the editor, off", (await editor(page)).some((r) => r.name === "Top Movies" && !r.on));
  check("  and in the layout, off, not removed", (await stored(page)).some((r) => r.id === "aio:top-movies" && r.on === false));

  // Carousel: only a switch. Off, and the carousel goes.
  check("the carousel is on Home before its switch goes off", (await page.locator(".shero, .lhero").count()) > 0);
  await page.getByRole("switch", { name: "Featured Carousel", exact: true }).click();
  await page.waitForTimeout(300);
  check("switching the carousel off takes it off Home, behind Settings", (await page.locator(".shero, .lhero").count()) === 0 && (await settingsUp(page)));
  check("  and nothing in the editor can move it: no handle, no name field", (await page.getByRole("button", { name: /^Reorder Featured/ }).count()) === 0 && (await page.getByRole("textbox", { name: /Featured/ }).count()) === 0);

  // Stream's page is not Home's: it still has every row, in its own order.
  await closeSettings(page);
  await stream(page);
  const onStream = await titles(page);
  check("Stream's own page is not moved by any of it: every row, in its order, under its own names", JSON.stringify(onStream) === JSON.stringify(["Continue Watching", "Next Up", "Upcoming", ...AIO_ROWS]), JSON.stringify(onStream));
  check("  and its carousel is still on (Appearance's switch is its own)", (await page.locator(".shero, .lhero").count()) > 0);

  // Reloaded: what was set is what Home draws.
  await page.reload({ waitUntil: "domcontentloaded" });
  await goTo(page, "hub");
  await rowsReady(page);
  const after = await titles(page);
  check(
    "after a reload Home is as it was left",
    JSON.stringify(after) === JSON.stringify(["Continue Watching", "Coming Up", "Upcoming", "Top Series", "Weekend Picks"]) && (await page.locator(".shero, .lhero").count()) === 0,
    JSON.stringify(after),
  );
  await ctx.close();
}

// ----------------------------------------------- a title from Home, and Back
{
  const { ctx, page } = await open({ store: { ...SEEDED, watching: WATCHING } });
  await goTo(page, "hub");
  await rowsReady(page);
  const card = page.locator(".media-row:has(h3:text-is('Top Series')) .stream-card").first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const at = await page.locator(".stream").evaluate((e) => e.scrollTop);
  await card.click();
  await page.locator(".stream--full").waitFor({ timeout: 10_000 });
  check("a title opened from Home opens there, on the hub screen, with Home still the current page", (await screen(page)) === "hub" && (await mark(page)).current === "page");
  await page.getByRole("button", { name: "Back", exact: true }).first().click({ timeout: 5000 });
  await rowsReady(page);
  await page.waitForTimeout(300);
  const back = await page.locator(".stream").evaluate((e) => ({ top: e.scrollTop, full: e.classList.contains("stream--full") }));
  check("  Back returns to Home, at its scroll", (await screen(page)) === "hub" && !back.full && at > 100 && Math.abs(back.top - at) <= 2, JSON.stringify({ at, ...back }));

  // The mark, on a title opened from Home: Home's top.
  await card.click();
  await page.locator(".stream--full").waitFor({ timeout: 10_000 });
  await page.locator("[data-dest='hub']").click();
  await rowsReady(page);
  await page.waitForTimeout(300);
  const top = await page.locator(".stream").evaluate((e) => ({ top: e.scrollTop, full: e.classList.contains("stream--full") }));
  check("the mark pressed on a title opened from Home goes to Home's rows, at the top", !top.full && top.top === 0, JSON.stringify(top));
  // And on Home, scrolled.
  await page.locator(".stream").evaluate((e) => (e.scrollTop = 400));
  await page.waitForTimeout(200);
  await page.locator("[data-dest='hub']").click();
  await page.waitForTimeout(400);
  check("  and pressed on Home, scrolled down, it goes to Home's top", (await page.locator(".stream").evaluate((e) => e.scrollTop)) === 0);

  // Home's scroll is its own: Stream's tab, scrolled elsewhere, does not take it.
  await page.locator(".stream").evaluate((e) => (e.scrollTop = 300));
  await page.waitForTimeout(200);
  await stream(page);
  await page.locator(".stream").evaluate((e) => (e.scrollTop = 150));
  await page.waitForTimeout(200);
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForTimeout(300);
  const homeTop = await page.locator(".stream").evaluate((e) => e.scrollTop);
  await stream(page);
  await page.waitForTimeout(300);
  const streamTop = await page.locator(".stream").evaluate((e) => e.scrollTop);
  check("Home keeps its scroll under its own key, and Stream its own", Math.abs(homeTop - 300) <= 2 && Math.abs(streamTop - 150) <= 2, JSON.stringify({ homeTop, streamTop }));
  await ctx.close();
}

// ---------------------------------------------------- nothing on Home
{
  const { ctx, page } = await open({ store: SEEDED });
  await goTo(page, "hub");
  await rowsReady(page);
  await openSettings(page);
  for (const name of ["Featured Carousel", ...AIO_ROWS, "Continue Watching", "Up Next"]) await page.getByRole("switch", { name, exact: true }).click();
  await page.waitForTimeout(300);
  const empty = (await page.locator(".stream__note").innerText().catch(() => "")).replace(/\n/g, " ");
  check("with every row off, Home says Nothing on Home, behind Settings", (await settingsUp(page)) && /Nothing on Home/.test(empty), empty);
  await closeSettings(page);
  const button = page.getByRole("button", { name: "Edit Home", exact: true });
  check("  with an Edit Home button", (await button.count()) === 1);
  await button.click();
  await page.locator(".settings__body").waitFor({ timeout: 10_000 });
  const sel = await page.getByRole("tablist", { name: "Settings", exact: true }).locator("[role=tab][aria-selected=true]").getAttribute("aria-label");
  check("  which opens Settings on the Home page", sel === "Home", sel ?? "");
  // Switch one back on: Home draws again, still behind Settings.
  await page.getByRole("switch", { name: "Top Series", exact: true }).click();
  await page.waitForTimeout(300);
  check("  and a row switched back on is drawn again, the message gone", (await titles(page)).join() === "Top Series" && (await page.locator(".stream__note").count()) === 0, JSON.stringify(await titles(page)));
  await ctx.close();
}

// ---------------------------------------------------------------- Start On
{
  const { ctx, page } = await open({ store: SEEDED });
  await openSettings(page, "Appearance");
  const start = page.getByRole("group", { name: "Start on", exact: true });
  const names = await start.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  check("Start On lists Home first, then the three it had", JSON.stringify(names) === JSON.stringify(["Home", "Live TV", "Stream", "Stream · Discover"]), JSON.stringify(names));
  const pressed = await start.getByRole("button", { pressed: true }).getAttribute("aria-label");
  check("  and the default is still Live TV", pressed === "Live TV", pressed);
  await start.getByRole("button", { name: "Home", exact: true }).click();
  await page.waitForTimeout(200);
  check("  Home picked is stored as home", (await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.startupTab")).data)) === "home");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap", { timeout: 20_000 });
  await page.locator("main[data-screen='hub']").waitFor({ timeout: 10_000 });
  await rowsReady(page);
  const launched = await markSettled(page, { glow: 0.4, pill: 0 });
  check("the next launch opens on Home: the hub screen, the mark current and glowing, no tab current", launched.screen === "hub" && launched.current === "page" && launched.on && launched.tabs.length === 0, JSON.stringify(launched));
  await ctx.close();
}
{
  // Nothing stored: Live TV, as before, with a live source; Stream without one.
  const { ctx, page } = await open({ store: SEEDED });
  await page.locator("main[data-screen='guide']").waitFor({ timeout: 10_000 });
  check("with nothing picked, a launch still opens on the Guide", (await screen(page)) === "guide" && (await mark(page)).current === null);
  await ctx.close();
}
{
  // Home picked with no live source: Home still opens (the mark, which is the
  // way back, is only drawn between the two sides, so it has no live side to
  // divide here).
  const { ctx, page } = await open({ store: { aiostreams: AIO, startupTab: { v: 1, data: "home" } } });
  await page.locator("main[data-screen='hub']").waitFor({ timeout: 10_000 });
  await rowsReady(page);
  check("Home picked with no playlist still launches on Home, with its rows", (await screen(page)) === "hub" && (await titles(page)).join() === AIO_ROWS.join(), JSON.stringify(await titles(page)));
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);

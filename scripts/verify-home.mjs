// E2E: Home, the page behind the logo (plan 033, phases 1 and 2).
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
//     is still Live TV. It offers only the places there is a source for:
//     no Live TV without a playlist, no Home or Stream without a stream
//     source, and no row at all with neither;
//   - the mark is drawn with no playlist too, first in the capsule, glowing
//     and current on Home, and pressed it goes Home;
//   - phase 2, the live rows: On Now (favourites with now, next and a bar),
//     Recent Channels, Today's Games (ESPN routed, the Sports board's own
//     cards) and Recordings (native stubbed at the IPC boundary), each drawn
//     with data and not without, and none of them fetched while off; a click
//     tunes the channel, opens the game, plays the recording; Add Row adds a
//     row and x removes it; a layout from phase 1 gets On Now and Today's
//     Games once and not again after a remove; Stream's own page has none.
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
async function open({ store = SEEDED, width = 1440, height = 900, reduced = false, games = null, recs = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: "dark", reducedMotion: reduced ? "reduce" : "no-preference" });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  // ESPN is routed, never reached: `games` is [[id, state]] for today's MLB.
  // Registered after the catch-all, so it answers first.
  const asked = { espn: 0 };
  await ctx.route(/site\.api\.espn\.com/, (route) => {
    asked.espn++;
    const url = new URL(route.request().url());
    const hit = games && url.pathname.includes("baseball/mlb") && url.searchParams.get("dates") === ymd(new Date());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(hit ? { leagues: [{ id: "10", name: "MLB", abbreviation: "MLB", slug: "mlb" }], events: games.map(([id, state]) => event(id, state)) } : { events: [] }),
    });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  // `recs`: native answered at the IPC boundary (isTauri() is then true),
  // with these recordings in its index. verify-recordings' stub, trimmed.
  if (recs)
    await page.addInitScript((recs) => {
      window.__calls = [];
      let cb = 0;
      const listeners = {};
      window.__TAURI_INTERNALS__ = {
        transformCallback: (f) => {
          const id = ++cb;
          window["_" + id] = f;
          return id;
        },
        convertFileSrc: (p) => p,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
        invoke: (cmd, args) => {
          window.__calls.push([cmd, args]);
          if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
          if (cmd === "plugin:event|listen") {
            (listeners[args.event] ??= []).push(args.handler);
            return Promise.resolve(++cb);
          }
          if (cmd === "rec_list") return Promise.resolve(recs);
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    }, recs);
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

const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
/** One of ESPN's events, as its scoreboard sends it; `state` is pre, live or final. */
const event = (id, state) => {
  const start = new Date();
  start.setHours(19, 0, 0, 0);
  const status = {
    pre: { clock: 0, displayClock: "0:00", period: 0, type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false } },
    live: { clock: 0, displayClock: "7:22", period: 3, type: { id: "2", name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: "3rd 07:22" } },
    final: { clock: 0, displayClock: "0:00", period: 4, type: { id: "3", name: "STATUS_FINAL", state: "post", completed: true, shortDetail: "Final" } },
  }[state];
  const team = (i, name, abbr) => ({ id: String(i), location: name, name, abbreviation: abbr, displayName: name, shortDisplayName: name, logo: "" });
  return {
    id,
    date: start.toISOString(),
    name: `Away ${id} at Home ${id}`,
    shortName: `A${id} @ H${id}`,
    status,
    competitions: [
      {
        id,
        date: start.toISOString(),
        competitors: [
          { id: `h${id}`, homeAway: "home", team: team(`h${id}`, `Home ${id}`, "HOM"), score: state === "pre" ? "0" : "3" },
          { id: `a${id}`, homeAway: "away", team: team(`a${id}`, `Away ${id}`, "AWY"), score: state === "pre" ? "0" : "1" },
        ],
        status,
        broadcasts: [{ market: "national", names: ["ESPN"] }],
      },
    ],
  };
};

/** Home's rows, once there are cards in them. */
const rowsReady = (page) => page.waitForSelector(".stream__rows .stream-card", { timeout: 20_000 });
const titles = (page) => page.locator(".stream__rows .media-row__title").allInnerTexts();
const screen = (page) => page.locator("main").getAttribute("data-screen");
const box = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("blammytv.homeRows");
    return raw ? JSON.parse(raw).data : null;
  });
/** The stored rows, whichever shape they were written in. */
const stored = async (page) => {
  const b = await box(page);
  return Array.isArray(b) ? b : (b?.rows ?? null);
};
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
    "  and what is stored is the carousel, Continue Watching, Up Next, On Now and Today's Games (there is a playlist), then each catalog row, once",
    JSON.stringify(layout) === JSON.stringify(["carousel", "continue", "upnext", "onnow", "games", "aio:top-movies", "aio:top-series", "aio:more-movies"]),
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
  // With no playlist, so that nothing else is appended after it (the live rows are below).
  const old = ["carousel", "continue", "upnext", "aio:top-movies", "aio:top-series"].map((kind) =>
    kind.startsWith("aio:") ? { id: kind, kind: "catalog", on: true } : { id: kind, kind, on: true },
  );
  const { ctx, page } = await open({ store: { aiostreams: AIO, homeRows: { v: 1, data: old } } });
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
  check("  and Home draws it last", JSON.stringify(await titles(page)) === JSON.stringify(AIO_ROWS), JSON.stringify(await titles(page)));
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
    rows.length === 8 &&
      rows[0].name === "Featured Carousel" &&
      !rows[0].grip &&
      rows.slice(1).every((r) => r.grip) &&
      JSON.stringify(rows.slice(1).map((r) => r.name)) === JSON.stringify(["Continue Watching", "Up Next", "On Now", "Today\u2019s Games", ...AIO_ROWS]),
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
  check("  and the editor's order is the stored one", JSON.stringify((await ids(page)).slice(5)) === JSON.stringify(["aio:top-series", "aio:top-movies", "aio:more-movies"]), JSON.stringify(await ids(page)));

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
  // Only a stream source: Live TV is not on offer, and the stored default
  // (Live TV) shows Stream instead, unsaved: where a launch opens then.
  const { ctx, page } = await open({ store: { aiostreams: AIO } });
  await openSettings(page, "Appearance");
  const start = page.getByRole("group", { name: "Start on", exact: true });
  const names = await start.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  check("with only a stream source, Start On leaves out Live TV", JSON.stringify(names) === JSON.stringify(["Home", "Stream", "Stream · Discover"]), JSON.stringify(names));
  const pressed = await start.getByRole("button", { pressed: true }).getAttribute("aria-label");
  const kept = await page.evaluate(() => localStorage.getItem("blammytv.startupTab"));
  check("  and shows Stream as chosen without saving it, where the launch opens", pressed === "Stream" && kept === null && (await screen(page)) === "home", JSON.stringify({ pressed, kept, screen: await screen(page) }));
  await ctx.close();
}
{
  // Only a playlist: Live TV alone.
  const { ctx, page } = await open({ store: { playlists: XTREAM } });
  await openSettings(page, "Appearance");
  const start = page.getByRole("group", { name: "Start on", exact: true });
  const names = await start.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  check("with only a playlist, Start On offers Live TV alone", JSON.stringify(names) === JSON.stringify(["Live TV"]), JSON.stringify(names));
  await ctx.close();
}
{
  // Neither: the row is not there.
  const { ctx, page } = await open({ store: {} });
  await openSettings(page, "Appearance");
  const rows = await page.locator(".settings__body .customize-row__title").allInnerTexts();
  check("with no source at all, Startup Tab is left out", rows.includes("Clock Format") && !rows.includes("Startup Tab") && (await page.getByRole("group", { name: "Start on", exact: true }).count()) === 0, JSON.stringify(rows));
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
  // Home picked with no live source: Home still opens, and the mark, the way
  // back to it, is drawn here too: first in the capsule, with no live tabs
  // before it.
  const { ctx, page } = await open({ store: { aiostreams: AIO, startupTab: { v: 1, data: "home" } } });
  await page.locator("main[data-screen='hub']").waitFor({ timeout: 10_000 });
  await rowsReady(page);
  check("Home picked with no playlist still launches on Home, with its rows", (await screen(page)) === "hub" && (await titles(page)).join() === AIO_ROWS.join(), JSON.stringify(await titles(page)));
  const lit = await markSettled(page, { glow: 0.4, pill: 0 });
  const place = await page.evaluate(() => {
    const m = document.querySelector("[data-dest='hub']")?.getBoundingClientRect();
    const first = document.querySelector(".navcap__row--nav .navcap__item")?.getBoundingClientRect();
    const live = document.querySelectorAll("[data-dest='guide'], [data-dest='multiview'], [data-dest='sports']").length;
    return { drawn: !!m, first: !!m && !!first && m.right <= first.left + 0.5, live };
  });
  check("  with no playlist the mark is drawn first in the capsule, with no live tab", place.drawn && place.first && place.live === 0, JSON.stringify(place));
  check("  and on Home it is current and glowing at the left end too", lit.label === "Home" && lit.current === "page" && lit.on && lit.tabs.length === 0, JSON.stringify(lit));
  await goTo(page, "home");
  await page.locator("main[data-screen='stream']").waitFor({ timeout: 10_000 }).catch(() => {});
  const away = await mark(page);
  await page.locator("[data-dest='hub']").click();
  await page.locator("main[data-screen='hub']").waitFor({ timeout: 10_000 }).catch(() => {});
  check("  pressed from Stream it goes Home", away.current === null && (await screen(page)) === "hub" && (await mark(page)).current === "page", JSON.stringify({ away: away.current, screen: await screen(page) }));
  await ctx.close();
}

// ======================================================== phase 2: live rows
const ESPN = "t:101"; // Fake ESPN 4K: a guide of one hour blocks, "ESPN Hour N"
const SKY = "t:102"; // Fake Sky Sports FHD: 90 minute blocks, "Sky Block N"
const NEWS = "t:103"; // Fake News Channel: no guide id, so "No Information"
const env = (v) => ({ v: 1, data: v });
/** A layout as stored now: the rows (on, every one), and the auto rows already offered. */
const layoutOf = (kinds, { offered = ["onnow", "games"], off = [] } = {}) =>
  env({
    rows: kinds.map((k) => ({ id: k, kind: k.includes(":") ? "catalog" : k, on: !off.includes(k) })),
    offered,
  });
const LIVE_TITLES = ["On Now", "Recent Channels", "Today\u2019s Games", "Recordings"];
const liveTitles = async (page) => (await titles(page)).filter((t) => LIVE_TITLES.includes(t));
const tiles = (page) =>
  page.locator(".media-row[data-row='channels']:has(h3:text-is('On Now')) .chan-tile").evaluateAll((els) =>
    els.map((e) => ({
      id: e.dataset.channel,
      name: e.querySelector(".stream-card__name")?.textContent,
      lines: [...e.querySelectorAll(".stream-card__meta")].map((m) => m.textContent),
      bar: e.querySelector(".tile__track > i") ? Number.parseFloat(e.querySelector(".tile__track > i").style.width) : null,
    })),
  );
/** Where the Guide stands, once a channel was asked for: its selected row. */
const guideSelected = (page) =>
  page.evaluate(() => document.querySelector(".guide__row:has(.guide__channel--selected)")?.getAttribute("data-channel") ?? null);

// ---------------------------------------------------------------- On Now
{
  const { ctx, page } = await open({ store: { ...SEEDED, favorites: env([ESPN, SKY, NEWS]) } });
  await goTo(page, "hub");
  await page.locator(".chan-tile").first().waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => /ESPN Hour/.test(document.querySelector(".chan-tile")?.innerText ?? ""), null, { timeout: 20_000 }).catch(() => {});
  const t = await tiles(page);
  check("On Now draws the starred channels, in the order they were starred", JSON.stringify(t.map((c) => c.id)) === JSON.stringify([ESPN, SKY, NEWS]) && JSON.stringify(t.map((c) => c.name)) === JSON.stringify(["Fake ESPN 4K", "Fake Sky Sports FHD", "Fake News Channel"]), JSON.stringify(t.map((c) => c.name)));
  check("  a seeded layout has it, after Up Next", (await ids(page)).slice(0, 5).join() === "carousel,continue,upnext,onnow,games", JSON.stringify(await ids(page)));
  check("  each with what is on and until when, in the clock the person picked (12h)", /^ESPN Hour \d+ · Until \d{1,2}:\d{2} [AP]M$/.test(t[0].lines[0] ?? "") && /^Sky Block \d+ · Until \d{1,2}:\d{2} [AP]M$/.test(t[1].lines[0] ?? ""), JSON.stringify(t.map((c) => c.lines)));
  check("  and what is next", /^Next: ESPN Hour \d+$/.test(t[0].lines[1] ?? "") && /^Next: Sky Block \d+$/.test(t[1].lines[1] ?? ""), JSON.stringify(t.map((c) => c.lines)));
  check("  a bar for how far through it is, part way", t[0].bar !== null && t[0].bar >= 0 && t[0].bar < 100 && t[1].bar !== null && t[1].bar >= 0 && t[1].bar < 100, JSON.stringify(t.map((c) => c.bar)));
  check("  a channel with no guide is its name alone, with no bar", t[2].lines.length === 0 && t[2].bar === null, JSON.stringify(t[2]));
  check("  quality badges and logos are the Guide's: 4K on the ESPN tile", (await page.locator(".chan-tile[data-channel='t:101'] .badge--4k").count()) === 1);

  // The click tunes it: the watch request lands, the Guide takes it and shows it.
  await page.locator(".chan-tile[data-channel='t:102']").click();
  await page.locator("main[data-screen='guide']").waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => !!document.querySelector(".guide__channel--selected"), null, { timeout: 15_000 }).catch(() => {});
  check("a click on an On Now card goes to the Guide, and the Guide takes that channel", (await screen(page)) === "guide" && (await guideSelected(page)) === SKY, JSON.stringify({ screen: await screen(page), selected: await guideSelected(page) }));
  check("  and plays it in the theater, as Multi-view's Watch in Player does", (await page.locator(".live--theater").count()) > 0);

  // Stream's own page has none of the live rows, though they have data.
  await goTo(page, "home");
  await rowsReady(page);
  check("Stream's own page has no live rows, though On Now has channels", (await liveTitles(page)).length === 0 && (await page.locator(".chan-tile, .gamecard, .home-rec").count()) === 0, JSON.stringify(await titles(page)));
  await ctx.close();
}
{
  // The clock the person picked: 24h has no AM or PM.
  const { ctx, page } = await open({ store: { ...SEEDED, favorites: env([ESPN]), clockFormat: env("24h") } });
  await goTo(page, "hub");
  await page.waitForFunction(() => /ESPN Hour/.test(document.querySelector(".chan-tile")?.innerText ?? ""), null, { timeout: 20_000 }).catch(() => {});
  const t = await tiles(page);
  check("On Now says Until in the 24h clock when that is picked", /· Until \d{2}:\d{2}$/.test(t[0]?.lines[0] ?? ""), JSON.stringify(t[0]?.lines));
  await ctx.close();
}
{
  // Nothing starred: no row, and the editor says what to do.
  const { ctx, page } = await open({ store: SEEDED });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForTimeout(800);
  check("with nothing starred, On Now is not drawn", !(await titles(page)).includes("On Now") && (await page.locator(".chan-tile").count()) === 0, JSON.stringify(await titles(page)));
  await openSettings(page);
  const why = await page.locator(".xtrow:has(.homerows__title[aria-label='Name of On Now']) .homerows__why").innerText();
  check("  Settings → Home says why, under the row", why === "Star channels in the Guide to fill this row.", why);
  check("  Today\u2019s Games says to follow a league, and Recent Channels nothing (it is not on Home)", (await page.locator(".xtrow:has(.homerows__title[aria-label='Name of Today\u2019s Games']) .homerows__why").innerText()) === "Follow a league in Sports to fill this row." && (await page.getByRole("textbox", { name: "Name of Recent Channels", exact: true }).count()) === 0);
  await ctx.close();
}

// ------------------------------------------------------- Recent Channels
{
  const base = { ...SEEDED, recents: env([NEWS, ESPN]), homeRows: layoutOf(["continue", "upnext", "recent"]) };
  const { ctx, page } = await open({ store: base });
  await goTo(page, "hub");
  await page.waitForSelector(".media-row[data-row='channels'] .chan-tile", { timeout: 20_000 });
  const got = await page.locator(".chan-tile").evaluateAll((els) => els.map((e) => e.dataset.channel));
  check("Recent Channels draws the channels watched, most recent first, on the same tile", JSON.stringify(got) === JSON.stringify([NEWS, ESPN]) && (await liveTitles(page)).join() === "Recent Channels", JSON.stringify({ got, titles: await titles(page) }));
  await page.locator(".chan-tile[data-channel='t:101']").click();
  await page.locator("main[data-screen='guide']").waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => !!document.querySelector(".guide__channel--selected"), null, { timeout: 15_000 }).catch(() => {});
  check("  a click tunes it, as On Now's does", (await guideSelected(page)) === ESPN, String(await guideSelected(page)));
  await ctx.close();
}
{
  const { ctx, page } = await open({ store: { ...SEEDED, homeRows: layoutOf(["continue", "upnext", "recent"]) } });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForTimeout(500);
  check("with no channel watched yet, Recent Channels is not drawn", !(await titles(page)).includes("Recent Channels"), JSON.stringify(await titles(page)));
  await openSettings(page);
  const why = await page.locator(".xtrow:has(.homerows__title[aria-label='Name of Recent Channels']) .homerows__why").innerText();
  check("  and Settings → Home says channels you watch show there", why === "Channels you watch show here.", why);
  await ctx.close();
}

// --------------------------------------------------------- Today's Games
const FOLLOW_MLB = env({ leagues: ["baseball/mlb"], teams: [], conferences: [] });
const GAMES = [["g1", "live"], ["g2", "final"], ["g3", "pre"]];
{
  const { ctx, page, asked } = await open({ store: { ...SEEDED, "sports-follows": FOLLOW_MLB, homeRows: layoutOf(["continue", "upnext", "games"]) }, games: GAMES });
  await goTo(page, "hub");
  await page.locator(".homegames .gamecard").first().waitFor({ timeout: 20_000 });
  const cards = await page.locator(".homegames .gamecard").evaluateAll((els) => els.map((e) => e.dataset.game));
  check("Today's Games draws the Sports board's own cards for the leagues you follow", cards.length === 3 && (await liveTitles(page)).join() === "Today\u2019s Games", JSON.stringify({ cards, titles: await titles(page) }));
  check("  a live one with its score, a finished one as Final, one to come with its time", /3\s*-\s*1/.test(await page.locator(".gamecard[data-game='baseball/mlb:g1'], .gamecard").first().innerText()) && (await page.locator(".homegames").innerText()).includes("Final") && /7:00\s?PM/.test(await page.locator(".homegames").innerText()), (await page.locator(".homegames").innerText()).replace(/\s+/g, " ").slice(0, 160));
  check("  asked ESPN for it", asked.espn > 0, String(asked.espn));

  // A click opens it the way the board does: the Sports tab, with the theater up.
  await page.locator(".homegames .gamecard", { hasText: "Home g1" }).click();
  await page.locator("main[data-screen='sports']").waitFor({ timeout: 10_000 });
  await page.locator(".sportstheater").waitFor({ timeout: 15_000 }).catch(() => {});
  check("a click on a game opens it in the Sports theater", (await screen(page)) === "sports" && (await page.locator(".sportstheater").count()) === 1, JSON.stringify({ screen: await screen(page), theater: await page.locator(".sportstheater").count() }));
  check("  the theater is that game's: Home g1 against Away g1", /Home g1/.test(await page.locator(".sportstheater").innerText()) || /HOM/.test(await page.locator(".sportstheater").innerText()), (await page.locator(".sportstheater").innerText()).replace(/\s+/g, " ").slice(0, 120));
  await ctx.close();
}
{
  // Nothing on today for what you follow: no row, and the editor says so once Home has asked.
  const { ctx, page, asked } = await open({ store: { ...SEEDED, "sports-follows": FOLLOW_MLB, homeRows: layoutOf(["continue", "upnext", "games"]) }, games: [] });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForTimeout(1500);
  check("with no game today for your leagues, Today's Games is not drawn", !(await titles(page)).includes("Today\u2019s Games") && (await page.locator(".gamecard").count()) === 0 && asked.espn > 0, JSON.stringify({ titles: await titles(page), asked: asked.espn }));
  await openSettings(page);
  const why = await page.locator(".xtrow:has(.homerows__title[aria-label='Name of Today\u2019s Games']) .homerows__why").innerText();
  check("  and Settings → Home says there are none, for your leagues", why === "No games today for your leagues.", why);
  await ctx.close();
}
{
  // Nothing followed is not the board's every league: no row, and not one request.
  const { ctx, page, asked } = await open({ store: { ...SEEDED, homeRows: layoutOf(["continue", "upnext", "games"]) }, games: GAMES });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForTimeout(1500);
  check("with no league followed, Today's Games is not drawn and nothing is asked of ESPN", !(await titles(page)).includes("Today\u2019s Games") && asked.espn === 0, JSON.stringify({ titles: await titles(page), asked: asked.espn }));
  await ctx.close();
}
{
  // Lazy: the row off, or Home not up, costs no request.
  const { ctx, page, asked } = await open({ store: { ...SEEDED, "sports-follows": FOLLOW_MLB, homeRows: layoutOf(["continue", "upnext", "games"], { off: ["games"] }) }, games: GAMES });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForTimeout(1500);
  const offAsked = asked.espn;
  await goTo(page, "home");
  await rowsReady(page);
  await page.waitForTimeout(1000);
  check("with the row switched off, Home asks ESPN for nothing; nor does Stream's own page", offAsked === 0 && asked.espn === 0 && (await page.locator(".gamecard").count()) === 0, JSON.stringify({ offAsked, asked: asked.espn }));
  await ctx.close();
}

// ------------------------------------------------------------ Recordings
const REC = (id, status, startedAt, more = {}) => ({
  id, channel: "Fake ESPN 4K", programme: null, playlistId: "t", startedAt, endedAt: status === "recording" ? null : startedAt + 1_800_000,
  path: `C:\\Videos\\${id}.ts`, bytes: 2_000_000, status, reason: null, buffer: false, ...more,
});
{
  const now = Date.now();
  const recs = [
    REC("p2", "done", now - 7_200_000, { programme: "Evening News" }),
    REC("p1", "done", now - 3_600_000, { programme: "Match Day" }),
    REC("p3", "partial", now - 10_800_000),
    REC("run", "recording", now - 600_000),
    REC("sch", "scheduled", now + 3_600_000, { path: "", bytes: 0, channelId: ESPN }),
    REC("bad", "failed", now - 14_400_000, { bytes: 0 }),
  ];
  // A live-only profile: a playlist and no stream source at all.
  const { ctx, page } = await open({ store: { playlists: XTREAM, homeRows: layoutOf(["recordings"]) }, recs });
  await goTo(page, "hub");
  await page.locator(".home-rec").first().waitFor({ timeout: 20_000 });
  const got = await page.locator(".home-rec").evaluateAll((els) => els.map((e) => ({ id: e.dataset.id, title: e.querySelector(".rec-row__title")?.textContent, sub: e.querySelector(".rec-row__sub")?.textContent, meta: e.querySelector(".rec-row__meta")?.textContent })));
  check("Recordings draws what finished, newest first: not the one running, scheduled or failed", JSON.stringify(got.map((r) => r.id)) === JSON.stringify(["p1", "p2", "p3"]), JSON.stringify(got.map((r) => r.id)));
  check("  each as the list's row: the programme (or the channel), the channel and when, the length and size", got[0].title === "Match Day" && /^Fake ESPN 4K · /.test(got[0].sub) && got[2].title === "Fake ESPN 4K" && /^30m|^0:30|30/.test(got[0].meta) && /MB/.test(got[0].meta), JSON.stringify(got));
  check("  a profile with a playlist and no stream source gets the row, not No Movies or Shows Yet", (await page.locator(".stream__note").count()) === 0 && (await titles(page)).join() === "Recordings", JSON.stringify(await titles(page)));

  await page.locator(".home-rec[data-id='p1'] button", { hasText: "Play" }).click();
  await page.locator("main[data-screen='guide']").waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => window.__calls.some((c) => c[0] === "rec_play"), null, { timeout: 10_000 }).catch(() => {});
  const play = await page.evaluate(() => window.__calls.filter((c) => c[0] === "rec_play").map((c) => c[1]));
  check("Play on a recording goes to the Guide and plays that recording, as Library's Play does", (await screen(page)) === "guide" && play.length > 0 && play.every((a) => a.id === "p1"), JSON.stringify({ screen: await screen(page), play: play.map((a) => a.id) }));
  check("  in Recordings mode, with the row marked as playing", (await page.locator(".rec-row[data-id='p1'][aria-current='true']").count()) === 1);
  await ctx.close();
}
{
  // None finished: no row, and the editor says so.
  const { ctx, page } = await open({ store: { ...SEEDED, homeRows: layoutOf(["continue", "upnext", "recordings"]) }, recs: [REC("run", "recording", Date.now() - 1000)] });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForTimeout(800);
  check("with no recording finished, Recordings is not drawn", !(await titles(page)).includes("Recordings") && (await page.locator(".home-rec").count()) === 0, JSON.stringify(await titles(page)));
  await openSettings(page);
  const why = await page.locator(".xtrow:has(.homerows__title[aria-label='Name of Recordings']) .homerows__why").innerText();
  check("  and Settings → Home says recordings you make show there", why === "Recordings you make show here.", why);
  await ctx.close();
}

// ----------------------------------------- every live row on, nothing in it
{
  // A live-only profile (a playlist, no stream source): Home's own message, not a prompt to add a catalog.
  const { ctx, page } = await open({ store: { playlists: XTREAM, homeRows: layoutOf(["onnow", "recent", "games", "recordings"]) } });
  await goTo(page, "hub");
  await page.waitForSelector(".stream__note", { timeout: 20_000 });
  await page.waitForTimeout(800);
  const note = (await page.locator(".stream__note").innerText()).replace(/\n/g, " ");
  check("with only live rows, all on and all empty, Home says Nothing on Home, and draws no heading", /Nothing on Home/.test(note) && (await page.locator(".media-row__title").count()) === 0, note);
  await ctx.close();
}

// ----------------------------------------------- Add Row, and the x
{
  const store = {
    ...SEEDED,
    favorites: env([ESPN]),
    recents: env([NEWS]),
    watching: WATCHING,
    homeRows: layoutOf(["continue", "upnext", "aio:top-movies", "aio:top-series", "aio:more-movies"]),
  };
  const { ctx, page } = await open({ store });
  await goTo(page, "hub");
  await rowsReady(page);
  await openSettings(page);
  const addBtn = page.getByRole("button", { name: "Add Row", exact: true });
  await addBtn.click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  const groups = await menu.getByRole("group").evaluateAll((gs) => gs.map((g) => ({ name: g.getAttribute("aria-label"), items: [...g.querySelectorAll("[role=menuitem]")].map((i) => i.textContent) })));
  check("Add Row offers the live rows not on Home, by where they come from", JSON.stringify(groups) === JSON.stringify([{ name: "Live TV", items: ["On Now", "Recent Channels", "Recordings"] }, { name: "Sports", items: ["Today\u2019s Games"] }]), JSON.stringify(groups));
  await menu.getByRole("menuitem", { name: "Recent Channels", exact: true }).click();
  await page.waitForTimeout(500);
  const ed = await editor(page);
  check("adding a row puts it in the editor, on, at the end of the list", ed.at(-1).name === "Recent Channels" && ed.at(-1).on && ed.at(-1).kind === "Live TV", JSON.stringify(ed.map((r) => r.name)));
  check("  and Home draws it, behind Settings, which stays open", (await settingsUp(page)) && (await titles(page)).includes("Recent Channels") && (await page.locator(".chan-tile[data-channel='t:103']").count()) === 1, JSON.stringify(await titles(page)));
  check("  and it is stored", (await ids(page)).at(-1) === "recent");
  await addBtn.click();
  const again = await page.getByRole("menu").getByRole("menuitem").allInnerTexts();
  check("  and is no longer offered", JSON.stringify(again) === JSON.stringify(["On Now", "Recordings", "Today\u2019s Games"]), JSON.stringify(again));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("  Escape closes the menu and leaves Settings up", (await page.getByRole("menu").count()) === 0 && (await settingsUp(page)));

  // The x: only on the live rows.
  const removers = await page.getByRole("button", { name: /^Remove / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  check("only the live rows have an x: not Continue Watching, Up Next, nor a catalog row", JSON.stringify(removers) === JSON.stringify(["Remove Recent Channels"]), JSON.stringify(removers));
  await page.getByRole("button", { name: "Remove Recent Channels", exact: true }).click();
  await page.waitForTimeout(500);
  check("the x takes the row off the editor, Home and the layout, behind Settings, which stays open", (await settingsUp(page)) && !(await editor(page)).some((r) => r.name === "Recent Channels") && !(await titles(page)).includes("Recent Channels") && !(await ids(page)).includes("recent"), JSON.stringify(await ids(page)));
  await addBtn.click();
  const back = await page.getByRole("menu").getByRole("menuitem").allInnerTexts();
  check("  and offers it again", JSON.stringify(back) === JSON.stringify(["On Now", "Recent Channels", "Recordings", "Today\u2019s Games"]), JSON.stringify(back));
  await page.getByRole("menu").getByRole("menuitem", { name: "On Now", exact: true }).click();
  await page.waitForTimeout(500);
  check("  and On Now added by hand draws, with its card", (await titles(page)).includes("On Now") && (await page.locator(".chan-tile[data-channel='t:101']").count()) === 1);
  // With every live row on Home there is nothing left to add.
  for (const name of ["Recent Channels", "Recordings", "Today\u2019s Games"]) {
    await addBtn.click();
    await page.getByRole("menu").getByRole("menuitem", { name, exact: true }).click();
    await page.waitForTimeout(250);
  }
  check("with all four on Home, there is no Add Row", (await addBtn.count()) === 0);
  await ctx.close();
}
{
  // No playlist: no live row can be added, so no Add Row.
  const { ctx, page } = await open({ store: { aiostreams: AIO } });
  await goTo(page, "hub");
  await rowsReady(page);
  await openSettings(page);
  check("with no playlist, Settings → Home has no Add Row", (await page.getByRole("button", { name: "Add Row", exact: true }).count()) === 0 && (await editor(page)).length > 0);
  await ctx.close();
}

// -------------------------------- On Now and Today's Games, offered once
{
  // A layout phase 1 stored (a bare list), on a profile with a playlist.
  const phase1 = env(["carousel", "continue", "upnext", "aio:top-movies", "aio:top-series", "aio:more-movies"].map((id) => (id.startsWith("aio:") ? { id, kind: "catalog", on: true } : { id, kind: id, on: true })));
  const { ctx, page } = await open({ store: { ...SEEDED, favorites: env([ESPN]), homeRows: phase1 } });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForSelector(".chan-tile", { timeout: 20_000 });
  const first = await box(page);
  const count = (list, id) => list.filter((r) => r.id === id).length;
  check("a layout from phase 1 gets On Now and Today's Games, once, switched on, at the end", first.rows.map((r) => r.id).slice(-2).join() === "onnow,games" && count(first.rows, "onnow") === 1 && count(first.rows, "games") === 1 && first.rows.slice(-2).every((r) => r.on), JSON.stringify(first.rows.map((r) => r.id)));
  check("  and writes down that it did", JSON.stringify(first.offered) === JSON.stringify(["onnow", "games"]), JSON.stringify(first.offered));
  check("  and On Now draws, on the same visit", (await titles(page)).includes("On Now"), JSON.stringify(await titles(page)));

  // Taken off Home: it stays off, through a reload and a second launch of Home.
  await openSettings(page);
  await page.getByRole("button", { name: "Remove On Now", exact: true }).click();
  await page.waitForTimeout(400);
  await closeSettings(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForTimeout(1200);
  const after = await box(page);
  check("On Now taken off Home is not added again at the next launch", count(after.rows, "onnow") === 0 && !(await titles(page)).includes("On Now") && (await page.locator(".chan-tile").count()) === 0, JSON.stringify(after.rows.map((r) => r.id)));
  check("  Today's Games, which was not removed, is still there once", count(after.rows, "games") === 1, JSON.stringify(after.rows.map((r) => r.id)));
  check("  and the offer is still on record", JSON.stringify(after.offered) === JSON.stringify(["onnow", "games"]), JSON.stringify(after.offered));
  await stream(page);
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForTimeout(800);
  check("  nor after leaving Home and coming back", count((await box(page)).rows, "onnow") === 0);
  await ctx.close();
}
{
  // With no playlist at the first open, there is nothing to offer; the playlist, later, gets them once.
  const { ctx, page } = await open({ store: { aiostreams: AIO, favorites: env([ESPN]) } });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForTimeout(800);
  const none = await box(page);
  check("a profile with no playlist is seeded without the live rows, and offered none", none.rows.every((r) => !["onnow", "games"].includes(r.kind)) && none.offered.length === 0, JSON.stringify(none));
  await page.evaluate((pl) => localStorage.setItem("blammytv.playlists", JSON.stringify(pl)), XTREAM);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap", { timeout: 20_000 });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForSelector(".chan-tile", { timeout: 20_000 });
  const once = await box(page);
  check("  once there is a playlist, On Now and Today's Games are added, once", once.rows.filter((r) => r.kind === "onnow").length === 1 && once.rows.filter((r) => r.kind === "games").length === 1 && (await titles(page)).includes("On Now"), JSON.stringify(once.rows.map((r) => r.id)));
  await page.reload({ waitUntil: "domcontentloaded" });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForTimeout(800);
  const twice = await box(page);
  check("  and not again at the launch after", twice.rows.length === once.rows.length, JSON.stringify(twice.rows.map((r) => r.id)));
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);

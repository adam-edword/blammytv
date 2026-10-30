// E2E: Home, the page behind the logo (plan 033, phases 1, 2 and 3).
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
//   - phase 3, lists and import: a Saved row draws a Library list's titles and
//     hides when the list is empty or gone; a Trakt row draws a stubbed
//     trending or popular list, and is not drawn (or asked for) when signed
//     out, failing or switched off; Add Row's Watching and Films & Shows;
//     Import Layout takes Adam's sample to the right rows in Strand's order,
//     not a second Continue Watching, junk gets the error, and a row we cannot
//     fill is a Needs a Source row, drawn quietly and removable;
//   - and four findings from review: an Xtream library alone shows its folders
//     on Home, two Next Up rows are not both given one name, Ctrl+K from Home
//     then Back lands on Home, and Home says it is loading (not empty) while a
//     live row has not answered (ESPN held).
//
//   node scripts/fake-panel.mjs   # :8081
//   node scripts/fake-aio.mjs     # :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-home.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { readFileSync } from "node:fs";
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
/** Trakt's four lists, as Add Row names them. */
const TRAKT_ROWS = ["Trending Movies", "Trending Shows", "Popular Movies", "Popular Shows"];
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
async function open({ store = SEEDED, width = 1440, height = 900, reduced = false, games = null, recs = null, native = false, trakt = null, hold = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: "dark", reducedMotion: reduced ? "reduce" : "no-preference" });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  // ESPN is routed, never reached: `games` is [[id, state]] for today's MLB.
  // Registered after the catch-all, so it answers first.
  const asked = { espn: 0 };
  await ctx.route(/site\.api\.espn\.com/, async (route) => {
    asked.espn++;
    // `hold`: a promise ESPN's answer waits for (phase 3: Home while it has not answered).
    if (hold) await hold;
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
  // `native`: the same stub with no recordings (the Xtream panel's calls need
  // http_get). `trakt`: { connected, replies: { path: body | status } }, answered
  // at the same boundary, so no request leaves the machine.
  if (recs || native || trakt)
    await page.addInitScript(({ recs, trakt }) => {
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
          if (cmd === "rec_list") return Promise.resolve(recs ?? []);
          if (cmd === "trakt_status") return Promise.resolve(trakt ? { configured: true, connected: trakt.connected } : { configured: false, connected: false });
          // Answers whether or not signed in: a page that asks when it should not gets data it must not draw.
          if (cmd === "trakt_request") {
            const path = args.path.split("?")[0];
            const r = trakt?.replies?.[path];
            return Promise.resolve(typeof r === "number" ? { status: r, body: "" } : r ? { status: 200, body: JSON.stringify(r) } : { status: 404, body: "" });
          }
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    }, { recs, trakt });
  await page.addInitScript((store) => {
    localStorage.setItem("btv:onboarded", "1"); localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
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
      glyph: r.querySelector(".homerows__glyph")?.getAttribute("data-glyph") ?? null,
      shapes: r.querySelectorAll(".homerows__glyph svg > *").length,
      dim: Number(getComputedStyle(r.querySelector(".homerows__glyph svg") ?? r).opacity),
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
  // Each row has a picture of its kind (1.0.40), drawn, and none dimmed while on.
  check(
    "  each with a picture of its row: the carousel's, Watching's, and posters for a catalog",
    JSON.stringify(rows.map((r) => r.glyph)) === JSON.stringify(["carousel", "continue", "upnext", "onnow", "games", ...AIO_ROWS.map(() => "catalog")]) &&
      rows.every((r) => r.shapes >= 3 && r.dim === 1),
    JSON.stringify(rows.map((r) => [r.glyph, r.shapes, r.dim])),
  );
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
  await page.waitForTimeout(250);
  check("  its picture is dimmed, and the others' are not", (await editor(page)).every((r) => (r.name === "Top Movies" ? r.dim < 0.5 : r.dim === 1)), JSON.stringify((await editor(page)).map((r) => [r.name, r.dim])));
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
  // Discover, still no playlist: its search row is wider than the tabs, and
  // the tabs sit centred over it, not at its left (Adam, 1.0.41).
  await goTo(page, "discover");
  await page.waitForTimeout(900);
  const rows2 = await page.evaluate(() => {
    const span = (sel) => {
      const kids = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
      const l = Math.min(...kids.map((r) => r.left));
      const r = Math.max(...kids.map((r) => r.right));
      return { mid: (l + r) / 2, w: r - l };
    };
    const cap = document.querySelector(".navcap").getBoundingClientRect();
    return { tabs: span(".navcap__row--nav > :not(.navcap__pill)"), sub: span(".navcap__row--sub > :not(.navcap__pill)"), cap: cap.left + cap.width / 2 };
  });
  check(
    "  on Discover the tabs sit centred over the wider search row, and both on the capsule's centre",
    rows2.sub.w > rows2.tabs.w + 40 && Math.abs(rows2.tabs.mid - rows2.cap) < 2 && Math.abs(rows2.sub.mid - rows2.cap) < 2,
    JSON.stringify(rows2),
  );
  await ctx.close();
}

{
  // With a playlist the mark holds the midline, and on Discover the tabs are
  // the wider row: the search row centres under them (Adam, 1.0.42).
  const { ctx, page } = await open({ store: SEEDED });
  await goTo(page, "discover");
  await page.waitForTimeout(900);
  const live2 = await page.evaluate(() => {
    const span = (sel) => {
      const kids = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
      const l = Math.min(...kids.map((r) => r.left));
      const r = Math.max(...kids.map((r) => r.right));
      return { mid: (l + r) / 2, w: r - l };
    };
    const cap = document.querySelector(".navcap").getBoundingClientRect();
    const m = document.querySelector(".navcap__mark").getBoundingClientRect();
    return { tabs: span(".navcap__row--nav > :not(.navcap__pill)"), sub: span(".navcap__row--sub > :not(.navcap__pill)"), cap: cap.left + cap.width / 2, mark: m.left + m.width / 2, mid: innerWidth / 2 };
  });
  check(
    "with a playlist, Discover's search row centres under the wider tabs, and the mark stays on the midline",
    live2.tabs.w > live2.sub.w + 40 && Math.abs(live2.sub.mid - live2.cap) < 2 && Math.abs(live2.mark - live2.mid) < 1.5,
    JSON.stringify(live2),
  );
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
  check("Add Row offers the live rows not on Home, by where they come from", JSON.stringify(groups) === JSON.stringify([{ name: "Live TV", items: ["On Now", "Recent Channels", "Recordings"] }, { name: "Sports", items: ["Today\u2019s Games"] }, { name: "Films & Shows", items: TRAKT_ROWS }]), JSON.stringify(groups));
  await menu.getByRole("menuitem", { name: "Recent Channels", exact: true }).click();
  await page.waitForTimeout(500);
  const ed = await editor(page);
  check("adding a row puts it in the editor, on, at the end of the list", ed.at(-1).name === "Recent Channels" && ed.at(-1).on && ed.at(-1).kind === "Live TV", JSON.stringify(ed.map((r) => r.name)));
  check("  and Home draws it, behind Settings, which stays open", (await settingsUp(page)) && (await titles(page)).includes("Recent Channels") && (await page.locator(".chan-tile[data-channel='t:103']").count()) === 1, JSON.stringify(await titles(page)));
  check("  and it is stored", (await ids(page)).at(-1) === "recent");
  await addBtn.click();
  const again = await page.getByRole("menu").getByRole("menuitem").allInnerTexts();
  check("  and is no longer offered", JSON.stringify(again) === JSON.stringify(["On Now", "Recordings", "Today\u2019s Games", ...TRAKT_ROWS]), JSON.stringify(again));
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
  check("  and offers it again", JSON.stringify(back) === JSON.stringify(["On Now", "Recent Channels", "Recordings", "Today\u2019s Games", ...TRAKT_ROWS]), JSON.stringify(back));
  await page.getByRole("menu").getByRole("menuitem", { name: "On Now", exact: true }).click();
  await page.waitForTimeout(500);
  check("  and On Now added by hand draws, with its card", (await titles(page)).includes("On Now") && (await page.locator(".chan-tile[data-channel='t:101']").count()) === 1);
  // With every live row on Home there is nothing left to add.
  for (const name of ["Recent Channels", "Recordings", "Today\u2019s Games"]) {
    await addBtn.click();
    await page.getByRole("menu").getByRole("menuitem", { name, exact: true }).click();
    await page.waitForTimeout(250);
  }
  await addBtn.click();
  const rest = await page.getByRole("menu").getByRole("group").evaluateAll((gs) => gs.map((g) => g.getAttribute("aria-label")));
  check("with all four live rows on Home, Add Row offers only Films & Shows", JSON.stringify(rest) === JSON.stringify(["Films & Shows"]), JSON.stringify(rest));
  await page.keyboard.press("Escape");
  await ctx.close();
}
{
  // No playlist: no live row can be added, so Add Row offers Trakt's rows alone.
  const { ctx, page } = await open({ store: { aiostreams: AIO } });
  await goTo(page, "hub");
  await rowsReady(page);
  await openSettings(page);
  await page.getByRole("button", { name: "Add Row", exact: true }).click();
  const groups = await page.getByRole("menu").getByRole("group").evaluateAll((gs) => gs.map((g) => g.getAttribute("aria-label")));
  check("with no playlist, Add Row offers no live row: Films & Shows alone", JSON.stringify(groups) === JSON.stringify(["Films & Shows"]) && (await editor(page)).length > 0, JSON.stringify(groups));
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

// ================================================ phase 3: lists and import
const entry = (id, title, kind, year) => ({ id, title, kind, year, at: 1 });
const LISTS = env([
  { id: "l1", name: "Weekend Watch", at: 1, entries: [entry("tt7000001", "Saved One", "movie", 2020), entry("tt7000002", "Saved Two", "series", 2021)] },
  { id: "l2", name: "Empty Shelf", at: 2, entries: [] },
  { id: "__trakt", name: "Trakt Watchlist", at: 3, entries: [entry("tt7000003", "Watch Three", "movie", 2019)] },
]);
/** A layout as stored now, from raw rows. */
const rowsEnv = (rows) => env({ rows, offered: ["onnow", "games"] });
const R = (id, kind, extra = {}) => ({ id, kind, on: true, ...extra });
const savedRow = (list, extra = {}) => R(`saved:${list}`, "saved", { list, ...extra });
const traktRow = (list, extra = {}) => R(`trakt:${list}`, "trakt", { list, ...extra });
const FRONT = [R("continue", "continue"), R("upnext", "upnext")];
/** One catalog row, so there are always cards to wait for. */
const CATALOG = R("aio:top-movies", "catalog");
const shelf = (page, kind) => page.locator(`.media-row[data-row='${kind}']`);
const shelfNames = (page, kind) => shelf(page, kind).locator(".stream-card__name").allInnerTexts();
const traktCalls = (page) => page.evaluate(() => window.__calls.filter((c) => c[0] === "trakt_request").map((c) => c[1].path));

// ---------------------------------------------------------------- Saved
{
  const rows = [...FRONT, savedRow("l1"), savedRow("l2"), savedRow("gone"), CATALOG];
  const { ctx, page } = await open({ store: { ...SEEDED, lists: LISTS, homeRows: rowsEnv(rows) } });
  await goTo(page, "hub");
  await rowsReady(page);
  const t = await titles(page);
  check("a Saved row draws a Library list's titles under the list's name", t.includes("Weekend Watch") && (await shelfNames(page, "saved")).join() === "Saved One,Saved Two", JSON.stringify({ t, cards: await shelfNames(page, "saved") }));
  check("  an empty list's row, and a row for a list that is gone, are not drawn", !t.includes("Empty Shelf") && (await page.locator(".media-row[data-row='saved']").count()) === 1, JSON.stringify(t));

  // A click opens the title's page, there, and Back is Home again.
  await shelf(page, "saved").locator(".stream-card", { hasText: "Saved Two" }).click();
  await page.locator(".stream--full").waitFor({ timeout: 10_000 });
  check("a click on a saved title opens its page, on Home", (await screen(page)) === "hub" && /Saved Two/.test(await page.locator(".stream--full").innerText()), await screen(page));
  await page.getByRole("button", { name: "Back", exact: true }).first().click({ timeout: 5000 });
  await rowsReady(page);
  check("  and Back is Home again, the row still there", (await screen(page)) === "hub" && (await shelfNames(page, "saved")).length === 2);

  // Settings → Home: the names, and why a row is empty.
  await openSettings(page);
  const ed = await editor(page);
  check("Settings → Home lists a Saved row under its list's name, as Watching", ed.some((r) => r.name === "Weekend Watch" && r.kind === "Watching") && ed.some((r) => r.name === "Empty Shelf"), JSON.stringify(ed.map((r) => r.name)));
  const why = (name) => page.locator(`.xtrow:has(.homerows__title[aria-label='Name of ${name}']) .homerows__why`).innerText();
  check("  an empty list says to save titles to it", (await why("Empty Shelf")) === "Save titles to this list to fill this row.", await why("Empty Shelf"));
  check("  a list that is gone says so, under a name of its own", (await why("Saved")) === "This list is gone.", await why("Saved"));
  check("  every Saved row has an x, and the one with titles has no reason", (await page.getByRole("button", { name: /^Remove (Weekend Watch|Empty Shelf|Saved)$/ }).count()) === 3 && (await page.locator(".xtrow:has(.homerows__title[aria-label='Name of Weekend Watch']) .homerows__why").count()) === 0);

  // Rename it.
  await page.getByRole("textbox", { name: "Name of Weekend Watch", exact: true }).fill("Friday Night");
  await page.waitForTimeout(250);
  check("renaming a Saved row retitles it on Home, behind Settings", (await titles(page)).includes("Friday Night") && !(await titles(page)).includes("Weekend Watch"), JSON.stringify(await titles(page)));

  // Add Row → Watching → Saved → a list not on Home yet.
  await page.getByRole("button", { name: "Add Row", exact: true }).click();
  const menu = page.getByRole("menu").first();
  await menu.waitFor();
  const groups = await menu.getByRole("group").evaluateAll((gs) => gs.map((g) => ({ name: g.getAttribute("aria-label"), items: [...g.querySelectorAll("[role=menuitem]")].map((i) => i.textContent) })));
  check("Add Row has a Watching group, with Saved in it, first", groups[0]?.name === "Watching" && groups[0].items.join() === "Saved", JSON.stringify(groups));
  await menu.getByRole("menuitem", { name: "Saved", exact: true }).click();
  const subs = await page.getByRole("menu").last().getByRole("menuitem").allInnerTexts();
  check("  Saved asks which list, and offers the ones not on Home: the Trakt Watchlist", JSON.stringify(subs) === JSON.stringify(["Trakt Watchlist"]), JSON.stringify(subs));
  // The sub-menu draws whole: inside the parent menu, its blur and scroll box
  // cut it off at the edge (1.0.38, Adam's screenshot).
  const shown = await page.getByRole("menuitem", { name: "Trakt Watchlist", exact: true }).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { hit: !!hit && el.contains(hit), nested: !!el.closest("[data-slot=dropdown-menu-content]") };
  });
  check("  the list sub-menu is drawn whole, outside the menu it opens from", shown.hit && !shown.nested, JSON.stringify(shown));
  await page.getByRole("menuitem", { name: "Trakt Watchlist", exact: true }).click();
  await page.waitForTimeout(500);
  check("  picking one adds its row, on, at the end of the editor, and Home draws it", (await editor(page)).at(-1).name === "Trakt Watchlist" && (await titles(page)).includes("Trakt Watchlist") && (await shelfNames(page, "saved")).includes("Watch Three"), JSON.stringify((await editor(page)).map((r) => r.name)));
  const savedIds = (await ids(page)).filter((i) => i.startsWith("saved:"));
  check("  each Saved row has an id of its own, made from its list", JSON.stringify(savedIds) === JSON.stringify(["saved:l1", "saved:l2", "saved:gone", "saved:__trakt"]), JSON.stringify(savedIds));
  await page.getByRole("button", { name: "Add Row", exact: true }).click();
  const left = await page.getByRole("menu").first().getByRole("group").evaluateAll((gs) => gs.map((g) => g.getAttribute("aria-label")));
  check("  and with every list on Home, there is no Saved to pick", !left.includes("Watching"), JSON.stringify(left));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);

  // The x.
  await page.getByRole("button", { name: "Remove Trakt Watchlist", exact: true }).click();
  await page.waitForTimeout(400);
  check("the x takes a Saved row off the editor, Home and the layout", !(await titles(page)).includes("Trakt Watchlist") && !(await ids(page)).includes("saved:__trakt"));
  await ctx.close();
}

// ---------------------------------------------------------------- Trakt
const TREND = [
  { watchers: 9, movie: { title: "Trending One", year: 2025, ids: { imdb: "tt9000001" } } },
  { watchers: 5, movie: { title: "Trending Two", year: 2024, ids: { imdb: "tt9000002" } } },
];
const POP_SHOWS = [{ title: "Popular Show", year: 2018, ids: { imdb: "tt9000003" } }];
/** What the stub answers: two lists with titles, one that fails, and one switched off below. */
const REPLIES = { "/movies/trending": TREND, "/shows/popular": POP_SHOWS, "/shows/trending": 500, "/movies/popular": POP_SHOWS };
const TRAKT_LAYOUT = [...FRONT, traktRow("trending_movies"), traktRow("trending_shows"), traktRow("popular_shows"), traktRow("popular_movies", { on: false }), CATALOG];
{
  const { ctx, page } = await open({ store: { ...SEEDED, homeRows: rowsEnv(TRAKT_LAYOUT) }, trakt: { connected: true, replies: REPLIES } });
  await goTo(page, "hub");
  await page.waitForSelector(".media-row[data-row='trakt'] .stream-card", { timeout: 20_000 });
  await page.waitForTimeout(600);
  const t = (await titles(page)).filter((x) => TRAKT_ROWS.includes(x));
  check("signed in, a Trakt row draws what Trakt sent, in its order, under its name", JSON.stringify(t) === JSON.stringify(["Trending Movies", "Popular Shows"]) && (await shelfNames(page, "trakt")).join() === "Trending One,Trending Two,Popular Show", JSON.stringify({ t, cards: await shelfNames(page, "trakt") }));
  check("  a list that failed is not drawn, and nor is one switched off", !t.includes("Trending Shows") && !t.includes("Popular Movies"));
  const asked = (await traktCalls(page)).map((p) => p.split("?")[0]);
  check("  only the rows that are on were asked for, once each: no request for the one switched off", JSON.stringify(asked.filter((p) => p !== "/sync/last_activities").sort()) === JSON.stringify(["/movies/trending", "/shows/popular", "/shows/trending"]), JSON.stringify(asked));

  // Back from a title is not four more requests; Stream's page asks for none.
  await shelf(page, "trakt").first().locator(".stream-card", { hasText: "Trending Two" }).click();
  await page.locator(".stream--full").waitFor({ timeout: 10_000 });
  check("a click on a Trakt title opens its page, on Home", (await screen(page)) === "hub" && /Trending Two/.test(await page.locator(".stream--full").innerText()));
  await page.getByRole("button", { name: "Back", exact: true }).first().click({ timeout: 5000 });
  await rowsReady(page);
  await page.waitForTimeout(500);
  const before = (await traktCalls(page)).length;
  await goTo(page, "home");
  await rowsReady(page);
  await page.waitForTimeout(500);
  check("  Back from a title, and Stream's own page, ask Trakt for nothing more, and Stream has no Trakt row", (await traktCalls(page)).length === before && (await page.locator(".media-row[data-row='trakt']").count()) === 0, JSON.stringify({ before, now: (await traktCalls(page)).length }));
  await ctx.close();
}
{
  // Not signed in: no row, and no request, though the stub would have answered.
  const { ctx, page } = await open({ store: { ...SEEDED, homeRows: rowsEnv(TRAKT_LAYOUT) }, trakt: { connected: false, replies: REPLIES } });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForTimeout(1500);
  check("signed out, no Trakt row is drawn", (await page.locator(".media-row[data-row='trakt']").count()) === 0 && !(await titles(page)).some((x) => TRAKT_ROWS.includes(x)), JSON.stringify(await titles(page)));
  check("  and Trakt is not asked for anything", (await traktCalls(page)).length === 0, JSON.stringify(await traktCalls(page)));
  await openSettings(page);
  const why = await page.locator(".xtrow:has(.homerows__title[aria-label='Name of Trending Movies']) .homerows__why").innerText();
  check("  Settings → Home says to sign in, under the row", why === "Sign in to Trakt to fill this row.", why);
  await ctx.close();
}
{
  // Add Row → Films & Shows: each list once.
  const { ctx, page } = await open({ store: { ...SEEDED, homeRows: rowsEnv([...FRONT, CATALOG]) }, trakt: { connected: true, replies: REPLIES } });
  await goTo(page, "hub");
  await rowsReady(page);
  await openSettings(page);
  await page.getByRole("button", { name: "Add Row", exact: true }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Popular Shows", exact: true }).click();
  await page.waitForTimeout(700);
  check("Add Row → Films & Shows adds the list, on, once, and Home draws it behind Settings", (await ids(page)).at(-1) === "trakt:popular_shows" && (await titles(page)).includes("Popular Shows") && (await shelfNames(page, "trakt")).join() === "Popular Show", JSON.stringify({ ids: await ids(page), titles: await titles(page) }));
  await page.getByRole("button", { name: "Add Row", exact: true }).click();
  const left = await page.getByRole("menu").getByRole("menuitem").allInnerTexts();
  check("  and it is no longer offered", JSON.stringify(left) === JSON.stringify(["On Now", "Recent Channels", "Recordings", "Today’s Games", "Trending Movies", "Trending Shows", "Popular Movies"]), JSON.stringify(left));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  check("  the x takes it off again", (await page.getByRole("button", { name: "Remove Popular Shows", exact: true }).count()) === 1);
  await page.getByRole("button", { name: "Remove Popular Shows", exact: true }).click();
  await page.waitForTimeout(400);
  check("  and it is gone from the layout and Home", !(await ids(page)).includes("trakt:popular_shows") && !(await titles(page)).includes("Popular Shows"));
  await ctx.close();
}

// ---------------------------------------------------------- Import Layout
const SAMPLE_TEXT = readFileSync(new URL("../apps/app/src/features/home/fixtures/strand-sample.json", import.meta.url), "utf8");
const SAMPLE = JSON.parse(SAMPLE_TEXT);
const dialog = (page) => page.getByRole("dialog", { name: "Import Layout", exact: true });
const importText = async (page, text) => {
  await dialog(page).getByRole("textbox", { name: "Strand Layout", exact: true }).fill(text);
  await dialog(page).getByRole("button", { name: "Add Rows", exact: true }).click();
  await page.waitForTimeout(500);
};
{
  const { ctx, page } = await open({ store: { ...SEEDED, lists: LISTS }, trakt: { connected: true, replies: REPLIES } });
  await goTo(page, "hub");
  await rowsReady(page);
  await openSettings(page);
  const seeded = await ids(page);
  await page.getByRole("button", { name: "Import Layout", exact: true }).click();
  await dialog(page).waitFor({ timeout: 5000 });
  check("Import Layout opens a dialog with a box and an Add Rows button that waits for something pasted", (await dialog(page).getByRole("textbox", { name: "Strand Layout", exact: true }).count()) === 1 && (await dialog(page).getByRole("button", { name: "Add Rows", exact: true }).isDisabled()));

  await importText(page, SAMPLE_TEXT);
  const line = await dialog(page).getByRole("status").innerText();
  check("the sample says how many rows it added, and that Continue Watching was already there", line === "Added 5 rows. 1 already on Home.", line);
  const after = await ids(page);
  check(
    "  the rows are the Watchlist (on the Trakt Watchlist) and Trakt's four, in Strand's order, after the existing ones",
    JSON.stringify(after) === JSON.stringify([...seeded, "saved:__trakt", "trakt:trending_movies", "trakt:trending_shows", "trakt:popular_movies", "trakt:popular_shows"]),
    JSON.stringify(after),
  );
  const stored5 = (await stored(page)).slice(seeded.length);
  check("  titled and switched as Strand has them: the Watchlist is titled, the others keep their own names, all on", stored5[0].title === "Watchlist" && stored5.slice(1).every((r) => r.title === undefined) && stored5.every((r) => r.on === true), JSON.stringify(stored5));
  check("  Continue Watching is not added a second time", (await stored(page)).filter((r) => r.kind === "continue").length === 1 && (await ids(page)).filter((i) => i === "continue").length === 1);
  await page.keyboard.press("Escape");
  await dialog(page).waitFor({ state: "detached", timeout: 5000 });
  check("Escape closes the dialog and leaves Settings up", await settingsUp(page));
  const ed = await editor(page);
  check("  the editor lists them: one Continue Watching, then the Watchlist and Trakt's four", ed.filter((r) => r.name === "Continue Watching").length === 1 && JSON.stringify(ed.slice(-5).map((r) => r.name)) === JSON.stringify(["Watchlist", "Trending Movies", "Trending Shows", "Popular Movies", "Popular Shows"]), JSON.stringify(ed.map((r) => r.name)));
  await page.waitForTimeout(600);
  const home = (await titles(page)).filter((x) => ["Watchlist", ...TRAKT_ROWS].includes(x));
  check("  and Home draws the ones with titles in them, behind Settings, in that order (Trending Shows fails)", JSON.stringify(home) === JSON.stringify(["Watchlist", "Trending Movies", "Popular Movies", "Popular Shows"]), JSON.stringify(home));

  // The same file again adds nothing.
  await page.getByRole("button", { name: "Import Layout", exact: true }).click();
  await importText(page, SAMPLE_TEXT);
  const again = await dialog(page).getByRole("status").innerText();
  check("the same layout a second time adds nothing", again === "Added 0 rows. 6 already on Home." && (await ids(page)).length === after.length, again);

  // Strand has Continue Watching off: ours goes off.
  await importText(page, JSON.stringify([{ ...SAMPLE[0], isEnabled: false }]));
  check("Strand's Continue Watching switched off switches ours off, and adds no row", (await stored(page)).find((r) => r.kind === "continue").on === false && (await ids(page)).length === after.length);

  // Junk: an error under the box, and nothing changes.
  const count = (await ids(page)).length;
  await importText(page, "this is not a layout");
  const err = await dialog(page).getByRole("alert").innerText().catch(() => "");
  check("text that is not a Strand layout says so under the box, and changes nothing", err === "This isn't a layout exported from Strand." && (await ids(page)).length === count && (await dialog(page).getByRole("status").count()) === 0, err);
  await importText(page, JSON.stringify({ rows: SAMPLE }));
  check("  a Strand layout wrapped in something else is junk too", (await dialog(page).getByRole("alert").count()) === 1 && (await ids(page)).length === count);
  await ctx.close();
}
{
  // Anything else: Needs a Source, kept whole, drawn quietly, removable.
  const odd = { id: "ZZZ-1", isEnabled: true, sortOrder: 0, source: { collection: { _0: "marvel" } }, style: "row_large", title: "Marvel" };
  const { ctx, page } = await open({ store: SEEDED });
  await goTo(page, "hub");
  await rowsReady(page);
  await openSettings(page);
  await page.getByRole("button", { name: "Import Layout", exact: true }).click();
  await importText(page, JSON.stringify([odd]));
  const line = await dialog(page).getByRole("status").innerText();
  check("a row Strand has that we do not fill is added, and counted as one row", line === "Added 1 row.", line);
  const kept = (await stored(page)).at(-1);
  check("  as a Needs a Source row that keeps Strand's row whole, and its title", kept.kind === "needs" && kept.title === "Marvel" && JSON.stringify(kept.strand) === JSON.stringify(odd) && kept.on === true, JSON.stringify(kept));
  await page.keyboard.press("Escape");
  await dialog(page).waitFor({ state: "detached", timeout: 5000 });
  const ed = (await editor(page)).at(-1);
  const why = await page.locator(".xtrow:has(.homerows__title[aria-label='Name of Marvel']) .homerows__why").innerText();
  check("  the editor lists it as Needs a Source, with a line that nothing fills it yet", ed.name === "Marvel" && ed.kind === "Needs a Source" && why === "Imported from Strand. Nothing fills this row yet.", JSON.stringify({ ed, why }));
  const row = page.locator(".media-row[data-row='needs']");
  check("  Home draws it, behind Settings: its name and one line, and nothing to click", (await row.count()) === 1 && (await row.locator("h3").innerText()) === "Marvel" && (await row.locator(".home-needs__note").innerText()) === "This row needs a source." && (await row.locator("button, a").count()) === 0);
  // Rename it: the title is the row.
  await page.getByRole("textbox", { name: "Name of Marvel", exact: true }).fill("Superheroes");
  await page.waitForTimeout(250);
  check("  renaming it retitles it on Home", (await row.locator("h3").innerText()) === "Superheroes" && (await stored(page)).at(-1).title === "Superheroes");
  // Switched off: gone from Home, still listed. Back on, and removed.
  await page.getByRole("switch", { name: "Superheroes", exact: true }).click();
  await page.waitForTimeout(300);
  check("  switched off it leaves Home and stays in the editor", (await row.count()) === 0 && (await editor(page)).some((r) => r.name === "Superheroes" && !r.on));
  await page.getByRole("switch", { name: "Superheroes", exact: true }).click();
  await page.waitForTimeout(300);
  check("  switched on it comes back, even with a source behind it that is nothing", (await row.count()) === 1);
  await page.getByRole("button", { name: "Remove Superheroes", exact: true }).click();
  await page.waitForTimeout(400);
  check("  the x removes it from the editor, Home and the layout", (await row.count()) === 0 && !(await editor(page)).some((r) => r.name === "Superheroes") && !(await stored(page)).some((r) => r.kind === "needs"));
  await ctx.close();
}
{
  // Needs a Source rows survive a reload (the JSON is kept), with no sources at all.
  const needs = { id: "needs:Q", kind: "needs", on: true, title: "Quiet One", strand: { source: { x: {} } } };
  const { ctx, page } = await open({ store: { aiostreams: AIO, homeRows: rowsEnv([...FRONT, needs, CATALOG]) } });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await goTo(page, "hub");
  await rowsReady(page);
  check("a Needs a Source row is still drawn after a reload", (await page.locator(".media-row[data-row='needs'] h3").innerText()) === "Quiet One" && (await stored(page)).some((r) => r.kind === "needs" && r.strand?.source));
  await ctx.close();
}

// ------------------------------------------------- finding (a): Xtream alone
const VOD_ONLY = { v: 1, data: [{ kind: "xtream", id: "vod1", name: "Vod Panel", enabled: true, server: "http://localhost:8081", username: "vod", password: "p" }] };
{
  const { ctx, page } = await open({ store: { playlists: VOD_ONLY }, native: true });
  await goTo(page, "home");
  await page.locator("[data-xtcoll]").waitFor({ timeout: 20_000 });
  const onStream = await page.locator("[data-xtcoll] .xtcard__name").allInnerTexts();
  await goTo(page, "hub");
  await page.locator("[data-xtcoll]").waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(500);
  const onHome = await page.locator("[data-xtcoll] .xtcard__name").allInnerTexts();
  const note = await page.locator(".stream__note").innerText().catch(() => "");
  check("a profile whose only stream source is an Xtream library: Home shows the Movies and Shows folders, as Stream does", onStream.length === 3 && JSON.stringify(onHome) === JSON.stringify(onStream) && !/Nothing on Home/.test(note), JSON.stringify({ onStream, onHome, note }));
  // Picking a folder makes it a row on Home, and the folders go.
  await page.locator("[data-xtcoll] .xtcard", { hasText: /^Action$/ }).click();
  await page.locator("[data-xtcoll]").getByRole("button", { name: /^Show 1 Row$/ }).click();
  await page.waitForSelector(".media-row .stream-card", { timeout: 15_000 });
  await page.waitForTimeout(500);
  check("  a folder picked on Home is a row on Home, and the folders step aside", (await titles(page)).includes("Action") && (await page.locator("[data-xtcoll]").count()) === 0, JSON.stringify(await titles(page)));
  await ctx.close();
}

// ------------------------------------------- finding (b): two Next Up rows
{
  const jellyfin = env({
    signedIn: { base: "http://localhost:8196", userId: "u1", userName: "u" },
    nextUp: [{ seriesId: "tt300001", episodeId: "tt300001:1:1", seriesTitle: "Jelly Series", label: "S1 · E1: Pilot" }],
  });
  const { ctx, page } = await open({ store: { ...SEEDED, aiojf: UP_NEXT, jellyfin } });
  await goTo(page, "hub");
  await rowsReady(page);
  await page.waitForTimeout(500);
  check("with AIOStreams and Jellyfin both signed in, Home draws both Next Up rows, each under its own name", (await titles(page)).includes("Next Up") && (await titles(page)).includes("Next Up on Jellyfin"), JSON.stringify(await titles(page)));
  await openSettings(page);
  await page.getByRole("textbox", { name: "Name of Up Next", exact: true }).fill("Coming Up");
  await page.waitForTimeout(300);
  const t = await titles(page);
  check("a rename gives AIOStreams' row the name and Jellyfin's the same name with whose it is: never the one name twice", t.includes("Coming Up") && t.includes("Coming Up on Jellyfin") && t.filter((x) => x === "Coming Up").length === 1, JSON.stringify(t));
  await closeSettings(page);
  await stream(page);
  const s = await titles(page);
  check("  Stream's own page keeps Next Up and Next Up on Jellyfin", s.includes("Next Up") && s.includes("Next Up on Jellyfin") && !s.includes("Coming Up"), JSON.stringify(s));
  await ctx.close();
}

// ------------------------------- finding (c): Ctrl+K from Home, then Back
{
  const { ctx, page } = await open({ store: { ...SEEDED, watching: WATCHING } });
  await goTo(page, "hub");
  await rowsReady(page);
  const card = page.locator(".media-row:has(h3:text-is('Top Series')) .stream-card").first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const at = await page.locator(".stream").evaluate((e) => e.scrollTop);
  await page.keyboard.press("Control+k");
  await page.locator(".palette").waitFor({ timeout: 5000 });
  await page.keyboard.type("series one");
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.locator(".vod-detail").first().waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Back", exact: true }).first().click({ timeout: 5000 });
  await page.locator("main[data-screen='hub']").waitFor({ timeout: 10_000 }).catch(() => {});
  await rowsReady(page);
  await page.waitForTimeout(500);
  const back = await page.locator(".stream").evaluate((e) => ({ top: e.scrollTop, full: e.classList.contains("stream--full") }));
  const m = await mark(page);
  check("Ctrl+K from Home, a title picked, Back: Home again, at its scroll, the mark current", (await screen(page)) === "hub" && m.current === "page" && !back.full && at > 100 && Math.abs(back.top - at) <= 2, JSON.stringify({ screen: await screen(page), at, ...back, current: m.current }));
  await ctx.close();
}
{
  // And from Stream's own page, Back still lands on Stream (the palette's old answer).
  const { ctx, page } = await open({ store: SEEDED });
  await stream(page);
  await page.keyboard.press("Control+k");
  await page.locator(".palette").waitFor({ timeout: 5000 });
  await page.keyboard.type("series one");
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.locator(".vod-detail").first().waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Back", exact: true }).first().click({ timeout: 5000 });
  await rowsReady(page);
  check("Ctrl+K from Stream, a title picked, Back: Stream, not Home", (await screen(page)) === "home", await screen(page));
  await ctx.close();
}

// ---------------------------- finding (d): live rows that have not answered
{
  // A playlist and no stream source, Today's Games on, ESPN held: Home is loading, not empty.
  let release;
  const hold = new Promise((r) => (release = r));
  const { ctx, page, asked } = await open({ store: { playlists: XTREAM, "sports-follows": FOLLOW_MLB, homeRows: layoutOf(["games"]) }, games: [], hold });
  await goTo(page, "hub");
  await page.waitForSelector(".stream__note", { timeout: 20_000 });
  await page.waitForTimeout(1500);
  const waiting = (await page.locator(".stream__note").innerText()).replace(/\n/g, " ");
  check("while ESPN has not answered, Home says it is loading, not that there is nothing", asked.espn > 0 && /Loading Home/.test(waiting) && !/Nothing on Home/.test(waiting), JSON.stringify({ asked: asked.espn, waiting }));
  release();
  await page.waitForFunction(() => /Nothing on Home/.test(document.querySelector(".stream__note")?.textContent ?? ""), null, { timeout: 15_000 }).catch(() => {});
  const done = (await page.locator(".stream__note").innerText()).replace(/\n/g, " ");
  check("  and once it has, with no game today, Nothing on Home", /Nothing on Home/.test(done) && !/Loading Home/.test(done), done);
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);

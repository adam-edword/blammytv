// Headless verify: the player chrome INSIDE THE SPORTS HOST.
//
// Why this exists. The v0.8.188-203 player work rewrote TheaterOverlay and
// useDirectOverlay under three hosts and was exercised in one. SportsTheater
// is the third, HANDOFF records it as opened zero times since that work
// began, and it is the v0.9.0 headline. The one defect found by reading
// (popout not passing its `live` flag, so a live PiP took the duration
// heuristic measured to be false) is the shape this guards against.
//
// Why not `?overlay=1`. That seam mounts a bare TheaterOverlay against a
// mocked `window.overlayApi`, which mocks the very layer the risk lives in.
// SportsTheater goes through the real `useDirectOverlay`, and all of its
// player paths are gated on `isTauri()`. So this stubs one level lower, at
// the IPC boundary (`window.__TAURI_INTERNALS__`), and the real hook runs.
//
// Run, from the REPO ROOT:
//   node scripts/fake-m3u.mjs                              # :8082
//   cd apps/app && pnpm exec vite --port 4173 --strictPort # or build+preview
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-sports-theater.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = "http://localhost:4173/?sportstheater=1";

let fail = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` ${detail}` : ""}`);
};

const PLAYLIST = {
  v: 1,
  data: [
    {
      kind: "m3u",
      id: "m1",
      name: "Test M3U",
      enabled: true,
      url: "http://localhost:8082/playlist.m3u",
    },
  ],
};

// A live NFL game on ESPN. fake-m3u carries "Fake ESPN 4K" in a Sports
// group, so the matcher has something real to link and the rail has a row.
const FIXTURE = {
  game: {
    kind: "fixture",
    id: "g1",
    sport: "football",
    league: "NFL",
    leagueKey: "football/nfl",
    state: "live",
    start: new Date().toISOString(),
    status: "3rd 07:22",
    broadcasts: ["ESPN"],
    channels: [],
    home: { name: "Kansas City", abbr: "KC" },
    away: { name: "Buffalo", abbr: "BUF" },
  },
  others: [],
};

/**
 * The IPC stub. `mpv_status` answers a LIVE reading:
 *   cacheDur 18   the forward buffer, so the edge baseline settles there
 *   dvr 0..100    seekable-ranges' outer bounds
 *   pos           set per scenario
 * The live edge is `dvrEnd - naturalGap` = 82, so pos 82 is AT live and
 * pos 40 is 42s behind it. Those are the numbers dvr.ts folds, run here
 * through the real hook rather than asserted against it.
 */
const stub = (pos) => `
  window.__tauriCalls = [];
  let cb = 0;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (f) => { const id = ++cb; window["_" + id] = f; return id; },
    convertFileSrc: (p) => p,
    invoke: (cmd, args) => {
      window.__tauriCalls.push([cmd, args]);
      // Stubbing the IPC boundary makes isTauri() true, which reroutes the
      // app's HTTP off plain fetch and onto the native command. Answer it
      // with the page's own fetch (fake-m3u serves CORS-open) so the
      // playlist really loads and the matcher has real channels.
      if (cmd === "http_get") return fetch(args.url).then((r) => r.text());
      if (cmd === "mpv_status") {
        return Promise.resolve(JSON.stringify({
          pos: ${pos}, dur: 24.745,   // a live feed DOES report a duration
          presenting: true, ended: false,
          buffering: false, seekable: true,
          cacheDur: 18, dvrStart: 0, dvrEnd: 100,
          audio: [], subs: [], chapters: [],
        }));
      }
      return Promise.resolve(undefined);
    },
  };
  window.__sportsFixture = ${JSON.stringify(FIXTURE)};
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.playlists", ${JSON.stringify(JSON.stringify(PLAYLIST))});
`;

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});

async function open(pos) {
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
  });
  const page = await ctx.newPage();
  await page.addInitScript(stub(pos));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  // The catalog load, the match, autoplay, and then the settle window the
  // edge baseline needs (SETTLE_MS is 10s) before it will draw a window.
  await page.waitForSelector(".theater-overlay", { timeout: 30_000 });
  await page.waitForTimeout(12_000);
  return { page, ctx };
}

// ---- At the live edge -------------------------------------------------
{
  const { page, ctx } = await open(82);

  const calls = await page.evaluate(() => window.__tauriCalls.map((c) => c[0]));
  check("the sports host tunes and opens mpv", calls.includes("inv_open"));
  check("the status poll is running", calls.filter((c) => c === "mpv_status").length > 1);

  check(
    "the chrome renders in the sports host",
    (await page.locator(".theater-overlay").count()) > 0,
  );

  // vod=false has to survive meta → useDirectOverlay → the chrome. If the
  // live flag were lost anywhere the VOD-only controls would appear.
  check(
    "LIVE control set, not VOD",
    (await page.getByLabel("Jump to live").count()) === 1 &&
      (await page.getByLabel("Sources").count()) === 0 &&
      (await page.getByLabel("Next episode").count()) === 0,
  );
  // Plan 017, P6b: the game joins multi-view from here, as the Guide's does.
  check(
    "and the top right offers Watch in multi-view",
    (await page.locator(".theater-topright").getByLabel("Watch in multi-view").count()) === 1,
  );

  const live = await page.locator(".theater-live").getAttribute("class");
  check("at the live edge, the LIVE pill is lit", /is-live/.test(live ?? ""), live ?? "");

  // THE REGRESSION. popout_open must carry live:true from this host, or
  // the native side falls back to the duration heuristic and seeks a live
  // stream to a resume point.
  // The chrome idles out and its own container then swallows the click.
  // A mouse move is what wakes it in the app, so it is what wakes it here.
  await page.mouse.move(800, 450);
  await page.mouse.move(802, 452);
  await page.waitForTimeout(400);
  await page.getByLabel("Pop out").click();
  await page.waitForTimeout(300);
  const popout = await page.evaluate(
    () => window.__tauriCalls.filter((c) => c[0] === "popout_open").map((c) => c[1]),
  );
  check("popout fires", popout.length === 1, JSON.stringify(popout));
  check(
    "popout says live:true",
    popout[0]?.live === true,
    JSON.stringify(popout[0] ?? null),
  );

  await ctx.close();
}

// ---- Behind the live edge --------------------------------------------
{
  const { page, ctx } = await open(40);
  const live = await page.locator(".theater-live").getAttribute("class");
  check(
    "42s behind, the LIVE pill is NOT lit",
    !/is-live/.test(live ?? ""),
    live ?? "",
  );
  await ctx.close();
}

// ---- Stopping the feed must not strand you ----------------------------
// The player chrome's own Back does NOT leave this screen: it stops the
// feed and hands you back to the rail, because you are still watching this
// game and only wanted a different channel for it. Two things made that a
// trap rather than a step back.
//
// The host that carries the chrome is position:fixed with no box of its
// own; InvertedPlayer writes left/top/width/height onto it inline and never
// takes them off. Left in the document after the feed stopped it is an
// EMPTY layer the size of the stage, over the theater, eating clicks. In
// fullscreen that box is the whole window and the side panel carrying the
// only visible way out is hidden, so the tab could only be escaped by
// leaving it.
{
  const { page, ctx } = await open(82);
  /** The chrome hides when the pointer is idle, and a click aimed at a
   * faded control is intercepted by the overlay itself. Wake it first —
   * two moves, because one does not register as movement. */
  const wake = async () => {
    await page.mouse.move(700, 400);
    await page.mouse.move(720, 420);
    await page.waitForTimeout(250);
  };
  const box = () =>
    page.evaluate(() => {
      const h = document.getElementById("inv-chrome");
      return h ? `${h.style.left},${h.style.top},${h.style.width},${h.style.height}` : null;
    });
  check("the chrome host has a box while the feed plays", !!(await box()));

  // ---- FOLDING THE SIDE COLUMN (Adam's) -------------------------------
  //
  // The picture is supposed to TAKE the column's width, so the assertion is
  // on the stage's measured width rather than on the class: a fold that
  // only added a class and left a 360px hole would pass the class check.
  const stageWidth = () =>
    page.evaluate(
      () =>
        document.querySelector(".sportstheater__stage")?.getBoundingClientRect()
          .width ?? 0,
    );
  const railShown = () =>
    page.evaluate(() => {
      const r = document.querySelector(".sportstheater__rail");
      return !!r && getComputedStyle(r).display !== "none";
    });
  const wideBefore = await stageWidth();
  check("the channel rail is on screen to begin with", await railShown());
  await page.getByLabel("Collapse channels").click();
  await page.waitForTimeout(400);
  const wideAfter = await stageWidth();
  check(
    "folding the column gives its width to the picture",
    wideAfter > wideBefore + 200,
    `${Math.round(wideBefore)}px -> ${Math.round(wideAfter)}px`,
  );
  check("and the channel rail goes with it", !(await railShown()));
  // THE WAY BACK OUT has to survive the fold. This is the difference
  // between folding and fullscreen: fullscreen is a mode you can Escape
  // from, a folded panel just looks like a theater that lost its rail, so
  // the strip keeps both its unfold control and the back pill.
  check(
    "the unfold control is still there",
    (await page.getByLabel("Expand channels").count()) === 1,
  );
  check(
    "and so is the way out",
    await page.evaluate(() => {
      const b = document.querySelector(".sportstheater__back");
      return !!b && getComputedStyle(b).display !== "none";
    }),
  );
  await page.getByLabel("Expand channels").click();
  await page.waitForTimeout(400);
  check(
    "unfolding puts the column back",
    (await railShown()) && Math.abs((await stageWidth()) - wideBefore) < 2,
    `${Math.round(await stageWidth())}px, expected ${Math.round(wideBefore)}px`,
  );

  // Fullscreen first: that is the state with no other control on screen.
  await wake();
  await page.getByLabel("Fullscreen").click();
  await page.waitForTimeout(500);
  check("fullscreen is on", await page.evaluate(() =>
    !!document.querySelector(".sportstheater--full")));
  await wake();
  // Two of them in fullscreen (the corner control and the transport's).
  await page.getByLabel("Exit fullscreen").first().click();
  await page.waitForTimeout(500);
  // BACK MEANS BACK. It used to stop the feed and keep you here, which left
  // a dead black stage and no chrome, because the chrome is what carried
  // the button. Reported as "the back button is straight up broken".
  //
  // SCOPED TO THE OVERLAY: the side panel's own "← Back" reads the same and
  // has always left the screen, so an unscoped selector would pass against
  // the broken build.
  await wake();
  await page.locator('.theater-overlay [aria-label="Back"]').first().click();
  await page.waitForTimeout(800);
  check(
    "the in-picture Back leaves the screen",
    (await page.evaluate(() => window.__sportsClosed ?? 0)) === 1,
    `onClose called ${await page.evaluate(() => window.__sportsClosed ?? 0)}x`,
  );
  check("and the whole screen goes with it", await page.evaluate(() =>
    !document.querySelector(".sportstheater")));
  // Weaker than it looks, and worth saying so: unmounting always removed
  // the host, even before v0.9.36. The guard that commit added is for the
  // feed stopping while the screen STAYS mounted, and the only path left to
  // that is the game-change clear, which this entry cannot drive (the
  // fixture is read once at load). This is a teardown sanity check, not
  // cover for that guard.
  check("and the chrome host with it", (await box()) === null, (await box()) ?? "");
  await ctx.close();
}

// ---- THE SIDE COLUMN'S WIDTH (Adam's, v0.9.127) ---------------------
//
// Dragged by its edge, as the Guide's channel column is. Asserted on what
// is DRAWN (the column and the picture, measured, and the rect handed to
// mpv), because a width that only reached the setting would pass a check
// on the setting.
{
  const { page, ctx } = await open(82);
  const widths = () =>
    page.evaluate(() => {
      const w = (s) => Math.round(document.querySelector(s)?.getBoundingClientRect().width ?? 0);
      return { side: w(".sportstheater__side"), slot: w(".sportstheater__slot") };
    });
  const edge = page.locator(".sportstheater__edge");
  const calls = (cmd) =>
    page.evaluate((c) => window.__tauriCalls.filter((x) => x[0] === c).map((x) => x[1]), cmd);
  /** Press on the edge's middle and move `dx` in steps, as a hand does. */
  const drag = async (dx) => {
    const b = await edge.boundingBox();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y);
    await page.mouse.up();
    await page.waitForTimeout(400);
  };

  const before = await widths();
  const eb = await edge.boundingBox();
  const sb = await page.locator(".sportstheater__slot").boundingBox();
  check(
    "the column has a drag edge, in the gap and clear of the picture, at 360 to begin with",
    (await edge.getAttribute("role")) === "separator" && !!eb && eb.x + eb.width <= sb.x && before.side === 360,
    JSON.stringify({ before, edge: eb && [Math.round(eb.x), Math.round(eb.width)], slotX: Math.round(sb.x) }),
  );

  // v0.9.127 drew nothing until the pointer was on the 12px strip, and Adam
  // couldn't find it. The grip shows at rest.
  const grip = await page.evaluate(() => {
    const i = document.querySelector(".sportstheater__edge > i");
    if (!i) return null;
    const r = i.getBoundingClientRect();
    return { opacity: Number(getComputedStyle(i).opacity), w: r.width, h: r.height };
  });
  check(
    "the edge shows its grip at rest",
    !!grip && grip.opacity >= 0.2 && grip.w >= 3 && grip.h >= 40,
    JSON.stringify(grip),
  );

  await drag(120);
  const dragged = await widths();
  const rects = (await calls("inv_set_rect")).map((r) => r.w);
  check(
    "dragging the edge widens the column, and the picture gives up the same width",
    dragged.side === 480 && before.slot - dragged.slot === 120,
    JSON.stringify({ before, dragged }),
  );
  check(
    "and mpv is moved to the new picture",
    rects.length > 0 && Math.abs(rects[rects.length - 1] - dragged.slot) <= 2,
    JSON.stringify(rects.slice(-3)),
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".theater-overlay", { timeout: 30_000 });
  check("the width is remembered", (await widths()).side === 480, JSON.stringify(await widths()));

  // The keyboard, and the player not taking the same key: an arrow on the
  // edge used to seek the stream too (the overlay listens on the document).
  const seeks = (await calls("mpv_seek")).length;
  await edge.focus();
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(200);
  const nudged = (await widths()).side;
  await page.keyboard.press("Home");
  await page.waitForTimeout(200);
  const home = (await widths()).side;
  await page.keyboard.press("End");
  await page.waitForTimeout(200);
  const end = (await widths()).side;
  check(
    "arrows nudge it 24px, Home and End go to 280 and 560",
    nudged === 456 && home === 280 && end === 560,
    JSON.stringify({ nudged, home, end }),
  );
  check(
    "and an arrow on the edge doesn't seek the stream",
    (await calls("mpv_seek")).length === seeks,
    `${(await calls("mpv_seek")).length - seeks} seeks`,
  );

  await edge.dblclick();
  await page.waitForTimeout(300);
  const reset = (await widths()).side;
  await drag(-400);
  const floor = (await widths()).side;
  await drag(600);
  const ceiling = (await widths()).side;
  check(
    "a double-click puts it back to 360, and a drag stops at 280 and 560",
    reset === 360 && floor === 280 && ceiling === 560,
    JSON.stringify({ reset, floor, ceiling }),
  );

  // A narrower window: the column is held to 40% of the theater, and a drag
  // starts from where the edge is drawn, not from the 560 still asked for.
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(400);
  const capped = await widths();
  await drag(-30);
  const fromCap = (await widths()).side;
  check(
    "in a narrow window it's held to 40%, and dragging moves it from there",
    Math.abs(capped.side - 0.4 * (1000 - 56)) <= 1 && fromCap === capped.side - 30,
    JSON.stringify({ capped, fromCap }),
  );

  // The UI-scale setting zooms the page: a drag still follows the pointer.
  await page.setViewportSize({ width: 1600, height: 900 });
  await edge.dblclick();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1.25";
  });
  await page.waitForTimeout(400);
  const z0 = (await widths()).side;
  await drag(100);
  const z1 = (await widths()).side;
  check(
    "at 125% UI scale the edge stays under the pointer",
    Math.abs(z1 - z0 - 100) <= 2,
    `${z0}px -> ${z1}px on screen for a 100px drag`,
  );
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });

  await page.getByLabel("Collapse channels").click();
  await page.waitForTimeout(300);
  const foldedEdges = await edge.count();
  await page.getByLabel("Expand channels").click();
  await page.waitForTimeout(300);
  check(
    "folded, there is no edge to drag, and it's back on unfolding",
    foldedEdges === 0 && (await edge.count()) === 1,
    JSON.stringify({ foldedEdges }),
  );
  await ctx.close();
}

await browser.close();
console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);

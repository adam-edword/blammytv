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
  // Now stop the feed from the chrome's own Back.
  // SCOPED TO THE OVERLAY. The side panel's own "← Back" is a button whose
  // text starts with the same word, and clicking that one leaves the screen
  // instead of stopping the feed, which is the opposite of what is under
  // test here.
  await wake();
  await page.locator('.theater-overlay [aria-label="Back"]').first().click();
  await page.waitForTimeout(800);
  check("the feed stopped", await page.evaluate(() =>
    !document.getElementById("player-slot")?.hasChildNodes?.() ||
    !document.querySelector(".theater-overlay")));
  check(
    "and the chrome host comes down with it",
    (await box()) === null,
    (await box()) ?? "",
  );
  check(
    "so the theater's own Back is hittable again",
    await page
      .locator(".sportstheater__back")
      .click({ timeout: 3000 })
      .then(() => true)
      .catch(() => false),
  );
  await ctx.close();
}

await browser.close();
console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);

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

await browser.close();
console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);

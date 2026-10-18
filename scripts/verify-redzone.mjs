// E2E: the RedZone entry in Multi-view's Live Scores row.
//
// A user asked for a "watch on RedZone" button when NFL games are live.
// RedZone only runs on Sunday afternoons, when games overlap, so the entry
// shows with two or more NFL games in progress and not with one (Thursday,
// Sunday and Monday night are one game each and the channel is off the air),
// and only when one of the enabled playlists has a RedZone channel. What this
// proves, under the IPC stub the other multi-view harnesses use and with ESPN
// answered here:
// - two live NFL games and a RedZone channel: "Add RedZone" heads the NFL's
//   games, once, and a click adds the RedZone channel as a tile (the stream
//   handed to the proxy is its own, not the worse copy's), after which the
//   entry is marked and does nothing more;
// - one live NFL game, the channel there: no entry;
// - two live games, no RedZone channel on the line: no entry;
// - a RedZone channel on a playlist that is switched off: no entry;
// - on a full line a click asks which tile it replaces, as the picker does,
//   and the tile picked is swapped for RedZone;
// - and on Sports, the same rule puts "Watch RedZone" at the end of Today's
//   Games' toolbar, and a click plays the channel in the Guide's player;
// - the Guide's right-click menu sets a channel as RedZone ("Use for
//   RedZone", on names that say NFL or RedZone), and Sports then plays it.
//
// Each "no entry" is held to a control that shows it could have been there: the
// row has the NFL games it counts, and the picker finds the channel (or, for
// the line without one, finds a plain channel and not RedZone).
//
//   node scripts/fake-panel.mjs   # :8081 (3 of 3), user "redzone"
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-redzone.mjs
import http from "node:http";
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const URL = process.env.APP_URL ?? "http://localhost:4173/";
const W = 1600;
const H = 900;
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const proxy = http.createServer((rq, rs) => {
  rs.writeHead(200, { "Content-Type": "video/mp2t", "Access-Control-Allow-Origin": "*" });
  const packet = Buffer.alloc(188);
  packet[0] = 0x47;
  const t = setInterval(() => rs.write(packet), 10);
  rs.on("close", () => clearInterval(t));
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const PORT = proxy.address().port;

/** One live game in ESPN's scoreboard shape. */
const liveEvent = (id, home, away) => {
  const status = {
    clock: 442,
    displayClock: "7:22",
    period: 3,
    type: { id: "2", name: "STATUS_IN_PROGRESS", state: "in", completed: false, shortDetail: "7:22 - 3rd" },
  };
  const team = (t) => ({
    id: t.id,
    displayName: t.name,
    shortDisplayName: t.short,
    abbreviation: t.abbr,
    name: t.short,
    logo: `https://a.espncdn.com/i/teamlogos/test/500/${t.abbr}.png`,
  });
  const date = new Date(Date.now() - 90 * 60_000).toISOString();
  return {
    id,
    date,
    name: `${away.name} at ${home.name}`,
    shortName: `${away.abbr} @ ${home.abbr}`,
    status,
    competitions: [
      {
        id,
        date,
        competitors: [
          { id: home.id, homeAway: "home", team: team(home), score: "14" },
          { id: away.id, homeAway: "away", team: team(away), score: "10" },
        ],
        status,
        broadcasts: [{ market: "national", names: ["CBS"] }],
      },
    ],
  };
};
const CHIEFS_BILLS = liveEvent(
  "401",
  { id: "12", name: "Kansas City Chiefs", short: "Chiefs", abbr: "KC" },
  { id: "2", name: "Buffalo Bills", short: "Bills", abbr: "BUF" },
);
const EAGLES_COWBOYS = liveEvent(
  "402",
  { id: "21", name: "Philadelphia Eagles", short: "Eagles", abbr: "PHI" },
  { id: "6", name: "Dallas Cowboys", short: "Cowboys", abbr: "DAL" },
);
const TWO = [CHIEFS_BILLS, EAGLES_COWBOYS];
const ONE = [CHIEFS_BILLS];

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const panel = (id, user, enabled = true) => ({
  kind: "xtream",
  id,
  name: `Panel ${id}`,
  enabled,
  server: "http://localhost:8081",
  username: user,
  password: "p",
});
const filler = (n, label) => ({ channelId: `r:910${n}`, label });
const FULL_GRID = [filler(2, "RZ Filler One"), filler(3, "RZ Filler Two"), filler(4, "RZ Filler Three")];

/** A Multi-view page: ESPN answers `events` for the NFL, `playlists` are
 * what is saved, `grid` is the grid it opens on. */
async function open({ events, playlists, grid = [], dest = "multiview" }) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route(/strem\.io/, (r) => r.abort());
  await ctx.route(/a\.espncdn\.com/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));
  await ctx.route(/site\.api\.espn\.com/, (route) => {
    const path = new globalThis.URL(route.request().url()).pathname;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: path.includes("football/nfl") ? events : [] }),
    });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ port, playlists, grid }) => {
      MediaSource.isTypeSupported = () => true;
      window.__proxied = [];
      window.__played = [];
      let cb = 0;
      let n = 0;
      window.__TAURI_INTERNALS__ = {
        transformCallback: (f) => {
          const id = ++cb;
          window["_" + id] = f;
          return id;
        },
        convertFileSrc: (p) => p,
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main", windowLabel: "main" },
        },
        invoke: (cmd, args) => {
          if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
          if (cmd === "inv_open") window.__played.push(args.url);
          if (cmd === "mv_proxy_open") {
            window.__proxied.push(args.url);
            return Promise.resolve(`http://127.0.0.1:${port}/mv/t${++n}`);
          }
          if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
      localStorage.setItem(
        "blammytv.sports-follows",
        JSON.stringify({ v: 1, data: { leagues: ["football/nfl"], teams: [], conferences: [] } }),
      );
      localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "stream" }));
      localStorage.setItem("blammytv.playlists", JSON.stringify({ v: 1, data: playlists }));
      if (grid.length && !sessionStorage.getItem("rz-seeded")) {
        sessionStorage.setItem("rz-seeded", "1");
        localStorage.setItem("blammytv.multiviewGrid", JSON.stringify({ v: 1, data: { picks: grid, sound: grid[0].channelId } }));
      }
    },
    { port: PORT, playlists, grid },
  );
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await goTo(page, dest);
  if (dest === "multiview") await page.locator(".mvtab").waitFor();
  return { page, ctx, errors };
}

/** The Live Scores row on, and the NFL games it counts on it. */
async function showRow(page, games) {
  await page.mouse.move(W / 2, H / 2);
  await page.keyboard.press("s");
  await page.locator(".mvscores").waitFor();
  await page
    .waitForFunction((n) => document.querySelectorAll(".mvscores .compactcard").length >= n, games, { timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
}

/** The row, child by child: a league label, an entry, or a game. */
const rowOf = (page) =>
  page.locator(".mvscores__row").evaluate((row) =>
    [...row.children].map((c) => {
      if (c.classList.contains("mvscores__league")) return { league: c.textContent };
      const rz = c.querySelector(".mvscores__rz");
      if (rz) return { rz: rz.textContent.trim(), on: c.classList.contains("is-on"), disabled: rz.disabled };
      return { game: c.querySelector(".compactcard")?.getAttribute("data-hint") ?? "" };
    }),
  );
const rzCount = (row) => row.filter((c) => "rz" in c).length;
const gameCount = (row) => row.filter((c) => c.game).length;

/** How many rows the picker lists for a search: a control that the channel is
 * (or is not) in the catalog, so an absent entry is not just a slow load. */
async function found(page, q) {
  await page.keyboard.press("a");
  await page.locator(".mvpick__input").waitFor();
  await page.locator(".mvpick__input").fill(q);
  await page.waitForTimeout(500);
  const n = await page.locator(".mvpick__row").count();
  await page.keyboard.press("Escape");
  await page.locator(".mvpick__input").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  return n;
}

const tiles = (page) =>
  page.locator(".mvtile:not(.mvtile--empty)").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").split(",")[0]));

// ---- two live NFL games and a RedZone channel -----------------------------
{
  const { page, ctx, errors } = await open({ events: TWO, playlists: [panel("r", "redzone")] });
  await showRow(page, 2);
  const row = await rowOf(page);
  const at = row.findIndex((c) => "rz" in c);
  check(
    "two live NFL games and a RedZone channel: Add RedZone heads the NFL's games, once",
    gameCount(row) === 2 &&
      rzCount(row) === 1 &&
      row[at - 1]?.league === "NFL" &&
      !!row[at + 1]?.game &&
      row[at].rz === "Add RedZone" &&
      !row[at].on &&
      !row[at].disabled,
    JSON.stringify(row),
  );
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/mv-redzone.png` });

  await page.getByRole("button", { name: "Add RedZone" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === 1, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  const added = await tiles(page);
  const proxied = await page.evaluate(() => window.__proxied);
  check(
    "a click adds the RedZone channel as a tile, and the stream is the NFL-named copy's",
    added.length === 1 && added[0] === "US: NFL Redzone" && proxied.length > 0 && proxied.every((u) => u.endsWith("/9101.ts")),
    JSON.stringify({ added, proxied }),
  );
  const after = await rowOf(page);
  check(
    "with RedZone on the grid the entry is marked, like a game on the grid, and does nothing more",
    after.some((c) => c.rz && c.on && c.disabled) && (await tiles(page)).length === 1,
    JSON.stringify(after.filter((c) => "rz" in c)),
  );
  check("no page errors (two games)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ---- one live NFL game ----------------------------------------------------
{
  const { page, ctx, errors } = await open({ events: ONE, playlists: [panel("r", "redzone")] });
  await showRow(page, 1);
  const row = await rowOf(page);
  const there = await found(page, "Redzone");
  check(
    "one live NFL game: no entry, though the channel is there",
    gameCount(row) === 1 && rzCount(row) === 0 && there >= 1,
    JSON.stringify({ row, channelsFound: there }),
  );
  check("no page errors (one game)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ---- no RedZone channel on the line ---------------------------------------
{
  const { page, ctx, errors } = await open({ events: TWO, playlists: [panel("t", "u")] });
  await showRow(page, 2);
  const row = await rowOf(page);
  const news = await found(page, "News");
  const rz = await found(page, "Redzone");
  check(
    "two live NFL games and no RedZone channel: no entry",
    gameCount(row) === 2 && rzCount(row) === 0 && news >= 1 && rz === 0,
    JSON.stringify({ row, news, rz }),
  );
  check("no page errors (no channel)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ---- RedZone on a playlist that is switched off ---------------------------
{
  const { page, ctx, errors } = await open({
    events: TWO,
    playlists: [panel("t", "u"), panel("r", "redzone", false)],
  });
  await showRow(page, 2);
  const row = await rowOf(page);
  const news = await found(page, "News");
  check(
    "a RedZone channel on a playlist that is switched off is not offered",
    gameCount(row) === 2 && rzCount(row) === 0 && news >= 1 && (await found(page, "Redzone")) === 0,
    JSON.stringify({ row, news }),
  );
  check("no page errors (switched off)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ---- a full line ----------------------------------------------------------
{
  const { page, ctx, errors } = await open({ events: TWO, playlists: [panel("r", "redzone")], grid: FULL_GRID });
  await showRow(page, 2);
  // Held until the panel has said what the line allows: before that nothing
  // says the grid is full, and the channel would simply join as a fourth.
  await page
    .waitForFunction(() => /of 3/.test(document.querySelector(".mvmeter")?.getAttribute("aria-label") ?? ""), null, { timeout: 10_000 })
    .catch(() => {});
  await page.getByRole("button", { name: "Add RedZone" }).click();
  await page.waitForSelector(".mvchoose", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const prompt = await page.locator(".mvchoose").textContent().catch(() => null);
  const asked = await tiles(page);
  check(
    "on a full line it asks which tile RedZone replaces, and adds nothing yet",
    !!prompt?.startsWith("Pick a Tile for US: NFL Redzone") && asked.length === 3 && !asked.includes("US: NFL Redzone"),
    JSON.stringify({ prompt, asked }),
  );
  await page.locator('.mvtile[aria-label^="RZ Filler Two,"]').click({ position: { x: 60, y: 60 } });
  await page.waitForTimeout(800);
  const swapped = await tiles(page);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.multiviewGrid")).data);
  check(
    "the tile picked is swapped for RedZone, which takes the sound",
    swapped.length === 3 &&
      !swapped.includes("RZ Filler Two") &&
      stored.sound === "r:9101" &&
      // In Filler Two's place, then into Focus's big spot, trading places
      // with Filler One (M2), as mventry's swap reads.
      stored.picks.map((p) => p.channelId).join() === "r:9101,r:9102,r:9104",
    JSON.stringify({ swapped, stored }),
  );
  check("no page errors (full line)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ---- Sports: Watch RedZone in Today's Games' toolbar ---------------------

/** Sports with today's NFL games on the row: how many, and the toolbar's
 * buttons in order. */
async function sportsBar(page, games) {
  await page
    .waitForFunction((n) => document.querySelectorAll(".sports__head--today ~ * .gamecard__tilt").length >= n, games, { timeout: 15_000 })
    .catch(() => {});
  // The catalog lands on its own clock; give the button the time it would take.
  await page.waitForTimeout(1500);
  return page.evaluate(() => ({
    games: document.querySelectorAll(".sports__head--today ~ * .gamecard__tilt").length,
    bar: [...document.querySelectorAll(".sports__head--today .sports__bar button")].map((b) => b.textContent.trim()),
  }));
}

{
  const { page, ctx, errors } = await open({ events: TWO, playlists: [panel("r", "redzone")], dest: "sports" });
  const { games, bar } = await sportsBar(page, 2);
  check(
    "Sports, two live NFL games and a RedZone channel: Watch RedZone ends Today's Games' toolbar",
    games === 2 && bar.at(-1) === "Watch RedZone" && bar.filter((b) => b === "Watch RedZone").length === 1,
    JSON.stringify({ games, bar }),
  );
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/sports-redzone.png` });
  await page.getByRole("button", { name: "Watch RedZone" }).click();
  await page.waitForFunction(() => window.__played.length > 0, null, { timeout: 10_000 }).catch(() => {});
  const played = await page.evaluate(() => window.__played);
  const onGuide = await page.evaluate(() => document.querySelector('[data-dest="guide"]')?.getAttribute("aria-current") === "page");
  check(
    "a click plays the NFL-named RedZone copy in the Guide's player",
    onGuide && played.length > 0 && played.every((u) => u.endsWith("/9101.ts")),
    JSON.stringify({ onGuide, played }),
  );
  check("no page errors (Sports, two games)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

{
  const { page, ctx, errors } = await open({ events: ONE, playlists: [panel("r", "redzone")], dest: "sports" });
  const { games, bar } = await sportsBar(page, 1);
  check(
    "Sports, one live NFL game: no Watch RedZone, though the row is there",
    games === 1 && !bar.includes("Watch RedZone"),
    JSON.stringify({ games, bar }),
  );
  check("no page errors (Sports, one game)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

{
  const { page, ctx, errors } = await open({ events: TWO, playlists: [panel("t", "u")], dest: "sports" });
  const { games, bar } = await sportsBar(page, 2);
  check(
    "Sports, two live NFL games and no RedZone channel: no Watch RedZone",
    games === 2 && !bar.includes("Watch RedZone"),
    JSON.stringify({ games, bar }),
  );
  check("no page errors (Sports, no channel)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ---- The Guide's menu: Use for RedZone ------------------------------------
{
  const { page, ctx, errors } = await open({ events: TWO, playlists: [panel("r", "redzone")], dest: "guide" });
  const card = (id) => page.locator(`.guide__row[data-channel="${id}"] .guide__card`);
  const menuOn = async (id) => {
    await card(id).click({ button: "right" });
    await page.getByRole("menu").waitFor({ timeout: 5000 });
  };
  const closeMenu = async () => {
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  };
  const useItem = () => page.getByRole("menuitemcheckbox", { name: "Use for RedZone" });
  await card("r:9100").waitFor({ timeout: 30_000 });

  await menuOn("r:9102");
  const filler = { use: await useItem().count(), add: await page.getByRole("menuitem", { name: "Add to Multi-View" }).count() };
  await closeMenu();
  check(
    "the Guide's menu doesn't offer Use for RedZone on a channel that says neither NFL nor RedZone",
    filler.use === 0 && filler.add === 1,
    JSON.stringify(filler),
  );

  // The decoy, the one the name match passes over for "US: NFL Redzone".
  await menuOn("r:9100");
  const before = await useItem().getAttribute("aria-checked").catch(() => null);
  await useItem().click();
  await page.getByRole("menu").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.redzoneChannel") ?? "null")?.data);
  await menuOn("r:9100");
  const after = await useItem().getAttribute("aria-checked").catch(() => null);
  await closeMenu();
  check(
    "Use for RedZone on RedZone HD: unchecked, then checked and kept",
    before === "false" && after === "true" && stored === "r:9100",
    JSON.stringify({ before, after, stored }),
  );

  await goTo(page, "sports");
  await sportsBar(page, 2);
  // The Guide may have played a preview on the way: only the click counts.
  await page.evaluate(() => (window.__played = []));
  await page.getByRole("button", { name: "Watch RedZone" }).click();
  await page.waitForFunction(() => window.__played.length > 0, null, { timeout: 10_000 }).catch(() => {});
  const played = await page.evaluate(() => window.__played);
  check(
    "Sports' Watch RedZone then plays the channel you set, not the name match's",
    played.length > 0 && played.every((u) => u.endsWith("/9100.ts")),
    JSON.stringify(played),
  );
  check("no page errors (Guide menu)", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);

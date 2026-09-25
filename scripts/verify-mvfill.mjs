// E2E: multi-view's ways out, and in (plan 017, P6a).
//
// What this proves, under the IPC stub the other multi-view harnesses use:
// - a double-click fills the window with a tile, which takes the sound; the
//   others keep playing out of sight (hidden, their videos kept), the seam
//   goes, and the move is animated with the filled tile on top;
// - Escape puts it back, and only it: full screen stays for the next press;
// - Enter fills the current tile at once (the keyboard never animates),
//   2 moves the whole window to tile 2, and a double-click on the filled
//   tile puts it back; Enter on a bar button is that button's;
// - closing the filled tile goes back to the grid;
// - Watch in player leaves for the Guide, which plays that channel in the
//   theater;
// - a live popout is stopped as the tab opens (F10); a VOD one is not;
// - the first-run notice is a real dialog: centred, focus kept inside it,
//   not dismissed by Escape or a click outside, and gone once accepted.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mvfill.mjs
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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const ESPN = "Fake ESPN 4K";
const SKY = "Fake Sky Sports FHD";
const NEWS = "Fake News Channel";
const GRID = [
  { channelId: "t:101", label: ESPN },
  { channelId: "t:102", label: SKY },
  { channelId: "t:103", label: NEWS },
];

/** A page with the app loaded (not yet on multi-view). */
async function load({ noticeSeen = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route(/\.espn(cdn)?\.com\/|strem\.io/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ port, grid, noticeSeen }) => {
      MediaSource.isTypeSupported = () => true;
      window.__calls = [];
      window.__full = false;
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
          window.__calls.push(cmd);
          if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
          if (cmd === "mv_proxy_open") return Promise.resolve(`http://127.0.0.1:${port}/mv/t${++n}`);
          if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(window.__full);
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      if (noticeSeen) localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem("blammytv.multiviewGrid", JSON.stringify({ v: 1, data: { picks: grid, sound: "t:101" } }));
      }
      localStorage.setItem(
        "blammytv.playlists",
        JSON.stringify({
          v: 1,
          data: [
            {
              kind: "xtream",
              id: "t",
              name: "Test",
              enabled: true,
              server: "http://localhost:8081",
              username: "u",
              password: "p",
            },
          ],
        }),
      );
    },
    { port: PORT, grid: GRID, noticeSeen },
  );
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  return { page, ctx, errors };
}

async function enter(page) {
  await goTo(page, "multiview");
  await page.waitForFunction(() => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === 3, null, {
    timeout: 15_000,
  });
  await page.waitForTimeout(300);
}

const tile = (page, name) => page.locator(`.mvtile[aria-label^="${name},"]`);
/** Every tile: name, rect, whether it shows, whether it has the sound. */
const tiles = (page) =>
  page.locator(".mvtile:not(.mvtile--empty)").evaluateAll((els) =>
    Object.fromEntries(
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return [
          e.getAttribute("aria-label").split(",")[0],
          {
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
            shown: getComputedStyle(e).visibility === "visible",
            on: e.classList.contains("is-on"),
          },
        ];
      }),
    ),
  );
/** The filled tile's width: the largest 16:9 picture, caption under it,
 * that the stage holds. */
const fillW = (page) =>
  page.locator(".mvgrid").evaluate((e) => Math.min(e.clientWidth, ((e.clientHeight - 30) * 16) / 9));
/** A double-click on a tile's picture, clear of anything on it (a failed
 * tile's Retry sits in the middle and keeps its own clicks). */
const dbl = (page, name) => tile(page, name).dblclick({ position: { x: 30, y: 30 } });
const ours = (page) => page.evaluate(() => document.getAnimations().filter((a) => a.id === "mv-motion").length);
const finish = (page) =>
  page.evaluate(() => document.getAnimations().forEach((a) => a.id === "mv-motion" && a.finish()));
const rest = (page) => page.mouse.move(W - 200, H - 10);
const press = async (page, key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(150);
};
const calls = (page) => page.evaluate(() => window.__calls);

// --------------------------------------------------------------- fill
{
  const { page, ctx, errors } = await load();
  await enter(page);
  await rest(page);
  await page.evaluate(() =>
    document.querySelectorAll(".mvtile[data-mv]").forEach((t) => {
      const v = t.querySelector("video");
      if (v) v.__mark = t.dataset.mv;
    }),
  );
  const sw = await fillW(page);

  // The sound tile, already in the big spot: its first click moves nothing,
  // so what moves is the fill. (A tile without the sound is Enter's, below.)
  await dbl(page, ESPN);
  const moving = await ours(page);
  const z = await tile(page, ESPN).evaluate((e) => getComputedStyle(e).zIndex);
  await finish(page);
  await page.waitForTimeout(100);
  const f = await tiles(page);
  check(
    "a double-click fills the window with the tile, animated with it on top",
    f[ESPN].shown && f[ESPN].on && Math.abs(f[ESPN].w - sw) <= 2 && moving > 0 && z === "1",
    JSON.stringify({ espn: f[ESPN], sw, moving, z }),
  );
  const marks = await page.evaluate(() =>
    [...document.querySelectorAll(".mvtile[data-mv]")].map((t) => [t.dataset.mv, t.querySelector("video")?.__mark ?? null]),
  );
  check(
    "the others keep playing out of sight: hidden, not closed, their videos kept, and the seam is gone",
    !f[NEWS].shown &&
      !f[SKY].shown &&
      marks.length === 3 &&
      marks.every(([mv, mark]) => mv === mark) &&
      (await page.getByRole("separator").count()) === 0,
    JSON.stringify({ marks, news: f[NEWS].shown, sky: f[SKY].shown }),
  );

  // Escape puts the tile back, and leaves full screen for the next press.
  await page.evaluate(() => {
    window.__full = true;
    window.__calls = [];
  });
  await press(page, "Escape");
  const back = await tiles(page);
  const firstEscape = await calls(page);
  await press(page, "Escape");
  const secondEscape = await calls(page);
  await page.evaluate(() => {
    window.__full = false;
  });
  check(
    "Escape puts it back, and only it: full screen goes with the next press",
    Object.values(back).every((t) => t.shown) &&
      back[ESPN].w < sw - 100 &&
      !firstEscape.includes("plugin:window|set_fullscreen") &&
      secondEscape.includes("plugin:window|set_fullscreen"),
    JSON.stringify({ firstEscape, secondEscape }),
  );

  // A small tile, double-clicked: its first click swaps it into the big
  // spot and the double-click fills from there. The fill must keep it on
  // top, not lose it to the swap it cut short.
  await rest(page);
  const small = Object.entries(await tiles(page)).find(([, t]) => !t.on)?.[0];
  await dbl(page, small);
  const zSmall = await tile(page, small).evaluate((e) => getComputedStyle(e).zIndex);
  await finish(page);
  const filledSmall = await tiles(page);
  check(
    "a small tile double-clicked fills from its swap, still on top of the others",
    zSmall === "1" && filledSmall[small].on && Math.abs(filledSmall[small].w - sw) <= 2,
    JSON.stringify({ small, zSmall }),
  );
  await press(page, "Escape");

  // Enter on a tile that has the keyboard (and not the sound): it fills,
  // takes the sound, at once; then 2 moves the whole window to tile 2.
  await rest(page);
  const quiet = Object.entries(await tiles(page)).find(([, t]) => !t.on)?.[0];
  await tile(page, quiet).focus();
  await press(page, "Enter");
  const byEnter = await ours(page);
  const e1 = await tiles(page);
  const current = Object.entries(e1).find(([, t]) => t.on)?.[0];
  await press(page, "2");
  const e2 = await tiles(page);
  const second = Object.entries(e2).find(([, t]) => t.shown)?.[0];
  check(
    "Enter on a tile fills the window with it and gives it the sound, at once, and 2 moves the whole window to tile 2",
    byEnter === 0 &&
      current === quiet &&
      e1[current].shown &&
      Math.abs(e1[current].w - sw) <= 2 &&
      Object.values(e2).filter((t) => t.shown).length === 1 &&
      second !== current &&
      e2[second].on &&
      Math.abs(e2[second].w - sw) <= 2,
    JSON.stringify({ quiet, current, second, byEnter }),
  );
  await dbl(page, second);
  await finish(page);
  check(
    "a double-click on the filled tile puts it back",
    Object.values(await tiles(page)).every((t) => t.shown),
    "",
  );

  // Enter on a bar button is the button's, not a fill.
  const kindBefore = await page.locator(".mvseg [aria-pressed='true']").getAttribute("aria-label");
  const other = kindBefore === "Grid" ? "Focus" : "Grid";
  await page.getByRole("button", { name: other, exact: true }).focus();
  await press(page, "Enter");
  check(
    "Enter on a bar button presses that button and fills nothing",
    (await page.locator(".mvseg [aria-pressed='true']").getAttribute("aria-label")) === other &&
      Object.values(await tiles(page)).every((t) => t.shown),
    "",
  );

  // Closing the filled tile goes back to the grid.
  await rest(page);
  await dbl(page, SKY);
  await finish(page);
  await tile(page, SKY).hover();
  // Every frame from the click on: the tile the sound falls to must not
  // start filling the window on its way back to the grid, even for one.
  await page.evaluate((closing) => {
    window.__widest = 0;
    const t0 = performance.now();
    const tick = () => {
      for (const e of document.querySelectorAll(".mvtile:not(.mvtile--empty)")) {
        if (e.getAttribute("aria-label").startsWith(`${closing},`)) continue;
        if (getComputedStyle(e).visibility === "visible")
          window.__widest = Math.max(window.__widest, e.getBoundingClientRect().width);
      }
      if (performance.now() - t0 < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, SKY);
  await page.getByRole("button", { name: `Close ${SKY}` }).click();
  await page.waitForTimeout(700);
  const after = await tiles(page);
  const widest = await page.evaluate(() => window.__widest);
  const gridWidest = Math.max(...Object.values(after).map((t) => t.w));
  check(
    "closing the filled tile goes back to the grid, without the next tile filling on the way",
    Object.keys(after).length === 2 && Object.values(after).every((t) => t.shown) && widest <= gridWidest + 2,
    JSON.stringify({ tiles: Object.keys(after), widest, gridWidest }),
  );

  // Watch in player: to the Guide, that channel, in the theater.
  await rest(page);
  await tile(page, ESPN).hover();
  await page.getByRole("button", { name: `Watch ${ESPN} in the player` }).click();
  const inTheater = await page
    .waitForFunction(
      () =>
        document.querySelector("[data-dest='guide']")?.getAttribute("aria-current") === "page" &&
        !!document.querySelector(".live--theater"),
      null,
      { timeout: 10_000 },
    )
    .then(() => true, () => false);
  const hero = await page.locator(".hero__channel").textContent().catch(() => "");
  check(
    "Watch in player leaves for the Guide, which plays that channel in the theater",
    inTheater && hero.includes(ESPN) && (await page.locator(".mvtab").count()) === 0,
    JSON.stringify({ inTheater, hero }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------------------------------------------- popouts
for (const live of [true, false]) {
  const { page, ctx, errors } = await load();
  await goTo(page, "guide");
  // Opened the way the players open one: through the app's own module.
  // The exact URL the app loaded it from: vite adds a timestamp to a module
  // it has hot-updated, and another URL would be another copy of it.
  await page.evaluate(async (live) => {
    const url = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .find((n) => new URL(n).pathname === "/src/lib/tauri.ts");
    const tauri = await import(url);
    await tauri.tauriPopoutOpen("http://127.0.0.1:1/popped", live);
  }, live);
  await page.evaluate(() => {
    window.__calls = [];
  });
  await enter(page);
  const stopped = (await calls(page)).includes("popout_stop");
  if (live) check("a live popout is stopped as the tab opens: the grid needs its connection", stopped, "");
  else check("a VOD popout is left playing: it never touched the line", !stopped, "");
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// -------------------------------------------------------------- notice
{
  const { page, ctx, errors } = await load({ noticeSeen: false });
  await goTo(page, "multiview");
  const dialog = page.getByRole("dialog", { name: "Multi-view" });
  await dialog.waitFor({ timeout: 10_000 });
  const box = await dialog.boundingBox();
  const centred = Math.abs(box.x + box.width / 2 - W / 2) <= 2;
  // Focus stays inside it however far you tab.
  for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
  const inside = await dialog.evaluate((d) => d.contains(document.activeElement));
  await press(page, "Escape");
  await page.mouse.click(30, H - 30);
  await page.waitForTimeout(300);
  const stays = await dialog.isVisible();
  check(
    "the notice is a real dialog: centred, focus kept inside, and neither Escape nor a click outside dismisses it",
    centred && inside && stays,
    JSON.stringify({ centred, inside, stays, box }),
  );
  await page.getByRole("button", { name: "Got it" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await enter(page);
  check("Got it closes it for good", (await page.getByRole("dialog").count()) === 0, "");
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);

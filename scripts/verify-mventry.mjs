// E2E: the ways into multi-view (plan 017, P6b).
//
// What this proves, under the IPC stub the other multi-view harnesses use:
// - a Guide channel's right-click menu names the channel and offers Add to
//   multi-view; off a channel (the ruler) there is no menu; the menu key
//   opens it by the row, not in the window's corner;
// - a channel sent that way joins the grid you left and takes the sound;
//   one already there only takes the sound;
// - on a full line the tab asks which tile it replaces: the bar says so,
//   every tile offers the swap, Escape lets it go, and a
//   click or a number swaps it in, in that place, with the sound;
// - with the panel slow to answer, a full grid still asks rather than
//   opening a fourth stream on a line of three;
// - the player's top-right offers Watch in multi-view, which stops the
//   Guide's player and hands the channel over, sound and all; and Watch in
//   player (P6a) plays the tile's own channel, not the Guide's first.
//
// No recents are seeded, on purpose: the Guide then opens on nothing, which
// is what made P6a's Watch in player play the first channel instead.
//
//   node scripts/fake-panel.mjs   # :8081 (3 of 3, like Adam's line)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mventry.mjs
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

const ESPN = { channelId: "t:101", label: "Fake ESPN 4K" };
const SKY = { channelId: "t:102", label: "Fake Sky Sports FHD" };
const NEWS = { channelId: "t:103", label: "Fake News Channel" };
const TOON = { channelId: "t:108", label: "Toonami Reruns" };

/** A page with this grid remembered. `slowLine` holds the panel's answer
 * back, so the tab has to decide before it knows the line. */
async function open(grid, { slowLine = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route(/\.espn(cdn)?\.com\/|strem\.io/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ port, grid }) => {
      MediaSource.isTypeSupported = () => true;
      window.__calls = [];
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
          window.__calls.push([cmd, cmd === "inv_open" ? args.url : undefined]);
          if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
          if (cmd === "mv_proxy_open") return Promise.resolve(`http://127.0.0.1:${port}/mv/t${++n}`);
          if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
          if (cmd === "mpv_status")
            return Promise.resolve(
              JSON.stringify({ pos: 82, dur: 24.7, presenting: true, ended: false, buffering: false, seekable: true, cacheDur: 18, dvrStart: 0, dvrEnd: 100, audio: [], subs: [], chapters: [] }),
            );
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem("blammytv.multiviewGrid", JSON.stringify({ v: 1, data: { picks: grid, sound: grid[0].channelId } }));
      }
      localStorage.setItem(
        "blammytv.playlists",
        JSON.stringify({
          v: 1,
          data: [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" }],
        }),
      );
    },
    { port: PORT, grid },
  );
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await goTo(page, "guide");
  await page.waitForSelector('.guide__row[data-channel="t:102"]', { timeout: 20_000 });
  await page.waitForTimeout(400);
  // Held back only from here: the catalog has loaded, and what is left to
  // ask the panel is the line's count.
  if (slowLine)
    await ctx.route(/player_api\.php\?username=u&password=p$/, async (r) => {
      await new Promise((ok) => setTimeout(ok, slowLine));
      await r.continue().catch(() => {});
    });
  return { page, ctx, errors };
}

const menu = (page) => page.locator("[data-slot='context-menu-content']");
/** Right-click a channel in the Guide and send it. */
async function send(page, ch) {
  await page.locator(`.guide__row[data-channel="${ch.channelId}"] .guide__card`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to multi-view" }).click();
  await page.waitForSelector(".mvtab", { timeout: 10_000 });
}
/** The grid as it stands: each tile's name, and which one has the sound. */
const grid = (page) =>
  page.evaluate(() => {
    const tiles = [...document.querySelectorAll(".mvtile:not(.mvtile--empty)")].map((t) => t.getAttribute("aria-label"));
    return {
      names: tiles.map((l) => l.split(",")[0]),
      sound: tiles.find((l) => l.includes("sound on"))?.split(",")[0] ?? null,
      labels: tiles,
      prompt: document.querySelector(".mvchoose")?.textContent ?? null,
      meter: !!document.querySelector(".mvmeter"),
      seg: !!document.querySelector(".mvseg"),
      stored: JSON.parse(localStorage.getItem("blammytv.multiviewGrid")).data,
    };
  });
const tile = (page, name) => page.locator(`.mvtile[aria-label^="${name},"]`);
const settle = async (page, want) => {
  await page
    .waitForFunction((n) => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === n, want, { timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(700);
};

// ------------------------------------------------------------ the menu
{
  const { page, ctx, errors } = await open([ESPN, NEWS]);
  await page.locator('.guide__row[data-channel="t:102"] .guide__card').click({ button: "right" });
  const text = await menu(page).innerText({ timeout: 3000 }).catch(() => "");
  check(
    "a channel's right-click menu names it and offers Add to multi-view",
    text.includes(SKY.label) && (await page.getByRole("menuitem", { name: "Add to multi-view" }).count()) === 1,
    JSON.stringify(text),
  );
  await page.keyboard.press("Escape");
  await menu(page).waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  await page.locator(".guide__ruler").click({ button: "right", position: { x: 300, y: 6 } });
  await page.waitForTimeout(300);
  check("off a channel (the ruler) there is no menu", (await menu(page).count()) === 0);

  // The menu key, as WebView2 sends it: at 0,0 (the folder menu's notes).
  // Headless Chromium puts it on the focused element instead, so it is
  // built here. The Guide sends it again from the row.
  const card = page.locator('.guide__row[data-channel="t:102"] .guide__card');
  await card.focus();
  await card.evaluate((el) =>
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 2 })),
  );
  const box = await menu(page).boundingBox({ timeout: 3000 }).catch(() => null);
  const row = await card.boundingBox();
  check(
    "the menu key opens it by the row, not in the window's corner",
    !!box && box.x > row.x && Math.abs(box.y - (row.y + row.height / 2)) < 40,
    JSON.stringify({ box, row }),
  );
  await page.keyboard.press("Escape");
  await menu(page).waitFor({ state: "detached", timeout: 3000 }).catch(() => {});

  await send(page, SKY);
  await settle(page, 3);
  const joined = await grid(page);
  check(
    "Add to multi-view lands on the tab: the channel joins the grid you left and takes the sound",
    [...joined.names].sort().join() === [ESPN.label, NEWS.label, SKY.label].sort().join() &&
      joined.sound === SKY.label &&
      joined.stored.sound === SKY.channelId,
    JSON.stringify(joined),
  );

  await goTo(page, "guide");
  await page.waitForSelector('.guide__row[data-channel="t:101"]', { timeout: 10_000 });
  await send(page, ESPN);
  await settle(page, 3);
  const here = await grid(page);
  check(
    "one already in the grid only takes the sound",
    here.names.length === 3 && here.sound === ESPN.label && !here.prompt,
    JSON.stringify(here),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------------------------------------- a full grid
{
  const { page, ctx, errors } = await open([ESPN, NEWS, TOON]);
  await send(page, SKY);
  await page.waitForSelector(".mvchoose", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const asked = await grid(page);
  check(
    "on a full line it asks for a tile: the bar names the channel, every tile offers the swap, nothing is added",
    asked.prompt?.startsWith(`Pick a tile for ${SKY.label}`) &&
      !asked.meter &&
      !asked.seg &&
      asked.names.length === 3 &&
      asked.labels.every((l) => l.endsWith(`Swap for ${SKY.label}`)),
    JSON.stringify(asked),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const kept = await grid(page);
  check(
    "Escape lets it go, and nothing is replaced",
    !kept.prompt && kept.meter && kept.names.join() === asked.names.join() && kept.stored.picks.length === 3,
    JSON.stringify(kept),
  );

  await goTo(page, "guide");
  await page.waitForSelector('.guide__row[data-channel="t:102"]', { timeout: 10_000 });
  await send(page, SKY);
  await page.waitForSelector(".mvchoose", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  await tile(page, NEWS.label).hover({ position: { x: 60, y: 60 } });
  await page.waitForTimeout(300);
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll(".mvtile__pickword")].map((w) => [
      w.closest(".mvtile").getAttribute("aria-label").split(",")[0],
      getComputedStyle(w).opacity,
    ]),
  );
  check(
    "the tile under the pointer says what picking it does, the others do not",
    shown.length === 3 && shown.every(([n, o]) => (n === NEWS.label ? o === "1" : o === "0")),
    JSON.stringify(shown),
  );
  await tile(page, NEWS.label).click({ position: { x: 60, y: 60 } });
  await page.waitForTimeout(700);
  const swapped = await grid(page);
  const storedIds = swapped.stored.picks.map((p) => p.channelId);
  check(
    "clicking a tile swaps it in, in that place, and it takes the sound",
    !swapped.prompt &&
      !swapped.names.includes(NEWS.label) &&
      swapped.sound === SKY.label &&
      swapped.stored.sound === SKY.channelId &&
      // In News's place, then, taking the sound, into Focus's big spot,
      // trading places with ESPN (M2): so ESPN is where News was.
      storedIds.join() === [SKY, ESPN, TOON].map((c) => c.channelId).join(),
    JSON.stringify(swapped),
  );

  await goTo(page, "guide");
  await page.waitForSelector('.guide__row[data-channel="t:103"]', { timeout: 10_000 });
  await send(page, NEWS);
  await page.waitForSelector(".mvchoose", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const before = (await grid(page)).names;
  await page.mouse.move(W - 300, H - 10);
  await page.keyboard.press("2");
  await page.waitForTimeout(500);
  const byKey = await grid(page);
  check(
    "or its number: 2 swaps the second tile",
    !byKey.prompt && !byKey.names.includes(before[1]) && byKey.names.includes(NEWS.label) && byKey.sound === NEWS.label,
    JSON.stringify({ before, byKey }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ---------------------------------------------- the panel slow to answer
{
  const { page, ctx, errors } = await open([ESPN, NEWS, TOON], { slowLine: 1500 });
  await send(page, SKY);
  let most = 0;
  for (let i = 0; i < 12; i++) {
    most = Math.max(most, await page.locator(".mvtile:not(.mvtile--empty)").count());
    await page.waitForTimeout(250);
  }
  const after = await grid(page);
  check(
    "with the panel slow to answer, a full grid still asks rather than opening a fourth stream",
    most === 3 && !!after.prompt,
    JSON.stringify({ most, prompt: after.prompt }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------------------------------------- the player
{
  const { page, ctx, errors } = await open([ESPN, NEWS]);
  await goTo(page, "multiview");
  await settle(page, 2);
  await tile(page, NEWS.label).hover({ position: { x: 60, y: 60 } });
  await page.getByRole("button", { name: `Watch ${NEWS.label} in the player` }).click();
  await page.waitForFunction(() => !!document.querySelector(".live--theater"), null, { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const opened = await page.evaluate(() => window.__calls.filter(([c]) => c === "inv_open").map(([, u]) => u));
  check(
    "Watch in player plays that tile's channel, not the Guide's first",
    opened.length > 0 && opened.every((u) => u.endsWith("/103.ts")),
    JSON.stringify(opened),
  );
  const ov = await page.locator(".theater-overlay").first().boundingBox();
  await page.mouse.move(ov.x + ov.width / 2, ov.y + ov.height / 2);
  await page.waitForTimeout(400);
  const right = await page.locator(".theater-topright button").evaluateAll((b) => b.map((x) => x.getAttribute("aria-label")));
  check("the player's top-right offers Watch in multi-view", right[0] === "Watch in multi-view", JSON.stringify(right));

  const stopsBefore = await page.evaluate(() => window.__calls.filter(([c]) => c === "inv_stop").length);
  await page.getByRole("button", { name: "Watch in multi-view" }).click();
  await page.waitForSelector(".mvtab", { timeout: 10_000 }).catch(() => {});
  await settle(page, 2);
  const back = await grid(page);
  const stopsAfter = await page.evaluate(() => window.__calls.filter(([c]) => c === "inv_stop").length);
  check(
    "it stops the Guide's player and hands the channel over, with the sound",
    back.sound === NEWS.label && back.names.length === 2 && stopsAfter > stopsBefore,
    JSON.stringify({ back, stopsBefore, stopsAfter }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);

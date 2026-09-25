// E2E: picking, and the line's limits (plan 017, P3).
//
// The rail beside the grid is gone. A search-first picker opens from Add,
// the empty place or A; the grid grows and shrinks with its channels; the
// line's limit is a ceiling you can see; the grid is there when you come
// back. What this proves, under the IPC stub the other multi-view
// harnesses use:
// - A opens the picker with the search focused; before typing it offers
//   your favourites and what you watched; typing searches, a number finds
//   its channel first;
// - Enter adds what is highlighted, and a channel already in the grid sorts
//   last and says so, so Enter always lands on something you can add;
// - Replace keeps the place and the sound, and closes the old stream
//   before it opens the new one (a replace never needs a spare connection);
// - the grid, and which tile had the sound, survive a reload; a channel
//   that has left the catalog is dropped;
// - a stream on another device counts against the line once the panel's
//   count settles, on the meter and on Add, and the meter leads with the
//   line's total: the number the Guide's own pill shows;
// - a refusal on a line with room says the code, not the limit.
//
// The panel's connection counts are rewritten per scenario with page.route.
// The stand-in proxy answers by channel, as in verify-mvtile.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mvpick.mjs
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
  const mode = rq.url.split("/")[2]?.split("-")[0];
  if (mode === "403") {
    rs.writeHead(403, { "Access-Control-Allow-Origin": "*" });
    return rs.end();
  }
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
const TOON = "Toonami Reruns";

/**
 * The app under the IPC stub. `line(tiles)` answers the panel's connection
 * count from how many tiles are on screen; `seed` sets localStorage.
 */
async function open({ modes = {}, line = null, seed = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route(/\.espn(cdn)?\.com\/|strem\.io/, (r) => r.abort());
  const page = await ctx.newPage();
  if (line) {
    // Only the bare login call carries the counts; the catalog's own calls
    // have an action and pass straight through.
    await page.route(/localhost:8081\/player_api\.php\?username=u&password=p$/, async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      const tiles = await page
        .locator(".mvtile:not(.mvtile--empty)")
        .count()
        .catch(() => 0);
      const [active, max] = line(tiles);
      json.user_info.active_cons = String(active);
      json.user_info.max_connections = String(max);
      await route.fulfill({ response: res, json });
    });
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ port, modes, seed }) => {
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
          if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
          if (cmd === "mv_proxy_open") {
            const id = args.url.match(/(\d+)\.ts$/)?.[1];
            const local = `http://127.0.0.1:${port}/mv/${modes[id] ?? "ok"}-${++n}`;
            window.__calls.push([cmd, id, local]);
            return Promise.resolve(local);
          }
          if (cmd === "mv_proxy_close") window.__calls.push([cmd, null, args.local]);
          if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      // Seeded once per context, so a reload finds what the app saved.
      if (!localStorage.getItem("mvpick-seeded")) {
        localStorage.setItem("mvpick-seeded", "1");
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify({ v: 1, data: v }));
      }
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
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
    { port: PORT, modes, seed },
  );
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await goTo(page, "multiview");
  await page.locator(".mvtab").waitFor();
  return { page, ctx, errors };
}

const tiles = (page) =>
  page
    .locator(".mvtile:not(.mvtile--empty)")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
const names = async (page) => (await tiles(page)).map((l) => l.split(",")[0]);
const soundOn = async (page) =>
  (await tiles(page)).filter((l) => l.includes("sound on")).map((l) => l.split(",")[0]);
const input = (page) => page.locator(".mvpick__input");
const sections = (page) =>
  page.locator(".mvpick__group").evaluateAll((gs) =>
    gs.map((g) => [
      g.querySelector(".mvpick__sec")?.textContent,
      [...g.querySelectorAll(".mvpick__row")].map((r) => r.querySelector(".mvpick__nametext, .mvpick__game")?.textContent?.trim()),
    ]),
  );
const tile = (page, name) => page.locator(`.mvtile[aria-label^="${name},"]`);

// ------------------------------------------------------------ the picker
{
  const { page, ctx, errors } = await open({
    seed: { "blammytv.favorites": ["t:102"], "blammytv.recents": ["t:103"] },
  });
  check("an empty grid is one place to add", (await page.locator(".mvtile").count()) === 1 &&
    (await page.locator(".mvtile--empty").count()) === 1);

  await page.keyboard.press("a");
  await input(page).waitFor({ timeout: 5000 });
  const focused = await page.evaluate(() => document.activeElement?.classList.contains("mvpick__input"));
  const before = await sections(page);
  check(
    "A opens the picker, search focused, with your favourites and what you watched",
    focused &&
      JSON.stringify(before) === JSON.stringify([["Favorites", [SKY]], ["Recent", [NEWS]]]),
    JSON.stringify(before),
  );

  await input(page).fill("fake");
  await page.waitForTimeout(200);
  const rows = await page.locator(".mvpick__row").allInnerTexts();
  check(
    "typing searches, each row with its number, what is on and until when",
    rows.length === 3 && /^Fake ESPN 4K[\s\S]*1 · ESPN Hour 2 · until /.test(rows[0]),
    JSON.stringify(rows.map((r) => r.replace(/\n/g, " | "))),
  );
  await page.keyboard.press("Enter");
  await input(page).waitFor({ state: "detached", timeout: 5000 });
  check(
    "Enter adds the highlighted one and closes the picker",
    JSON.stringify(await names(page)) === JSON.stringify([ESPN]) &&
      (await page.locator(".mvtile--empty").count()) === 1,
    JSON.stringify(await names(page)),
  );

  // A click outside, then Add straight away. The overlay fades in 150ms and
  // the picker in 200, and Radix dismisses on the CLICK after an outside
  // press, so a click in between reopened the picker and the fading one
  // closed it again (verify-mvtile, 2 runs in 13). The fade is stretched
  // here so the click lands in it every run. A pointer's close, since
  // Escape now shuts it at once (P5: keys never animate) and leaves no
  // fade to land in.
  const slow = await page.addStyleTag({
    content: ".mvpick[data-state=closed] { animation-duration: 1500ms !important; }",
  });
  await page.locator(".mvtile--empty").click();
  await input(page).waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  await page.mouse.click(20, H - 20);
  await page.waitForTimeout(100);
  const fadingThen = await page.locator(".mvpick").count();
  await page.locator(".mvtile--empty").click();
  await page.waitForTimeout(1800);
  // On top, too: the overlay fades first, and remounting it put it over a
  // picker that was still fading, so the rows could not be clicked.
  const onTop = await page.evaluate(() => {
    const box = document.querySelector(".mvpick__input");
    const r = box?.getBoundingClientRect();
    return {
      top: !!r && !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest(".mvpick"),
      focused: document.activeElement === box,
      pickers: document.querySelectorAll(".mvpick").length,
    };
  });
  check(
    "a click outside, then Add while the picker is still fading out: it opens again, on top, focused",
    fadingThen === 1 && (await input(page).isVisible()) && onTop.top && onTop.focused && onTop.pickers === 1,
    JSON.stringify({ fadingThen, ...onTop }),
  );
  await page.keyboard.press("Escape");
  await input(page).waitFor({ state: "detached", timeout: 5000 });
  await slow.evaluate((el) => el.remove());
  // And a click outside an open picker still closes it.
  await page.locator(".mvtile--empty").click();
  await input(page).waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  await page.mouse.click(20, H - 20);
  check(
    "a click outside the picker closes it",
    await input(page)
      .waitFor({ state: "detached", timeout: 3000 })
      .then(() => true, () => false),
  );

  await page.locator(".mvtile--empty").click();
  await input(page).fill("fake");
  await page.waitForTimeout(200);
  const order = await page.locator(".mvpick__row").evaluateAll((rs) =>
    rs.map((r) => [
      r.querySelector(".mvpick__nametext")?.textContent,
      r.hasAttribute("data-disabled"),
      r.hasAttribute("data-highlighted"),
    ]),
  );
  check(
    "what is already in the grid says so, sorts last, and the highlight lands on one you can add",
    JSON.stringify(order[order.length - 1]) === JSON.stringify([ESPN, true, false]) &&
      order[0][1] === false &&
      order[0][2] === true &&
      (await page.locator(".mvpick__ingrid").first().textContent()) === "In the grid",
    JSON.stringify(order),
  );
  await input(page).fill("2");
  await page.waitForTimeout(200);
  const first = await page
    .locator(".mvpick__row .mvpick__nametext")
    .first()
    .textContent({ timeout: 3000 })
    .catch(() => "no rows");
  check("a number finds its channel first", first === SKY, first);
  await page.keyboard.press("Enter");
  await input(page).waitFor({ state: "detached", timeout: 5000 });

  // Sound to Sky, then replace Sky: same place, same sound, closed first.
  const sky = tile(page, SKY);
  await sky.hover();
  await sky.getByRole("button", { name: "Sound here" }).click();
  await sky.getByRole("button", { name: `Replace ${SKY}` }).click();
  await input(page).waitFor();
  const target = await page.locator(".mvpick__target").textContent();
  await input(page).fill("toon");
  const callsBefore = (await page.evaluate(() => window.__calls)).length;
  await page.locator(".mvpick__row", { hasText: TOON }).click();
  await page.waitForFunction(
    (n) => document.querySelector(`.mvtile[aria-label^="${n},"]`),
    TOON,
    { timeout: 5000 },
  );
  await page.waitForTimeout(500);
  const after = (await page.evaluate(() => window.__calls)).slice(callsBefore);
  const closeAt = after.findIndex(([c]) => c === "mv_proxy_close");
  const openAt = after.findIndex(([c, id]) => c === "mv_proxy_open" && id === "108");
  check(
    "Replace swaps in place, keeps the sound, and closes the old stream before opening the new",
    target === `Replaces ${SKY}` &&
      JSON.stringify(await names(page)) === JSON.stringify([ESPN, TOON]) &&
      JSON.stringify(await soundOn(page)) === JSON.stringify([TOON]) &&
      closeAt >= 0 &&
      openAt > closeAt,
    JSON.stringify({ target, names: await names(page), after: after.map(([c, id]) => `${c} ${id ?? ""}`) }),
  );

  // Reload: the grid, and the sound, come back.
  await page.reload({ waitUntil: "domcontentloaded" });
  await goTo(page, "multiview");
  await page.waitForFunction(() => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === 2, null, {
    timeout: 10_000,
  }).catch(() => {});
  check(
    "a reload finds the grid as it was, sound and all (M7)",
    JSON.stringify(await names(page)) === JSON.stringify([ESPN, TOON]) &&
      JSON.stringify(await soundOn(page)) === JSON.stringify([TOON]),
    JSON.stringify(await tiles(page)),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// -------------------------------------------- a remembered channel that left
{
  const { page, ctx, errors } = await open({
    seed: {
      "blammytv.multiviewGrid": {
        picks: [
          { channelId: "t:999", label: "Long Gone" },
          { channelId: "t:101", label: ESPN },
        ],
        sound: "t:999",
      },
    },
  });
  await page.waitForFunction(() => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === 1, null, {
    timeout: 10_000,
  }).catch(() => {});
  check(
    "a remembered channel that has left the catalog is dropped, and the sound falls to what is left",
    JSON.stringify(await names(page)) === JSON.stringify([ESPN]) &&
      JSON.stringify(await soundOn(page)) === JSON.stringify([ESPN]),
    JSON.stringify(await tiles(page)),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------------------------- a stream on another device
{
  // The line allows 3 and the panel counts 3 in use: this grid's two, and
  // one somewhere else.
  const { page, ctx, errors } = await open({ line: () => [3, 3] });
  await page.locator(".mvtile--empty").click();
  await input(page).fill(ESPN);
  await page.keyboard.press("Enter");
  await input(page).waitFor({ state: "detached" });
  await page.locator(".mvbar__add").click();
  await input(page).fill(SKY);
  await page.keyboard.press("Enter");
  await input(page).waitFor({ state: "detached" });
  const early = await page.locator(".mvmeter").getAttribute("aria-label");
  // The panel takes up to ~20s to notice a stream has gone, so the grid
  // believes the count only once it has settled.
  await page.waitForTimeout(27_000);
  const meter = await page.locator(".mvmeter").getAttribute("aria-label");
  const addOff = await page.locator(".mvbar__add").getAttribute("aria-disabled");
  const hatched = await page.locator(".mvmeter__dashes i.is-elsewhere").count();
  await page.locator(".mvbar__add").hover();
  const tip = await page.locator("[role='tooltip']").first().textContent({ timeout: 3000 }).catch(() => "");
  check(
    "a stream elsewhere counts once the panel's count settles: on the meter, and on Add",
    early === "2 of 3 streams in use" &&
      meter === "3 of 3 streams in use · 1 elsewhere" &&
      hatched === 1 &&
      addOff === "true" &&
      tip.includes("Your line allows 3, and 1 is in use elsewhere"),
    JSON.stringify({ early, meter, hatched, addOff, tip }),
  );
  // The same panel count, read by the Guide: its sidebar pill is "3/3", and
  // the meter's total is that number, not just this grid's two.
  const total = Number(meter.match(/^(\d+) of/)?.[1]);
  await page.locator('[data-dest="guide"]').click();
  const pill = await page.locator(".live-conns").first().textContent({ timeout: 15_000 }).catch(() => "");
  check(
    "the meter's total is the number the Guide's pill shows",
    pill === "3/3" && total === 3,
    `meter total ${total}, Guide pill "${pill}"`,
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ---------------------------------------- a refusal on a line with room
{
  const { page, ctx, errors } = await open({ modes: { 103: "403" }, line: (n) => [n, 4] });
  await page.locator(".mvtile--empty").click();
  await input(page).fill(NEWS);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.querySelector('.mvtile[data-state="failed"]'),
    null,
    { timeout: 10_000 },
  ).catch(() => {});
  const text = await tile(page, NEWS).locator(".mvtile__state").innerText().catch(() => "");
  check(
    "on a line with room, a 403 is a refusal with its code, not the limit",
    /Your provider refused this one/.test(text) && /It answered 403\./.test(text),
    text.replace(/\n/g, " | "),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);

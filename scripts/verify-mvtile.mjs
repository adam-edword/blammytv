// E2E: a multi-view tile says what it is (plan 017, P2).
//
// Before P2 a tile was a bare <video>: black while tuning, "Stream failed"
// for every kind of failure, no name on it, no way to close it. What this
// proves, under the IPC stub verify-multiview uses:
// - Multi-view finds channels even when it is the first live screen opened
//   (launching on Stream skipped the catalog load, v0.9.105);
// - a tile says it is tuning, then shows the channel, what is on, its
//   progress and LIVE under the pointer, and nothing at rest;
// - a failure says why, in words from what the proxy reported: a DNS miss
//   behind a redirect reads as off the air, a 403 on a full line as the
//   limit, and Retry opens the stream again;
// - a stall shows Buffering, and time lost to stalls shows as behind live;
// - the sound moves with Sound here, is announced, cannot go to a dead
//   tile, and follows the STREAM when another tile closes (audit F13);
// - the X closes a stream and hands its connection back.
//
// The stand-in for mvproxy.rs answers by channel: a stream, the proxy's own
// DNS-miss 502 (its exact wording), or a provider 403. The fake panel's
// guide puts "ESPN Hour 2" on now. Nothing decodes in the test Chromium, so
// a tile's first frame and its stalls are the video events they fire.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mvtile.mjs
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

const DNS_MISS =
  "Bad Gateway: could not connect (provider.tv -> xyakqielska.net): No such host is known. (os error 11001)";
let closed = 0;
const proxy = http.createServer((rq, rs) => {
  const mode = rq.url.split("/")[2]?.split("-")[0];
  if (mode === "dns") {
    rs.writeHead(502, DNS_MISS, { "Access-Control-Allow-Origin": "*" });
    return rs.end();
  }
  if (mode === "403") {
    rs.writeHead(403, { "Access-Control-Allow-Origin": "*" });
    return rs.end();
  }
  rs.writeHead(200, { "Content-Type": "video/mp2t", "Access-Control-Allow-Origin": "*" });
  const packet = Buffer.alloc(188);
  packet[0] = 0x47;
  const t = setInterval(() => rs.write(packet), 10);
  rs.on("close", () => {
    clearInterval(t);
    closed++;
  });
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const PORT = proxy.address().port;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/** The app under the IPC stub. `modes` maps a fake stream id to how the
 * stand-in proxy answers it; `startup` is the tab the app opens on. */
async function open({ modes, startup }) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route(/\.espn(cdn)?\.com\/|strem\.io/, (r) => r.abort());
  // A logo the size real providers send (Cartoon Network's is several
  // hundred pixels). The fake panel's is 1x1, which no size bug can show on.
  await ctx.route("http://localhost:8081/logo.png", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250"><rect width="400" height="250" fill="#e00"/></svg>',
    }),
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ port, modes, startup }) => {
      MediaSource.isTypeSupported = () => true;
      window.__calls = [];
      window.__line = [3, 3];
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
          if (cmd === "http_get") {
            // The panel's count is the test's (the fake panel's own is 3 of
            // 3, a full line); every other answer is the fake panel's.
            if (/player_api\.php/.test(args.url) && !/action=/.test(args.url))
              return fetch(args.url)
                .then((r) => r.json())
                .then((j) => {
                  j.user_info.active_cons = String(window.__line[0]);
                  j.user_info.max_connections = String(window.__line[1]);
                  return new TextEncoder().encode(JSON.stringify(j)).buffer;
                });
            return fetch(args.url).then((r) => r.arrayBuffer());
          }
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
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
      localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: startup }));
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
    { port: PORT, modes, startup },
  );
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await goTo(page, "multiview");
  await page.locator(".mvtab").waitFor();
  return { page, ctx, errors };
}

/** A tile by its name, which leads its accessible name ("CNN, muted, …"). */
const tile = (page, name) => page.locator(`.mvtile[aria-label^="${name},"]`);
const labels = (page) =>
  page.locator(".mvtile:not(.mvtile--empty)").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
/** Add channels through the picker (plan 017, P3), one at a time. */
async function pick(page, names) {
  for (const n of names) {
    const empty = page.locator(".mvtile--empty");
    if (await empty.count()) await empty.click();
    else await page.locator(".mvbar__add").click();
    await page.locator(".mvpick__input").fill(n);
    await page.locator(".mvpick__row", { hasText: n }).first().click();
    await page.locator(".mvpick__input").waitFor({ state: "detached" });
  }
  await page.waitForFunction(
    (k) => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === k,
    names.length,
    { timeout: 10_000 },
  );
}
const fire = (page, name, event) =>
  page.evaluate(
    ([n, ev]) =>
      document
        .querySelector(`.mvtile[aria-label^="${CSS.escape(n)},"] video`)
        ?.dispatchEvent(new Event(ev)),
    [name, event],
  );
const rest = (page) => page.mouse.move(W - 200, H - 10);

const ESPN = "Fake ESPN 4K";
const SKY = "Fake Sky Sports FHD";
const NEWS = "Fake News Channel";

// ---------------------------------------------------------------- states
{
  // Launched on Stream: nothing has loaded the catalog when the tab opens.
  const { page, ctx, errors } = await open({ modes: { 102: "dns", 103: "403" }, startup: "stream" });
  await page.locator(".mvtile--empty").click();
  await page.locator(".mvpick__input").fill("fake");
  const found = await page
    .locator(".mvpick__row")
    .first()
    .waitFor({ timeout: 10_000 })
    .then(() => true, () => false);
  check("opened first, before the Guide, it still finds your channels", found);
  await page.keyboard.press("Escape");

  await pick(page, [ESPN, SKY, NEWS]);
  const espn = tile(page, ESPN);
  check(
    "a new tile says it is tuning",
    (await espn.getAttribute("data-state")) === "tuning" &&
      (await espn.locator(".mvtile__statetitle").textContent()) === `Tuning ${ESPN}`,
  );

  // The failures: words from what the proxy said.
  await page.waitForFunction(
    () => document.querySelectorAll('.mvtile[data-state="failed"]').length === 2,
    null,
    { timeout: 10_000 },
  ).catch(() => {});
  const sky = tile(page, SKY);
  const news = tile(page, NEWS);
  const skyText = await sky.locator(".mvtile__state").innerText().catch(() => "");
  check(
    "a channel sent to a host that does not exist reads as off the air, and says so",
    /Fake Sky Sports FHD is off the air/.test(skyText) && /server that doesn.t exist/.test(skyText),
    skyText.replace(/\n/g, " | "),
  );
  const newsText = await news.locator(".mvtile__state").innerText().catch(() => "");
  // Three tiles on a line that allows three: the line is full, so a 403 is
  // most likely the limit and says so (P3). verify-mvpick covers a refusal
  // on a line with room.
  check(
    "a 403 on a full line reads as the limit, with the code",
    /Your line is at its limit/.test(newsText) && /\(403\)/.test(newsText),
    newsText.replace(/\n/g, " | "),
  );

  // Retry on a full line waits for a slot (plan 018, H1): straight away it
  // would only be refused again. It says so, and goes once the panel shows
  // one; the dead stream was handed back when it failed.
  const opens = async () =>
    (await page.evaluate(() => window.__calls)).filter(([c, id]) => c === "mv_proxy_open" && id === "103");
  const before = (await opens()).length;
  await news.hover();
  await news.getByRole("button", { name: "Retry" }).click();
  await page.waitForTimeout(1200);
  const waitWords = await news.locator(".mvtile__statesub").textContent().catch(() => "");
  const held = (await opens()).length;
  check(
    "Retry on a full line waits for a free slot, and says so",
    held === before && waitWords === "Waiting for a free slot on your line.",
    JSON.stringify({ held: held - before, waitWords }),
  );
  await page.evaluate(() => (window.__line = [2, 3]));
  await page
    .waitForFunction((k) => window.__calls.filter(([c, id]) => c === "mv_proxy_open" && id === "103").length > k, before, {
      timeout: 12_000,
    })
    .catch(() => {});
  const after = await opens();
  const closes = (await page.evaluate(() => window.__calls)).filter(([c]) => c === "mv_proxy_close");
  check(
    "then opens the stream again once there is one, the old one handed back",
    after.length === before + 1 && closes.some(([, , u]) => u === after[0][2]),
    `${before} -> ${after.length} opens`,
  );

  // A failed tile cannot take the sound.
  await sky.click();
  await page.waitForTimeout(200);
  check(
    "a dead tile cannot take the sound, and does not offer to",
    (await espn.getAttribute("aria-label")).includes("sound on") &&
      (await sky.getByRole("button", { name: "Sound here" }).count()) === 0,
    JSON.stringify(await labels(page)),
  );

  // Playing: the first frame.
  await fire(page, ESPN, "playing");
  await rest(page);
  await page.waitForTimeout(3300);
  const chromeAtRest = await espn.locator(".mvtile__chrome").evaluate((e) => getComputedStyle(e).opacity);
  check("at rest, nothing is on the picture", chromeAtRest === "0", `chrome opacity ${chromeAtRest}`);

  await espn.hover();
  await page.waitForTimeout(400);
  const info = {
    chrome: await espn.locator(".mvtile__chrome").evaluate((e) => getComputedStyle(e).opacity),
    chan: await espn.locator(".mvtile__chan").textContent(),
    title: await espn.locator(".mvtile__title").textContent(),
    prog: await espn.locator(".mvtile__track i").evaluate((e) => parseFloat(e.style.width)),
    live: await espn.locator(".mvtile__live").textContent(),
    badge: await espn.locator(".mvtile__badge").evaluate((e) => getComputedStyle(e).opacity),
  };
  check(
    "under the pointer: the channel and number, what is on, how far in, and LIVE",
    info.chrome === "1" &&
      info.chan === `${ESPN} · 1` &&
      info.title === "ESPN Hour 2" &&
      info.prog > 0 &&
      info.prog < 100 &&
      info.live === "LIVE" &&
      info.badge === "1",
    JSON.stringify(info),
  );
  const caps = await page.locator(".mvcap").allInnerTexts();
  check(
    "the captions carry what is on, and nothing for a channel with no guide",
    caps.some((c) => c.includes(ESPN) && c.includes("ESPN Hour 2")) &&
      caps.some((c) => c.trim().endsWith(NEWS)),
    JSON.stringify(caps),
  );
  const logos = await page.locator(".mvcap .chlogo").evaluateAll((els) =>
    els.map((e) => (e.querySelector("img") ? "img" : e.textContent)),
  );
  check(
    "a logo where the provider has one that loads, the initial where it does not",
    logos[0] === "img" && logos[1] === "F" && logos[2] === "F",
    JSON.stringify(logos),
  );
  // Without its stylesheet, a logo still keeps to its box. Adam's first
  // v0.9.107 run got the new markup and the old CSS after a mid-pull
  // reload, and every caption drew its logo at full size.
  const bare = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      const strip = (list) => {
        for (let i = list.length - 1; i >= 0; i--) {
          const r = list[i];
          if (r.cssRules) strip(r.cssRules);
          if (r.selectorText?.includes("chlogo")) (r.parentRule ?? r.parentStyleSheet).deleteRule(i);
        }
      };
      strip(rules);
    }
    const img = document.querySelector(".mvcap .chlogo img").getBoundingClientRect();
    return [Math.round(img.width), Math.round(img.height)];
  });
  check("and with no stylesheet for it, the logo still keeps to its 20px box", bare[0] <= 20 && bare[1] <= 20, JSON.stringify(bare));

  // Stalls: Buffering after a second, then the time lost as behind live.
  await fire(page, ESPN, "waiting");
  await page.waitForTimeout(1300);
  const stalled = await espn.getAttribute("data-state");
  const pill = await espn.locator(".mvtile__buffering").textContent().catch(() => "");
  await page.waitForTimeout(2300);
  await fire(page, ESPN, "playing");
  await page.waitForTimeout(200);
  const behind = await espn.locator(".mvtile__live").textContent();
  check(
    "a stall over a second shows Buffering, and the time it cost shows as behind live",
    stalled === "stalled" && pill.trim() === "Buffering" && /^\ds behind live$/.test(behind),
    `${stalled}, "${pill.trim()}", "${behind}"`,
  );

  // Idle: a pointer left on a tile is watching it.
  await page.waitForTimeout(2600);
  const idleChrome = await espn.locator(".mvtile__chrome").evaluate((e) => getComputedStyle(e).opacity);
  check("a pointer left resting on a tile lets its information go", idleChrome === "0", idleChrome);

  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------------------------------------ the sound and the X
{
  const { page, ctx, errors } = await open({ modes: {}, startup: "live" });
  await pick(page, [ESPN, SKY, NEWS]);
  await page.evaluate(() =>
    document.querySelectorAll("video.mvtile__video").forEach((v) => v.dispatchEvent(new Event("playing"))),
  );
  const sound = async () =>
    (await labels(page)).filter((l) => l.includes("sound on")).map((l) => l.split(",")[0]);
  check("the first tile has the sound", JSON.stringify(await sound()) === JSON.stringify([ESPN]));

  const sky = tile(page, SKY);
  await sky.hover();
  await sky.getByRole("button", { name: "Sound here" }).click();
  await page.waitForTimeout(200);
  const said = await page.locator(".sr-only[aria-live]").textContent();
  check(
    "Sound here moves it, says so, and marks the tile",
    JSON.stringify(await sound()) === JSON.stringify([SKY]) &&
      said === `Sound: ${SKY}` &&
      (await sky.getAttribute("class")).includes("is-flash"),
    `${await sound()} / "${said}"`,
  );

  // Close the tile BEFORE the sound tile: the sound must stay on Sky.
  const espnUrl = (await page.evaluate(() => window.__calls)).find(
    ([c, id]) => c === "mv_proxy_open" && id === "101",
  )[2];
  const espn = tile(page, ESPN);
  const closedBefore = closed;
  await espn.hover();
  await espn.getByRole("button", { name: `Close ${ESPN}` }).click();
  await page.waitForTimeout(500);
  const left = await labels(page);
  const released = (await page.evaluate(() => window.__calls)).some(
    ([c, , u]) => c === "mv_proxy_close" && u === espnUrl,
  );
  check(
    "the X closes that stream and hands its connection back",
    left.length === 2 && !left.some((l) => l.startsWith(ESPN)) && released &&
      closed === closedBefore + 1 &&
      // The grid shrinks to what is left (M8): two streams, no hole.
      (await page.locator(".mvtile").count()) === 2,
    `${JSON.stringify(left)}, ${closed - closedBefore} connection closed`,
  );
  check(
    "and the sound stays with the stream it was on, not the slot (F13)",
    JSON.stringify(await sound()) === JSON.stringify([SKY]),
    JSON.stringify(await sound()),
  );
  // Close the sound tile itself: it falls to what is left.
  await sky.hover();
  await sky.getByRole("button", { name: `Close ${SKY}` }).click();
  await page.waitForTimeout(300);
  check(
    "closing the sound tile hands the sound to what is left",
    JSON.stringify(await sound()) === JSON.stringify([NEWS]),
    JSON.stringify(await labels(page)),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);

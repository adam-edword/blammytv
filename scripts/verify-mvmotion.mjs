// E2E: multi-view's motion (plan 017, P5).
//
// What this proves, under the IPC stub the other multi-view harnesses use:
// - a click that changes the layout moves the tiles FROM WHERE THEY WERE:
//   frozen at its first frame, the tile swapped into Focus's big spot is
//   still drawn at its old small place, and it ends in the big spot; its
//   caption moves with it without scaling; 260ms on the strong ease-in-out;
// - the same changes from the keyboard do not animate at all (2, G);
// - Grid and Focus from the bar's buttons animate;
// - a tile closed from its X leaves a stand-in that fades out and goes,
//   and Delete leaves none;
// - a tile added with a click on a picker row scales in from 0.96, never
//   from nothing;
// - the picker opened from the keyboard appears at once and Escape shuts
//   it at once; opened with a click it scales in over 200ms, and a click
//   outside fades it out;
// - no <video> is re-created by any of it;
// - with reduced motion, nothing moves: only opacity is animated.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mvmotion.mjs
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

async function open({ reduced = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await ctx.route(/\.espn(cdn)?\.com\/|strem\.io/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ port, grid }) => {
      MediaSource.isTypeSupported = () => true;
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
          if (cmd === "mv_proxy_open") return Promise.resolve(`http://127.0.0.1:${port}/mv/t${++n}`);
          if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
      localStorage.setItem("blammytv.multiviewGrid", JSON.stringify({ v: 1, data: { picks: grid, sound: "t:101" } }));
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
    { port: PORT, grid: GRID },
  );
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await goTo(page, "multiview");
  await page.waitForFunction(() => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === 3, null, {
    timeout: 15_000,
  });
  await page.waitForTimeout(400);
  // Mark each video with its stream: nothing here may re-create one.
  await page.evaluate(() =>
    document.querySelectorAll(".mvtile[data-mv]").forEach((t) => {
      const v = t.querySelector("video");
      if (v) v.__mark = t.dataset.mv;
    }),
  );
  return { page, ctx, errors };
}

const tile = (page, name) => page.locator(`.mvtile[aria-label^="${name},"]`);
const rectOf = (page, name) =>
  tile(page, name).evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
  });
/** Our animations in flight, frozen at their first frame so what is drawn
 * can be measured: every one of them, with what it animates. */
const freeze = (page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.id === "mv-motion")
      .map((a) => {
        a.pause();
        a.currentTime = 0;
        const t = a.effect.getTiming();
        const kf = a.effect.getKeyframes();
        return {
          mv: a.effect.target?.dataset?.mv ?? a.effect.target?.className,
          duration: t.duration,
          easing: t.easing,
          first: { transform: kf[0].transform ?? null, opacity: kf[0].opacity ?? null },
        };
      }),
  );
const finish = (page) =>
  page.evaluate(() =>
    document.getAnimations().forEach((a) => {
      if (a.id === "mv-motion") a.finish();
    }),
  );
const ours = (page) =>
  page.evaluate(() => document.getAnimations().filter((a) => a.id === "mv-motion").length);
/** Each tile's stream and the stream its video was marked with. */
const marks = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".mvtile[data-mv]")].map((t) => [t.dataset.mv, t.querySelector("video")?.__mark ?? null]),
  );
const rest = (page) => page.mouse.move(W - 200, H - 10);
const press = async (page, key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(150);
};

{
  const { page, ctx, errors } = await open();
  await rest(page);

  // ------------------------------------------- a click swaps into Focus
  const newsWas = await rectOf(page, NEWS);
  const bigWas = await rectOf(page, ESPN);
  await tile(page, NEWS).click();
  const frozen = await freeze(page);
  const drawnAt = await rectOf(page, NEWS);
  const zDuring = {
    news: await tile(page, NEWS).evaluate((e) => getComputedStyle(e).zIndex),
    espn: await tile(page, ESPN).evaluate((e) => getComputedStyle(e).zIndex),
  };
  const news = frozen.find((a) => a.mv === "tile:t:103");
  const newsCap = frozen.find((a) => a.mv === "cap:t:103");
  check(
    "a click into the big spot moves the tile from where it was: frozen at the start it is still drawn at its old place",
    !!news && Math.abs(drawnAt.x - newsWas.x) <= 2 && Math.abs(drawnAt.y - newsWas.y) <= 2 && Math.abs(drawnAt.w - newsWas.w) <= 2,
    JSON.stringify({ newsWas, drawnAt, news }),
  );
  check(
    "260ms on the strong ease-in-out, and its caption moves with it without scaling",
    news?.duration === 260 &&
      /0\.77, ?0, ?0\.175, ?1/.test(news?.easing ?? "") &&
      !!newsCap &&
      /scale\(1\)$/.test(newsCap.first.transform ?? ""),
    JSON.stringify({ news, newsCap }),
  );
  await finish(page);
  const landed = await rectOf(page, NEWS);
  const zAfter = await tile(page, NEWS).evaluate((e) => getComputedStyle(e).zIndex);
  check(
    "and it ends in the big spot",
    Math.abs(landed.x - bigWas.x) <= 1 && Math.abs(landed.w - bigWas.w) <= 1 && (await ours(page)) === 0,
    JSON.stringify({ landed, bigWas }),
  );
  check(
    "the tile growing into the big spot passes over the one leaving it, and settles back",
    zDuring.news === "1" && zDuring.espn === "auto" && zAfter === "auto",
    JSON.stringify({ zDuring, zAfter }),
  );

  // ------------------------------------------------------ keys: nothing
  await rest(page);
  await press(page, "2");
  const byKey = await ours(page);
  await press(page, "g");
  const byG = await ours(page);
  check("from the keyboard the same changes do not animate (2, G)", byKey === 0 && byG === 0, `${byKey}, ${byG}`);

  // ---------------------------------------------------- the bar's switch
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  const byButton = await freeze(page);
  await finish(page);
  check(
    "Grid to Focus from the bar's button animates every tile",
    byButton.filter((a) => a.mv?.startsWith("tile:")).length === 3,
    JSON.stringify(byButton.map((a) => a.mv)),
  );

  // A resize in the middle of a move stops it: the tiles are laid out for
  // the new window at once, not slid there from the old one.
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  const movingBefore = await ours(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.waitForTimeout(20);
  const movingAfter = await ours(page);
  await page.setViewportSize({ width: W, height: H });
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await finish(page);
  check("a resize in the middle of a move stops it", movingBefore > 0 && movingAfter === 0, JSON.stringify({ movingBefore, movingAfter }));

  // ------------------------------------------------------- X: a stand-in
  await rest(page);
  const skyHadSound = await tile(page, SKY).evaluate((e) => e.classList.contains("is-on"));
  await tile(page, SKY).hover();
  await page.getByRole("button", { name: `Close ${SKY}` }).click();
  const ghostNow = await page.locator(".mvghost").count();
  const movingNow = await ours(page);
  await page.waitForTimeout(450);
  const ghostLater = await page.locator(".mvghost").count();
  check(
    "a tile closed from its X leaves a stand-in that fades out and goes, while the rest move",
    ghostNow === 1 && movingNow >= 2 && ghostLater === 0,
    JSON.stringify({ ghostNow, movingNow, ghostLater }),
  );

  // ------------------------------------------- a row click: from 0.96
  await rest(page);
  await page.getByRole("button", { name: "Add channel" }).click();
  await page.locator(".mvpick__input").waitFor();
  const pick = await page.locator(".mvpick").evaluate((el) =>
    el.getAnimations().map((a) => ({ d: a.effect.getTiming().duration, name: a.animationName })),
  );
  await page.waitForTimeout(250);
  await page.locator(".mvpick__input").fill("sky");
  await page.waitForTimeout(250);
  await page.locator(".mvpick__row").first().click();
  const added = await freeze(page);
  await finish(page);
  const entering = added.find((a) => a.mv === "tile:t:102");
  check(
    "the picker opened with a click scales in over 200ms",
    pick.length === 1 && pick[0].d === 200,
    JSON.stringify(pick),
  );
  const soundNow = await page.locator(".mvtile.is-on").getAttribute("aria-label");
  check(
    "closing the sound tile and adding that channel back does not hand it the sound again",
    skyHadSound && !soundNow.startsWith(SKY),
    JSON.stringify({ skyHadSound, soundNow: soundNow.split(",")[0] }),
  );
  check(
    "a tile added with a click on a row scales in from 0.96 and fades up, never from nothing",
    !!entering && /scale\(0\.96\)/.test(entering.first.transform ?? "") && Number(entering.first.opacity) === 0,
    JSON.stringify(entering),
  );

  // --------------------------------------------- Delete: no stand-in
  await page.locator(".mvpick").waitFor({ state: "detached" });
  await rest(page);
  const before = await page.locator(".mvtile:not(.mvtile--empty)").count();
  await press(page, "Delete");
  const left = await page.locator(".mvtile:not(.mvtile--empty)").count();
  check(
    "Delete closes the tile with no stand-in and nothing moving",
    before === 3 && left === 2 && (await page.locator(".mvghost").count()) === 0 && (await ours(page)) === 0,
    JSON.stringify({ before, left }),
  );

  // -------------------------------------------------- the picker, keys
  await press(page, "a");
  await page.locator(".mvpick__input").waitFor();
  const keyPick = await page.locator(".mvpick").evaluate((el) => ({
    anims: el.getAnimations().length,
    name: getComputedStyle(el).animationName,
  }));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(40);
  const afterEscape = await page.locator(".mvpick").count();
  check(
    "opened with A the picker appears at once, and Escape shuts it at once",
    keyPick.anims === 0 && keyPick.name === "none" && afterEscape === 0,
    JSON.stringify({ keyPick, afterEscape }),
  );
  await page.getByRole("button", { name: "Add channel" }).click();
  await page.locator(".mvpick__input").waitFor();
  await page.waitForTimeout(300);
  await page.mouse.click(20, H - 20);
  await page.waitForTimeout(40);
  const fading = await page.locator(".mvpick").count();
  await page.waitForTimeout(400);
  const gone = await page.locator(".mvpick").count();
  check("a click outside fades it out rather than cutting it", fading === 1 && gone === 0, JSON.stringify({ fading, gone }));

  // A picker fading out has let go of the keyboard: G reaches the grid.
  const slow = await page.addStyleTag({ content: ".mvpick[data-state=closed] { animation-duration: 1500ms !important; }" });
  await page.getByRole("button", { name: "Add channel" }).click();
  await page.locator(".mvpick__input").waitFor();
  await page.waitForTimeout(300);
  const kindBefore = await page.locator(".mvseg [aria-pressed='true']").getAttribute("aria-label");
  await page.mouse.click(20, H - 20);
  await page.waitForTimeout(100);
  await press(page, "g");
  const stillFading = await page.locator(".mvpick").count();
  const kindAfter = await page.locator(".mvseg [aria-pressed='true']").getAttribute("aria-label");
  check(
    "a key pressed while the picker is still fading out reaches the grid",
    stillFading === 1 && kindAfter !== kindBefore,
    JSON.stringify({ stillFading, kindBefore, kindAfter }),
  );
  await page.locator(".mvpick").waitFor({ state: "detached" });
  await slow.evaluate((el) => el.remove());

  // ESPN and News were never closed (Sky was, and came back new).
  const kept = (await marks(page)).filter(([mv]) => mv === "tile:t:101" || mv === "tile:t:103");
  check(
    "no video was re-created by any of it: the streams never closed keep theirs",
    kept.length >= 1 && kept.every(([mv, mark]) => mv === mark),
    JSON.stringify(await marks(page)),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------------------------------------ reduced motion
{
  const { page, ctx, errors } = await open({ reduced: true });
  await rest(page);
  await tile(page, NEWS).click();
  const frozen = await freeze(page);
  await finish(page);
  check(
    "with reduced motion nothing moves: only opacity is animated",
    frozen.length > 0 && frozen.every((a) => a.first.transform === null && a.first.opacity !== null),
    JSON.stringify(frozen.slice(0, 3)),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);

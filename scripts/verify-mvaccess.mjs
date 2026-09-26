// Headless verify: multi-view by keyboard, to a screen reader, and at the
// window's smallest (plan 018, H4).
//
// - U1: focus comes back after the picker, to what opened it or, when that
//   went with a replace, to the tile in its place; after a tile's X, to the
//   next tile;
// - U2: the volume slider shows its focus;
// - U3: a shortcut straight after entering the tab lets the bar dim;
// - U5: a long channel name leaves "what is on" its share of the caption;
// - U6: the meter is a named image, and says so on hover when it is only
//   dashes; Grid and Focus say theirs when they drop their words;
// - U7: "Can't play this here" offers Watch in player on the card;
// - U8: "Swap for …" fits its pill on one line;
// - U9: at 1000px the bar keeps 16px from the capsule;
// - U10: a disabled picker row is muted, not faded, and the picker never
//   opens highlighting one;
// - U11: reduced motion stops overlays zooming, here and elsewhere;
// - U13: the seam's place in Tab order, its tip after a key, a row's
//   quality said once.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-mvaccess.mjs
import http from "node:http";
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const URL = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

// The stand-in proxy, by channel: "ok" streams, "hevc" is a stream this
// WebView can't decode.
const proxy = http.createServer((rq, rs) => {
  if (rq.url.includes("/hevc-")) {
    rs.writeHead(502, "Bad Gateway: can't convert HEVC: ffmpeg exited", { "Access-Control-Allow-Origin": "*" });
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
const pick = (id, label) => ({ channelId: `t:${id}`, label });

/** The tab on a seeded grid, under the IPC stub. */
async function open({ grid = [], sound = null, width = 1600, height = 900, reduced = false, seed = {}, modes = {} } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await ctx.route(/\.espn(cdn)?\.com\/|strem\.io/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ port, grid, sound, seed, modes }) => {
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
          window.__calls.push(cmd);
          if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
          if (cmd === "mv_proxy_open") {
            const id = args.url.match(/(\d+)\.ts$/)?.[1];
            return Promise.resolve(`http://127.0.0.1:${port}/mv/${modes[id] ?? "ok"}-${++n}`);
          }
          if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem("blammytv.multiviewGrid", JSON.stringify({ v: 1, data: { picks: grid, sound } }));
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
    { port: PORT, grid, sound, seed, modes },
  );
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await goTo(page, "multiview");
  await page.locator(".mvtab").waitFor();
  await page
    .waitForFunction((k) => document.querySelectorAll(".mvtile:not(.mvtile--empty)").length === k, grid.length, {
      timeout: 15_000,
    })
    .catch(() => {});
  return { page, ctx, errors };
}

const tile = (page, name) => page.locator(`.mvtile[aria-label^="${name},"]`);

const focusedLabel = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a?.getAttribute("aria-label") ?? a?.tagName ?? null;
  });

// ------------------------------------------------ U1: where focus goes
{
  // Two tiles: the fake line takes three, so there is room to add.
  const { page, ctx, errors } = await open({ grid: [pick(101, ESPN), pick(102, SKY)], sound: "t:101" });
  await tile(page, ESPN).focus();
  await page.keyboard.press("a");
  await page.locator(".mvpick__input").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".mvpick__input").waitFor({ state: "detached" }).catch(() => {});
  await page.waitForTimeout(200);
  const afterEscape = await focusedLabel(page);

  // R replaces the sound tile, whose tile goes with the replace: focus
  // lands on the one in its place.
  await page.keyboard.press("r");
  await page.locator(".mvpick__input").waitFor();
  await page.locator(".mvpick__input").fill("toon");
  await page.locator(".mvpick__row", { hasText: "Toonami Reruns" }).first().waitFor();
  await page.keyboard.press("Enter");
  await page.locator(".mvpick__input").waitFor({ state: "detached" }).catch(() => {});
  await page.waitForTimeout(300);
  const afterReplace = await focusedLabel(page);

  // Delete closes the sound tile, which has focus: the next one takes it.
  await page.keyboard.press("Delete");
  await page.waitForTimeout(400);
  const afterDelete = await focusedLabel(page);
  check(
    "focus comes back: to the tile that opened the picker, to the tile a replace put in its place, to the next tile after a close",
    /^Fake ESPN 4K,/.test(afterEscape ?? "") &&
      /^Toonami Reruns,/.test(afterReplace ?? "") &&
      /^Fake Sky Sports FHD,/.test(afterDelete ?? ""),
    JSON.stringify({ afterEscape, afterReplace, afterDelete }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------------------ U2: the slider; U3: the bar dims
{
  const { page, ctx, errors } = await open({ grid: [pick(101, ESPN), pick(102, SKY)], sound: "t:101" });
  // Keyboard focus, as Tab gives it.
  await page.keyboard.press("Shift");
  await page.locator(".mvvol__slider").focus();
  const ring = await page.locator(".mvvol__slider").evaluate((el) => ({
    visible: el.matches(":focus-visible"),
    outline: getComputedStyle(el).outlineStyle,
    width: getComputedStyle(el).outlineWidth,
  }));
  check(
    "the volume slider shows its focus",
    ring.visible && ring.outline !== "none" && ring.width !== "0px",
    JSON.stringify(ring),
  );

  // The pointer resting on the picture, the nav pill holding keyboard focus
  // as it does after arriving by keyboard, and then a shortcut: the tab is
  // being worked, and the bar dims as it would have anyway.
  await page.mouse.move(700, 450);
  await page.keyboard.press("Shift");
  await page.locator('[data-dest="multiview"]').focus();
  const pillRing = await page.evaluate(() => document.activeElement?.matches(":focus-visible") ?? false);
  await page.keyboard.press("m");
  await page.waitForTimeout(2800);
  const dimmed = await page.evaluate(() => !!document.querySelector(".mvtab.is-idle"));
  check(
    "a shortcut straight after arriving by keyboard lets the bar dim",
    pillRing && dimmed,
    JSON.stringify({ pillRing, dimmed }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------------------ U5: the caption shares its width
{
  const LONG = "Fake ESPN 4K Ultra Extended Feed With A Very Long Name";
  const { page, ctx, errors } = await open({
    grid: [pick(101, LONG), pick(102, SKY)],
    sound: "t:101",
    width: 1400,
  });
  await page
    .waitForFunction(() => document.querySelector(".mvcap .mvcap__now"), null, { timeout: 15_000 })
    .catch(() => {});
  const cap = await page.evaluate(() => {
    const c = document.querySelector(".mvcap:has(.mvcap__now)");
    if (!c) return null;
    const w = (s) => Math.round(c.querySelector(s)?.getBoundingClientRect().width ?? 0);
    return { cap: Math.round(c.getBoundingClientRect().width), name: w(".mvcap__name"), now: w(".mvcap__now") };
  });
  check(
    "a long channel name leaves what is on its share of the caption",
    !!cap && cap.now >= cap.cap * 0.3,
    JSON.stringify(cap),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------- U6: the meter, and words that go at 1000px
{
  const { page, ctx, errors } = await open({
    grid: [pick(101, ESPN), pick(102, SKY)],
    sound: "t:101",
    width: 1000,
    height: 700,
  });
  await page.waitForTimeout(1500);
  const meter = page.getByRole("img", { name: /streams? in use|of \d/ });
  const named = await meter.count();
  const label = await meter.first().getAttribute("aria-label").catch(() => null);
  /** Whether hovering `loc` brings up a tooltip saying `words`. */
  // In steps, as a hand moves: one jump can land inside the path Radix
  // keeps open to the last tooltip, and a move there opens nothing.
  const tipSays = async (loc, words) => {
    const b = await loc.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.move(b.x + b.width / 2 + 1, b.y + b.height / 2);
    return page
      .locator("[data-slot=tooltip-content]:not([data-state=closed])", { hasText: words })
      .first()
      .waitFor({ timeout: 3000 })
      .then(() => true, () => false);
  };
  // Straight from one to the next, as a hand does.
  const meterTip = label ? await tipSays(page.locator(".mvmeter"), label) : false;
  const gridTip = await tipSays(page.getByRole("button", { name: "Grid", exact: true }), "Grid (G)");
  check(
    "the meter is a named image, and at 1000px it and Grid say their words on hover",
    named === 1 && meterTip && gridTip,
    JSON.stringify({ named, label, meterTip, gridTip }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------- U7: the way on from "needs the main player"
{
  const { page, ctx, errors } = await open({
    grid: [pick(101, ESPN), pick(103, NEWS)],
    sound: "t:101",
    modes: { 103: "hevc" },
  });
  const news = tile(page, NEWS);
  await news.locator(".mvtile__state--fail").waitFor({ timeout: 15_000 }).catch(() => {});
  const title = await news.locator(".mvtile__statetitle").textContent().catch(() => null);
  const watch = news.locator(".mvtile__state--fail").getByRole("button", { name: "Watch in player" });
  const offered = await watch.count();
  await watch.click().catch(() => {});
  await page.waitForTimeout(800);
  const onGuide = await page.evaluate(
    () => document.querySelector('[data-dest="guide"]')?.getAttribute("aria-current") === "page",
  );
  check(
    "a channel multi-view can't play offers Watch in player on its card, and it goes",
    /convert/i.test(title ?? "") && offered === 1 && onGuide,
    JSON.stringify({ title, offered, onGuide }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ---------- U8: "Swap for …" on one line; U9: the bar clears the capsule
{
  const { page, ctx, errors } = await open({
    grid: [pick(101, ESPN), pick(102, SKY), pick(103, NEWS)],
    sound: "t:101",
    width: 1000,
    height: 700,
  });
  await page.waitForTimeout(1500);
  /** How far the bar's left side stops short of the capsule. */
  const clearance = () =>
    page.evaluate(() => {
      const side = document.querySelector(".mvbar__side")?.getBoundingClientRect();
      const cap = document.querySelector(".navcap")?.getBoundingClientRect();
      return side && cap ? Math.round(cap.left - side.right) : null;
    });
  const withStreams = await clearance();
  // A channel sent from the Guide to a full grid: pick the tile it replaces.
  await goTo(page, "guide");
  await page.locator('.guide__row[data-channel="t:108"] .guide__card').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to multi-view" }).click();
  await page.waitForSelector(".mvchoose", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  const picking = await clearance();
  await tile(page, SKY).hover();
  await page.waitForTimeout(300);
  const pill = await tile(page, SKY)
    .locator(".mvtile__pickword")
    .evaluate((el) => ({
      pill: Math.round(el.getBoundingClientRect().height),
      text: Math.round(el.querySelector(".mvtile__pickname")?.getBoundingClientRect().height ?? 0),
      fits: el.getBoundingClientRect().width <= el.closest(".mvtile").getBoundingClientRect().width,
    }))
    .catch(() => null);
  check(
    "at 1000px the bar keeps 16px from the capsule, with streams and while picking a tile",
    withStreams !== null && withStreams >= 16 && picking !== null && picking >= 16,
    JSON.stringify({ withStreams, picking }),
  );
  check(
    '"Swap for …" is one line in its pill, inside the tile',
    !!pill && pill.pill === 38 && pill.text > 0 && pill.text < 26 && pill.fits,
    JSON.stringify(pill),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------- U10: disabled rows, and what the picker opens on
{
  // Both Favorites already on the grid; Toonami in Recent is the one to add.
  const { page, ctx, errors } = await open({
    grid: [pick(101, ESPN), pick(102, SKY)],
    sound: "t:101",
    seed: { "blammytv.favorites": ["t:101", "t:102"], "blammytv.recents": ["t:108"] },
  });
  await page.keyboard.press("a");
  await page.locator(".mvpick__row").first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll(".mvpick__row")].map((r) => ({
      name: r.querySelector(".mvpick__nametext, .mvpick__name")?.textContent?.trim(),
      disabled: r.hasAttribute("data-disabled"),
      lit: r.hasAttribute("data-highlighted"),
      opacity: getComputedStyle(r).opacity,
      color: getComputedStyle(r.querySelector(".mvpick__name") ?? r).color,
    })),
  );
  const lit = rows.find((r) => r.lit);
  const off = rows.filter((r) => r.disabled);
  check(
    "the picker opens on a row it can add, and a disabled row is muted by colour, not faded",
    lit?.name === "Toonami Reruns" &&
      !lit.disabled &&
      off.length === 2 &&
      off.every((r) => r.opacity === "1" && r.color !== rows.find((x) => !x.disabled)?.color),
    JSON.stringify(rows),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ----------------------------------------------- U13: the small ones
{
  const { page, ctx, errors } = await open({ grid: [pick(101, ESPN), pick(102, SKY)], sound: "t:101" });
  await page.waitForTimeout(800);
  // The seam comes after the big tile it sizes (and that tile's own
  // buttons), before the small ones: DOM order is Tab order.
  const order = await page.evaluate(() => {
    const els = [...document.querySelectorAll(".mvgrid .mvtile[tabindex], .mvgrid .mvseam")];
    return els.map((e) => (e.classList.contains("mvseam") ? "seam" : e.getAttribute("aria-label").split(",")[0]));
  });
  const next = order.slice(0, 3).join(" > ");
  // Moved by a key, its tip says the key that resets it.
  await page.keyboard.press("Shift");
  await page.locator(".mvseam").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  const tipText = await page.locator(".mvseam-tip").textContent().catch(() => null);
  check(
    "Tab goes from the big tile to the seam, and after a key its tip says \\ resets it",
    next === "Fake ESPN 4K > seam > Fake Sky Sports FHD" && /\\ to reset/.test(tipText ?? "") && !/double-click/.test(tipText ?? ""),
    JSON.stringify({ next, tipText }),
  );
  // Focus on the sound tile while its ring is up: both rings, apart.
  await tile(page, ESPN).focus();
  await tile(page, ESPN).hover();
  await page.waitForTimeout(300);
  const rings = await tile(page, ESPN).evaluate((t) => ({
    outline: getComputedStyle(t).outlineWidth,
    shadow: getComputedStyle(t).boxShadow,
  }));
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/rings.png`, clip: { x: 0, y: 60, width: 1600, height: 840 } });
  check(
    "a focused sound tile shows its sound ring and a focus ring outside it",
    rings.outline === "2px" && rings.shadow !== "none",
    JSON.stringify(rings),
  );
  // A picker row says its quality once: the badge is the name's twin.
  await page.keyboard.press("a");
  await page.locator(".mvpick__input").fill("sky");
  await page.locator(".mvpick__row .badge").first().waitFor({ timeout: 5000 }).catch(() => {});
  const badge = await page.locator(".mvpick__row .badge").first().getAttribute("aria-hidden").catch(() => null);
  check("a picker row's quality badge is left out of what it reads", badge === "true", String(badge));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// ------------------------------------------------ U11: reduced motion
{
  const { page, ctx, errors } = await open({ grid: [pick(101, ESPN)], sound: "t:101", reduced: true });
  // The scale an opening overlay starts from, read as it opens.
  const scaleOf = (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el).getPropertyValue("--tw-enter-scale").trim() : null;
    }, sel);
  await page.getByRole("button", { name: "Add channel" }).click();
  await page.locator(".mvpick").waitFor();
  const picker = await scaleOf(".mvpick");
  await page.keyboard.press("Escape");
  await page.locator(".mvpick").waitFor({ state: "detached" }).catch(() => {});
  // Another of the app's overlays, under the same guard: the Guide's
  // right-click menu.
  await goTo(page, "guide");
  const row = page.locator(".guide__channel").first();
  await row.waitFor({ timeout: 15_000 }).catch(() => {});
  await row.click({ button: "right" }).catch(() => {});
  const other = await page
    .locator("[data-slot=context-menu-content]")
    .waitFor({ timeout: 3000 })
    .then(() => scaleOf("[data-slot=context-menu-content]"), () => "no menu");
  await page.keyboard.press("Escape");
  check(
    "under reduced motion an overlay fades without zooming: the picker, and another",
    (picker === "1" || picker === "") && (other === "1" || other === ""),
    JSON.stringify({ picker, other }),
  );
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
proxy.close();
console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);

// E2E: the Multi-view tab (plan 017, P1).
//
// Multi-view used to be a panel inside Sports, sharing the screen with the
// app header, with tiles that were 1fr cells letterboxing a picture
// somewhere inside. P1 makes it a tab of its own and places the tiles by
// mvLayout. What this proves, under the IPC stub verify-mvproxy uses:
// - the tab sits between Guide and Sports, with Adam's icon in both weights;
// - on the tab the header gives up its clock and Settings, and multi-view's
//   bar takes the flanks with the capsule still in the middle;
// - every picture is 16:9, nothing overlaps, nothing is under the bar, and
//   nothing is drawn over a picture at rest (the name is under it);
// - Grid and Focus move the tiles without re-creating a video or re-tuning;
// - the bar and capsule dim after two idle seconds (Adam: dim, not remove),
//   stay clickable, don't dim under the pointer, and come back on movement;
// - full screen goes to the window;
// - leaving the tab stops every tile: each proxy URL is handed back;
// - the Sports board's Multi-view button lands on the tab;
// - the size you chose is not overwritten when the line clamps it (F14).
//
// The fake panel reports max_connections 3, like Adam's line: sizes 2 and 3.
// The test Chromium has no H.264, so nothing decodes; what is asserted is
// geometry, wiring and connections, not pictures.
//
//   node scripts/fake-panel.mjs   # :8081
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-multiview.mjs
import http from "node:http";
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
const W = 1600;
const H = 900;
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

// Stands in for mvproxy.rs's loopback server, as in verify-mvproxy.
let closed = 0;
const proxy = http.createServer((rq, rs) => {
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
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
// Offline, as the dev container always is (CLAUDE.md).
await ctx.route(/\.espn(cdn)?\.com\/|strem\.io/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(
  ({ port }) => {
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
          window.__calls.push([cmd, args.url]);
          return Promise.resolve(`http://127.0.0.1:${port}/mv/tok${++n}`);
        }
        if (cmd === "mv_proxy_close") window.__calls.push([cmd, args.local]);
        if (cmd === "plugin:window|set_fullscreen") window.__calls.push([cmd, args.value]);
        if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
        return Promise.resolve(undefined);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    localStorage.setItem("btv:onboarded", "1");
    sessionStorage.setItem("btv:welcome-played", "1");
    localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
    // Chosen on a bigger line. This one allows 3.
    if (!sessionStorage.getItem("mv-seeded")) {
      sessionStorage.setItem("mv-seeded", "1");
      localStorage.setItem("blammytv.multiviewSize", JSON.stringify({ v: 1, data: 4 }));
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
  { port: PORT },
);
await page.goto(URL, { waitUntil: "domcontentloaded" });

const calls = () => page.evaluate(() => window.__calls);
const rectOf = (sel) =>
  page.evaluate(
    (s) =>
      [...document.querySelectorAll(s)].map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    sel,
  );

// ---- the tab in the capsule
const order = await page
  .locator(".navcap__row--nav [data-dest]")
  .evaluateAll((els) => els.map((e) => e.dataset.dest));
check(
  "the Multi-view tab sits between Guide and Sports",
  order.indexOf("multiview") === order.indexOf("guide") + 1 &&
    order.indexOf("sports") === order.indexOf("multiview") + 1,
  order.join(" "),
);
const box = () => page.locator('[data-dest="multiview"] svg').getAttribute("viewBox");
const offBox = await box();
await page.locator('[data-dest="multiview"]').click({ timeout: 30_000 });
await page.locator(".mvtab").waitFor();
// The screen rises 8px into place over 180ms (App's swap); measure after.
await page.waitForTimeout(400);
const onBox = await box();
check(
  "Adam's icon, regular off and filled on, the drawing at one scale",
  offBox === "7 7 16 16" && onBox === "10 7 16 16",
  `${offBox} -> ${onBox}`,
);

// ---- the header, on this tab
const vis = (sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    return e ? getComputedStyle(e).visibility : "missing";
  }, sel);
check(
  "the header gives up its clock and Settings here",
  (await vis(".header__brand")) === "hidden" && (await vis(".header__right")) === "hidden",
);
const [cap] = await rectOf(".navcap");
const [left, right] = await rectOf(".mvbar__side");
check(
  "the bar takes the flanks, the capsule still in the middle",
  !!cap && !!left && !!right &&
    Math.abs(cap.y + cap.h / 2 - (left.y + left.h / 2)) < 2 &&
    left.x + left.w < cap.x &&
    right.x > cap.x + cap.w,
  JSON.stringify({ cap, left, right }),
);

// ---- the size you chose survives the line's clamp (audit F14)
const sizes = await page.locator('.mvseg[aria-label="Tiles"] button').allTextContents();
const on = await page.locator('.mvseg[aria-label="Tiles"] button.is-on').textContent();
const stored = await page.evaluate(() => localStorage.getItem("blammytv.multiviewSize"));
check(
  "a 4 chosen elsewhere opens as 3 on a 3-connection line, and stays 4 in storage",
  sizes.join(",") === "2,3" && on === "3" && JSON.parse(stored).data === 4,
  `offered ${sizes}, on ${on}, stored ${stored}`,
);

// ---- three tiles, placed
await page.locator(".mvscreen__search").fill("fake");
const chans = page.locator(".mvscreen__chan");
await chans.first().waitFor({ timeout: 10_000 });
for (let i = 0; i < 3; i++) await chans.nth(i).click();
await page.waitForFunction(() => document.querySelectorAll("video.mvtile__video").length === 3, null, {
  timeout: 10_000,
});
// "At rest" means playing, with the Sound badge's three seconds over (P2).
// Nothing decodes here, so each tile gets the event its first frame fires.
await page.evaluate(() =>
  document.querySelectorAll("video.mvtile__video").forEach((v) => v.dispatchEvent(new Event("playing"))),
);
await page.waitForTimeout(3300);

async function geometry(label) {
  const tiles = await rectOf(".mvtile");
  const caps = await rectOf(".mvcap");
  const [stage] = await rectOf(".mvtab__stage");
  const [capsule] = await rectOf(".navcap");
  const ratio = tiles.every((t) => Math.abs((t.w * 9) / 16 - t.h) <= 1);
  check(`${label}: every picture is 16:9`, tiles.length === 3 && ratio, JSON.stringify(tiles.map((t) => [t.w, t.h])));
  const boxes = [...tiles, ...caps];
  let clash = "";
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1)
        clash = `${i} and ${j}`;
    }
  check(`${label}: nothing overlaps, captions included`, caps.length === 3 && !clash, clash);
  check(
    `${label}: everything is inside the stage, below the bar`,
    boxes.every(
      (b) =>
        b.x >= stage.x - 1 &&
        b.y >= stage.y - 1 &&
        b.x + b.w <= stage.x + stage.w + 1 &&
        b.y + b.h <= stage.y + stage.h + 1,
    ) && stage.y >= capsule.y + capsule.h,
    JSON.stringify({ stage, capsuleBottom: capsule.y + capsule.h }),
  );
  // At rest the picture is the only thing there. Every VISIBLE element on
  // the page is checked, not what elementFromPoint returns: that skips
  // anything with pointer-events off, which is exactly how a name pill is
  // drawn. Inside the tile only the video may be; outside, nothing may
  // cross into it.
  const covered = await page.evaluate(() => {
    const out = [];
    // What of an element actually shows: none if it or an ancestor is
    // invisible, and only the part every clipping ancestor lets through.
    // The capsule's shut second row has a thumb in it, parked below the
    // bar and clipped away; its bare rect would read as crossing a tile.
    const shown = (e) => {
      const cs = getComputedStyle(e);
      if (cs.visibility === "hidden" || cs.display === "none") return null;
      let { left, top, right, bottom } = e.getBoundingClientRect();
      for (let a = e; a && a !== document.documentElement; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (as.opacity === "0") return null;
        if (a !== e && (as.overflowX !== "visible" || as.overflowY !== "visible")) {
          const c = a.getBoundingClientRect();
          left = Math.max(left, c.left);
          top = Math.max(top, c.top);
          right = Math.min(right, c.right);
          bottom = Math.min(bottom, c.bottom);
        }
      }
      return right - left > 0 && bottom - top > 0 ? { x: left, y: top, width: right - left, height: bottom - top } : null;
    };
    for (const t of document.querySelectorAll(".mvtile")) {
      const r = t.getBoundingClientRect();
      for (const e of document.querySelectorAll("body *")) {
        if (e === t || e.contains(t)) continue;
        const o = shown(e);
        if (!o) continue;
        if (t.contains(e)) {
          if (e.tagName !== "VIDEO") out.push(`inside: ${e.className}`);
          continue;
        }
        if (o.x < r.x + r.width - 1 && r.x < o.x + o.width - 1 && o.y < r.y + r.height - 1 && r.y < o.y + o.height - 1)
          out.push(`over: ${e.className || e.tagName}`);
      }
    }
    return out;
  });
  check(`${label}: nothing is drawn over a picture`, covered.length === 0, covered.join(", "));
}

// Park the pointer on black so nothing is hovered.
await page.mouse.move(W - 400, H - 10);
await geometry("Focus, 3");
const focusTiles = await rectOf(".mvtile");
check(
  "three open in Focus: one big, two stacked",
  focusTiles[0].w > focusTiles[1].w * 1.5 && Math.abs(focusTiles[1].x - focusTiles[2].x) < 1,
);

// Tag the elements, switch layout, and see the same elements come back.
await page.evaluate(() =>
  document.querySelectorAll("video.mvtile__video").forEach((v, i) => (v.__tag = `v${i}`)),
);
const opensBefore = (await calls()).filter(([c]) => c === "mv_proxy_open").length;
await page.getByRole("button", { name: "Grid", exact: true }).click();
await page.waitForTimeout(300);
await page.mouse.move(W - 400, H - 10);
await geometry("Grid, 3");
const kept = await page.evaluate(() =>
  [...document.querySelectorAll("video.mvtile__video")].map((v) => v.__tag).join(","),
);
const opensAfter = (await calls()).filter(([c]) => c === "mv_proxy_open").length;
check(
  "switching layout moves the videos, it does not re-create or re-tune them",
  kept === "v0,v1,v2" && opensAfter === opensBefore,
  `tags ${kept}, opens ${opensBefore} -> ${opensAfter}`,
);
check(
  "and the switch is remembered for three",
  (await page.evaluate(() => localStorage.getItem("blammytv.multiviewLayouts")))?.includes('"3":"grid"'),
);

// ---- idle
const idleState = () =>
  page.evaluate(() => ({
    idle: document.documentElement.dataset.mvIdle === "1",
    header: getComputedStyle(document.querySelector(".header")).opacity,
    bar: getComputedStyle(document.querySelector(".mvbar")).opacity,
    cursor: getComputedStyle(document.querySelector(".mvtab")).cursor,
    // Whether the nav would take a click where it is drawn.
    navClicks: getComputedStyle(document.querySelector('[data-dest="guide"]')).pointerEvents !== "none",
  }));
await page.mouse.move(W - 420, H - 12);
await page.waitForTimeout(2600);
const rest = await idleState();
check(
  "two idle seconds and the bar and capsule dim to 0.35, still clickable, and the pointer goes",
  rest.idle && rest.header === "0.35" && rest.bar === "0.35" && rest.navClicks && rest.cursor === "none",
  JSON.stringify(rest),
);
await page.mouse.move(W - 300, H - 40);
await page.waitForTimeout(300);
const woke = await idleState();
check(
  "a movement brings them back",
  !woke.idle && woke.header === "1" && woke.bar === "1",
  JSON.stringify(woke),
);
// The pointer resting ON the bar keeps it.
const [seg] = await rectOf(".mvseg");
await page.mouse.move(seg.x + seg.w / 2, seg.y + seg.h / 2);
await page.waitForTimeout(2600);
const held = await idleState();
check("but not while the pointer rests on the bar", !held.idle && held.bar === "1", JSON.stringify(held));

// ---- full screen goes to the window
await page.getByRole("button", { name: "Full screen", exact: true }).click();
await page.waitForTimeout(300);
check(
  "full screen asks the window",
  (await calls()).some(([c, v]) => c === "plugin:window|set_fullscreen" && v === true),
);

// ---- leaving stops every tile
const opened = (await calls()).filter(([c]) => c === "mv_proxy_open").length;
await page.locator('[data-dest="guide"]').click();
const t0 = Date.now();
while (closed < opened && Date.now() - t0 < 5_000) await page.waitForTimeout(100);
const released = (await calls()).filter(([c]) => c === "mv_proxy_close").map(([, u]) => u);
check(
  "leaving the tab hands back every stream",
  opened === 3 && new Set(released).size === 3 && closed >= 3,
  `${opened} opened, ${new Set(released).size} handed back, ${closed} connections closed`,
);
await page.waitForTimeout(400);
check(
  "and the header has its clock back",
  (await vis(".header__brand")) === "visible" &&
    (await page.evaluate(() => document.documentElement.dataset.mv)) === undefined,
);
check(
  "full screen this tab turned on is turned off on the way out",
  (await calls()).some(([c, v]) => c === "plugin:window|set_fullscreen" && v === false),
);

// ---- the Sports board's button lands on the tab
await page.locator('[data-dest="sports"]').click();
await page.locator(".sports__mvbtn").click({ timeout: 20_000 });
await page.locator(".mvtab").waitFor({ timeout: 5_000 }).catch(() => {});
check(
  "the Sports board's Multi-view button goes to the tab",
  (await page.locator('[data-dest="multiview"]').getAttribute("aria-current")) === "page" &&
    (await page.locator(".mvtab").count()) === 1,
);

// ---- the narrowest window the app allows (tauri.conf: 1000x680)
{
  const words = await page.locator(".mvseg__word").first().isVisible();
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.waitForTimeout(700);
  const [capN] = await rectOf(".navcap");
  const [leftN] = await rectOf(".mvbar__side");
  const wordsN = await page.locator(".mvseg__word").first().isVisible();
  // Held, not flickering: a side that measured its own shrunk width would
  // decide the words fit, show them, measure them, and hide them again.
  const flips = await page.evaluate(async () => {
    const side = document.querySelector(".mvbar__side");
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      seen.add(side.classList.contains("is-compact"));
      await new Promise((r) => requestAnimationFrame(r));
    }
    return seen.size;
  });
  check("and holds that, frame after frame", flips === 1, `${flips} states seen in 30 frames`);
  check(
    "at 1600 the bar has its words; at 1000 it drops them and clears the capsule",
    words && !wordsN && leftN.x + leftN.w < capN.x,
    `left side ends ${Math.round(leftN.x + leftN.w)}, capsule starts ${Math.round(capN.x)}`,
  );
  await page.setViewportSize({ width: W, height: H });
  await page.waitForTimeout(700);
  check(
    "and gets them back when there is room again",
    await page.locator(".mvseg__word").first().isVisible(),
  );
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);

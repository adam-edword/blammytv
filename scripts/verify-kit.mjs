// E2E: plan 019, multi-view's look on every tab. One section per primitive
// (K1, K2, ...), each written when that primitive lands, so a later step
// that undoes an earlier one fails here rather than on someone's screen.
//
// Offline, as every harness is (CLAUDE.md): every host but localhost is
// aborted, and ESPN's scoreboard answers from a fixture.
//
//   node scripts/fake-panel.mjs   # :8081
//   node scripts/fake-aio.mjs     # :8084
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-kit.mjs
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "apps/app/src");
const STYLES = join(SRC, "styles");
const APP = process.env.APP_URL ?? "http://localhost:4173/";
const W = 1600;
const H = 900;
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

/** Every app stylesheet, comments stripped, keyed by file name. */
const sheets = Object.fromEntries(
  readdirSync(STYLES)
    .filter((n) => n.endsWith(".css"))
    .map((n) => [n, readFileSync(join(STYLES, n), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")]),
);
const MLB = readFileSync(join(SRC, "features/sports/fixtures/mlb-scoreboard.json"), "utf8");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname) && !/site\.api\.espn\.com/.test(u.hostname), (r) => r.abort());
await ctx.route(/site\.api\.espn\.com/, (r) =>
  r.fulfill({
    status: 200,
    contentType: "application/json",
    body: /baseball\/mlb/.test(r.request().url()) ? MLB : '{"events":[]}',
  }),
);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  let cb = 0;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (f) => {
      const id = ++cb;
      window["_" + id] = f;
      return id;
    },
    convertFileSrc: (p) => p,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    invoke: (cmd, args) => (cmd === "http_get" ? fetch(args.url).then((r) => r.arrayBuffer()) : Promise.resolve(undefined)),
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  localStorage.setItem(
    "blammytv.playlists",
    JSON.stringify({
      v: 1,
      data: [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" }],
    }),
  );
});
await page.goto(APP, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-dest="guide"]', { timeout: 60_000 });

/** A property of a throwaway element with these classes, and of the root. */
const probe = (className, prop) =>
  page.evaluate(
    ([cls, p]) => {
      const el = document.createElement("div");
      el.className = cls;
      document.body.appendChild(el);
      const v = getComputedStyle(el)[p];
      el.remove();
      return v;
    },
    [className, prop],
  );
/** What a token computes to, read through a property that accepts it. */
const token = (name, prop = "backgroundColor") =>
  page.evaluate(
    ([n, p]) => {
      const el = document.createElement("div");
      el.style[p] = `var(${n})`;
      document.body.appendChild(el);
      const v = getComputedStyle(el)[p];
      el.remove();
      return v;
    },
    [name, prop],
  );

// ======================================================================= K1
// The capsule's glass, the tints and the layers, as tokens.

// The glass is one recipe. The capsule and multi-view's controls read it
// from --glass, so they cannot drift apart again: they were five hand-typed
// copies of the same two lines.
{
  const glass = await token("--glass");
  const fx = await token("--glass-fx", "backdropFilter");
  const cap = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector(".navcap"));
    return { bg: s.backgroundColor, fx: s.backdropFilter };
  });
  const seg = await probe("seg", "backgroundColor");
  const icon = await probe("mvbar__icon", "backdropFilter");
  check(
    "the capsule and multi-view's controls are the same glass, from --glass",
    cap.bg === glass && seg === glass && cap.fx === fx && icon === fx && /blur\(5px\)/.test(fx),
    `glass ${glass} ${fx}; capsule ${cap.bg} ${cap.fx}; seg ${seg}; icon ${icon}`,
  );
  const copies = Object.entries(sheets)
    .filter(([n]) => n !== "tokens.css")
    .flatMap(([n, css]) => (css.match(/color-mix\(in srgb, var\(--text\) 10%, transparent\)|blur\(5px\) saturate\(1\.4\)/g) ?? []).map(() => n));
  check("  and no stylesheet types the recipe out again", copies.length === 0, copies.join(" "));
}

// A picture's ground and the chip on it are tokens too.
{
  const pic = await token("--pic");
  const tile = await probe("mvtile", "backgroundColor");
  const chip = await probe("mvchip", "backgroundColor");
  const chipTok = await token("--chip-bg");
  check(
    "a tile sits on --pic and a chip on a picture is --chip-bg",
    pic === "rgb(17, 17, 17)" && tile === pic && chip === chipTok,
    `pic ${pic}, tile ${tile}, chip ${chip} vs ${chipTok}`,
  );
}

// THE LAYERS (plan 016 3.1). Popovers above the sheet: a tooltip, menu or
// combobox opened inside Settings has to paint over it. Read from the real
// utility and the real sheet rule, so a z-50 put back in a component shows.
{
  const pop = Number(await probe("z-(--z-popover)", "zIndex"));
  const sheet = Number(await probe("modal-backdrop", "zIndex"));
  const header = Number(await page.evaluate(() => getComputedStyle(document.querySelector(".header")).zIndex));
  check(
    "popovers sit above the Settings sheet, and the sheet above the header",
    pop > sheet && sheet > header && pop === 70 && sheet === 60 && header === 20,
    `popover ${pop}, sheet ${sheet}, header ${header}`,
  );
  // Every z-index from 20 up comes from the scale. Local stacking (a caption
  // over its own picture) keeps its small numbers.
  const raw = Object.entries(sheets).flatMap(([n, css]) =>
    [...css.matchAll(/z-index:\s*(-?\d+)/g)].filter((m) => Number(m[1]) >= 20).map((m) => `${n}:${m[1]}`),
  );
  const ui = readdirSync(join(SRC, "components/ui"))
    .filter((n) => n.endsWith(".tsx"))
    .flatMap((n) =>
      [...readFileSync(join(SRC, "components/ui", n), "utf8")
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
        .matchAll(/\bz-(\d{2,})\b/g)].map((m) => `${n}:z-${m[1]}`),
    );
  check("  and every layer from 20 up is on the scale", raw.length + ui.length === 0, [...raw, ...ui].join(" "));
}

// MUTED BY COLOUR, NEVER BY OPACITY (plan 019 rule 6, plan 016 3.1). Faded
// text is the app's own word for "not available" (a disabled control), so
// a quiet label that fades reads as one. Walk every tab and Settings and
// find text whose effective opacity is between none and all at rest.
// Hidden things (0) are fine; so is anything mid-animation, disabled, or
// dimmed on purpose while idle (multi-view's bar, Adam's call).
const dimmedText = () =>
  page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      if (el.closest("[disabled],[aria-disabled='true'],[data-disabled],[inert]")) continue;
      let o = 1;
      let moving = false;
      for (let a = el; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.visibility === "hidden" || s.display === "none") o = 0;
        o *= Number(s.opacity);
        if (a.getAnimations().length) moving = true;
      }
      if (moving || o === 0 || o > 0.99) continue;
      out.push(`${el.className || el.tagName}:"${n.textContent.trim().slice(0, 24)}"@${o.toFixed(2)}`);
    }
    return out;
  });
{
  const found = [];
  for (const dest of ["guide", "sports", "home", "discover", "mylist"]) {
    await goTo(page, dest);
    await page.waitForTimeout(1800);
    await page.mouse.move(W - 4, H - 4);
    await page.waitForTimeout(600);
    for (const d of await dimmedText()) found.push(`${dest} ${d}`);
  }
  await goTo(page, "guide");
  await page.locator(".header__right button").last().click();
  await page.locator(".settings").waitFor();
  await page.waitForTimeout(900);
  for (const d of await dimmedText()) found.push(`settings ${d}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const kinds = [...new Set(found.map((f) => f.replace(/:".*$/, "")))];
  check("no text on any tab or in Settings is dimmed by opacity", found.length === 0, `${found.length}: ${kinds.join(" | ")}`);
  // And the tier that replaced the header's opacity is a real colour.
  const clock = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector(".header__clock"));
    return { o: s.opacity, c: s.color };
  });
  const faint = await token("--text-faint", "color");
  check("  the clock is the faint tier, a colour, not a 0.3 fade", clock.o === "1" && clock.c === faint, `${clock.o} ${clock.c} vs ${faint}`);
}

// ======================================================================= K2
// ONE segmented control (ui/Segmented.tsx), where there were five drawings
// of it, with a thumb that slides.
{
  const where = {};
  await goTo(page, "guide");
  await page.waitForTimeout(800);
  where.guide = await page.locator(".live-sidebar .seg").count();
  await goTo(page, "sports");
  await page.waitForTimeout(1200);
  where.sports = await page.locator(".live-sidebar .seg").count();
  await goTo(page, "guide");
  await page.locator(".header__right button").last().click();
  await page.locator(".settings").waitFor();
  await page.waitForTimeout(700);
  where.settings = await page.locator(".settings .seg").count();
  const old = await page.evaluate(() => document.querySelectorAll(".chip-tabs, .mode-rail, .season-chip").length);
  check(
    "the sidebars' rails and Settings' tabs are the one segmented control",
    where.guide === 1 && where.sports === 1 && where.settings >= 2 && old === 0,
    `${JSON.stringify(where)}, old ${old}`,
  );
  const look = await page.evaluate(() => {
    const seg = document.querySelector(".settings .seg");
    const t = seg.querySelector(".seg__thumb");
    return { bg: getComputedStyle(seg).backgroundColor, thumb: getComputedStyle(t).backgroundColor, r: getComputedStyle(seg).borderRadius };
  });
  const glass = await token("--glass");
  const on = await token("--tint-on");
  check("  in the capsule's glass, round-ended, the chosen option a 16% tint", look.bg === glass && look.thumb === on && look.r === "999px", JSON.stringify(look));

  // TABS, for a control that switches what the panel shows (016 3.4): a
  // tablist, the chosen tab the only tab stop, and the arrows move the
  // choice and the focus together.
  const tabs = page.getByRole("tablist", { name: "Settings" });
  const general = tabs.getByRole("tab", { name: "General", exact: true });
  const customize = tabs.getByRole("tab", { name: "Customize", exact: true });
  check(
    "Settings' sections are a tablist with one tab stop",
    (await general.getAttribute("aria-selected")) === "true" &&
      (await general.getAttribute("tabindex")) === "0" &&
      (await customize.getAttribute("tabindex")) === "-1",
  );
  await general.focus();
  // Sample the thumb every frame from the key press on, in the page, so the
  // reading can't miss the move or land on its overshoot by timing luck.
  const path = await page.evaluate(
    () =>
      new Promise((done) => {
        const t = document.querySelector(".settings .seg .seg__thumb");
        const xs = [t.getBoundingClientRect().left];
        document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        const t0 = performance.now();
        const tick = () => {
          xs.push(t.getBoundingClientRect().left);
          if (performance.now() - t0 < 700) requestAnimationFrame(tick);
          else done(xs);
        };
        requestAnimationFrame(tick);
      }),
  );
  const target = (await customize.boundingBox()).x;
  const from = path[0];
  const to = path.at(-1);
  // Any frame off both ends is the thumb in motion, overshoot included (the
  // spring passes the target by about 4% on its way in).
  const between = path.filter((x) => Math.abs(x - from) > 1 && Math.abs(x - to) > 1).length;
  check(
    "  the arrow moves the choice and the focus",
    (await customize.getAttribute("aria-selected")) === "true" && (await customize.evaluate((e) => e === document.activeElement)),
  );
  check(
    "  and the thumb SLIDES there, frame by frame (the thumb stays, Adam 2026-09-06)",
    between >= 4 && Math.abs(to - target) < 1.5,
    `${between} frames in motion from ${from.toFixed(1)} to ${to.toFixed(1)} (target ${target.toFixed(1)})`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);

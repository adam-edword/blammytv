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
    invoke: (cmd, args) => {
      if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
      // A tile that opens and fails: its chrome, the X included, is there in
      // every state, which is all K3 reads.
      if (cmd === "mv_proxy_open") return Promise.resolve("http://127.0.0.1:9/mv/none");
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  localStorage.setItem("btv:onboarded", "1");
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
  // K7's tiles: two films part-way (one with art, one without) and a
  // series on its second episode with the first watched.
  localStorage.setItem(
    "blammytv.watching",
    JSON.stringify({
      v: 1,
      data: [
        { id: "tt100003", title: "Fake Movie Three", at: 3, posSec: 1200, durSec: 5700, kind: "movie", art: "http://localhost:8084/bg/tt100003.png" },
        { id: "tt100004", title: "Fake Movie Four", at: 2, posSec: 600, durSec: 5700, kind: "movie" },
        { id: "tt200001", title: "Fake Series One", at: 1, episodeId: "tt200001:1:2", posSec: 2000, durSec: 5700, kind: "series" },
      ],
    }),
  );
  localStorage.setItem("blammytv.watchedEpisodes", JSON.stringify({ v: 1, data: { tt200001: ["tt200001:1:1"] } }));
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
  const icon = await page.evaluate(() => getComputedStyle(document.querySelector(".header__action")).backdropFilter);
  check(
    "the capsule, the segmented control and the gear are the same glass, from --glass",
    cap.bg === glass && seg === glass && cap.fx === fx && icon === fx && /blur\(5px\)/.test(fx),
    `glass ${glass} ${fx}; capsule ${cap.bg} ${cap.fx}; seg ${seg}; gear ${icon}`,
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
  const chip = await probe("bg-chip", "backgroundColor");
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

// ======================================================================= K3
// Buttons in multi-view's shapes, from Button's own variants.
{
  /** Every visible Button on the page, as the numbers K3 is about. Found by
   * data-variant, not data-slot: a Button inside a Hint is Radix's trigger,
   * and Radix writes its own data-slot over Button's. */
  const buttons = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("button[data-variant]")]
        .map((b) => {
          const r = b.getBoundingClientRect();
          const s = getComputedStyle(b);
          const radius = Math.max(...["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map((c) => parseFloat(s[`border${c}Radius`]) || 0));
          return {
            // A row (K10) is multi-view's picker row, 10px, not a pill.
            row: b.matches(".live-folder, .live-group"),
            v: b.dataset.variant,
            name: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 24),
            h: r.height,
            round: radius >= r.height / 2 - 0.5,
            seen: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && s.visibility !== "hidden" && Number(s.opacity) > 0,
            bg: s.backgroundColor,
          };
        })
        .filter((b) => b.seen && !b.row),
    );
  const square = [];
  const whites = {};
  // Stream's home is left out of the white-pill count on purpose: its
  // carousel shows the next film's card peeking in, Watch now and all.
  let counted = 0;
  for (const dest of ["guide", "sports", "discover", "mylist", "home"]) {
    await goTo(page, dest);
    await page.waitForTimeout(1500);
    const bs = await buttons();
    counted += bs.length;
    for (const b of bs) if (!b.round && b.v !== "link") square.push(`${dest}:${b.name}`);
    if (dest !== "home") whites[dest] = bs.filter((b) => b.v === "default").map((b) => b.name);
  }
  await goTo(page, "guide");
  await page.locator(".header__right button").last().click();
  await page.locator(".settings").waitFor();
  // General, where the pane's one pill is (K2's check left Settings on
  // Customize, and Settings remembers).
  await page.getByRole("tab", { name: "General", exact: true }).click();
  await page.waitForTimeout(800);
  for (const b of await buttons()) if (!b.round && b.v !== "link") square.push(`settings:${b.name}`);
  whites.settings = (await buttons()).filter((b) => b.v === "default").map((b) => b.name);
  const text = await token("--text");
  const pill = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".settings button[data-variant=default]")][0];
    return b ? { bg: getComputedStyle(b).backgroundColor, h: b.getBoundingClientRect().height } : null;
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check(
    "every button is round-ended, on every tab and in Settings",
    square.length === 0 && counted >= 10,
    `${counted} read; square: ${square.slice(0, 5).join(" | ")}`,
  );
  const many = Object.entries(whites).filter(([, v]) => v.length > 1);
  check(
    "  and a screen has one white pill at most, the text colour as its fill",
    many.length === 0 && pill && pill.bg === text && pill.h === 40,
    `${JSON.stringify(whites)} pill ${JSON.stringify(pill)} vs ${text}`,
  );
  // The gear is multi-view's round glass icon, read at rest.
  await page.mouse.move(W / 2, H - 4);
  await page.waitForTimeout(300);
  const gear = await page.evaluate(() => {
    const b = document.querySelector(".header__action");
    const r = b.getBoundingClientRect();
    return { w: r.width, h: r.height, bg: getComputedStyle(b).backgroundColor, r: getComputedStyle(b).borderTopLeftRadius };
  });
  check("  the Settings gear is a 40px circle of the glass", gear.w === 40 && gear.h === 40 && gear.bg === (await token("--glass")) && parseFloat(gear.r) >= 20, JSON.stringify(gear));
  // No dead hooks. The paint for these went to styles/old in v0.9.54 to 56
  // and the names were left on elements that drew nothing (two were bare
  // browser buttons).
  const dead = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory() && e.name !== "old") walk(p);
      else if (/\.(tsx|css)$/.test(e.name)) {
        const src = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
        for (const m of src.matchAll(/\b(btn-primary|btn-quiet|btn-danger|shero__btn-quiet|player__btn--glass)\b/g)) dead.push(`${e.name}:${m[1]}`);
      }
    }
  };
  walk(SRC);
  check("  and none of the dead button hooks is left", dead.length === 0, dead.slice(0, 5).join(" "));
}

// Back is one control: the round glass arrow, named Back.
{
  await goTo(page, "home");
  await page.waitForTimeout(2000);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(800);
  await page.locator(".stream-card", { hasText: "Movie" }).first().click();
  const back = page.locator(".vod-back");
  await back.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);
  const b = await back.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, name: el.getAttribute("aria-label"), text: el.textContent.trim(), bg: getComputedStyle(el).backgroundColor };
  });
  check("a film's Back is the round glass arrow, named Back, no word on it", b.w === 40 && b.h === 40 && b.name === "Back" && b.text === "" && b.bg === (await token("--glass")), JSON.stringify(b));
  await back.click();
  await page.waitForTimeout(600);
}

// Chips on pictures: a multi-view tile's actions are Button's `chip`.
{
  await goTo(page, "multiview");
  await page.waitForTimeout(800);
  const empty = page.locator(".mvtile--empty");
  if (await empty.count()) await empty.click();
  else await page.locator(".mvbar__add").click();
  await page.locator(".mvpick__input").fill("ESPN");
  await page.locator(".mvpick__row", { hasText: "ESPN" }).first().click();
  await page.locator(".mvpick__input").waitFor({ state: "detached" });
  await page.waitForTimeout(900);
  const t = await page.locator(".mvtile:not(.mvtile--empty)").first().boundingBox();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.waitForTimeout(500);
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll(".mvtile__actions button[data-variant]")].map((b) => ({ v: b.dataset.variant, bg: getComputedStyle(b).backgroundColor, h: b.getBoundingClientRect().height })),
  );
  const chipBg = await token("--chip-bg");
  check(
    "a tile's actions are chips: the dark glass, 30px",
    chips.length >= 1 && chips.every((c) => c.v === "chip" && c.bg === chipBg && c.h === 30),
    JSON.stringify(chips),
  );
  const add = await page.evaluate(() => {
    const b = document.querySelector(".mvbar__add");
    return { v: b.dataset.variant, bg: getComputedStyle(b).backgroundColor, h: b.getBoundingClientRect().height };
  });
  check("  and the bar's Add is the white pill", add.v === "default" && add.bg === (await token("--text")) && add.h === 40, JSON.stringify(add));
}

// ================================================================= K4 to K6
// LIVE, the line's count and a channel's logo, each drawn one way.
{
  await goTo(page, "guide");
  await page.waitForTimeout(1500);
  const accent = await token("--accent");
  const white = "rgb(255, 255, 255)";
  const g = await page.evaluate(() => {
    const pill = document.querySelector(".hero .live-pill");
    const cards = [...document.querySelectorAll(".guide__card")];
    const tiles = cards.map((c) => c.querySelector(".chlogo"));
    const meter = document.querySelector(".live-conns");
    return {
      pill: pill ? { text: pill.textContent.trim(), dot: getComputedStyle(pill, "::before").backgroundColor } : null,
      oldLive: document.querySelectorAll(".hero__live").length,
      cards: cards.length,
      tiles: tiles.filter(Boolean).map((t) => ({ bg: getComputedStyle(t).backgroundColor, w: t.getBoundingClientRect().width, img: !!t.querySelector("img"), letter: t.textContent.trim() })),
      meter: meter ? { isMeter: meter.classList.contains("meter"), on: meter.querySelectorAll(".meter__dashes i.is-on").length, all: meter.querySelectorAll(".meter__dashes i").length, label: meter.getAttribute("aria-label") } : null,
    };
  });
  check(
    "the Guide's LIVE is the one pill, its dot the accent",
    g.pill && g.pill.text === "LIVE" && g.pill.dot === accent && g.oldLive === 0,
    JSON.stringify(g.pill),
  );
  check(
    "every Guide channel has its logo on a 40px white tile, a lettermark on the same tile",
    g.cards > 0 && g.tiles.length === g.cards && g.tiles.every((t) => t.bg === white && t.w === 40) && g.tiles.some((t) => !t.img && t.letter.length === 1),
    `${g.cards} cards, ${JSON.stringify(g.tiles.slice(0, 3))}`,
  );
  check(
    "the Guide's line count is the meter: a dash a stream, filled for the ones in use",
    g.meter && g.meter.isMeter && g.meter.all === 3 && g.meter.on === 3 && g.meter.label === "3 of 3 streams in use",
    JSON.stringify(g.meter),
  );
  await page.locator(".header__right button").last().click();
  await page.locator(".settings").waitFor();
  await page.getByRole("tab", { name: "General", exact: true }).click();
  const rowMeter = await page
    .locator(".playlist-row .meter")
    .first()
    .getAttribute("aria-label", { timeout: 8000 })
    .catch(() => null);
  check("  and the playlist's row in Settings carries the same meter", rowMeter === "3 of 3 streams in use", String(rowMeter));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  // Sports says live in the accent too (D5): it was the only red one.
  await goTo(page, "sports");
  await page.locator(".gamepip").first().waitFor({ timeout: 15_000 }).catch(() => {});
  const pips = await page.evaluate(() => [...document.querySelectorAll(".gamepip, .gamecard__dot")].map((p) => getComputedStyle(p).backgroundColor));
  check("  and Sports' live dots are the accent, not red", pips.length > 0 && pips.every((c) => c === accent), `${pips.length}: ${[...new Set(pips)].join(" ")}`);
}

// ======================================================================= K7
// The tile: a 16:9 picture on the picture's corner, nothing on it at rest,
// progress UNDER it, the caption under that.
{
  const pic = await token("--radius-pic", "borderTopLeftRadius");
  check("the picture's corner is multi-view's 10px", pic === "10px", pic);
  await goTo(page, "home");
  const cw = page.locator(".continue-card");
  await cw.first().waitFor({ timeout: 20_000 });
  await cw.first().scrollIntoViewIfNeeded();
  await page.mouse.move(W / 2, H - 4);
  await page.waitForTimeout(500);
  const read = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".continue-card")].map((c) => {
        const p = c.querySelector(".tile__pic");
        const pr = p.getBoundingClientRect();
        const track = c.querySelector(".tile__track");
        const tr = track?.getBoundingClientRect();
        const cap = c.querySelector(".continue-card__text").getBoundingClientRect();
        const src = c.querySelector(".continue-card__sources");
        return {
          w: pr.width,
          h: pr.height,
          r: getComputedStyle(p).borderTopLeftRadius,
          track: tr ? { top: tr.top, bottom: tr.bottom, h: tr.height, fill: getComputedStyle(track.firstElementChild).backgroundColor } : null,
          picBottom: pr.bottom,
          capTop: cap.top,
          scrim: +getComputedStyle(c.querySelector(".tile__scrim")).opacity,
          chip: { o: +getComputedStyle(src).opacity, v: src.dataset.variant },
        };
      }),
    );
  const rest = await read();
  check(
    "Continue Watching is tiles: every picture exactly 16:9, one width, the picture's corner",
    rest.length === 3 && rest.every((t) => Math.abs(t.w / t.h - 16 / 9) < 0.01 && t.w === rest[0].w && t.r === "10px"),
    JSON.stringify(rest.map((t) => [Math.round(t.w), Math.round(t.h), t.r])),
  );
  const text = await token("--text");
  check(
    "  progress is a 3px white track UNDER the picture, above the caption",
    rest.every((t) => t.track && t.track.h === 3 && t.track.top >= t.picBottom && t.track.bottom <= t.capTop && t.track.fill === text),
    JSON.stringify(rest.map((t) => t.track && [t.track.h, Math.round(t.track.top - t.picBottom), t.track.fill])),
  );
  check("  nothing on the picture at rest: no scrim, no chip", rest.every((t) => t.scrim === 0 && t.chip.o === 0));
  await cw.nth(0).hover();
  await page.waitForTimeout(500);
  const hov = (await read())[0];
  check("  under the pointer the scrim comes up, and Sources is a chip", hov.scrim === 1 && hov.chip.o === 1 && hov.chip.v === "chip", JSON.stringify(hov));
  await page.mouse.move(W / 2, H - 4);

  // Posters: 2:3 still, on the picture's corner.
  const poster = await page.evaluate(() => {
    const p = document.querySelector(".stream-card__poster, .stream-card__mono");
    return p && getComputedStyle(p).borderTopLeftRadius;
  });
  check("a poster takes the picture's corner", poster === "10px", String(poster));

  // A series: episodes are tiles, watched is a full track and a check in the
  // caption, the next one up wears the sound tile's ring.
  await page.locator(".stream-card", { hasText: "Fake Series One" }).first().click();
  await page.locator(".episode-card").first().waitFor({ timeout: 15_000 });
  await page.mouse.move(W - 4, H - 4);
  await page.waitForTimeout(600);
  const accent = await token("--accent");
  const eps = await page.evaluate(() =>
    [...document.querySelectorAll(".episode-card")].map((e) => {
      const p = e.querySelector(".tile__pic");
      const pr = p.getBoundingClientRect();
      const track = e.querySelector(".tile__track");
      const fill = track.firstElementChild.getBoundingClientRect().width / track.getBoundingClientRect().width;
      const ps = getComputedStyle(p);
      return {
        ratio: pr.width / pr.height,
        r: ps.borderTopLeftRadius,
        bg: getComputedStyle(e).backgroundColor,
        border: getComputedStyle(e).borderTopColor,
        shown: getComputedStyle(track).visibility,
        fill,
        seen: !!e.querySelector("[data-slot=item-title] .episode-card__seen"),
        ring: ps.outlineStyle === "solid" ? `${ps.outlineWidth} ${ps.outlineColor}` : "none",
      };
    }),
  );
  check(
    "episodes are tiles: a 16:9 picture on the picture's corner, no box round it",
    eps.length >= 3 && eps.every((e) => Math.abs(e.ratio - 16 / 9) < 0.01 && e.r === "10px" && e.bg === "rgba(0, 0, 0, 0)" && e.border === "rgba(0, 0, 0, 0)"),
    JSON.stringify(eps.map((e) => [e.ratio.toFixed(3), e.r, e.bg])),
  );
  check("  a watched episode has a full track and a check in its caption", eps[0].shown === "visible" && eps[0].fill > 0.99 && eps[0].seen, JSON.stringify(eps[0]));
  check(
    "  the one you're part-way through shows where, and wears the ring",
    eps[1].shown === "visible" && eps[1].fill > 0.3 && eps[1].fill < 0.4 && eps[1].ring === `2px ${accent}` && !eps[1].seen,
    JSON.stringify(eps[1]),
  );
  check("  an untouched one keeps its track's place, hidden", eps[2].shown === "hidden" && eps[2].ring === "none", JSON.stringify(eps[2]));
  await page.locator(".vod-back").click();
  await page.waitForTimeout(600);

  // More like this: posters with their caption, like every other row.
  await page.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
  await page.locator(".vod-more__card").first().waitFor({ timeout: 15_000 });
  const more = await page.evaluate(() =>
    [...document.querySelectorAll(".vod-more__card")].map((c) => ({
      title: c.getAttribute("title"),
      cap: c.querySelector(".vod-more__name")?.textContent,
      r: getComputedStyle(c.querySelector(".vod-more__tilt")).borderTopLeftRadius,
    })),
  );
  check(
    "More like this: every poster has its caption under it, on the picture's corner",
    more.length > 0 && more.every((m) => m.cap === m.title && m.r === "10px"),
    JSON.stringify(more.slice(0, 2)),
  );
  await page.locator(".vod-back").click();
  await page.waitForTimeout(600);

  // The players: the Guide's preview is a tile, and the Sports theater's
  // slot, and each agrees with the number its hole is cut from.
  await goTo(page, "guide");
  await page.waitForTimeout(800);
  const prev = await page.evaluate(() => {
    const p = document.querySelector(".hero__preview");
    const s = getComputedStyle(p);
    return { r: s.borderTopLeftRadius, bg: s.backgroundColor, edge: s.borderTopWidth };
  });
  check("the Guide's preview is a tile: the picture's corner and ground, no edge", prev.r === "10px" && prev.bg === (await token("--pic")) && prev.edge === "0px", JSON.stringify(prev));
  const inv = readFileSync(join(SRC, "features/live/InvertedPlayer.tsx"), "utf8").match(/const RADIUS_CSS = (\d+)/)?.[1];
  const slotJs = readFileSync(join(SRC, "features/sports/SportsTheater.tsx"), "utf8").match(/const SLOT_RADIUS = (\d+)/)?.[1];
  const slotCss = sheets["sports.css"].match(/\.sportstheater__slot \{[^}]*border-radius: (\d+)px/)?.[1];
  check(
    "  and the numbers the video holes are cut from agree: preview 10, theater slot 10",
    inv === "10" && slotJs === "10" && slotCss === "10",
    `RADIUS_CSS ${inv}, SLOT_RADIUS ${slotJs}, .sportstheater__slot ${slotCss}`,
  );
}

// ======================================================================= K8
// Nothing here, drawn one way: multi-view's tile state is the StateCard,
// and so is every screen's; its dashed Add tile is the empty place, and so
// are Library's New list and the Guide's lanes with no listings.
{
  const readState = (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const t = el.querySelector(".state__title");
      const sub = el.querySelector(".state__sub");
      const texts = [...el.querySelectorAll("*")].filter((n) => n.childElementCount === 0 && n.textContent.trim());
      return {
        isState: el.classList.contains("state"),
        icon: !!el.querySelector(".state__icon svg, .state__icon .buffering__dot"),
        title: t?.textContent.trim(),
        weight: t && getComputedStyle(t).fontWeight,
        titleInk: t && getComputedStyle(t).color,
        subInk: sub && getComputedStyle(sub).color,
        faded: texts.filter((n) => {
          for (let e = n; e && e !== document.body; e = e.parentElement) if (+getComputedStyle(e).opacity < 1) return true;
          return false;
        }).length,
      };
    }, sel);
  const text = await token("--text", "color");
  const muted = await token("--text-muted", "color");

  // The tile K3 opened failed (its proxy answers nothing): its state.
  await goTo(page, "multiview");
  await page.locator(".mvtile__state").first().waitFor({ timeout: 20_000 }).catch(() => {});
  const tileState = await readState(".mvtile__state");
  check(
    "multi-view's tile state is the StateCard: an icon, the headline",
    tileState?.isState && tileState.icon && tileState.weight === "650" && !!tileState.title,
    JSON.stringify(tileState),
  );

  // The Guide with nothing starred.
  await goTo(page, "guide");
  await page.getByRole("tab", { name: "Favorites" }).click();
  await page.locator(".guide-empty").waitFor({ timeout: 8000 }).catch(() => {});
  const fav = await readState(".guide-empty");
  check(
    "the Guide's empty Favorites is the same card: icon, headline in the text colour, the why muted by colour",
    fav?.isState && fav.icon && fav.title === "Nothing starred yet" && fav.weight === "650" && fav.titleInk === text && fav.subInk === muted && fav.faded === 0,
    JSON.stringify(fav),
  );
  await page.getByRole("tab", { name: "Playlist" }).click();
  await page.waitForTimeout(600);

  // The empty place, three ways, one edge.
  const edge = await token("--place-edge", "borderTopColor");
  const lane = await page.evaluate(() => {
    const c = document.querySelector(".guide__cell--blank");
    if (!c) return null;
    const s = getComputedStyle(c);
    return { style: s.borderTopStyle, w: s.borderTopWidth, c: s.borderTopColor, bg: s.backgroundColor };
  });
  check(
    "a Guide lane with no listings is the empty place: the dashed edge, no fill",
    // Not the width: 1.5px rounds to a device pixel, 1px at this 1x.
    lane && lane.style === "dashed" && lane.c === edge && lane.bg === "rgba(0, 0, 0, 0)",
    JSON.stringify(lane),
  );
  await goTo(page, "mylist");
  const nl = page.locator(".library__new");
  await nl.waitFor({ timeout: 10_000 });
  await page.mouse.move(W - 4, H - 4);
  const place = await nl.evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.borderTopStyle, w: s.borderTopWidth, c: s.borderTopColor, r: s.borderTopLeftRadius, plus: !!el.querySelector(".place__plus svg") };
  });
  check(
    "  and so is Library's New list, with multi-view's plus",
    place.style === "dashed" && place.w === lane?.w && place.c === edge && place.r === "10px" && place.plus,
    JSON.stringify(place),
  );
  // Multi-view's Add tile, as its classes cascade: whether one is on screen
  // here depends on the layout K3 left, and a check that reads nothing
  // passes vacuously.
  const mvSrc = readFileSync(join(SRC, "features/live/MultiviewGrid.tsx"), "utf8");
  const mvPlace = await page.evaluate(() => {
    const el = document.createElement("button");
    el.className = "mvtile mvtile--empty place";
    document.body.appendChild(el);
    const s = getComputedStyle(el);
    const out = { style: s.borderTopStyle, c: s.borderTopColor, bg: s.backgroundColor };
    el.remove();
    return out;
  });
  check(
    "  and multi-view's Add tile is where it came from",
    mvSrc.includes('className="mvtile mvtile--empty place"') && mvPlace.style === "dashed" && mvPlace.c === edge && mvPlace.bg === "rgba(0, 0, 0, 0)",
    JSON.stringify(mvPlace),
  );

  // Stream and Discover with no addon: their states are the card too.
  const bare = await browser.newContext({ viewport: { width: W, height: H } });
  await bare.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const p2 = await bare.newPage();
  p2.on("pageerror", (e) => errors.push(String(e)));
  await p2.addInitScript(() => {
    localStorage.setItem("btv:onboarded", "1");
    sessionStorage.setItem("btv:welcome-played", "1");
  });
  await p2.goto(APP, { waitUntil: "domcontentloaded" });
  await p2.waitForSelector('[data-dest="home"]', { timeout: 60_000 });
  await goTo(p2, "home");
  const home = await p2.locator(".stream__note").evaluate((el) => ({
    state: el.classList.contains("state"),
    title: el.querySelector(".state__title")?.textContent,
    icon: !!el.querySelector(".state__icon svg"),
  })).catch(() => null);
  check(
    "Stream with no addon says so as a StateCard",
    home?.state && home.icon && home.title === "Movies and shows, one tab over from live",
    JSON.stringify(home),
  );
  await goTo(p2, "discover");
  const disc = await p2.locator(".discover--empty .state").evaluate((el) => el.querySelector(".state__title")?.textContent).catch(() => null);
  check("  and so does Discover", disc === "Something new to watch", String(disc));
  await bare.close();

  // None of the old layouts is left to drift back.
  const old = [];
  const scan = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory() && e.name !== "old") scan(p);
      else if (/\.(tsx|css)$/.test(e.name)) {
        const src = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
        for (const m of src.matchAll(/\b(vod-sources__note|sports-empty__(?:mark|title|note|action)|stream__note--dim|tourndraw__none|mvtile__state(?:title|sub|icon|acts)|mvadd__(?:plus|title|sub)|library__new-plus)\b/g))
          old.push(`${e.name}:${m[1]}`);
      }
    }
  };
  scan(SRC);
  check("  and none of the nine old layouts' classes is left", old.length === 0, old.slice(0, 5).join(" "));
}

// ================================================================= K9, K10
// Eyebrows, rows, and a title's sources as multi-view's picker lists
// channels.
{
  const eyebrowOf = (sel, pg = page) =>
    pg.evaluate((q) => {
      const el = document.querySelector(q);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { size: s.fontSize, weight: s.fontWeight, caps: s.textTransform, track: s.letterSpacing, ink: s.color, text: el.textContent.trim().slice(0, 30) };
    }, sel);
  const muted = await token("--text-muted", "color");
  const isEyebrow = (e, ink = muted) => e && e.size === "11px" && e.weight === "650" && e.caps === "uppercase" && e.track === "0.66px" && (ink === null || e.ink === ink);

  await goTo(page, "guide");
  await page.waitForTimeout(800);
  const group = await eyebrowOf(".live-group");
  check("the Guide's playlist label is an eyebrow: 11px, 650, caps, 0.06em, muted", isEyebrow(group), JSON.stringify(group));
  const meterCase = await page.evaluate(() => getComputedStyle(document.querySelector(".live-group .meter")).textTransform);
  check("  and the count beside it keeps its own case", meterCase === "none", meterCase);

  // The folders are rows: 36px, the 10px corner, the chosen one a 16% tint.
  const tintOn = await token("--tint-on");
  const folders = await page.evaluate(() =>
    [...document.querySelectorAll(".live-folder")].map((f) => {
      const s = getComputedStyle(f);
      return { h: f.getBoundingClientRect().height, r: s.borderTopLeftRadius, bg: s.backgroundColor, on: f.getAttribute("aria-current") === "true" || f.dataset.active === "true" };
    }),
  );
  check(
    "the Guide's folders are rows: 36px, the 10px corner",
    folders.length > 0 && folders.every((f) => f.h === 36 && f.r === "10px"),
    JSON.stringify(folders.slice(0, 2)),
  );
  await page.locator(".live-folder").nth(1).click();
  await page.mouse.move(W - 4, H - 4);
  await page.waitForTimeout(400);
  const chosen = await page.locator(".live-folder").nth(1).evaluate((f) => getComputedStyle(f).backgroundColor);
  check("  and the chosen one is the 16% tint, not a fill of its own", chosen === tintOn, `${chosen} vs ${tintOn}`);

  await page.locator(".header__right button").last().click();
  await page.locator(".settings").waitFor();
  await page.getByRole("tab", { name: "General", exact: true }).click();
  const sec = await eyebrowOf(".settings__group");
  check("Settings' section labels are eyebrows", isEyebrow(sec) && sec.text === "Sources", JSON.stringify(sec));
  const pl = await page.evaluate(() => {
    const r = document.querySelector(".playlist-row");
    if (!r) return null;
    const s = getComputedStyle(r);
    return { logo: !!r.querySelector(".chlogo"), border: s.borderTopWidth, r: s.borderTopLeftRadius, x: r.querySelector(".playlist-row__delete")?.dataset.variant };
  });
  check("  a playlist is a row: its logo tile, no border, the 10px corner, a glass X", pl?.logo && pl.border === "0px" && pl.r === "10px" && pl.x === "secondary", JSON.stringify(pl));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await goTo(page, "sports");
  await page.locator(".leaguepick__sport").first().waitFor({ timeout: 15_000 }).catch(() => {});
  const sport = await eyebrowOf(".leaguepick__sport");
  check("Sports' sidebar labels are the same eyebrow", isEyebrow(sport), JSON.stringify(sport));

  // A film's sources.
  await goTo(page, "home");
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, 700);
  await page.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
  await page.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
  const more = await eyebrowOf(".vod-more__title");
  const secLabel = await eyebrowOf(".srclist__sec > span", page);
  check("  More like this is an eyebrow, in the on-image ink", isEyebrow(more, null) && more.text === "More like this", JSON.stringify(more));
  const col = await page.evaluate(() => {
    const c = document.querySelector(".vod-sources").getBoundingClientRect();
    const hdr = document.querySelector(".navcap, .header")?.getBoundingClientRect();
    const labels = [...document.querySelectorAll(".srclist__sec")].map((l) => l.textContent.trim());
    const rows = [...document.querySelectorAll(".vod-source")].map((b) => {
      const s = getComputedStyle(b);
      const lines = [...b.querySelectorAll(".vod-source__lines span")].map((l) => ({ w: getComputedStyle(l).fontWeight, ink: getComputedStyle(l).color }));
      return { r: s.borderTopLeftRadius, border: s.borderTopWidth, shadow: s.boxShadow, bg: s.backgroundColor, tab: b.tabIndex, cache: b.dataset.cache, lines };
    });
    return { bottom: c.bottom, top: c.top, hdrBottom: hdr?.bottom, labels, rows, foot: document.querySelector(".srclist__foot")?.textContent.replace(/\s+/g, " ").trim() };
  });
  check(
    "the sources run to the window's bottom edge, in one glass column",
    Math.abs(col.bottom - H) <= 1 && col.top > (col.hdrBottom ?? 0),
    `top ${col.top}, bottom ${col.bottom} of ${H}`,
  );
  check(
    "  grouped by what is known about the cache, each group with its count",
    JSON.stringify(col.labels) === JSON.stringify(["Cached1", "Other sources1"]) && col.rows.map((r) => r.cache).join() === "cached,unknown",
    JSON.stringify(col.labels),
  );
  check("  and those labels are eyebrows too", isEyebrow(secLabel, null), JSON.stringify(secLabel));
  check(
    "  each source is the picker's row: flat, the 10px corner, no border or shadow",
    col.rows.every((r) => r.r === "10px" && r.border === "0px" && r.shadow === "none" && r.bg === "rgba(0, 0, 0, 0)"),
    JSON.stringify(col.rows.map((r) => [r.r, r.border, r.bg])),
  );
  check(
    "  every line shown, the first at 600 in the text colour and the rest quieter",
    col.rows.every((r) => r.lines.length >= 2 && r.lines[0].w === "600" && r.lines.slice(1).every((l) => l.w !== "600" && l.ink !== r.lines[0].ink)),
    JSON.stringify(col.rows[0].lines),
  );
  check("  and the keys and the count along the bottom", /move.*play.*2 sources/.test(col.foot ?? ""), String(col.foot));
  // One tab stop; the arrows move through it.
  check("the list is one tab stop", col.rows.filter((r) => r.tab === 0).length === 1, col.rows.map((r) => r.tab).join());
  await page.locator(".vod-source").first().focus();
  await page.keyboard.press("ArrowDown");
  const moved = await page.evaluate(() => [...document.querySelectorAll(".vod-source")].indexOf(document.activeElement));
  await page.keyboard.press("Home");
  const home = await page.evaluate(() => [...document.querySelectorAll(".vod-source")].indexOf(document.activeElement));
  check("  and ↓ moves to the next source, Home back to the first", moved === 1 && home === 0, `after ↓ ${moved}, after Home ${home}`);
  await page.locator(".vod-back").click();
  await page.waitForTimeout(500);
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);

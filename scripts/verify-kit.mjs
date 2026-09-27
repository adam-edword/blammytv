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
/** The app as every section here sees it; a second page takes it too. */
const init = () => {
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
};
await page.addInitScript(init);
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
  const icon = await page.evaluate(() => getComputedStyle(document.querySelector(".header__action[aria-label='Settings']")).backdropFilter);
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
    const b = document.querySelector(".header__action[aria-label='Settings']");
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
      title: c.getAttribute("data-hint"),
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
  // After the screen's entrance: App fades a new screen in on .app-main
  // (0 to 1), and a read taken inside that counted every line as faded. A
  // loaded board got there first (v0.10.13's merge onto main).
  const readState = async (sel) => {
    await page
      .waitForFunction(() => !document.querySelector(".app-main")?.getAnimations().some((a) => a.playState === "running"), null, { timeout: 3000 })
      .catch(() => {});
    return page.evaluate((s) => {
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
  };
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

  // Tooltips (v0.10.23; Adam: shadcn's, in the app's dark glass, "across
  // the entire app"). No element anywhere uses the browser's title. A
  // control's comes from Hint, one Radix tooltip each; a card's comes from
  // the one shared HintLayer, by data-hint, because a Radix tooltip per
  // card cost 154ms per 400 in the dev build. Both are the same bubble.
  await goTo(page, "home");
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(400);
  const openTip = () =>
    page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])').first().textContent({ timeout: 3000 }).catch(() => null);
  const hoverSlow = async (loc) => {
    await page.mouse.move(W / 2, H - 20, { steps: 4 });
    await page.waitForTimeout(200);
    const b = await loc.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  };
  const card = page.locator(".stream-card", { hasText: "Fake Movie One" }).first();
  await card.scrollIntoViewIfNeeded();
  await hoverSlow(card);
  const cardTip = await openTip();
  const cardHint = await card.getAttribute("data-hint");
  const tab = page.locator(".navcap__item:not([aria-current])").first();
  await hoverSlow(tab);
  const tabTip = await openTip();
  const tabName = (await tab.getAttribute("aria-label"))?.replace(/ \(beta\)$/, "");
  const titled = await page.evaluate(() => [...document.querySelectorAll("[title]")].map((e) => e.outerHTML.slice(0, 80)));
  check(
    "a tooltip is the kit's everywhere: a card's from the shared layer, a tab's from Hint, and nothing uses the browser's",
    cardHint === "Fake Movie One" && cardTip === "Fake Movie One" && !!tabName && tabTip === tabName && titled.length === 0,
    JSON.stringify({ cardTip, tabTip, tabName, titled: titled.slice(0, 3) }),
  );
  await page.mouse.move(W / 2, H - 20);

  // A film's sources.
  await card.click();
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
      const lines = [...b.querySelectorAll(".vod-source__lines > span")].map((l) => ({ w: getComputedStyle(l).fontWeight, ink: getComputedStyle(l).color }));
      return { r: s.borderTopLeftRadius, border: s.borderTopWidth, shadow: s.boxShadow, bg: s.backgroundColor, tab: b.tabIndex, cache: b.dataset.cache, lines };
    });
    const cs = getComputedStyle(document.querySelector(".vod-sources"));
    const half = document.querySelector(".halfstar");
    const star = (ch) => {
      const t = document.createElement("span");
      t.textContent = ch;
      half.parentElement.append(t);
      const w = t.getBoundingClientRect().width;
      t.remove();
      return w;
    };
    const stars = half && {
      text: [...document.querySelectorAll(".vod-source__lines")].map((l) => l.textContent).join("|"),
      w: half.getBoundingClientRect().width,
      outline: star("\u2606"),
      fill: getComputedStyle(half.firstElementChild).clipPath,
      overlay: half.firstElementChild.textContent,
    };
    return { stars, radius: cs.borderBottomLeftRadius, edge: cs.borderBottomWidth, bottom: c.bottom, top: c.top, hdrBottom: hdr?.bottom, labels, rows, foot: document.querySelector(".srclist__foot")?.textContent.replace(/\s+/g, " ").trim() };
  });
  // Down the window, but stopping 32px short of its edge with its corners
  // rounded (Adam, v0.10.17: "can the bottom of the panel not go to the
  // edge of the window?").
  check(
    "the sources run down the window to 32px short of its edge, in one glass column",
    Math.abs(col.bottom - (H - 32)) <= 1 && col.top > (col.hdrBottom ?? 0) && col.radius === "16px" && col.edge === "1px",
    `top ${col.top}, bottom ${col.bottom} of ${H}, corner ${col.radius}, edge ${col.edge}`,
  );
  // The fixture's "★⯪☆☆☆": the half star is drawn from ☆ and ★, since no
  // Windows font has U+2BEA. Measured here as the text the line holds and
  // the drawn star's width against a ☆'s, not by eye: this container's
  // fonts may well draw the real character.
  check(
    "  a half star in a source's line is drawn from ☆ and a ★ clipped to its left half, not the character",
    !!col.stars && !/[\u2BE8-\u2BEB]/.test(col.stars.text) && col.stars.text.includes("★☆★☆☆☆") &&
      Math.abs(col.stars.w - col.stars.outline) < 0.5 && col.stars.overlay === "★" && col.stars.fill === "inset(0px 50% 0px 0px)",
    JSON.stringify(col.stars),
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

// ================================================================ K12, K13
// Focus is multi-view's ring everywhere; keys are one chip; the header goes
// quiet over a theater as it does over multi-view.
{
  const text = await token("--text", "outlineColor");
  const ringOn = (sel) =>
    page.evaluate((q) => {
      const el = document.querySelector(q);
      if (!el) return null;
      el.focus();
      return new Promise((res) =>
        setTimeout(() => {
          const s = getComputedStyle(el);
          res({ fv: el.matches(":focus-visible"), w: s.outlineWidth, st: s.outlineStyle, c: s.outlineColor, off: s.outlineOffset });
        }, 400),
      );
    }, sel);
  await goTo(page, "guide");
  await page.keyboard.press("Tab");
  const gear = await ringOn(".header__action[aria-label='Settings']");
  const seg = await ringOn(".live-sidebar .seg__opt");
  const ok = (r, off = "2px") => r && r.fv && r.w === "2px" && r.st === "solid" && r.c === text && r.off === off;
  check("keyboard focus is multi-view's ring: 2px of the text colour, held 2px off (a Button)", ok(gear), JSON.stringify(gear));
  check("  and the same on a segmented option", ok(seg), JSON.stringify(seg));
  await goTo(page, "home");
  await page.waitForTimeout(1200);
  await page.mouse.wheel(0, 700);
  await page.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
  await page.locator(".vod-source").first().waitFor({ timeout: 15_000 });
  await page.keyboard.press("Tab");
  const row = await ringOn(".vod-source");
  check("  and inside a row, where a list that scrolls would clip it", ok(row, "-2px"), JSON.stringify(row));
  const keys = await page.evaluate(() => [...document.querySelectorAll(".srclist__foot .kbd")].map((k) => k.textContent));
  const rawKbd = ["features/live/MultiviewPicker.tsx", "features/live/MultiviewGrid.tsx"].filter((f) =>
    /<kbd>[^<]{1,3}<\/kbd>(?![^\n]*to reset)/.test(readFileSync(join(SRC, f), "utf8")),
  );
  check("keys are one chip: the source column's footer and multi-view's", keys.join(" ") === "↑ ↓ ↵" && rawKbd.length === 0, `${keys.join(" ")} ${rawKbd.join(" ")}`);
  await page.locator(".vod-back").click();
  await page.waitForTimeout(500);

  // The Guide's theater: rest, and the header drops to 0.35; move, and it's back.
  const headerOpacity = () => page.evaluate(() => +getComputedStyle(document.querySelector(".header")).opacity);
  await goTo(page, "guide");
  await page.waitForTimeout(1200);
  // Tune a channel: the theater is the player's, and nothing plays until
  // one is picked.
  await page.locator(".guide__card").first().click();
  await page.waitForTimeout(1500);
  await page.keyboard.press("t");
  let inTheater = await page.waitForFunction(() => !!document.querySelector(".live--theater"), null, { timeout: 4000 }).then(() => true, () => false);
  if (!inTheater) {
    await page.locator(".mini-overlay, .hero__preview").first().click({ force: true }).catch(() => {});
    inTheater = await page.waitForFunction(() => !!document.querySelector(".live--theater"), null, { timeout: 4000 }).then(() => true, () => false);
  }
  await page.mouse.move(W / 2, H / 2);
  await page.waitForTimeout(2800);
  const restG = await headerOpacity();
  await page.mouse.move(W / 2 + 40, H / 2 + 40);
  await page.waitForTimeout(500);
  const wokeG = await headerOpacity();
  check(
    "over the Guide's theater the header goes quiet at rest (0.35) and comes back on the pointer",
    inTheater && Math.abs(restG - 0.35) < 0.01 && wokeG === 1,
    `theater ${inTheater}, rest ${restG}, moved ${wokeG}`,
  );
  await page.keyboard.press("t");
  await page.waitForTimeout(600);
  if (await page.evaluate(() => !!document.querySelector(".live--theater"))) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }
  const outOfTheater = await page.evaluate(() => !document.querySelector(".live--theater"));
  await page.mouse.move(W / 2, H / 2);
  await page.waitForTimeout(2800);
  const restMini = await headerOpacity();
  check("  and not over the Guide itself", outOfTheater && restMini === 1, `out ${outOfTheater}, rest ${restMini}`);

  // The Sports theater.
  await goTo(page, "sports");
  const card = page.locator(".gamecard").first();
  await card.waitFor({ timeout: 15_000 }).catch(() => {});
  await card.click().catch(() => {});
  const inSports = await page.waitForFunction(() => !!document.querySelector(".sportstheater"), null, { timeout: 6000 }).then(() => true, () => false);
  await page.mouse.move(W / 2, H / 2);
  await page.waitForTimeout(2800);
  const restS = await headerOpacity();
  await page.mouse.move(W / 2 + 40, H / 2 + 40);
  await page.waitForTimeout(500);
  const wokeS = await headerOpacity();
  check(
    "  and the same over the Sports theater",
    inSports && Math.abs(restS - 0.35) < 0.01 && wokeS === 1,
    `theater ${inSports}, rest ${restS}, moved ${wokeS}`,
  );
  await page.locator(".sportstheater .vod-back, .sportstheater__back").first().click().catch(() => {});
  await page.waitForTimeout(600);
}

// ====================================================================== K11
// The palette: multi-view's picker grown to the whole app.
{
  await goTo(page, "guide");
  await page.waitForTimeout(1000);
  await page.mouse.move(W / 2, H - 4);
  const glass = await token("--glass");
  const btn = await page.evaluate(() => {
    const b = document.querySelector("button[aria-label='Search']");
    const g = document.querySelector("button[aria-label='Settings']");
    if (!b || !g) return null;
    const r = b.getBoundingClientRect();
    return { w: r.width, h: r.height, bg: getComputedStyle(b).backgroundColor, beside: g.getBoundingClientRect().left > r.right && g.getBoundingClientRect().left - r.right < 20 };
  });
  check("a round glass search button sits beside Settings", btn && btn.w === 40 && btn.h === 40 && btn.bg === glass && btn.beside, JSON.stringify(btn));

  await page.keyboard.press("Control+k");
  const pal = page.locator(".palette");
  const opened = await pal.waitFor({ timeout: 4000 }).then(() => true, () => false);
  const stayed = await page.evaluate(() => document.querySelector("[data-dest='guide']")?.getAttribute("aria-current") === "page" || !!document.querySelector(".live-main"));
  check("Ctrl+K opens the palette where you are (it used to jump to Discover)", opened && stayed, `open ${opened}, still on the Guide ${stayed}`);
  await page.keyboard.type("espn");
  await page.waitForTimeout(400);
  const secs = await page.evaluate(() => [...document.querySelectorAll(".palette .mvpick__sec")].map((e) => e.textContent));
  check("  it finds channels and what is on later, under their headings", secs.includes("Channels") && secs.includes("On later"), secs.join(", "));
  // shadcn's stock Command (v0.10.25; Adam: "i do want it to look like
  // shadcn's stock look"): the dialog rounded-xl on the popover, 448 wide;
  // the field h-8 rounded-lg; headings text-xs font-medium muted, not an
  // eyebrow; every row one 32px line, the highlighted one on muted.
  const popover = await token("--float-bg");
  const muted = await token("--surface-raised");
  const stock = await page.evaluate(() => {
    const px = (el, p) => parseFloat(getComputedStyle(el)[p]);
    const box = document.querySelector(".palette");
    const head = document.querySelector(".palette .mvpick__head");
    const sec = document.querySelector(".palette .mvpick__sec");
    const rows = [...document.querySelectorAll(".palette [role=option]")];
    const hi = document.querySelector(".palette [role=option][data-highlighted]");
    return {
      w: Math.round(box.getBoundingClientRect().width),
      radius: px(box, "borderTopLeftRadius"),
      bg: getComputedStyle(box).backgroundColor,
      field: [Math.round(head.getBoundingClientRect().height), px(head, "borderTopLeftRadius")],
      sec: [px(sec, "fontSize"), getComputedStyle(sec).fontWeight, getComputedStyle(sec).textTransform],
      rows: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))],
      hi: hi && getComputedStyle(hi).backgroundColor,
      foot: !!document.querySelector(".palette .mvpick__foot"),
    };
  });
  check(
    "  it wears shadcn's stock Command: 448 by rounded-xl on the popover, an h-8 field, 32px rows, muted highlight",
    stock.w === 448 && stock.radius === 14 && stock.bg === popover &&
      stock.field[0] === 32 && stock.field[1] === 10 &&
      stock.sec[0] === 12 && stock.sec[1] === "500" && stock.sec[2] === "none" &&
      stock.rows.length === 1 && stock.rows[0] === 32 && stock.hi === muted && !stock.foot,
    JSON.stringify(stock),
  );
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  const tuned = await page.evaluate(() => ({
    closed: !document.querySelector(".palette"),
    name: document.querySelector(".hero__channel-name")?.textContent,
    theater: !!document.querySelector(".live--theater"),
  }));
  check("  Enter on a channel tunes it in the Guide, not the theater", tuned.closed && /ESPN/.test(tuned.name ?? "") && !tuned.theater, JSON.stringify(tuned));

  // A title, from the Guide: to its page on Stream, and Back lands on Stream.
  await page.keyboard.press("Control+k");
  await pal.waitFor({ timeout: 4000 });
  await page.keyboard.type("movie one");
  await page.waitForTimeout(400);
  const films = await page.evaluate(() => [...document.querySelectorAll(".palette .mvpick__sec")].map((e) => e.textContent));
  await page.keyboard.press("Enter");
  const page1 = await page.locator(".vod-detail").waitFor({ timeout: 10_000 }).then(() => true, () => false);
  const title = await page.evaluate(() => document.querySelector(".vod-detail__title")?.textContent ?? document.querySelector(".vod-detail__logo")?.getAttribute("alt"));
  check("  and a film opens its page on Stream", films.includes("Films and series") && page1 && title === "Fake Movie One", `${films.join(", ")} → ${title}`);
  await page.locator(".vod-back").click();
  await page.waitForTimeout(1500);
  const home = await page.evaluate(() => !document.querySelector(".vod-detail") && !!document.querySelector(".media-row, .shero, .stream"));
  check("  Back from it lands on Stream's rows", home, String(home));

  // A place: Customize opens Settings on that tab.
  await page.keyboard.press("Control+k");
  await pal.waitFor({ timeout: 4000 });
  await page.keyboard.type("customize");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.locator(".settings").waitFor({ timeout: 5000 }).catch(() => {});
  const tab = await page.evaluate(() => document.querySelector(".settings [role=tab][aria-selected=true]")?.textContent);
  check("  and a place goes there: Customize opens Settings on Customize", tab === "Customize", String(tab));
  // Escape straight away: the palette, closed from the keyboard, is gone at
  // once, so the key is Settings'. (Its fading layer used to take it.)
  await page.keyboard.press("Escape");
  const closed = await page.locator(".settings").waitFor({ state: "detached", timeout: 4000 }).then(() => true, () => false);
  check("  and the Escape right after closes Settings, not the palette that already went", closed);
  if (!closed) await page.locator("button[aria-label='Close settings']").click().catch(() => {});
  await page.waitForTimeout(300);
  // The button opens it too.
  await page.locator("button[aria-label='Search']").click();
  const byButton = await pal.waitFor({ timeout: 4000 }).then(() => true, () => false);
  check("  the search button opens it too", byButton);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

// ==================================================================== Audit
// What the audit of plan 019 found (v0.10.13), each checked where it showed.
{
  // The Guide's rail: an arrow moves the choice AND the focus. Its options
  // trade words for marks, and wrapping only the unchosen ones in a tooltip
  // remounted the buttons on every move: focus fell to the page.
  await goTo(page, "guide");
  await page.waitForTimeout(1000);
  await page.mouse.move(W / 2, H - 4);
  const railTab = (name) => page.locator(`.live-sidebar [role=tab][aria-label="${name}"]`);
  await railTab("Playlist").click();
  await page.waitForTimeout(500);
  await railTab("Playlist").focus();
  const moves = [];
  for (const k of ["ArrowRight", "ArrowRight", "ArrowLeft"]) {
    await page.keyboard.press(k);
    await page.waitForTimeout(250);
    moves.push(
      await page.evaluate(() => ({
        focus: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName,
        chosen: document.querySelector(".live-sidebar [role=tab][aria-selected=true]")?.getAttribute("aria-label"),
        bubbles: [...document.querySelectorAll("[data-slot=tooltip-content]")].map((t) => t.textContent),
      })),
    );
  }
  check(
    "Audit. the Guide's rail: each arrow moves the choice, and focus goes with it",
    moves.every((m) => m.focus === m.chosen) && moves.map((m) => m.chosen).join() === "Favorites,Recents,Favorites",
    JSON.stringify(moves),
  );
  check("  and the option you left doesn't pop its label", moves.every((m) => m.bubbles.length === 0), JSON.stringify(moves.map((m) => m.bubbles)));
  await railTab("Playlist").click();
  await page.waitForTimeout(800);

  // Escape out of the palette hands focus back (it fell to the page).
  await railTab("Playlist").focus();
  await page.keyboard.press("Control+k");
  await page.locator(".palette").waitFor({ timeout: 4000 });
  await page.keyboard.press("Escape");
  await page.locator(".palette").waitFor({ state: "detached", timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(200);
  const back = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName);
  check("  Escape out of the palette puts focus back where it was", back === "Playlist", String(back));

  // A playlist's line meter clear of its name's fade (the row's fade took
  // the meter's last 14px).
  const meter = await page.evaluate(() => {
    const g = document.querySelector(".live-group");
    const n = g?.querySelector(".live-group__name");
    const m = g?.querySelector(".live-conns");
    if (!g || !n || !m) return null;
    return {
      row: getComputedStyle(g).maskImage,
      name: getComputedStyle(n).maskImage,
      nameRight: Math.round(n.getBoundingClientRect().right),
      meterLeft: Math.round(m.getBoundingClientRect().left),
    };
  });
  check(
    "  a playlist's line meter sits clear of its name's fade",
    !!meter && meter.row === "none" && /gradient/.test(meter.name) && meter.meterLeft >= meter.nameRight,
    JSON.stringify(meter),
  );

  // The palette's times follow the clock setting (it read it once).
  const laterTimes = async () => {
    await page.keyboard.press("Control+k");
    await page.locator(".palette").waitFor({ timeout: 4000 });
    await page.keyboard.type("espn");
    await page.waitForTimeout(400);
    const t = await page.evaluate(() => [...document.querySelectorAll(".palette .mvpick__sub")].map((e) => e.textContent).filter((x) => /\d:\d\d/.test(x)));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    return t;
  };
  const clockTo = async (f) => {
    await page.locator("button[aria-label='Settings']").click();
    await page.getByRole("tab", { name: "Customize", exact: true }).click();
    await page.locator(`.settings button[aria-label='${f}']`).click();
    await page.keyboard.press("Escape");
    await page.locator(".settings").waitFor({ state: "detached", timeout: 4000 }).catch(() => {});
  };
  const t12 = await laterTimes();
  await clockTo("24h");
  const t24 = await laterTimes();
  await clockTo("12h");
  check(
    "  the palette's times follow a switch to 24h without a restart",
    t12.length > 0 && t12.every((x) => /[AP]M/.test(x)) && t24.length > 0 && t24.every((x) => !/[AP]M/.test(x)),
    JSON.stringify({ t12: t12.slice(0, 2), t24: t24.slice(0, 2) }),
  );

  // Dimmed once, by colour (plan 019 rule 6): the old opacities had stayed
  // on top of the new colours.
  const dim = await page.evaluate(() => {
    const note = document.createElement("p");
    note.className = "settings__section-note settings__section-note--dim";
    const rail = document.createElement("div");
    rail.className = "sportsrail is-wrong";
    const name = document.createElement("span");
    name.className = "sportsrail__name";
    rail.appendChild(name);
    document.body.append(note, rail);
    const r = { note: getComputedStyle(note).opacity, name: getComputedStyle(name).opacity };
    note.remove();
    rail.remove();
    return r;
  });
  check("  a dimmed note and a wrong pick's name are dimmed by colour alone", dim.note === "1" && dim.name === "1", JSON.stringify(dim));

  // The Library's history: each picture in its own column. At the row's
  // 300px height every card was 533px across in a 300px column.
  await goTo(page, "mylist");
  await page.waitForTimeout(1200);
  await page.locator(".disc-grid > *", { hasText: /^Library/ }).first().click();
  await page.waitForSelector(".disc-grid .continue-card", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const hist = await page.evaluate(() =>
    [...document.querySelectorAll(".disc-grid .continue-card")].map((c) => {
      const r = c.getBoundingClientRect();
      const p = c.querySelector(".tile__pic").getBoundingClientRect();
      return { right: Math.round(r.right), picLeft: Math.round(p.left), picRight: Math.round(p.right) };
    }),
  );
  check(
    "  the Library's history: each picture fits its column, none over the next card",
    hist.length >= 2 && hist.every((h, i) => h.picRight <= h.right && (i === 0 || hist[i - 1].picRight <= h.picLeft)),
    JSON.stringify(hist),
  );

  // A title the palette opens over one Discover opened: Back, Back is
  // Discover again (the palette's hand-off had written over the return).
  await goTo(page, "discover");
  await page.waitForFunction(() => document.querySelectorAll(".disc-grid .stream-card").length > 0, null, { timeout: 20_000 });
  await page.locator(".disc-grid .stream-card", { hasText: "Fake Movie" }).first().click();
  await page.locator(".vod-detail").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800);
  // The source column's heading, for a screen reader's H.
  const head = await page.evaluate(() => [...document.querySelectorAll(".vod-sources h3")].map((h) => [h.textContent, h.className]));
  check("  a film's source column has its heading back, for a screen reader", head.length === 1 && head[0][0] === "Sources" && head[0][1] === "sr-only", JSON.stringify(head));
  await page.keyboard.press("Control+k");
  await page.locator(".palette").waitFor({ timeout: 4000 });
  await page.keyboard.type("Fake Series Two");
  await page.locator(".palette [role=option]", { hasText: "Fake Series Two" }).first().click();
  await page.waitForSelector(".season-bar", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
  // Its up-next episode, focused: the focus ring shows round the picture,
  // not the accent ring that sits in the same place.
  await page.evaluate(() => document.documentElement.style.setProperty("--accent", "rgb(255, 0, 0)"));
  const upnext = page.locator(".tile.is-next").first();
  const ring = async () =>
    page.evaluate(() => ({
      pic: getComputedStyle(document.querySelector(".tile.is-next .tile__pic")).outlineColor,
      focused: document.activeElement?.matches(".tile.is-next:focus-visible") ?? false,
    }));
  const idle = await ring();
  if (await upnext.count()) {
    await upnext.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(250);
  }
  const lit = await ring();
  await page.evaluate(() => document.documentElement.style.removeProperty("--accent"));
  check(
    "  the up-next episode, focused, shows the focus ring and not the accent over it",
    idle.pic === "rgb(255, 0, 0)" && lit.focused && lit.pic === "rgba(0, 0, 0, 0)",
    JSON.stringify({ idle, lit }),
  );
  await page.locator(".vod-back").click();
  await page.waitForTimeout(1200);
  await page.locator(".vod-back").click();
  await page.waitForTimeout(1800);
  const where = await page.evaluate(() => document.querySelector("[data-dest][aria-current=page]")?.getAttribute("data-dest"));
  check("  a title opened by the palette over one Discover opened: Back, Back is Discover", where === "discover", String(where));
  // Discover's search row stands in for the Live tabs; Stream brings them back.
  await goTo(page, "home");
  await page.waitForTimeout(600);

  // A page's state is that page's heading again (h2, as it was). Its own
  // context: storage is the context's, and taking the manifest away here
  // took it from the first page as well.
  const ctx5 = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx5.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const p5 = await ctx5.newPage();
  p5.on("pageerror", (e) => errors.push(String(e)));
  await p5.addInitScript(init);
  await p5.addInitScript(() => localStorage.removeItem("blammytv.aiostreams"));
  await p5.goto(APP, { waitUntil: "domcontentloaded" });
  await p5.waitForSelector('[data-dest="home"]', { timeout: 60_000 });
  await goTo(p5, "home");
  await p5.waitForSelector(".state--page", { timeout: 10_000 }).catch(() => {});
  const h2 = await p5.evaluate(() => [...document.querySelectorAll(".state--page .state__title")].map((t) => t.tagName));
  check("  a page's empty state is a heading", h2.length > 0 && h2.every((t) => t === "H2"), JSON.stringify(h2));
  await ctx5.close();

  // The tennis draw: both of a day's draws on one card, the day pinned. Its
  // own context, because a clock is the whole context's: pinned here, it
  // froze the first page's clock too, and goTo waits on that clock.
  const ctx6 = await browser.newContext({ viewport: { width: W, height: H } });
  const atp = JSON.parse(readFileSync(join(SRC, "features/sports/fixtures/atp-scoreboard.json"), "utf8"));
  for (const g of atp.events[0].groupings) for (const c of g.competitions) c.date = "2026-07-26T17:00Z";
  await ctx6.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname) && !/site\.api\.espn\.com/.test(u.hostname), (r) => r.abort());
  await ctx6.route(/site\.api\.espn\.com/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: /tennis\/atp/.test(r.request().url()) ? JSON.stringify(atp) : '{"events":[]}' }),
  );
  await ctx6.clock.setFixedTime(new Date("2026-07-26T16:00:00Z"));
  const p6 = await ctx6.newPage();
  p6.on("pageerror", (e) => errors.push(String(e)));
  await p6.addInitScript(init);
  await p6.addInitScript(() =>
    localStorage.setItem("blammytv.sports-follows", JSON.stringify({ v: 1, data: { leagues: ["tennis/atp"], teams: [], conferences: [] } })),
  );
  await p6.goto(APP, { waitUntil: "domcontentloaded" });
  await p6.waitForSelector('[data-dest="sports"]', { timeout: 60_000 });
  await goTo(p6, "sports");
  await p6.locator(".tourncard").first().waitFor({ timeout: 15_000 }).catch(() => {});
  await p6.locator(".tourncard").first().click();
  await p6.locator(".tourndraw").waitFor({ timeout: 8000 }).catch(() => {});
  await p6.waitForTimeout(900);
  const opened = await p6.evaluate(() => ({
    focus: document.activeElement?.getAttribute("aria-label"),
    bubbles: [...document.querySelectorAll("[data-slot=tooltip-content]")].map((t) => t.textContent),
  }));
  check(
    "  a draw opened with a click puts focus on Back without popping its label",
    opened.focus === "Back to the board" && opened.bubbles.length === 0,
    JSON.stringify(opened),
  );
  const onAll = () =>
    p6.evaluate(() => {
      const b = document.querySelector(".tourndraw__draws .seg");
      const on = b?.querySelector(".seg__opt[aria-pressed=true]");
      const t = b?.querySelector(".seg__thumb");
      return {
        chosen: on?.textContent.trim() ?? null,
        onThumb: !!on && !!t && t.getBoundingClientRect().width > 0 && Math.abs(t.getBoundingClientRect().left - on.getBoundingClientRect().left) < 1,
      };
    });
  const first = await onAll();
  await p6.locator(".tourndraw__draws .seg__opt").nth(2).click();
  await p6.waitForTimeout(400);
  await p6.locator(".tourndraw__draws .seg__opt").nth(0).click();
  await p6.waitForTimeout(500);
  const again = await onAll();
  check(
    '  its draw filter\'s thumb sits on "All", opened and chosen again',
    first.chosen === "All" && first.onThumb && again.chosen === "All" && again.onThumb,
    JSON.stringify({ first, again }),
  );
  await p6.keyboard.press("Control+k");
  await p6.locator(".palette").waitFor({ timeout: 4000 });
  await p6.keyboard.press("Escape");
  await p6.waitForTimeout(500);
  const esc = await p6.evaluate(() => ({ palette: !!document.querySelector(".palette"), draw: !!document.querySelector(".tourndraw") }));
  check("  Escape in the palette over it closes the palette, not the draw too", !esc.palette && esc.draw, JSON.stringify(esc));
  await p6.keyboard.press("Control+k");
  await p6.locator(".palette").waitFor({ timeout: 4000 });
  await p6.evaluate(() => {
    for (const t of ["mousedown", "mouseup"]) window.dispatchEvent(new MouseEvent(t, { button: 3, bubbles: true, cancelable: true }));
  });
  await p6.waitForTimeout(500);
  const mb = await p6.evaluate(() => ({ palette: !!document.querySelector(".palette"), draw: !!document.querySelector(".tourndraw") }));
  check("  and the mouse's Back closes the palette, not the draw under it", !mb.palette && mb.draw, JSON.stringify(mb));
  await ctx6.close();
}

// ================================================================== Screens
// The frames' own changes (plan 019, "Each screen"), beyond the kit.
{
  // B. The Guide: one radius for card and cell, a real tick on the ruler,
  // the programme's track between its two times.
  await goTo(page, "guide");
  await page.waitForTimeout(1200);
  const g = await page.evaluate(() => {
    const card = document.querySelector(".guide__card");
    const cell = document.querySelector(".guide__cell:not(.guide__cell--blank)");
    const tick = document.querySelector(".guide__tick");
    const meta = document.querySelector(".hero__meta");
    return {
      card: card && getComputedStyle(card).borderTopLeftRadius,
      cell: cell && getComputedStyle(cell).borderTopLeftRadius,
      tickText: tick?.textContent,
      tickSize: tick && getComputedStyle(tick).fontSize,
      tickNums: tick && getComputedStyle(tick).fontVariantNumeric,
      tickLine: tick && getComputedStyle(tick, "::before").width,
      order: meta ? [...meta.children].map((c) => c.className.split(" ")[0]) : [],
    };
  });
  check(
    "the Guide: card and cell share the 10px corner",
    g.card === "10px" && g.cell === "10px",
    `card ${g.card}, cell ${g.cell}`,
  );
  check(
    "  the ruler is 12px tabular times after a 1px tick, not a typed bar",
    !/\|/.test(g.tickText ?? "|") && g.tickSize === "12px" && /tabular-nums/.test(g.tickNums ?? "") && g.tickLine === "1px",
    JSON.stringify({ text: g.tickText, size: g.tickSize, line: g.tickLine }),
  );
  check(
    "  and the programme's track sits between its two times",
    g.order.join(" ").endsWith("hero__time hero__bar hero__time"),
    g.order.join(" "),
  );

  // C. Stream: the hero's meta takes the middle dot.
  await goTo(page, "home");
  await page.waitForTimeout(1500);
  const meta = await page.evaluate(() => document.querySelector(".shero__card:not([inert]) .shero__meta, .shero__meta")?.textContent ?? "");
  check("Stream: the hero's meta is joined with \" · \"", / · /.test(meta) && !/ {2,}/.test(meta), JSON.stringify(meta));

  // F. Sports: the board's tools on one row beside Today's Games.
  await goTo(page, "sports");
  await page.locator(".sports__head--today").waitFor({ timeout: 15_000 }).catch(() => {});
  const f = await page.evaluate(() => {
    const head = document.querySelector(".sports__head--today");
    if (!head) return null;
    const h = head.querySelector(".sports__title").getBoundingClientRect();
    const mv = head.querySelector(".sports__mvbtn")?.getBoundingClientRect();
    const early = head.querySelector(".sports__morebtn")?.getBoundingClientRect();
    return {
      mv: !!mv,
      early: !!early,
      beside: !!mv && !!early && mv.left > h.right && early.left > mv.right && Math.abs(mv.top - early.top) < 1,
      level: !!mv && Math.abs((mv.top + mv.bottom) / 2 - (h.top + h.bottom) / 2) < 8,
    };
  });
  check(
    "Sports: Multi-view and Show earlier days on one row beside Today's Games",
    f && f.mv && f.early && f.beside && f.level,
    JSON.stringify(f),
  );

  // G. Settings: fields are 40px, a tint, no edge.
  await page.locator(".header__right button[aria-label='Settings']").click();
  await page.locator(".settings").waitFor();
  await page.getByRole("tab", { name: "General", exact: true }).click();
  const field = await page.evaluate(() => {
    const i = document.querySelector(".settings .settings-input");
    const s = getComputedStyle(i);
    return { h: i.getBoundingClientRect().height, edge: s.borderTopColor, r: s.borderTopLeftRadius };
  });
  check(
    "Settings: a field is 40px, the 10px corner, no edge (it measured 28px in its column)",
    field.h === 40 && field.r === "10px" && field.edge === "rgba(0, 0, 0, 0)",
    JSON.stringify(field),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

// E. A series with more seasons than fit (Adam's, v0.10.11): the bar keeps
// its height and its options their width, the wheel scrolls it rather than
// the page, and the edge with more past it fades. A fresh page with the
// fake's 2 seasons swapped for Specials and 24 of 14 episodes each, so the
// page overflows the way a real long show's does.
{
  const p3 = await ctx.newPage();
  p3.on("pageerror", (e) => errors.push(String(e)));
  await p3.addInitScript(init);
  await p3.route(/localhost:8084\/(.*\/)?meta\/series\/tt200001/, async (r) => {
    const res = await r.fetch();
    const body = await res.json();
    const videos = [];
    for (let s = 0; s <= 24; s++)
      for (let e = 1; e <= 14; e++)
        videos.push({ id: `tt200001:${s}:${e}`, season: s, episode: e, name: `S${s}E${e}`, released: "2024-01-01T00:00:00Z" });
    body.meta.videos = videos;
    return r.fulfill({ response: res, json: body });
  });
  await p3.goto(APP, { waitUntil: "domcontentloaded" });
  await p3.waitForSelector('[data-dest="home"]', { timeout: 60_000 });
  await goTo(p3, "home");
  await p3.waitForTimeout(1500);
  await p3.mouse.wheel(0, 700);
  await p3.locator(".stream-card", { hasText: "Fake Series One" }).first().click();
  await p3.waitForFunction(() => document.querySelectorAll(".season-bar .seg__opt").length >= 25, null, { timeout: 15_000 }).catch(() => {});
  await p3.waitForTimeout(800);
  const bar = await p3.evaluate(() => {
    const s = document.querySelector(".season-bar");
    if (!s) return null;
    const opts = [...s.querySelectorAll(".seg__opt")];
    const rs = opts.map((o) => o.getBoundingClientRect());
    const list = document.querySelector("[data-slot=item-group]")?.getBoundingClientRect();
    return {
      n: opts.length,
      h: s.getBoundingClientRect().height,
      optH: rs[0].height,
      squeezed: opts.filter((o) => o.scrollWidth > o.clientWidth + 1).length,
      overlap: rs.some((r, i) => i > 0 && r.left < rs[i - 1].right - 0.5),
      below: list ? Math.round(list.top - s.getBoundingClientRect().bottom) : null,
      scrolls: s.scrollWidth > s.clientWidth,
      more: s.dataset.more ?? "",
    };
  });
  check(
    "E. many seasons: the bar keeps its height and each season its width",
    bar && bar.n >= 25 && bar.h >= bar.optH + 8 && bar.squeezed === 0 && !bar.overlap && bar.below >= 20,
    JSON.stringify(bar),
  );
  check("  it scrolls sideways, and the far edge fades", bar?.scrolls && bar.more === "end", JSON.stringify(bar && { scrolls: bar.scrolls, more: bar.more }));
  const box = await p3.locator(".season-bar").boundingBox();
  const pageTop = () => p3.evaluate(() => document.querySelector(".vod-detail__body--episodes").scrollTop);
  const top0 = await pageTop();
  await p3.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p3.mouse.wheel(0, 240);
  await p3.waitForTimeout(400);
  const after = await p3.evaluate(() => {
    const s = document.querySelector(".season-bar");
    return { left: s.scrollLeft, max: s.scrollWidth - s.clientWidth, more: s.dataset.more };
  });
  check(
    "  the wheel over it scrolls the seasons, not the page",
    after.left >= Math.min(200, after.max) - 1 && after.left > 0 && (await pageTop()) === top0 && after.more !== "end",
    JSON.stringify({ ...after, page: await pageTop(), was: top0 }),
  );
  // A resize leaves it where the wheel put it (it used to pull the track
  // back to the chosen season).
  await p3.setViewportSize({ width: W - 100, height: H });
  await p3.waitForTimeout(600);
  const kept = await p3.evaluate(() => document.querySelector(".season-bar").scrollLeft);
  await p3.setViewportSize({ width: W, height: H });
  await p3.waitForTimeout(400);
  check("  and a resize leaves it where you wheeled it", Math.abs(kept - after.left) <= 1, JSON.stringify({ wheeled: after.left, resized: kept }));

  // A far season, then another show from the palette: the new show's own
  // first season, chosen, with the thumb on it and the track at its start.
  // The page was reused, so it kept the last show's season (clamped to
  // this one's last) and a thumb beyond both its options.
  await p3.locator(".season-bar .seg__opt", { hasText: /^Season 20$/ }).first().click();
  await p3.waitForTimeout(500);
  await p3.keyboard.press("Control+k");
  await p3.locator(".palette").waitFor({ timeout: 4000 });
  await p3.keyboard.type("Fake Series Two");
  await p3.locator(".palette [role=option]", { hasText: "Fake Series Two" }).first().click();
  await p3.waitForFunction(() => /Two/.test(document.querySelector(".vod-detail__title")?.textContent ?? ""), null, { timeout: 10_000 }).catch(() => {});
  await p3.waitForTimeout(1200);
  const other = await p3.evaluate(() => {
    const b = document.querySelector(".season-bar");
    const on = b?.querySelector(".seg__opt[aria-pressed=true]");
    const t = b?.querySelector(".seg__thumb");
    return {
      title: document.querySelector(".vod-detail__title")?.textContent,
      opts: b?.querySelectorAll(".seg__opt").length,
      chosen: on?.textContent?.trim() ?? null,
      onThumb: !!on && !!t && Math.abs(t.getBoundingClientRect().left - on.getBoundingClientRect().left) < 1,
      left: b?.scrollLeft,
    };
  });
  check(
    "  another show from the palette opens on its own first season, the thumb on it",
    other.opts === 2 && other.chosen === "Season 1" && other.onThumb && other.left === 0,
    JSON.stringify(other),
  );
  await p3.close();
}

// ======================================================================= M2
// ROADMAP M2, finishing plan 014's primitives: one block per step.
{
  // The league picker's rule is shadcn's Separator (v0.10.29), the one place
  // a hand-drawn line did its job. It has to be the same line: 1px of the
  // hairline colour, the picker's full width, 2px clear of either side, and
  // still a separator to a screen reader, as the <hr> was.
  await goTo(page, "sports");
  await page.locator(".leaguepick__rule").waitFor({ timeout: 15_000 }).catch(() => {});
  const rule = await page.evaluate(() => {
    const el = document.querySelector(".leaguepick__rule");
    if (!el) return null;
    const s = getComputedStyle(el);
    const p = getComputedStyle(el.parentElement);
    const inner = el.parentElement.clientWidth - parseFloat(p.paddingLeft) - parseFloat(p.paddingRight);
    return {
      slot: el.dataset.slot,
      role: el.getAttribute("role"),
      h: el.getBoundingClientRect().height,
      w: Math.round(el.getBoundingClientRect().width),
      box: Math.round(inner),
      bg: s.backgroundColor,
      m: `${s.marginTop} ${s.marginBottom}`,
    };
  });
  const hair = await token("--border");
  check(
    "M2. the league picker's rule is the Separator: 1px of the hairline, full width, 2px clear",
    rule?.slot === "separator" && rule.role === "separator" && rule.h === 1 && rule.w === rule.box && rule.bg === hair && rule.m === "2px 2px",
    JSON.stringify({ ...rule, hair }),
  );

  // RowScroller and Card live in ui/ (v0.10.31), and ContinueCard in its own
  // file: a screen that exports primitives is why "redo one screen" kept
  // touching three. So no file imports a screen's file but App, which mounts
  // them. Read from the source, so a new cross-screen import fails here.
  const crossed = [];
  const scan = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) scan(p);
      else if (/\.tsx?$/.test(e.name) && !p.endsWith(join("app", "App.tsx")))
        for (const m of readFileSync(p, "utf8").matchAll(/from\s+"([^"]*\/\w+Screen)"/g))
          crossed.push(`${p.slice(SRC.length + 1)} <- ${m[1]}`);
    }
  };
  scan(SRC);
  check("M2. no screen imports another screen's file: the rows and cards are in ui/", crossed.length === 0, crossed.join(" | ") || "only App mounts screens");
  // And every screen that draws rows still draws them, cards and all.
  const rows = {};
  for (const dest of ["home", "discover", "mylist", "sports"]) {
    await goTo(page, dest);
    await page.locator(".media-row__viewport").first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(600);
    rows[dest] = await page.evaluate(() => ({
      rows: document.querySelectorAll(".media-row__viewport").length,
      posters: document.querySelectorAll(".stream-card").length,
      cw: document.querySelectorAll(".media-row__viewport .continue-card").length,
    }));
  }
  check(
    "  and Stream, Discover, Library and Sports still draw their rows: posters, Continue Watching, the board's row",
    rows.home.rows > 1 && rows.home.posters > 0 && rows.home.cw === 3 && rows.discover.rows > 0 && rows.discover.posters > 0 && rows.mylist.cw === 3 && rows.sports.rows > 0,
    JSON.stringify(rows),
  );
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);

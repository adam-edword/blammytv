// Headless verify: Stream's shelf hero (plan 031) against the fake addon
// (scripts/fake-aio.mjs, :8084). One 16:9 card in focus and 2:3 posters at its
// height; the focused card opens the title, a poster slides in, ← → and a drag
// move the shelf; the logo only fades; the details sit under the card on the
// PAGE. verify-stream keeps the hero's older checks (tab stops, autoplay with
// focus, the art fading in, the header over the picture); this file has the
// geometry, the motion and the gestures.
//
// Run: node scripts/fake-aio.mjs; pnpm build + preview (:4173);
//      PW_FROM=<dir>/x.js node scripts/verify-shero.mjs
import { createRequire } from "node:module";
import { goTo } from "./nav-settle.mjs";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const seed = () => {
  // Seeded, as screens.mjs does: the hero's order is a shuffle, and a draw
  // that put a title with no poster and no synopsis first crashed two checks.
  let n = 42;
  Math.random = () => {
    n = (n + 0x6d2b79f5) | 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  sessionStorage.setItem("btv:welcome-played", "1");
};
/** A context that reaches nothing but this machine. Real motion unless asked,
 * every title gets a logo (the fake's own metas have none), and a picture
 * whose address matches `abort` fails to load (a hero pick always has a
 * backdrop, so a missing one is a failed one). */
const context = async ({ width = 1440, height = 900, reduced = false, abort = [], logo = true, lag = null } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? "reduce" : "no-preference" });
  await ctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
  // `lag.ms` holds every card picture back that long (a slow network): set it
  // once the shelf is at rest, so only a picture first asked for mid-move is late.
  if (lag)
    await ctx.route(/localhost:8084\/(poster|bg)\/(?!logo)/, async (r) => {
      if (lag.ms) await new Promise((res) => setTimeout(res, lag.ms));
      await r.continue().catch(() => {});
    });
  for (const re of abort) await ctx.route(re, (r) => r.abort());
  if (logo)
    await ctx.route(/localhost:8084\/meta\//, async (r) => {
      const res = await r.fetch();
      const json = await res.json();
      if (json.meta) json.meta.logo = "http://localhost:8084/poster/logo.png";
      await r.fulfill({ response: res, json });
    });
  return ctx;
};
const openStream = async (ctx, { mouse = [700, 320], loaded = true } = {}) => {
  const p = await ctx.newPage();
  await p.addInitScript(seed);
  await p.goto("http://localhost:4173/");
  await goTo(p, "home"); // not a bare click: the capsule slides at launch (CLAUDE.md)
  await p.waitForSelector(".shero__card--active .shero__mark", { timeout: 20_000, state: "attached" });
  if (loaded) await p.waitForFunction(() => document.querySelector(".shero__card--active .shero__art")?.hasAttribute("data-loaded"), null, { timeout: 10_000 });
  await p.waitForTimeout(400); // the animReady frames
  if (mouse) await p.mouse.move(...mouse); // over the hero: no autoplay under a check
  return p;
};
const active = (p) => p.locator(".shero__card--active").getAttribute("aria-label");
/** The poster right of the focused card. */
const target0 = (p) => p.locator(".shero__card--active + .shero__card");
const labels = (p) => p.locator(".shero__card").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
const rects = (p, sel) =>
  p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => {
    const r = e.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  }), sel);
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

// ------------------------------------------------------------ the geometry
{
  const ctx = await context();
  const p = await openStream(ctx);
  const cards = await rects(p, ".shero__card");
  const on = (await rects(p, ".shero__card--active"))[0];
  const posters = cards.filter((c) => !near(c.w, on.w, 2));
  // A Continue Watching card, built where the page builds it, is the unit.
  const cw = await p.evaluate(() => {
    const host = document.querySelector(".stream");
    const card = document.createElement("div");
    card.className = "continue-card";
    card.innerHTML = '<span class="tile__pic"></span>';
    host.appendChild(card);
    const r = card.querySelector(".tile__pic").getBoundingClientRect();
    card.remove();
    return { w: r.width, h: r.height };
  });
  check(
    "the focused card is 16:9 and 1.97x a Continue Watching card, the posters 2:3, all one height",
    near(cw.w, 533.3, 0.5) && near(on.w, cw.w * 1.96875) && near(on.h * 16, on.w * 9, 1) && posters.length >= 4 &&
      posters.every((c) => near(c.w * 3, c.h * 2, 1) && near(c.h, on.h, 0.5)),
    JSON.stringify({ cw, on: [on.w, on.h], posters: posters.map((c) => [c.w, c.h]) }),
  );
  const prev = cards.filter((c) => c.l < on.l);
  check(
    "a poster peeks in before the focused card, and the next ones follow a 16px gap apart",
    prev.length >= 1 && prev.at(-1).r > 0 && near(cards.find((c) => c.l > on.l).l - on.r, 16, 0.5),
    JSON.stringify({ peek: prev.at(-1)?.r, gap: cards.find((c) => c.l > on.l).l - on.r }),
  );
  await ctx.close();
}
{
  // A narrow window: capped at 80vw, with a poster still beside the card.
  const ctx = await context({ width: 1000, height: 700 });
  const p = await openStream(ctx, { mouse: [500, 250] });
  const on = (await rects(p, ".shero__card--active"))[0];
  const next = (await rects(p, ".shero__card")).find((c) => c.l > on.l);
  check(
    "in a narrow window the focused card stops at 80vw and a poster still shows beside it",
    near(on.w, 800, 1) && next.l < 1000 - 100, // at least 100px of the poster is on screen
    JSON.stringify({ card: on.w, next: [next.l, next.r] }),
  );
  await ctx.close();
}

// ----------------------------------------- one left edge, rows to the window
{
  const ctx = await context();
  const p = await openStream(ctx);
  const gut = Math.max(28, 0.033 * 1440);
  const on = (await rects(p, ".shero__card--active"))[0];
  const info = (await rects(p, ".shero__info"))[0];
  const row = await p.evaluate(() => {
    const s = [...document.querySelectorAll(".media-row__scroller")].find((e) => e.scrollWidth > e.clientWidth + 400);
    s.dataset.probe = "1";
    const title = s.closest(".media-row").querySelector(".media-row__title").getBoundingClientRect();
    const vp = s.parentElement.getBoundingClientRect();
    const cardsAt = () => [...s.querySelectorAll(".stream-card")].map((c) => c.getBoundingClientRect());
    const first = cardsAt()[0];
    // Half the first card past the window's edge, whatever a poster's width.
    s.scrollLeft = first.left + first.width / 2;
    const slid = cardsAt().some((c) => c.left < 0 && c.right > 0);
    s.scrollLeft = s.scrollWidth;
    const last = cardsAt().at(-1);
    return { vp: [vp.left, vp.right], title: title.left, first: first.left, slid, last: last.right };
  });
  check(
    "a row spans the whole window: the scroller runs 0 to the window's edge",
    near(row.vp[0], 0, 0.5) && near(row.vp[1], 1440, 0.5),
    JSON.stringify(row.vp),
  );
  check(
    "Stream has one left edge: the focused card, its details, a row's title and its first card start on the gutter",
    [on.l, info.l, row.title, row.first].every((x) => near(x, gut, 1)),
    JSON.stringify({ gut, card: on.l, info: info.l, title: row.title, first: row.first }),
  );
  check(
    "and a row scrolls on to the window's edge, not the gutter: a card slides past 0, the last ends a gutter short",
    row.slid && near(row.last, 1440 - gut, 1.5),
    JSON.stringify({ slid: row.slid, last: row.last }),
  );
  await ctx.close();
}

// -------------------------------------------------------- a grow, frame by frame
{
  const ctx = await context();
  const p = await openStream(ctx);
  const before = await active(p);
  const trackMs = await p.locator(".shero__track").evaluate((e) => getComputedStyle(e).transitionDuration);
  // The card to the right of the focused one, sampled every frame as it grows.
  // The pointer rests on it first, as it does before any real click. The
  // first hover lifts a card onto its own layer (the tilt), which a software
  // rasteriser pays for in the frames right after; counting those as the
  // grow's starved the early frames.
  await target0(p).hover();
  await p.waitForTimeout(800);
  await p.evaluate(() => {
    const c = document.querySelector(".shero__card--active").nextElementSibling;
    window.__s = [];
    const t0 = performance.now();
    const tick = () => {
      const r = c.getBoundingClientRect();
      const mark = c.querySelector(".shero__mark");
      // Layout boxes, not the screen's: the card under the pointer leans and
      // lifts 1.03 (the tilt), which is meant; these are about the sizes.
      window.__s.push({
        t: performance.now() - t0,
        cw: r.width,
        lw: mark.offsetWidth,
        lh: mark.offsetHeight,
        lx: mark.offsetLeft,
        lo: Number(getComputedStyle(mark).opacity),
        pw: c.querySelector(".shero__layer--p").offsetWidth,
        bw: c.querySelector(".shero__layer--b").offsetWidth,
      });
      if (performance.now() - t0 < 1100) requestAnimationFrame(tick);
    };
    tick();
  });
  const target = p.locator(".shero__card--active + .shero__card");
  const slid = await target.getAttribute("aria-label");
  await target.click();
  await p.waitForTimeout(1200);
  const s = await p.evaluate(() => window.__s);
  const spread = (k) => Math.max(...s.map((x) => x[k])) - Math.min(...s.map((x) => x[k]));
  const widths = new Set(s.map((x) => Math.round(x.cw / 20)));
  check(
    "the card really grows frame by frame (and the track's transition is the 620ms one)",
    // 10 frames in 1.2s proves a glide and not a jump, on a slow CI runner too.
    s.length >= 10 && widths.size >= 6 && s[0].cw < 400 && near(s.at(-1).cw, 1050, 1) && trackMs === "0.62s",
    JSON.stringify({ frames: s.length, from: s[0].cw, to: s.at(-1).cw, distinct: widths.size, trackMs }),
  );
  check(
    "the logo's box is the same size at every moment of the grow, sized from the full card",
    spread("lw") < 0.5 && spread("lh") < 0.5 && near(s.at(-1).lw, 0.46 * 1050, 1) && near(s.at(-1).lh, 0.34 * 590.625, 1) && spread("lx") < 0.5,
    JSON.stringify({ w: [Math.min(...s.map((x) => x.lw)), Math.max(...s.map((x) => x.lw))], h: [Math.min(...s.map((x) => x.lh)), Math.max(...s.map((x) => x.lh))], x: spread("lx") }),
  );
  const early = s.filter((x) => x.t < 300);
  check(
    "and it only fades: nothing of it shows until the card is past 55% of the grow, then it is fully in",
    early.length > 5 && early.every((x) => x.lo < 0.01) && s.at(-1).lo === 1,
    JSON.stringify({ early: Math.max(...early.map((x) => x.lo)), end: s.at(-1).lo }),
  );
  check(
    "the poster layer is as wide as a poster, and the 16:9 layer as wide as the focused card, throughout the grow",
    spread("pw") < 0.5 && near(s[0].pw, 393.75, 0.5) && spread("bw") < 0.5 && near(s[0].bw, 1050, 0.5),
    JSON.stringify({ pw: [s[0].pw, spread("pw")], bw: [s[0].bw, spread("bw")] }),
  );
  check(
    "a click on a poster slides it into focus and does not open the title",
    (await active(p)) === slid && slid !== before && (await p.locator(".vod-detail").count()) === 0,
    JSON.stringify({ before, slid, now: await active(p) }),
  );
  await ctx.close();
}

// ------------------------------------------------ moving more than one card
// The recording's bugs: a jump of several cards unmounted the shrinking card
// and left the peek empty, mounted cards in view with no picture, a poster
// and the 16:9 art side by side with a hard edge, and the glow lit round the
// wrong card. A per-frame watcher in the page sees all of it; the shelf is
// at rest and every picture loaded before it starts.
const rest = (p) =>
  p.waitForFunction(
    () => {
      const imgs = [...document.querySelectorAll(".shero__card img.shero__art, .shero__card img.shero__poster")];
      return imgs.length > 4 && imgs.every((i) => i.hasAttribute("data-loaded"));
    },
    null,
    { timeout: 10_000 },
  );
/** Starts the watcher. Every frame it checks, for the cards (`.shero__card`):
 *  - gone: one that was in view the frame before is out of the DOM now;
 *  - popped: one that enters the view with its poster not decoded, or the
 *    focused one without its 16:9 art decoded;
 *  - holes: the window's left or right edge is not covered by any card;
 *  - jump: a card moved faster than 14px/ms (the slide's own top speed is
 *    about 10, a three-card jump with the card beside it shrinking), which is
 *    a rebase, not motion;
 *  - glow: the copies behind (`.shero__glowcard`) are the same cards in the
 *    same order at the same left and width (the largest gap is kept). */
const watch = (p) =>
  p.evaluate(() => {
    const vw = innerWidth;
    const w = (window.__w = { frames: 0, gone: [], popped: [], holes: [], jump: 0, glowL: 0, glowW: 0, mism: 0, stop: false, oldGoneW: null, old: document.querySelector(".shero__card--active"), seen: 0 });
    const t0 = performance.now();
    let seen = new Set();
    let prev = new Map();
    let oldW = 0;
    let last = t0;
    const tick = (now) => {
      const cards = [...document.querySelectorAll(".shero__card")];
      const rs = cards.map((c) => c.getBoundingClientRect());
      const at = Math.round(now - t0);
      for (const n of seen) if (!n.isConnected) w.gone.push(`${n.getAttribute("aria-label")}@${at}`);
      if (w.oldGoneW === null && !w.old.isConnected) w.oldGoneW = oldW;
      if (w.old.isConnected) oldW = w.old.getBoundingClientRect().width;
      const inView = new Set();
      const next = new Map();
      cards.forEach((c, i) => {
        const r = rs[i];
        next.set(c, r.left);
        if (r.right > 0 && r.left < vw) {
          inView.add(c);
          const poster = c.querySelector(".shero__poster");
          if (w.frames > 0 && !seen.has(c) && poster && !poster.hasAttribute("data-loaded")) w.popped.push(`${c.getAttribute("aria-label")} poster@${at}`);
        }
        const was = prev.get(c);
        if (was !== undefined) { const ex = Math.abs(r.left - was) - 14 * (now - last); if (ex > w.jump) w.jumpAt = `${c.getAttribute("aria-label")} ${Math.round(r.left - was)}px in ${Math.round(now - last)}ms@${at}`; w.jump = Math.max(w.jump, ex); }
      });
      const on = document.querySelector(".shero__card--active");
      const art = on?.querySelector(".shero__art");
      if (w.frames > 0 && art && !art.hasAttribute("data-loaded")) w.popped.push(`${on.getAttribute("aria-label")} art@${at}`);
      if (Math.min(...rs.map((r) => r.left)) > 0 || Math.max(...rs.map((r) => r.right)) < vw) w.holes.push(at);
      const glow = [...document.querySelectorAll(".shero__glowcard")];
      if (glow.length !== cards.length || !glow.length) w.mism++;
      else
        glow.forEach((g, i) => {
          const gr = g.getBoundingClientRect();
          w.glowL = Math.max(w.glowL, Math.abs(gr.left - rs[i].left));
          w.glowW = Math.max(w.glowW, Math.abs(gr.width - rs[i].width));
        });
      seen = inView;
      prev = next;
      last = now;
      w.frames++;
      w.seen = Math.max(w.seen, inView.size);
      if (!w.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const report = async (p) => {
  await p.evaluate(() => (window.__w.stop = true));
  return p.evaluate(() => ({ ...window.__w, old: null }));
};
const clean = (w, pw) =>
  w.frames > 30 && w.seen >= 3 && w.gone.length === 0 && w.popped.length === 0 && w.holes.length === 0 && w.jump < 30 &&
  w.mism === 0 && w.glowL <= 2 && w.glowW <= 2 && (w.oldGoneW === null || w.oldGoneW <= pw + 2);
const brief = (w) => JSON.stringify({ frames: w.frames, gone: w.gone.slice(0, 3), popped: w.popped.slice(0, 3), holes: w.holes.length, jump: Math.round(w.jump), jumpAt: w.jumpAt, mism: w.mism, glow: [Math.round(w.glowL), Math.round(w.glowW)], oldGoneW: w.oldGoneW });

for (const [width, height] of [[1920, 1080], [1280, 800]]) {
  const lag = { ms: 0 };
  const ctx = await context({ width, height, lag });
  const p = await openStream(ctx, { mouse: [width / 2, 300] });
  await rest(p);
  const cards = await rects(p, ".shero__card");
  const a = cards.findIndex((c) => c.w > 600);
  const pw = cards[0].w;
  check(
    `at ${width}px the cards mounted cover the window: two cards past the right edge, one past the left`,
    cards.filter((c) => c.l >= width).length >= 2 && cards.filter((c) => c.r <= 0).length >= 1 && cards.at(-1).r > width,
    JSON.stringify({ ahead: cards.filter((c) => c.l >= width).length, behind: cards.filter((c) => c.r <= 0).length }),
  );
  // The farthest poster showing, clicked: two cards at 1920, one at 1280.
  // The farthest card with room to click (40px or more in view).
  const k = cards.reduce((m, c, i) => (i > a && c.l < width - 40 ? i : m), -1) - a;
  lag.ms = 1000;
  await watch(p);
  const target = p.locator(".shero__card").nth(a + k);
  const want = await target.getAttribute("aria-label");
  await target.click({ position: { x: 12, y: 40 } });
  await p.waitForTimeout(2200);
  const w = await report(p);
  check(
    `at ${width}px a click ${k} poster${k > 1 ? "s" : ""} along: the shrinking card stays until it is poster-sized, no card enters view undecoded, the glow stays behind its card`,
    (await active(p)) === want && k === (width === 1920 ? 2 : 1) && clean(w, pw),
    `k=${k} ${brief(w)}`,
  );
  // Several presses mid-slide: each retargets from where the shelf is.
  lag.ms = 0;
  await rest(p);
  const ls = await labels(p);
  const at = ls.indexOf(await active(p));
  await p.locator(".shero__card--active").focus();
  await watch(p);
  for (const key of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowLeft", "ArrowLeft"]) {
    await p.keyboard.press(key);
    await p.waitForTimeout(110);
  }
  await p.waitForTimeout(1500);
  const w2 = await report(p);
  check(
    `at ${width}px five arrow presses in a row mid-slide land on the right card with nothing popping, jumping or unmounting in view`,
    (await active(p)) === ls[at + 1] && clean(w2, pw),
    brief(w2),
  );
  if (width === 1920) {
    // A long drag: 4 steps in about half a second, then release. Four, since
    // 1.0.23's bigger posters (410px a step or more) put a fifth past the window.
    lag.ms = 1000;
    await rest(p);
    const before = await labels(p);
    const from = before.indexOf(await active(p));
    // Before it starts, every poster it will bring into view is mounted and
    // loaded. Not a race: on a fast runner the drag outran a poster first
    // asked for when it began (four CI runs, 1.0.7 to 1.0.10).
    const ready = await p.evaluate(() => {
      const cards = [...document.querySelectorAll(".shero__card")];
      const a = cards.findIndex((c) => c.classList.contains("shero__card--active"));
      const lead = document.querySelector(".shero__lead").getBoundingClientRect().width;
      const step = document.querySelector(".shero__step").getBoundingClientRect().width;
      const fit = Math.ceil((innerWidth - lead) / step);
      const need = cards.slice(a, a + 5 + fit + 2);
      return { fit, need: need.length, want: 5 + fit + 2, loaded: need.filter((c) => c.querySelector(".shero__poster")?.hasAttribute("data-loaded")).length };
    });
    check(
      "at rest, every poster a five-step drag will reveal is already mounted and loaded",
      ready.need === ready.want && ready.loaded === ready.want,
      JSON.stringify(ready),
    );
    await watch(p);
    await p.mouse.move(1910, 300);
    await p.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await p.mouse.move(1910 - i * 84, 300);
      await p.waitForTimeout(25);
    }
    await p.mouse.up();
    await p.waitForTimeout(2200);
    const w3 = await report(p);
    check(
      "a long drag over four steps lands four cards on, with nothing popping, jumping or unmounting in view",
      (await active(p)) === before[from + 4] && clean(w3, pw),
      brief(w3),
    );
  }
  await ctx.close();
}

// ------------------------------------------------- the poster's fade timing
{
  // One click grows the card to its right and shrinks the focused one. The
  // transitions it starts are paused and set to chosen moments, so the check
  // does not depend on how fast this machine draws frames: opacity of each
  // card's poster and 16:9 layers (and the glow copies') at each moment, as a
  // share of the 620ms slide.
  const ctx = await context();
  const p = await openStream(ctx);
  await rest(p);
  const at = await p.evaluate(async () => {
    const old = document.querySelector(".shero__card--active");
    const inn = old.nextElementSibling;
    const gOld = document.querySelector(".shero__glowcard--active");
    const gInn = gOld.nextElementSibling;
    inn.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const anims = document.getAnimations().filter((a) => a.transitionProperty === "opacity");
    anims.forEach((a) => a.pause());
    const op = (c, s) => Number(getComputedStyle(c.querySelector(s)).opacity);
    const out = {};
    for (const t of [0, 40, 100, 186, 217, 300, 500, 600]) {
      anims.forEach((a) => (a.currentTime = t));
      out[t] = {};
      for (const [k, c] of [["old", old], ["inn", inn], ["gOld", gOld], ["gInn", gInn]]) out[t][k] = { p: op(c, ".shero__layer--p"), b: op(c, ".shero__layer--b") };
    }
    // The shrinking poster's own transition, to place its fade-in.
    for (const t of [403, 450, 500, 550, 620, 700]) {
      anims.forEach((a) => (a.currentTime = t));
      out[t] = { ...out[t] };
      for (const [k, c] of [["old", old], ["gOld", gOld]]) out[t][k] = { p: op(c, ".shero__layer--p"), b: op(c, ".shero__layer--b") };
    }
    return { out, n: anims.length };
  });
  const o = at.out;
  for (const [who, inn, old] of [["card", "inn", "old"], ["glow copy", "gInn", "gOld"]]) {
    // 0, 40, 100, 186, 217, 300, 500, 600ms of the 620ms grow.
    const grow = [0, 40, 100, 186, 217, 300, 500, 600].map((t) => o[t][inn]);
    check(
      `growing, the ${who}'s 16:9 art fades in over the first 45% and leads the poster, which fades out from 10% to 50%`,
      grow[0].b === 0 && grow[0].p === 1 && // nothing has moved at the start
        grow[1].b > 0.1 && grow[1].b < 0.9 && grow[1].p === 1 && // the art fading in, the poster still waiting
        grow.slice(2, 5).every((x) => x.b > 1 - x.p) && // the art further in than the poster is out: no dip to the ground
        grow.every((x, i) => i === 0 || x.b >= grow[i - 1].b) &&
        grow.slice(5).every((x) => x.b === 1 && x.p < 0.01),
      JSON.stringify(grow.map((x) => [+x.b.toFixed(2), +x.p.toFixed(2)])),
    );
    const hold = [0, 40, 100, 186, 217, 300].map((t) => o[t][old]);
    const back = [403, 450, 500, 550].map((t) => o[t][old].p);
    const end = [620, 700].map((t) => o[t][old]);
    check(
      `shrinking, the ${who}'s 16:9 art stays and the poster stays out for the first 65%, then fades in and is fully there at the end`,
      hold.every((x) => x.p < 0.1 && x.b === 1) && back[0] < 0.1 && back[1] > 0.05 && back[1] < 0.95 && back[2] > back[1] && end.every((x) => x.p === 1 && x.b === 0),
      JSON.stringify({ hold: hold.map((x) => +x.p.toFixed(2)), back: back.map((x) => +x.toFixed(2)), end: end.map((x) => [x.p, x.b]) }),
    );
  }
  check("the transitions under test exist (a poster and a 16:9 layer on each of four cards)", at.n >= 8, `n=${at.n}`);
  await ctx.close();
}

// -------------------------------------------------- the details under the card
{
  const ctx = await context();
  const p = await openStream(ctx);
  const read = () => p.locator(".shero__info").evaluate((e) => e.innerText);
  const before = await read();
  await target0(p).hover(); // as above: the pointer is on the card before the click
  await p.waitForTimeout(800);
  // Every frame's opacity: it must dip (the words leave) and come back.
  await p.evaluate(() => {
    const el = document.querySelector(".shero__info").firstElementChild;
    window.__o = [];
    const t0 = performance.now();
    const tick = () => {
      window.__o.push(Number(getComputedStyle(el).opacity));
      if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
    };
    tick();
  });
  await p.locator(".shero__card--active + .shero__card").click();
  await p.waitForTimeout(1500);
  const mid = Math.min(...(await p.evaluate(() => window.__o)));
  const after = await read();
  const op = await p.locator(".shero__info").evaluate((e) => Number(getComputedStyle(e.firstElementChild).opacity));
  const title = await active(p);
  check(
    "the meta and synopsis fade out and back in with the new title",
    before !== after && mid < 0.9 && op === 1 && /^\d{4} · .* · (Movie|Series)/.test(after),
    JSON.stringify({ before, after, mid }),
  );
  // ← → move the shelf while focus is in the hero, and the ring goes with it.
  await p.locator(".shero__card--active").focus();
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(900);
  const right = await active(p);
  const ringRight = await p.evaluate(() => document.activeElement?.classList.contains("shero__card--active"));
  await p.keyboard.press("ArrowLeft");
  await p.waitForTimeout(900);
  check(
    "→ and ← move the focus one card, and keyboard focus goes with it",
    right !== title && ringRight && (await active(p)) === title && (await p.evaluate(() => document.activeElement?.classList.contains("shero__card--active"))),
    JSON.stringify({ title, right }),
  );
  // Enter, then a click, on the focused card: the title's page.
  await p.keyboard.press("Enter");
  const byEnter = await p.waitForSelector(".vod-detail", { timeout: 5000 }).then(() => true, () => false);
  await p.locator(".vod-back").click();
  await p.waitForSelector(".shero__card--active", { timeout: 10_000 });
  await p.waitForTimeout(500);
  await p.locator(".shero__card--active").click();
  const byClick = await p.waitForSelector(".vod-detail", { timeout: 5000 }).then(() => true, () => false);
  check("Enter on the focused card opens the title's page, and so does a click", byEnter && byClick);
  await ctx.close();
}

// -------------------------------------------------------------------- a drag
{
  const ctx = await context();
  const p = await openStream(ctx, { mouse: null });
  const step = (await rects(p, ".shero__card")).find((c) => c.w < 600).w + 16;
  const startAt = async () => {
    const ls = await labels(p);
    const a = ls.indexOf(await active(p));
    return { ls, a };
  };
  const settle = () => p.waitForTimeout(1100);
  const Y = 300;
  // Two steps and a bit, slowly: moves two cards.
  let { ls, a } = await startAt();
  const tx = (e) => new DOMMatrixReadOnly(getComputedStyle(e).transform).m41;
  const before = await p.locator(".shero__track").evaluate(tx);
  await p.mouse.move(900, Y);
  await p.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await p.mouse.move(900 - i * ((2 * step + 40) / 10), Y);
    await p.waitForTimeout(30);
  }
  const during = await p.locator(".shero__track").evaluate(tx);
  await p.mouse.up();
  await settle();
  const two = await active(p);
  const detail1 = await p.locator(".vod-detail").count();
  check(
    "a long drag moves as many cards as it spans, the shelf following the pointer",
    // Mid-drag the track has followed the pointer most of the way (~2 steps).
    two === ls[a + 2] && detail1 === 0 && before - during > step * 1.5,
    JSON.stringify({ was: ls[a], now: two, wanted: ls[a + 2], followed: Math.round(before - during), step }),
  );
  // A short, quick flick: one card.
  ({ ls, a } = await startAt());
  await p.mouse.move(900, Y);
  await p.mouse.down();
  await p.mouse.move(840, Y); // one quick move: under a step, over the flick's speed
  await p.mouse.up();
  await settle();
  const flick = await active(p);
  check("a short flick moves one card", flick === ls[a + 1], JSON.stringify({ was: ls[a], now: flick }));
  // A short, slow drag settles back where it was.
  ({ ls, a } = await startAt());
  await p.mouse.move(900, Y);
  await p.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await p.mouse.move(900 - i * 8, Y);
    await p.waitForTimeout(70);
  }
  await p.mouse.up();
  await settle();
  check("and a short, slow drag settles back on the same card", (await active(p)) === ls[a]);
  // A drag that ends over the focused card does not open the title.
  const on = (await rects(p, ".shero__card--active"))[0];
  const cx = on.l + on.w / 2;
  await p.mouse.move(cx, Y);
  await p.mouse.down();
  for (const dx of [20, 40, 20, 0]) {
    await p.mouse.move(cx + dx, Y);
    await p.waitForTimeout(70);
  }
  await p.mouse.up();
  await settle();
  check(
    "a drag that ends on the focused card does not open the title",
    (await p.locator(".vod-detail").count()) === 0 && (await active(p)) === ls[a],
  );
  await ctx.close();
}

// ------------------------------------------------------------------ the tilt
// The cards lean to the pointer as the row cards do (react-parallax-tilt, on
// the picture inside each button). The library writes rotateX/rotateY/scale3d
// to the wrapper's inline style, which is what is read here. rotateY is the
// horizontal lean: -5 * (how far right of centre, -1..1) at 5 degrees max.
const HERO_SETTLE = 900; // HERO_SETTLE_MS in StreamScreen.tsx
const TILT_RE = /rotateX\((\S+)deg\) rotateY\((\S+)deg\) scale3d\((\S+?),/;
/** The inline lean of the Tilt wrapper under a point, and the rect of the card
 * (the button, which never transforms) it belongs to. */
const leanAt = (p, x, y) =>
  p.evaluate(
    ([x, y, src]) => {
      const el = document.elementFromPoint(x, y);
      const tilt = el?.closest(".shero__tilt");
      const card = el?.closest(".shero__card");
      const m = new RegExp(src).exec(tilt?.style.transform ?? "");
      if (!m || !card) return null;
      const r = card.getBoundingClientRect();
      return { rx: +m[1], ry: +m[2], s: +m[3], l: r.left, t: r.top, w: r.width, h: r.height };
    },
    [x, y, TILT_RE.source],
  );
const frame = (p) => p.waitForTimeout(160); // the library writes on the next frame
/** Every Tilt wrapper's lean and every glare, as the page draws them now. The
 * 200ms ease to flat is finished first: a slow frame (software raster, the
 * glow's blur) can hold a transition's start back by half a second, and what is
 * under test is where it ends. "Flat" is no rotation and no scale; the
 * library's own perspective() is not a lean. */
const flatState = (p) =>
  p.evaluate(() => {
    for (const a of document.getAnimations())
      if (a.effect?.target?.closest?.(".shero__tilt")) a.finish();
    const flat = (t) => {
      const cs = getComputedStyle(t).transform;
      if (cs === "none") return true;
      const m = new DOMMatrix(cs);
      const eps = 1e-4;
      return [m.m11, m.m22, m.m33].every((x) => Math.abs(x - 1) < eps) &&
        [m.m12, m.m13, m.m21, m.m23, m.m31, m.m32, m.m41, m.m42, m.m43].every((x) => Math.abs(x) < eps);
    };
    const tilts = [...document.querySelectorAll(".shero__tilt")];
    const glares = [...document.querySelectorAll(".shero__tilt .glare-wrapper")];
    return {
      moving: !!document.querySelector(".shero--moving"),
      drag: document.querySelector(".shero").hasAttribute("data-drag"),
      n: tilts.length,
      bent: tilts.filter((t) => !flat(t)).length,
      lit: glares.filter((g) => Number(getComputedStyle(g).opacity) !== 0).length,
    };
  });
const settled = (p) =>
  p.waitForFunction(() => !document.querySelector(".shero--moving"), null, { timeout: 5000 }).then(() => p.waitForTimeout(150));
{
  const ctx = await context();
  const p = await openStream(ctx, { mouse: null });
  await rest(p);
  const on = (await rects(p, ".shero__card--active"))[0];
  // Off-centre on the focused card: right of centre, near the top.
  const fx = on.l + on.w * 0.8;
  const fy = on.t + on.h * 0.2;
  await p.mouse.move(fx - 30, fy + 20);
  await p.mouse.move(fx, fy, { steps: 4 });
  await frame(p);
  const f = await leanAt(p, fx, fy);
  // The focused card leans 2.5 degrees at most and lifts 1.005 (it is wide;
  // a poster's 5 and 1.03 put it over its neighbours, Adam; 3 and 1.01 did
  // too once it grew in 1.0.23).
  const wantY = -(((fx - on.l) / on.w) * 200 - 100) * 0.025;
  const wantX = (((fy - on.t) / on.h) * 200 - 100) * 0.025;
  check(
    "hovering the focused card off-centre leans it toward the pointer, gently, and lifts it a little",
    !!f && near(f.ry, wantY, 0.1) && near(f.rx, wantX, 0.1) && Math.abs(f.ry) > 1.2 && Math.abs(f.rx) > 1.2 && near(f.s, 1.005, 0.001),
    JSON.stringify({ f, wantX, wantY }),
  );
  // Leaning as far as it can, at each side's edge, the picture stays clear of
  // the cards beside it (their buttons don't lean; the gap is 16px).
  const clear = [];
  for (const [fxk, side] of [[0.02, "left"], [0.98, "right"]]) {
    for (const fyk of [0.05, 0.95]) {
      await p.mouse.move(on.l + on.w * fxk, on.t + on.h * fyk, { steps: 4 });
      await p.waitForTimeout(750); // the library's 650ms ease
      clear.push(
        await p.evaluate((side) => {
          const card = document.querySelector(".shero__card--active");
          const pic = card.querySelector(".shero__tilt").getBoundingClientRect();
          const nb = (side === "left" ? card.previousElementSibling : card.nextElementSibling).getBoundingClientRect();
          return Math.round((side === "left" ? pic.left - nb.right : nb.left - pic.right) * 10) / 10;
        }, side),
      );
    }
  }
  check("leaning to its edges, the focused card stays at least 4px clear of the cards beside it", clear.every((g) => g >= 4), JSON.stringify(clear));
  // The first poster right of the focused card. At 1440 it is cut by the
  // window's edge (1.0.23's bigger cards), so the pointer stays on its left.
  const post = (await rects(p, ".shero__card")).find((c) => c.l > on.r && c.l < 1440 - 150);
  const px = post.l + post.w * 0.25;
  const py = post.t + post.h * 0.8;
  await p.mouse.move(px, py, { steps: 6 });
  await frame(p);
  const q = await leanAt(p, px, py);
  const wantQ = -(((px - post.l) / post.w) * 200 - 100) * 0.05;
  check(
    "a poster leans too, the same way, and the one the pointer left is flat again",
    !!q && near(q.ry, wantQ, 0.15) && q.ry > 1 && q.rx > 1 && near(q.s, 1.03, 0.001) &&
      (await p.evaluate(() => {
        const t = document.querySelector(".shero__card--active .shero__tilt").style.transform;
        return /rotateX\(0deg\) rotateY\(0deg\) scale3d\(1,/.test(t);
      })),
    JSON.stringify({ q, wantQ }),
  );
  check(
    "only the real cards have a Tilt: the glow's copies have none, and the logo is inside it",
    (await p.locator(".shero__glowbox .shero__tilt, .shero__glowbox .glare-wrapper").count()) === 0 &&
      (await p.evaluate(() => { const cs = [...document.querySelectorAll(".shero__card")]; return cs.length > 4 && cs.every((c) => c.querySelector(".shero__tilt .glare-wrapper")); })) &&
      (await p.evaluate(() => { const ms = [...document.querySelectorAll(".shero__card .shero__mark")]; return ms.length > 4 && ms.every((m) => m.closest(".shero__tilt")); })),
  );
  await ctx.close();
}
{
  // After a move the lean must follow the pointer on the card that is under it
  // NOW. The library works the lean out from a rect it took on mouseenter, and
  // the cards moved and resized since: HeroCard measures again when the shelf
  // has settled. Two ways to move it, the pointer left where it was.
  // The settle is a timer (900ms after the move); on a runner whose frames take
  // 70ms the slide can start so late that it is still running when it fires,
  // and nothing measured then can be right. The page notes where the cards were
  // at that moment; a scenario whose cards were still moving is run again.
  const scenario = async (how) => {
    // 1920 wide: at 1440 the card a click lands on is cut by the window's
    // edge since 1.0.23's bigger cards, and its right quarter is off screen.
    const ctx = await context({ width: 1920, height: 1080 });
    try {
      const p = await openStream(ctx, { mouse: null });
      await rest(p);
      const on = (await rects(p, ".shero__card--active"))[0];
      let px, py;
      await p.evaluate(() => {
        const host = document.querySelector(".shero");
        window.__at = null;
        new MutationObserver(() => {
          if (!host.classList.contains("shero--moving") && !window.__at)
            window.__at = new Map([...document.querySelectorAll(".shero__card")].map((c) => [c, c.getBoundingClientRect().left]));
        }).observe(host, { attributes: true, attributeFilter: ["class"] });
      });
      if (how === "click") {
        const next = (await rects(p, ".shero__card")).find((c) => c.l > on.r);
        [px, py] = [next.l + next.w / 2, next.t + next.h / 2];
        await p.mouse.move(px, py, { steps: 4 });
        await p.mouse.click(px, py);
      } else {
        [px, py] = [on.l + on.w / 2, on.t + on.h / 2];
        await p.mouse.move(px, py, { steps: 4 });
        await p.locator(".shero__card--active").focus();
        await p.keyboard.press("ArrowRight");
      }
      await p.waitForTimeout(HERO_SETTLE + 400);
      await settled(p);
      const late = await p.evaluate(() => {
        const at = window.__at;
        return !at || [...at].some(([c, l]) => c.isConnected && Math.abs(c.getBoundingClientRect().left - l) > 0.5);
      });
      const card = await p.evaluate(([x, y]) => {
        const c = document.elementFromPoint(x, y)?.closest(".shero__card");
        const b = c?.getBoundingClientRect();
        return b && { l: b.left, t: b.top, w: b.width, h: b.height, on: c.classList.contains("shero__card--active") };
      }, [px, py]);
      if (!card) return { how, card: null };
      const y = card.t + card.h * 0.5;
      await p.mouse.move(card.l + card.w * 0.75, y, { steps: 3 });
      await frame(p);
      const right = await leanAt(p, card.l + card.w * 0.75, y);
      await p.mouse.move(card.l + card.w * 0.25, y, { steps: 3 });
      await frame(p);
      const left = await leanAt(p, card.l + card.w * 0.25, y);
      // Half the max at the quarters: 5 on a poster, 2.5 on the focused card.
      return { how, w: Math.round(card.w), half: card.on ? 1.25 : 2.5, right: right?.ry, left: left?.ry, late };
    } finally {
      await ctx.close();
    }
  };
  const out = [];
  for (const how of ["click", "key"]) {
    let o;
    for (let tries = 1; tries <= 3; tries++) {
      o = { ...(await scenario(how)), tries };
      if (!o.late) break;
    }
    out.push(o);
  }
  check(
    "after a move, once it has settled, the lean follows the pointer on the card now under it: opposite sides, half the max at the quarters",
    out.every((o) => o.card !== null && !o.late && near(o.right, -o.half, 0.35) && near(o.left, o.half, 0.35)),
    JSON.stringify(out),
  );
}
{
  // Mid-slide every card is flat, and its glare gone, even one that was leaning
  // under the pointer the moment the slide began (so this cannot pass on a
  // shelf that never tilted).
  const ctx = await context();
  const p = await openStream(ctx, { mouse: null });
  await rest(p);
  const on = (await rects(p, ".shero__card--active"))[0];
  const [px, py] = [on.l + on.w * 0.7, on.t + on.h * 0.3];
  await p.mouse.move(px - 20, py + 20);
  await p.mouse.move(px, py, { steps: 4 });
  await frame(p);
  const before = await leanAt(p, px, py);
  // (A dev build mounts a Tilt twice and appends two glares; one is a leftover.)
  const glareBefore = await p.evaluate(([x, y]) => Math.max(...[...document.elementFromPoint(x, y).closest(".shero__tilt").querySelectorAll(".glare")].map((g) => Number(g.style.opacity))), [px, py]);
  await p.locator(".shero__card--active").focus();
  await p.keyboard.press("ArrowRight");
  await p.waitForFunction(() => document.querySelector(".shero--moving"), null, { timeout: 2000 });
  const samples = [await flatState(p)];
  await p.waitForTimeout(150);
  samples.push(await flatState(p));
  check(
    "mid-slide every card's lean is gone and its glare hidden, having been leaning just before",
    !!before && Math.abs(before.ry) > 0.8 && Math.abs(before.rx) > 0.8 && glareBefore > 0.01 &&
      samples.every((s) => s.moving && s.n > 4 && s.bent === 0 && s.lit === 0),
    JSON.stringify({ before, glareBefore, samples }),
  );
  await ctx.close();
}
{
  // The same while the shelf is dragged, before a step is crossed (React's
  // "moving" starts at half a step; the drag attribute is there from 6px).
  const ctx = await context();
  const p = await openStream(ctx, { mouse: null });
  await rest(p);
  const on = (await rects(p, ".shero__card--active"))[0];
  const [px, py] = [on.l + on.w * 0.7, on.t + on.h * 0.3];
  await p.mouse.move(px - 20, py + 20);
  await p.mouse.move(px, py, { steps: 4 });
  await frame(p);
  const before = await leanAt(p, px, py);
  await p.mouse.down();
  for (let i = 1; i <= 4; i++) {
    await p.mouse.move(px + i * 10, py);
    await p.waitForTimeout(100);
  }
  await p.waitForTimeout(300);
  const held = await flatState(p);
  await p.mouse.up();
  check(
    "and while the shelf is dragged",
    !!before && Math.abs(before.ry) > 0.8 && held.drag && held.n > 4 && held.bent === 0 && held.lit === 0,
    JSON.stringify({ before, held }),
  );
  await ctx.close();
}

// ----------------------------------------------------------------- autoplay
{
  // Idle it moves on (so the holds below mean something), under the pointer it
  // holds, and under reduced motion it never moves.
  const idle = (async () => {
    const ctx = await context();
    const p = await openStream(ctx, { mouse: [2, 2] });
    const a = await active(p);
    await p.waitForTimeout(9_000);
    const b = await active(p);
    await ctx.close();
    return [a, b];
  })();
  const hover = (async () => {
    const ctx = await context();
    const p = await openStream(ctx, { mouse: [700, 320] });
    const a = await active(p);
    await p.waitForTimeout(9_000);
    const b = await active(p);
    await ctx.close();
    return [a, b];
  })();
  const still = (async () => {
    const ctx = await context({ reduced: true });
    const p = await openStream(ctx, { mouse: [2, 2] });
    const a = await active(p);
    await p.waitForTimeout(9_000);
    const b = await active(p);
    await ctx.close();
    return [a, b];
  })();
  const [i, h, r] = await Promise.all([idle, hover, still]);
  check("autoplay moves the hero on every 8 seconds when nothing holds it", i[0] !== i[1], JSON.stringify(i));
  check("autoplay pauses under the pointer", h[0] === h[1], JSON.stringify(h));
  check("and never runs under reduced motion", r[0] === r[1], JSON.stringify(r));
}

// ------------------------------------------------------------ reduced motion
{
  const ctx = await context({ reduced: true });
  const p = await openStream(ctx, { mouse: [2, 2] });
  const off = await p.evaluate(() => {
    const sel = [".shero__track", ".shero__glowtrack", ".shero__card", ".shero__layer--b", ".shero__layer--p", ".shero__scrim", ".shero__mark", ".shero__info > *"];
    return sel.map((s) => [s, [...document.querySelectorAll(s)].every((e) => /^(0s)(, 0s)*$/.test(getComputedStyle(e).transitionDuration) && /^(0s)(, 0s)*$/.test(getComputedStyle(e).transitionDelay))]);
  });
  const was = await active(p);
  const next = await p.locator(".shero__card--active + .shero__card").getAttribute("aria-label");
  await p.locator(".shero__card--active + .shero__card").click({ position: { x: 20, y: 20 } });
  await p.waitForTimeout(60);
  const soon = await p.locator(".shero__track").evaluate((e) => getComputedStyle(e).transform);
  await p.waitForTimeout(800);
  const late = await p.locator(".shero__track").evaluate((e) => getComputedStyle(e).transform);
  check(
    "under reduced motion nothing in the hero has a transition, and a slide lands at once",
    off.every(([, ok]) => ok) && soon === late && was !== next && (await active(p)) === next,
    JSON.stringify({ off: off.filter(([, ok]) => !ok).map(([s]) => s), soon, late, was, next, now: await active(p) }),
  );
  await ctx.close();
}

// ---------------------------------------------------- reduced motion: no tilt
{
  const ctx = await context({ reduced: true });
  const p = await openStream(ctx, { mouse: null });
  const on = (await rects(p, ".shero__card--active"))[0];
  const [px, py] = [on.l + on.w * 0.8, on.t + on.h * 0.2];
  await p.mouse.move(px - 30, py + 20);
  await p.mouse.move(px, py, { steps: 4 });
  await frame(p);
  const f = await leanAt(p, px, py);
  const post = (await rects(p, ".shero__card")).find((c) => c.l > on.r && c.l < 1440 - 150);
  await p.mouse.move(post.l + post.w * 0.25, post.t + post.h * 0.8, { steps: 4 });
  await frame(p);
  const q = await leanAt(p, post.l + post.w * 0.25, post.t + post.h * 0.8);
  check(
    "under reduced motion hovering a card leaves it flat, unscaled and with no glare",
    !!f && !!q && [f.rx, f.ry, q.rx, q.ry].every((x) => x === 0) && f.s === 1 && q.s === 1 &&
      (await p.locator(".shero__card .glare-wrapper").count()) === 0,
    JSON.stringify({ f, q }),
  );
  await ctx.close();
}

// ------------------------------------------------ the details are on the page
{
  const ctx = await context({ reduced: true });
  const p = await openStream(ctx, { mouse: [2, 2] });
  for (const theme of ["dark", "light"]) {
    await p.evaluate((t) => (document.documentElement.dataset.theme = t === "light" ? "light" : ""), theme);
    await p.waitForTimeout(300);
    const c = await p.evaluate(() => {
      const px = (css, base) => {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 1;
        const x = cv.getContext("2d", { willReadFrequently: true });
        x.fillStyle = base;
        x.fillRect(0, 0, 1, 1);
        if (css !== base) {
          x.fillStyle = css;
          x.fillRect(0, 0, 1, 1);
        }
        return [...x.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      };
      const lum = ([r, g, b]) => [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
      // The page's ground: the first painted background up from the details.
      let el = document.querySelector(".shero__meta");
      let bg = "";
      for (; el; el = el.parentElement) {
        bg = getComputedStyle(el).backgroundColor;
        if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) break;
      }
      const ground = px(bg || "#fff", "#fff");
      const out = {};
      for (const k of ["meta", "synopsis"]) {
        const css = getComputedStyle(document.querySelector(`.shero__${k}`)).color;
        out[k] = ratio(px(css, bg || "#fff"), ground);
      }
      return { ...out, bg };
    });
    check(
      `in ${theme}, the meta and synopsis are readable on the page (contrast 3 or better)`,
      c.meta >= 3 && c.synopsis >= 3,
      JSON.stringify(c),
    );
  }
  await ctx.close();
}

// -------------------------------------------------------------- missing art
{
  // No 16:9 art: the poster stands in, blurred, and the sharp one sits right.
  const ctx = await context({ reduced: true, abort: [/localhost:8084\/bg\//] });
  const p = await openStream(ctx, { mouse: [2, 2], loaded: false });
  await p.waitForSelector(".shero__card--active.shero__nobd", { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const c = document.querySelector(".shero__card--active");
    const art = c.querySelector(".shero__art");
    const lp = c.querySelector(".shero__layer--p").getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    return {
      nobd: c.classList.contains("shero__nobd"),
      same: art.src === c.querySelector(".shero__poster").src && /\/poster\//.test(art.src),
      blur: /blur/.test(getComputedStyle(art).filter),
      right: Math.abs(lp.right - cr.right) < 1 && Math.abs(lp.width - 393.75) < 1,
      opacity: Number(getComputedStyle(c.querySelector(".shero__layer--p")).opacity),
    };
  });
  check(
    "with no 16:9 art: the poster, blurred, behind the sharp poster at the card's right",
    r.nobd && r.same && r.blur && r.right && r.opacity === 1,
    JSON.stringify(r),
  );
  await ctx.close();
}
{
  // No poster: the 16:9 art, cropped to the poster's box.
  const ctx = await context({ reduced: true, abort: [/localhost:8084\/poster\/(?!logo)/] });
  const p = await openStream(ctx, { mouse: [2, 2] });
  await p.waitForSelector(".shero__card:not(.shero__card--active) .shero__poster[src*='/bg/']", { timeout: 5000 }).catch(() => {});
  const r = await p.evaluate(() => {
    const c = [...document.querySelectorAll(".shero__card")].find((x) => !x.classList.contains("shero__card--active"));
    const art = c.querySelector(".shero__art");
    const poster = c.querySelector(".shero__poster");
    const lp = c.querySelector(".shero__layer--p").getBoundingClientRect();
    return { same: !!poster && poster.src === art.src && /\/bg\//.test(art.src), w: lp.width, fit: poster && getComputedStyle(poster).objectFit, blur: /blur/.test(getComputedStyle(art).filter) };
  });
  check(
    "with no poster: the 16:9 art, cropped to the poster's box",
    r.same && near(r.w, 393.75, 1) && r.fit === "cover" && !r.blur,
    JSON.stringify(r),
  );
  await ctx.close();
}
{
  // Neither: the card's letter, and a dark ground under the focused card.
  const ctx = await context({ reduced: true, abort: [/localhost:8084\/(poster|bg)\//], logo: false });
  const p = await openStream(ctx, { mouse: [2, 2], loaded: false });
  await p.waitForSelector(".shero__card--active .shero__layer--bare", { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const cards = [...document.querySelectorAll(".shero__card")];
    const c = cards.find((x) => !x.classList.contains("shero__card--active"));
    const on = document.querySelector(".shero__card--active");
    return {
      letter: c.querySelector(".shero__mono")?.textContent === c.getAttribute("aria-label").slice(0, 1),
      imgs: c.querySelectorAll(".shero__layer img").length,
      ground: getComputedStyle(on.querySelector(".shero__layer--b")).backgroundColor,
      type: on.querySelector(".shero__title")?.textContent === on.getAttribute("aria-label"),
    };
  });
  check(
    "with neither: the title's first letter on a poster, a dark ground under the card, the name in type",
    r.letter && r.imgs === 0 && /oklab|oklch|rgb/.test(r.ground) && r.type,
    JSON.stringify(r),
  );
  await ctx.close();
}

await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);

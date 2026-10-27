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
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  sessionStorage.setItem("btv:welcome-played", "1");
};
/** A context that reaches nothing but this machine. Real motion unless asked,
 * every title gets a logo (the fake's own metas have none), and a picture
 * whose address matches `abort` fails to load (a hero pick always has a
 * backdrop, so a missing one is a failed one). */
const context = async ({ width = 1440, height = 900, reduced = false, abort = [], logo = true } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? "reduce" : "no-preference" });
  await ctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
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
    "the focused card is 16:9 and 1.8x a Continue Watching card, the posters 2:3, all one height",
    near(cw.w, 533.3, 0.5) && near(on.w, cw.w * 1.8) && near(on.h * 16, on.w * 9, 1) && posters.length >= 4 &&
      posters.every((c) => near(c.w * 3, c.h * 2, 1) && near(c.h, on.h, 0.5)),
    JSON.stringify({ cw, on: [on.w, on.h], posters: posters.map((c) => [c.w, c.h]) }),
  );
  const prev = cards.filter((c) => c.l < on.l);
  check(
    "a poster peeks in before the focused card, and the next ones follow a 30px gap apart",
    prev.length >= 1 && prev.at(-1).r > 0 && near(cards.find((c) => c.l > on.l).l - on.r, 30, 0.5),
    JSON.stringify({ peek: prev.at(-1)?.r, gap: cards.find((c) => c.l > on.l).l - on.r }),
  );
  await ctx.close();
}
{
  // A narrow window: capped at 72vw, with a poster still beside the card.
  const ctx = await context({ width: 1000, height: 700 });
  const p = await openStream(ctx, { mouse: [500, 250] });
  const on = (await rects(p, ".shero__card--active"))[0];
  const next = (await rects(p, ".shero__card")).find((c) => c.l > on.l);
  check(
    "in a narrow window the focused card stops at 72vw and a poster still shows beside it",
    near(on.w, 720, 1) && next.l < 1000 - 100, // at least 100px of the poster is on screen
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
    s.scrollLeft = 300;
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
  await p.evaluate(() => {
    const c = document.querySelector(".shero__card--active").nextElementSibling;
    window.__s = [];
    const t0 = performance.now();
    const tick = () => {
      const r = c.getBoundingClientRect();
      const logo = c.querySelector(".shero__mark").getBoundingClientRect();
      window.__s.push({
        t: performance.now() - t0,
        cw: r.width,
        lw: logo.width,
        lh: logo.height,
        lx: logo.left - r.left,
        lo: Number(getComputedStyle(c.querySelector(".shero__mark")).opacity),
        pw: c.querySelector(".shero__layer--p").getBoundingClientRect().width,
        bw: c.querySelector(".shero__layer--b").getBoundingClientRect().width,
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
    s.length > 20 && widths.size >= 6 && s[0].cw < 365 && near(s.at(-1).cw, 960, 1) && trackMs === "0.62s",
    JSON.stringify({ frames: s.length, from: s[0].cw, to: s.at(-1).cw, distinct: widths.size, trackMs }),
  );
  check(
    "the logo's box is the same size at every moment of the grow, sized from the full card",
    spread("lw") < 0.5 && spread("lh") < 0.5 && near(s.at(-1).lw, 0.46 * 960, 1) && near(s.at(-1).lh, 0.34 * 540, 1) && spread("lx") < 0.5,
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
    spread("pw") < 0.5 && near(s[0].pw, 360, 0.5) && spread("bw") < 0.5 && near(s[0].bw, 960, 0.5),
    JSON.stringify({ pw: [s[0].pw, spread("pw")], bw: [s[0].bw, spread("bw")] }),
  );
  check(
    "a click on a poster slides it into focus and does not open the title",
    (await active(p)) === slid && slid !== before && (await p.locator(".vod-detail").count()) === 0,
    JSON.stringify({ before, slid, now: await active(p) }),
  );
  await ctx.close();
}

// -------------------------------------------------- the details under the card
{
  const ctx = await context();
  const p = await openStream(ctx);
  const read = () => p.locator(".shero__info").evaluate((e) => e.innerText);
  const before = await read();
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
  const step = (await rects(p, ".shero__card")).find((c) => c.w < 400).w + 30;
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
      right: Math.abs(lp.right - cr.right) < 1 && Math.abs(lp.width - 360) < 1,
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
    r.same && near(r.w, 360, 1) && r.fit === "cover" && !r.blur,
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

// Headless verify: Stream's rows refresh (v1.0.14), against the fake addon
// (scripts/fake-aio.mjs, :8084).
//
// Three changes, Stream's Home only. Posters 240 wide in its rows (Discover
// and the Library keep 300). The meta line (rating, year, length) shows on
// hover or keyboard focus and keeps its space; Continue Watching's lines and a
// Next Up episode line stay. And the shelf's ambient colour: the focused
// title's art blurred behind the top of the page, following the shelf, dark
// only, shelf style only, under the content and out of the pointer's way.
//
// Run: node scripts/fake-aio.mjs; pnpm build + preview (:4173);
//      PW_FROM=<dir>/x.js node scripts/verify-streamrows.mjs
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
/** What a launch holds before the app loads. `style` is the Carousel Style
 * stored (null: nothing stored); `extra` is other settings, { key: envelope }.
 * The random is seeded, as verify-shero does: the hero's order is a shuffle. */
const seed = ({ style, extra }) => {
  let n = 42;
  Math.random = () => {
    n = (n + 0x6d2b79f5) | 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  localStorage.setItem("btv:onboarded", "1"); localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  sessionStorage.setItem("btv:welcome-played", "1");
  // Once: a reload in a check must see what the check left.
  if (!sessionStorage.getItem("seeded")) {
    sessionStorage.setItem("seeded", "1");
    if (style) localStorage.setItem("blammytv.heroStyle", JSON.stringify({ v: 1, data: style }));
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(`blammytv.${k}`, JSON.stringify(v));
  }
};
/** A context that reaches nothing but this machine. */
const context = async ({ reduced = false } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: reduced ? "reduce" : "no-preference", colorScheme: "dark" });
  await ctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
  return ctx;
};
/** Stream, with the Carousel Style stored as given (the shelf by default). */
const openStream = async (ctx, { style = null, extra = {}, mouse = [700, 450], shelf = true } = {}) => {
  const p = await ctx.newPage();
  await p.addInitScript(seed, { style, extra });
  await p.goto("http://localhost:4173/");
  await goTo(p, "home"); // not a bare click: the capsule slides at launch (CLAUDE.md)
  await p.waitForSelector(".stream__rows .stream-card", { timeout: 20_000 });
  if (shelf) {
    await p.waitForSelector(".shero__card--active .shero__art[data-loaded]", { timeout: 20_000 });
    await p.waitForTimeout(400); // the animReady frames
  }
  if (mouse) await p.mouse.move(...mouse); // over the hero: no autoplay under a check
  return p;
};
/** The picture the focused card shows, as the ambient layer would name it. */
const activeArt = (p) => p.evaluate(() => document.querySelector(".shero__card--active .shero__art")?.getAttribute("src") ?? null);
/** The ambient's two layers (canvases, painted once per pick): which one is
 * showing, and which art each was painted from. */
const ambient = (p) =>
  p.evaluate(() => {
    const box = document.querySelector(".shero__ambient");
    if (!box) return null;
    const layers = [...box.children].map((i) => {
      const cs = getComputedStyle(i);
      return { on: i.classList.contains("on"), img: i.dataset.src ? `url("${i.dataset.src}")` : "none", opacity: Number(cs.opacity), dur: cs.transitionDuration };
    });
    return { box: getComputedStyle(box).display, layers, on: layers.find((l) => l.on)?.img ?? null };
  });
const cssUrl = (src) => `url("${src}")`;
/** A poster in the focused card's neighbour slot: a click slides it in. */
const clickNeighbour = async (p) => {
  const before = await activeArt(p);
  const w = await p.evaluate(() => document.querySelector(".shero").clientWidth);
  await p.mouse.click(w - 80, 280);
  await p.waitForFunction((b) => document.querySelector(".shero__card--active .shero__art")?.getAttribute("src") !== b, before, { timeout: 5_000 });
};

// ------------------------------------------------------- posters 240 wide
{
  const ctx = await context();
  const p = await openStream(ctx);
  const sizes = await p.evaluate(() => {
    const rows = [...document.querySelectorAll(".stream__rows .stream-card")];
    const w = (sel) => [...new Set(rows.map((c) => c.querySelector(sel)).filter(Boolean).map((e) => Math.round(e.getBoundingClientRect().width)))];
    const max = (sel) => [...new Set(rows.map((c) => c.querySelector(sel)).filter(Boolean).map((e) => getComputedStyle(e).maxWidth))];
    return { n: rows.length, pic: w(".stream-card__poster, .stream-card__mono"), name: max(".stream-card__name"), meta: max(".stream-card__meta") };
  });
  check("Stream's row posters are 240 wide, the name and the meta bounded at 240", sizes.n > 3 && sizes.pic.join() === "240" && sizes.name.join() === "240px" && sizes.meta.join() === "240px", JSON.stringify(sizes));
  const ratio = await p.evaluate(() => {
    const r = document.querySelector(".stream__rows .stream-card__poster").getBoundingClientRect();
    return r.height / r.width;
  });
  check("  and still 2:3", Math.abs(ratio - 1.5) < 0.01, String(ratio));

  // Discover's grid draws the same card, outside the rows: 300 as before.
  await goTo(p, "discover");
  await p.waitForSelector(".disc-grid .stream-card__poster", { timeout: 20_000 });
  const disc = await p.evaluate(() => {
    const e = document.querySelector(".disc-grid .stream-card__poster");
    return { w: Math.round(e.getBoundingClientRect().width), max: getComputedStyle(document.querySelector(".disc-grid .stream-card__name")).maxWidth };
  });
  check("a Discover poster is still 300 wide, its name bounded at 300", disc.w === 300 && disc.max === "300px", JSON.stringify(disc));
  await ctx.close();
}

// ------------------------------------------------------- the meta line
{
  const ctx = await context();
  const p = await openStream(ctx, {
    extra: { watching: { v: 1, data: [{ id: "tt555", title: "Odd Movie", kind: "movie", at: Date.now() - 3 * 86400_000, posSec: 1200, durSec: 6000 }] } },
  });
  // Rows scroll into view as needed; this card is the first poster row's first.
  const card = p.locator(".stream__rows .stream-card:has(.stream-card__meta:not([data-said]))").first();
  await card.scrollIntoViewIfNeeded();
  await p.mouse.move(5, 5);
  await p.waitForTimeout(400);
  const read = () =>
    card.evaluate((c) => {
      const m = c.querySelector(".stream-card__meta");
      const r = m.getBoundingClientRect();
      return { o: Number(getComputedStyle(m).opacity), h: Math.round(r.height), text: m.textContent, cardH: Math.round(c.getBoundingClientRect().height) };
    });
  const rest = await read();
  check("a poster card's meta is invisible at rest, with its box still laid out", rest.o === 0 && rest.h > 0 && rest.text.length > 0, JSON.stringify(rest));
  const siblings = await p.evaluate(() => [...document.querySelectorAll(".stream__rows .stream-card > .stream-card__meta:not([data-said])")].map((m) => Number(getComputedStyle(m).opacity)));
  check("  and so is every other poster card's", siblings.length > 3 && siblings.every((o) => o === 0), JSON.stringify(siblings.slice(0, 6)));

  await card.hover();
  await p.waitForTimeout(400);
  const hover = await read();
  check("under the pointer the meta is fully shown, and the card is no taller", hover.o === 1 && hover.cardH === rest.cardH && hover.h === rest.h, JSON.stringify(hover));
  const others = await p.evaluate(() => [...document.querySelectorAll(".stream__rows .stream-card > .stream-card__meta:not([data-said])")].filter((m) => Number(getComputedStyle(m).opacity) === 1).length);
  check("  and only that card's", others === 1, String(others));
  await p.mouse.move(5, 5);
  await p.waitForTimeout(400);
  check("  and it fades away again when the pointer leaves", (await read()).o === 0);

  // Keyboard: Tab until a poster card has focus, the pointer nowhere near.
  for (let i = 0, on = false; i < 80 && !on; i++) {
    await p.keyboard.press("Tab");
    on = await p.evaluate(() => !!document.activeElement?.classList.contains("stream-card"));
  }
  await p
    .waitForFunction(() => getComputedStyle(document.activeElement?.querySelector(".stream-card__meta") ?? document.body).opacity === "1", null, { timeout: 4000 })
    .catch(() => {}); // a failed fade is a failed check below
  const kb = await p.evaluate(() => {
    const a = document.activeElement;
    const m = a?.querySelector(".stream-card__meta");
    return { card: !!a?.classList.contains("stream-card"), vis: !!a?.matches(":focus-visible"), o: m ? Number(getComputedStyle(m).opacity) : null, said: m?.hasAttribute("data-said") };
  });
  check("Tab to a poster card shows its meta (keyboard focus)", kb.card && kb.vis && kb.o === 1, JSON.stringify(kb));

  // Continue Watching: its lines stay as they were.
  const cw = await p.evaluate(() => {
    const m = document.querySelector(".continue-card .stream-card__meta");
    return m && { o: Number(getComputedStyle(m).opacity), text: m.textContent, max: getComputedStyle(document.querySelector(".continue-card .stream-card__name")).maxWidth };
  });
  check("Continue Watching's line stays shown, at its own width", !!cw && cw.o === 1 && /Left/.test(cw.text) && cw.max === "533px", JSON.stringify(cw));
  await ctx.close();
}
{
  // Reduced motion: no fade, just show and hide.
  const ctx = await context({ reduced: true });
  const p = await openStream(ctx, { mouse: null });
  const card = p.locator(".stream__rows .stream-card:has(.stream-card__meta:not([data-said]))").first();
  await card.scrollIntoViewIfNeeded();
  const dur = await card.evaluate((c) => getComputedStyle(c.querySelector(".stream-card__meta")).transitionDuration);
  await card.hover();
  await p.waitForTimeout(60);
  const o = await card.evaluate((c) => Number(getComputedStyle(c.querySelector(".stream-card__meta")).opacity));
  check("under reduced motion the meta shows at once, with no fade", dur === "0s" && o === 1, JSON.stringify({ dur, o }));
  await ctx.close();
}

// ------------------------------------------------------- the ambient colour
{
  const ctx = await context();
  const p = await openStream(ctx);
  const art0 = await activeArt(p);
  const a0 = await ambient(p);
  check("the ambient layer shows the focused shelf title's art", !!art0 && a0?.on === cssUrl(art0), JSON.stringify({ art0, on: a0?.on }));
  const lit = a0?.layers.find((l) => l.on);
  check("  at 0.42, the other layer clear", Math.abs((lit?.opacity ?? 0) - 0.42) < 0.01 && a0.layers.filter((l) => !l.on).every((l) => l.opacity === 0), JSON.stringify(a0?.layers.map((l) => l.opacity)));

  // Geometry: the top of the page, the window's width.
  const geo = await p.evaluate(() => {
    const box = document.querySelector(".shero__ambient");
    const r = box.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, pe: getComputedStyle(box).pointerEvents, streamTop: Math.round(document.querySelector(".stream").getBoundingClientRect().top) };
  });
  check("it spans the window's width from the top of the page, 1300 tall", geo.top === geo.streamTop && geo.left === 0 && geo.w === geo.vw && geo.h === 1300, JSON.stringify(geo));
  check("  and takes no pointer events", geo.pe === "none");

  // Painted, not just there: the fake's pictures are a red pixel, so the wash
  // tints a bare patch of the page red (right of the details, under the shelf),
  // strongly near the top and not at all by the second row.
  const redAt = async (x, y) => {
    const buf = await p.screenshot({ clip: { x, y, width: 1, height: 1 } });
    return p.evaluate(async (b64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const [r, gr, bl] = g.getImageData(0, 0, 1, 1).data;
      return r - Math.max(gr, bl);
    }, buf.toString("base64"));
  };
  await p.mouse.move(5, 5);
  // Just under the posters' foot, at the right: the shelf's height moved in
  // 1.0.23 (bigger cards), so read it rather than assume it.
  const shelfFoot = await p.evaluate(() => Math.round(document.querySelector(".shero__viewport").getBoundingClientRect().bottom));
  const bare = [1380, shelfFoot + 40];
  const withRed = await redAt(...bare);
  await p.addStyleTag({ content: ".shero__ambient { visibility: hidden !important; }" });
  const noRed = await redAt(...bare);
  check("the wash is painted: a bare patch under the shelf is tinted red with it and not without", withRed - noRed >= 6, JSON.stringify({ withRed, noRed }));
  // Inside the box, near its foot (1240 of its 1300px): the fade has taken it.
  // Read where the box really is, so this can't sample past it.
  await p.evaluate(() => (document.querySelector(".stream").scrollTop = 700));
  await p.waitForTimeout(250);
  const foot = await p.evaluate(() => Math.round(document.querySelector(".shero__ambient").getBoundingClientRect().top + 1240));
  const deepWithout = await redAt(1436, foot);
  await p.addStyleTag({ content: ".shero__ambient { visibility: visible !important; }" });
  const deepWith = await redAt(1436, foot);
  check("  and it has faded out by the foot of its box (1240px down, inside it, the same with it as without)", foot > 0 && foot < 900 && Math.abs(deepWith - deepWithout) <= 1, JSON.stringify({ foot, deepWith, deepWithout }));
  await p.evaluate(() => (document.querySelector(".stream").scrollTop = 0));
  await p.waitForTimeout(250);

  // Under the content: a row card answers a hit-test, and the rows paint after it.
  const card = p.locator(".stream__rows .stream-card").first();
  await card.scrollIntoViewIfNeeded();
  const hit = await card.evaluate((c) => {
    const r = c.querySelector(".stream-card__poster, .stream-card__mono").getBoundingClientRect();
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const amb = document.querySelector(".shero__ambient");
    const rows = document.querySelector(".stream__rows");
    return {
      hit: !!e?.closest(".stream-card") && e.closest(".stream-card") === c,
      after: !!(amb.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING),
      z: getComputedStyle(amb).zIndex,
      rowsPos: getComputedStyle(rows).position,
    };
  });
  check("a row card is what the pointer reaches, and the rows paint over the ambient (later in the tree, positioned, it at z 0)", hit.hit && hit.after && hit.z === "0" && hit.rowsPos === "relative", JSON.stringify(hit));

  // The wash reaches the first row, so the paint order is a real question.
  await p.evaluate(() => (document.querySelector(".stream").scrollTop = 0));
  const above = await p.evaluate(() => {
    const box = document.querySelector(".shero__ambient").getBoundingClientRect();
    const t = document.querySelector(".stream__rows .media-row__title").getBoundingClientRect();
    return { overlaps: t.top < box.bottom && t.bottom > box.top };
  });
  check("  the first row's title sits inside the ambient's reach (so the order matters)", above.overlaps, JSON.stringify(above));

  // It must not move a thing: with the layer hidden, the page measures the same.
  await p.evaluate(() => (document.querySelector(".stream").scrollTop = 0));
  const measure = () =>
    p.evaluate(() => {
      const s = document.querySelector(".stream");
      const r = (sel) => {
        const b = document.querySelector(sel).getBoundingClientRect();
        return [Math.round(b.top), Math.round(b.left), Math.round(b.width), Math.round(b.height)].join();
      };
      return { h: s.scrollHeight, shero: r(".shero"), rows: r(".stream__rows"), card: r(".stream__rows .stream-card") };
    });
  const withIt = await measure();
  await p.addStyleTag({ content: ".shero__ambient { display: none !important; }" });
  const without = await measure();
  check("it moves nothing: the shelf, the rows and the page's height measure the same without it", JSON.stringify(withIt) === JSON.stringify(without), JSON.stringify({ withIt, without }));

  // Following the shelf: a click on the neighbour, and the wash crossfades to its art.
  await p.addStyleTag({ content: ".shero__ambient { display: block !important; }" });
  await p.mouse.move(700, 450);
  await clickNeighbour(p);
  await p.waitForTimeout(150);
  const mid = await ambient(p);
  await p
    .waitForFunction(() => [...document.querySelectorAll(".shero__ambient canvas")].every((c) => Number(getComputedStyle(c).opacity) === (c.classList.contains("on") ? 0.42 : 0)), null, { timeout: 6000 })
    .catch(() => {}); // the 900ms crossfade, on a rasteriser that may be slow
  const art1 = await activeArt(p);
  const a1 = await ambient(p);
  check("after the shelf moves, the ambient is the new title's art and not the old", !!art1 && art1 !== art0 && a1?.on === cssUrl(art1), JSON.stringify({ art0, art1, on: a1?.on }));
  check("  the old art waits in the other layer and fades out as the new one fades in (a crossfade)", mid?.layers.length === 2 && mid.layers.some((l) => !l.on && l.img === cssUrl(art0)) && mid.layers.find((l) => l.on).dur === "0.9s" && a1.layers.filter((l) => !l.on).every((l) => l.opacity === 0), JSON.stringify({ mid, end: a1?.layers.map((l) => l.opacity) }));
  await ctx.close();
}
{
  // Reduced motion: the wash swaps, no crossfade.
  const ctx = await context({ reduced: true });
  const p = await openStream(ctx);
  const art0 = await activeArt(p);
  await clickNeighbour(p);
  await p.waitForTimeout(100);
  const a = await ambient(p);
  const art1 = await activeArt(p);
  check("under reduced motion the ambient swaps at once, with no crossfade", art1 !== art0 && a?.on === cssUrl(art1) && a.layers.every((l) => l.dur === "0s") && Math.abs(a.layers.find((l) => l.on).opacity - 0.42) < 0.01 && a.layers.filter((l) => !l.on).every((l) => l.opacity === 0), JSON.stringify(a));
  await ctx.close();
}
{
  // Dark only: light gets nothing.
  const ctx = await context();
  const p = await openStream(ctx);
  const dark = await ambient(p);
  await p.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await p.waitForTimeout(300);
  const light = await ambient(p);
  check("in dark the ambient is drawn, in light it is not", dark?.box === "block" && light?.box === "none", JSON.stringify({ dark: dark?.box, light: light?.box }));
  await p.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await p.waitForTimeout(300);
  check("  and it is back when dark is", (await ambient(p))?.box === "block");
  await ctx.close();
}
{
  // The large style has its own glow: no ambient there.
  const ctx = await context();
  const p = await openStream(ctx, { style: "large", shelf: false });
  await p.waitForSelector(".lhero__card--active", { timeout: 20_000 });
  const n = await p.evaluate(() => ({ ambient: document.querySelectorAll(".shero__ambient").length, large: document.querySelectorAll(".lhero").length }));
  check("with the Large style there is no ambient layer", n.large === 1 && n.ambient === 0, JSON.stringify(n));
  await ctx.close();
}
{
  // Featured Carousel off: no hero, so nothing to take the colour from.
  const ctx = await context();
  const p = await openStream(ctx, { extra: { showHero: { v: 1, data: false } }, shelf: false, mouse: null });
  const n = await p.evaluate(() => ({ ambient: document.querySelectorAll(".shero__ambient").length, hero: document.querySelectorAll(".shero, .lhero").length }));
  check("with Featured Carousel off there is no ambient layer", n.hero === 0 && n.ambient === 0, JSON.stringify(n));
  await ctx.close();
}

await browser.close();
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

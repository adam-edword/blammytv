// Headless verify: Stream's large hero, the first carousel (Figma 133-721),
// kept as a second style next to the shelf (plan 031) and picked in Settings,
// Appearance, Stream, Carousel Style. Against the fake addon
// (scripts/fake-aio.mjs, :8084).
//
// Two halves. The setting: the shelf with nothing stored, Large switches it
// and Shelf switches back, the row hides with Featured Carousel and sits
// right under it. And the large hero as it was before v1.0.5, its checks
// restored from verify-stream (class `.shero` is `.lhero` here): the tilt's
// glare, no tab stops on the peeking slides, autoplay with focus, the
// header and the ink over the picture, the art fading in, the logo, a
// refresh; with the ones that measure what this style does that the old
// harness never did (Watch Now, More Info, the slide, the gutter).
//
// Run: node scripts/fake-aio.mjs; pnpm build + preview (:4173);
//      PW_FROM=<dir>/x.js node scripts/verify-lhero.mjs
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
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
  sessionStorage.setItem("btv:welcome-played", "1");
  // Once: a reload in a check must see what the check left.
  if (!sessionStorage.getItem("seeded")) {
    sessionStorage.setItem("seeded", "1");
    if (style) localStorage.setItem("blammytv.heroStyle", JSON.stringify({ v: 1, data: style }));
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(`blammytv.${k}`, JSON.stringify(v));
  }
};
/** A context that reaches nothing but this machine. Real motion unless asked. */
const context = async ({ width = 1440, height = 900, reduced = false, colorScheme = "dark" } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? "reduce" : "no-preference", colorScheme });
  await ctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
  return ctx;
};
/** Stream, with the Carousel Style stored as given ("large" by default). */
const openStream = async (ctx, { style = "large", extra = {}, mouse = [700, 450], ready = true } = {}) => {
  const p = await ctx.newPage();
  await p.addInitScript(seed, { style, extra });
  await p.goto("http://localhost:4173/");
  await goTo(p, "home"); // not a bare click: the capsule slides at launch (CLAUDE.md)
  if (ready) {
    await p.waitForSelector(".lhero__card--active .lhero__art[data-loaded]", { timeout: 20_000 });
    await p.waitForTimeout(400); // the animReady frames
  }
  if (mouse) await p.mouse.move(...mouse); // over the hero: no autoplay under a check
  return p;
};
/** The focused card's title: its logo's alt, or the name in type. */
const activeTitle = (p) =>
  p.evaluate(() => {
    const c = document.querySelector(".lhero__card--active");
    return c?.querySelector(".lhero__logo")?.alt ?? c?.querySelector(".lhero__title")?.textContent ?? null;
  });
/** Each card's title, in order. */
const titles = (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll(".lhero__card")].map(
      (c) => c.querySelector(".lhero__logo")?.alt ?? c.querySelector(".lhero__title")?.textContent ?? "",
    ),
  );
const trackX = (p) =>
  p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".lhero__track")).transform).m41);
/** Slide to the next card by clicking the neighbour peeking in at the right. */
const next = async (p) => {
  const w = await p.evaluate(() => document.querySelector(".lhero").clientWidth);
  const before = await activeTitle(p);
  await p.mouse.click(w - 80, 450);
  await p.waitForFunction((b) => {
    const c = document.querySelector(".lhero__card--active");
    return (c?.querySelector(".lhero__logo")?.alt ?? c?.querySelector(".lhero__title")?.textContent) !== b;
  }, before, { timeout: 5_000 });
  await p.waitForTimeout(800); // the 650ms slide
};
const gear = (p) => p.getByRole("button", { name: "Settings", exact: true }).first();
const openAppearance = async (p) => {
  await gear(p).click();
  await p.locator(".settings__body").waitFor({ timeout: 15_000 });
  await p.getByRole("tablist", { name: "Settings", exact: true }).getByRole("tab", { name: "Appearance", exact: true }).click();
  await p.getByRole("tablist", { name: "Media" }).getByRole("tab", { name: "Stream", exact: true }).click();
  await p.locator("[data-setting='featured-carousel']").waitFor({ timeout: 10_000 });
  await p.waitForTimeout(300);
};
const closeSettings = async (p) => {
  await p.keyboard.press("Escape");
  await p.locator(".settings__body").waitFor({ state: "detached", timeout: 10_000 });
  await p.waitForTimeout(500);
};
const styles = (p) => p.evaluate(() => ({ shelf: document.querySelectorAll(".shero").length, large: document.querySelectorAll(".lhero").length }));
const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("blammytv.heroStyle") ?? "null"));

// ------------------------------------------------------- the setting
{
  // Nothing stored: the shelf, as it has been since v1.0.5.
  const ctx = await context();
  const p = await openStream(ctx, { style: null, ready: false });
  await p.waitForSelector(".shero__card", { timeout: 20_000 });
  const s = await styles(p);
  check("with nothing stored, Stream has the shelf and not the large hero", s.shelf === 1 && s.large === 0 && (await stored(p)) === null, JSON.stringify(s));

  // Settings, Appearance, Stream: the row is there, Shelf is the one chosen.
  await openAppearance(p);
  const row = p.locator("[data-setting='carousel-style']");
  const pressed = () => row.locator("button[aria-pressed='true']").allInnerTexts();
  const opts = await row.locator("button").allInnerTexts();
  const firstPressed = await pressed();
  check(
    "Settings, Appearance, Stream has Carousel Style with Shelf and Large, Shelf chosen",
    (await row.locator(".customize-row__title").innerText()) === "Carousel Style" && opts.join() === "Shelf,Large" && firstPressed.join() === "Shelf",
    JSON.stringify({ opts, firstPressed }),
  );
  // Directly under Featured Carousel, in this order.
  const order = await p.locator(".settings__body [data-setting]").evaluateAll((els) => els.map((e) => e.getAttribute("data-setting")));
  check(
    "  and it sits directly under Featured Carousel",
    order.indexOf("carousel-style") === order.indexOf("featured-carousel") + 1,
    JSON.stringify(order),
  );

  // Large: stored, and when Settings closes Stream has the large hero and not the shelf.
  await row.getByRole("button", { name: "Large", exact: true }).click();
  const afterPick = { chosen: await pressed(), stored: await stored(p) };
  await closeSettings(p);
  await p.waitForSelector(".lhero__card--active", { timeout: 8_000 }).catch(() => {}); // a failed switch is a failed check, not a crash
  const large = await styles(p);
  check(
    "picking Large stores it, and Stream shows the large hero and no shelf once Settings closes",
    afterPick.chosen.join() === "Large" && afterPick.stored?.data === "large" && large.large === 1 && large.shelf === 0,
    JSON.stringify({ afterPick, large }),
  );

  // And back.
  await openAppearance(p);
  const reopened = await pressed();
  await row.getByRole("button", { name: "Shelf", exact: true }).click();
  await closeSettings(p);
  await p.waitForSelector(".shero__card--active", { timeout: 8_000 }).catch(() => {});
  const back = await styles(p);
  check(
    "reopened, Large is the one chosen; picking Shelf puts the shelf back and takes the large hero away",
    reopened.join() === "Large" && (await stored(p))?.data === "shelf" && back.shelf === 1 && back.large === 0,
    JSON.stringify({ reopened, back }),
  );
  await ctx.close();
}
{
  // A launch with Large stored opens on it, with no shelf mounted.
  const ctx = await context();
  const p = await openStream(ctx, { ready: false });
  await p.waitForSelector(".lhero__card--active", { timeout: 8_000 }).catch(() => {});
  const s = await styles(p);
  check("a launch with Large stored opens on the large hero, with no shelf", s.large === 1 && s.shelf === 0, JSON.stringify(s));
  // An unknown stored value is the shelf, not a blank where the hero was.
  await ctx.close();
  const ctx2 = await context();
  const p2 = await openStream(ctx2, { style: "wide", ready: false });
  await p2.waitForSelector(".shero__card--active", { timeout: 20_000 }).catch(() => {});
  const s2 = await styles(p2);
  check("a stored value it does not know is the shelf", s2.shelf === 1 && s2.large === 0, JSON.stringify(s2));
  await ctx2.close();
}
{
  // Featured Carousel off: the style row goes with it, as the sources do, and
  // comes back with it. The hero is gone either way.
  const ctx = await context();
  const p = await openStream(ctx, { extra: { showHero: { v: 1, data: false } }, ready: false, mouse: null });
  await p.waitForSelector(".stream__rows", { timeout: 20_000 });
  const gone = await styles(p);
  await openAppearance(p);
  const off = await p.evaluate(() => ({
    carousel: !!document.querySelector("[data-setting='featured-carousel']"),
    style: !!document.querySelector("[data-setting='carousel-style']"),
    on: document.querySelector("[data-setting='featured-carousel'] [role=switch]")?.getAttribute("aria-checked"),
  }));
  check(
    "with Featured Carousel off there is no hero of either style, and no Carousel Style row",
    gone.shelf === 0 && gone.large === 0 && off.carousel && off.on === "false" && !off.style,
    JSON.stringify({ gone, off }),
  );
  await p.locator("[data-setting='featured-carousel'] [role=switch]").click();
  await p.waitForTimeout(300);
  const on = await p.evaluate(() => ({ style: !!document.querySelector("[data-setting='carousel-style']") }));
  check("  and switching it on brings the row back", on.style, JSON.stringify(on));
  await ctx.close();
}

// ------------------------------------------- the large hero, as it was
{
  const ctx = await context();
  const p = await openStream(ctx);
  check("the large hero is on Stream", (await p.locator(".lhero").count()) === 1 && (await p.locator(".lhero__card").count()) >= 4);

  // The tilt glare's corner against its card's (v0.9.132). react-parallax-tilt
  // clips its glare to a radius of its own, and each card named one, 25 to
  // 60px, that the restyle's 14px corners left behind: a rounder sheen inside
  // a squarer card. The hero's tilt has no corner of its own; its art does.
  const glareCorners = (sel) =>
    p.evaluate((sel) =>
      [...document.querySelectorAll(sel)].map((g) => {
        const tilt = g.parentElement;
        const card = getComputedStyle(tilt).borderTopLeftRadius !== "0px"
          ? tilt
          : tilt.querySelector(".lhero__art") ?? tilt;
        return [getComputedStyle(g).borderTopLeftRadius, getComputedStyle(card).borderTopLeftRadius];
      }), sel);
  const heroGlare = await glareCorners(".lhero__card--active .lhero__tilt > .glare-wrapper");
  const cardGlare = await glareCorners(".stream-card__tilt > .glare-wrapper");
  check(
    "the hero's and the posters' glare share their card's corner",
    heroGlare.length > 0 && cardGlare.length > 0 && [...heroGlare, ...cardGlare].every(([g, c]) => g === c),
    [...new Set([...heroGlare, ...cardGlare].map(([g, c]) => `glare ${g} on ${c}`))].join(", "),
  );

  // The glare is on the focused card and nobody else's (the library makes it
  // only for a card enabled at mount, so CSS hides the rest).
  const glareShown = await p.evaluate(() =>
    [...document.querySelectorAll(".lhero__card")].map((c) => [c.classList.contains("lhero__card--active"), getComputedStyle(c.querySelector(".glare-wrapper")).display !== "none"]),
  );
  check(
    "only the focused card shows the sheen",
    glareShown.length >= 4 && glareShown.filter(([a]) => a).length === 1 && glareShown.every(([a, shown]) => a === shown),
    JSON.stringify(glareShown),
  );

  // The window of slots: one behind, the card, both neighbours and two ahead,
  // so the next-next card decodes before it slides in.
  const slots = await p.locator(".lhero__card").count();
  const ahead = await p.evaluate(() => {
    const cs = [...document.querySelectorAll(".lhero__card")];
    return cs.length - 1 - cs.findIndex((c) => c.classList.contains("lhero__card--active"));
  });
  check("six cards are mounted, three of them ahead of the focused one", slots === 6 && ahead === 3, JSON.stringify({ slots, ahead }));

  // Keyboard in the hero (v0.9.92). Every slide's buttons were tab stops,
  // peeking and off-screen slides included, and autoplay paused for the
  // mouse only, so a focused button slid off screen 8s after you reached it.
  const peeking = await p.locator(".lhero__card:not(.lhero__card--active)").count();
  const stops = await p.locator(".lhero button:not([tabindex='-1'])").evaluateAll((els) => els.map((e) => [e.closest(".lhero__card")?.classList.contains("lhero__card--active"), e.textContent]));
  check(
    "no tab stops on the peeking hero slides: only the focused card's Watch Now and More Info",
    peeking >= 4 && stops.length === 2 && stops.every(([a]) => a === true) && stops.map(([, t]) => t).join() === "Watch Now,More Info",
    JSON.stringify(stops),
  );
  await p.close();
}
{
  // Autoplay, in the three states that matter. With nothing holding it, the
  // hero moves on its own (the positive: without it the two holds below could
  // pass on a hero that never moves); under the mouse it stays; with focus in
  // it, it stays and the focus is still on screen.
  const ctx = await context();
  const p = await openStream(ctx, { mouse: [2, 2] }); // no hover pause
  const t0 = await activeTitle(p);
  await p.waitForTimeout(9_000);
  const t1 = await activeTitle(p);
  check("autoplay moves the hero on by itself, one card in 8 seconds", t0 !== null && t1 !== null && t1 !== t0, JSON.stringify([t0, t1]));

  await p.waitForTimeout(800);
  await p.locator(".lhero__card--active button").first().focus();
  const f0 = await activeTitle(p);
  await p.waitForTimeout(9_000); // one autoplay interval, and a second
  const stillHere = await p.evaluate(() => {
    const a = document.activeElement;
    const r = a?.getBoundingClientRect();
    return !!a?.closest(".lhero__card--active") && !!r && r.left >= 0 && r.right <= innerWidth;
  });
  check("autoplay holds while focus is in the hero", stillHere && (await activeTitle(p)) === f0, f0);
  await p.evaluate(() => document.activeElement?.blur());

  await p.mouse.move(700, 450);
  const h0 = await activeTitle(p);
  await p.waitForTimeout(9_000);
  check("autoplay holds while the pointer is over the hero", (await activeTitle(p)) === h0, h0);
  await ctx.close();
}
{
  // Reduced motion: no autoplay, and the slide snaps.
  const ctx = await context({ reduced: true });
  const p = await openStream(ctx, { mouse: [2, 2] });
  const t0 = await activeTitle(p);
  await p.waitForTimeout(9_000);
  const dur = await p.evaluate(() => getComputedStyle(document.querySelector(".lhero__track")).transitionDuration);
  check("under reduced motion the hero stays put and its slide has no duration", (await activeTitle(p)) === t0 && /^0s$/.test(dur), JSON.stringify({ t0, dur }));
  await ctx.close();
}

// ---------------------------------------- the slide, the buttons, the gutter
{
  const ctx = await context();
  const p = await openStream(ctx);
  // Forward only: each click on the next card moves the track one step left
  // and puts a different title in focus.
  const seen = [await activeTitle(p)];
  const xs = [await trackX(p)];
  for (let i = 0; i < 4; i++) {
    await next(p);
    seen.push(await activeTitle(p));
    xs.push(await trackX(p));
  }
  check(
    "clicking the next card slides it in, one step left each time, and never back",
    new Set(seen).size === seen.length && xs.every((x, i) => i === 0 || x < xs[i - 1] - 100),
    JSON.stringify({ seen, xs }),
  );
  await ctx.close();
}
{
  // Watch Now and More Info.
  const ctx = await context();
  const asked = [];
  ctx.on("request", (r) => {
    if (/localhost:8084\/.*stream\/movie\//.test(r.url())) asked.push(r.url());
  });
  const p = await openStream(ctx);
  // More Info opens the focused title's page, and Back comes home.
  const t = await activeTitle(p);
  await p.locator(".lhero__card--active").getByRole("button", { name: "More Info", exact: true }).click();
  await p.waitForSelector(".vod-detail", { timeout: 15_000 });
  const detail = await p.locator(".vod-detail").first().innerText();
  check("More Info opens the focused title's page, not a stream", detail.includes(t) && asked.length === 0, JSON.stringify({ t, asked }));
  await p.locator(".vod-back").click();
  await p.waitForSelector(".lhero__card--active", { timeout: 15_000 });
  await p.waitForTimeout(500);

  // The card itself opens the title too, as a click on the focused card always did.
  // On a film: on a series "does not play it" would pass for nothing.
  for (let i = 0; i < 8 && !/Movie/.test(await activeTitle(p)); i++) await next(p);
  const t2 = await activeTitle(p);
  await p.mouse.click(700, 300);
  await p.waitForSelector(".vod-detail", { timeout: 15_000 });
  // A film's page asks for its sources itself (its Sources list), so "does not
  // play" is the player's loading screen never showing, not a quiet network.
  check("a click on the focused card opens its page, and does not play it", /Movie/.test(t2) && (await p.locator(".vod-detail").first().innerText()).includes(t2) && (await p.locator(".vodload").count()) === 0, JSON.stringify({ t2, loading: await p.locator(".vodload").count() }));
  await p.locator(".vod-back").click();
  await p.waitForSelector(".lhero__card--active", { timeout: 15_000 });
  await p.waitForTimeout(500);

  // Watch Now on a series browses (series always do); on a film it asks the
  // addon for sources and plays or falls back to the page. Slide to each.
  for (let i = 0; i < 8 && !/Movie/.test(await activeTitle(p)); i++) await next(p);
  const movie = await activeTitle(p);
  await p.locator(".lhero__card--active").getByRole("button", { name: "Watch Now", exact: true }).click();
  await p.waitForFunction(() => document.body.innerText.length > 0).catch(() => {});
  await p.waitForTimeout(1500);
  check("Watch Now on a film asks the addon for its sources", /Movie/.test(movie) && asked.length > 0, JSON.stringify({ movie, asked }));
  await ctx.close();

  const ctx2 = await context();
  const asked2 = [];
  ctx2.on("request", (r) => {
    if (/localhost:8084\/.*stream\/movie\//.test(r.url())) asked2.push(r.url());
  });
  const q = await openStream(ctx2);
  for (let i = 0; i < 8 && !/Series/.test(await activeTitle(q)); i++) await next(q);
  const series = await activeTitle(q);
  await q.locator(".lhero__card--active").getByRole("button", { name: "Watch Now", exact: true }).click();
  await q.waitForSelector(".vod-detail", { timeout: 15_000 });
  check("Watch Now on a series opens its page", /Series/.test(series) && (await q.locator(".vod-detail").first().innerText()).includes(series) && asked2.length === 0, JSON.stringify({ series, asked2 }));
  await ctx2.close();
}
{
  // Stream's gutter is --gut (max(28px, 3.3vw)), not 28px. The hero bleeds
  // past it to the window's edges, so it has to take --gut with it: with the
  // old -28px it stops 20px short at 1440 (and is right at 700, where --gut
  // is 28px, which is why both widths are here).
  for (const width of [1440, 700]) {
    const ctx = await context({ width, height: 800 });
    const p = await openStream(ctx, { mouse: null });
    const g = await p.evaluate(() => {
      const s = document.querySelector(".stream").getBoundingClientRect();
      const sc = document.querySelector(".stream");
      const h = document.querySelector(".lhero").getBoundingClientRect();
      return { gut: parseFloat(getComputedStyle(sc).getPropertyValue("--gut")) || null, padL: parseFloat(getComputedStyle(sc).paddingLeft), sl: s.left, sw: sc.clientWidth, hl: h.left, hw: h.width };
    });
    check(
      `at ${width}px the large hero runs from the window's edge to the other, past the gutter (${Math.round(g.padL)}px)`,
      Math.abs(g.hl - g.sl) <= 1 && Math.abs(g.hw - g.sw) <= 1 && (width === 1440 ? g.padL > 40 : g.padL === 28),
      JSON.stringify(g),
    );
    await ctx.close();
  }
}
{
  // Under the hero: the rows follow it, Continue Watching first when there is
  // a title being watched.
  const ctx = await context();
  const p = await openStream(ctx, {
    extra: {
      watching: {
        v: 1,
        data: [{ id: "tt555", title: "Odd Movie", kind: "movie", at: Date.now() - 3 * 86400_000, posSec: 1200, durSec: 6000 }],
      },
    },
  });
  const after = await p.evaluate(() => {
    const h = document.querySelector(".lhero");
    const rows = h?.nextElementSibling;
    return { cls: rows?.className ?? null, first: rows?.querySelector(".media-row__title")?.textContent ?? null, below: rows ? rows.getBoundingClientRect().top >= h.getBoundingClientRect().bottom - 1 : false };
  });
  check("Continue Watching is the first row, straight under the large hero", after.cls === "stream__rows" && after.first === "Continue Watching" && after.below, JSON.stringify(after));
  await ctx.close();
}

// -------------------------------- the picture, the ink, the light, the title
{
  // On a picture, the dark theme's ink in both themes (plan 022). In light,
  // Watch Now turned black and More Info vanished into the art; scrolled, the
  // header laid a white haze over the hero. The header takes the picture's
  // ink only while the hero is under it.
  const ctx = await context({ reduced: true });
  const p = await openStream(ctx, { mouse: null, ready: false });
  await p.waitForSelector(".lhero__card--active .on-picture button", { timeout: 15_000 });
  await p.evaluate(() => (document.documentElement.dataset.theme = "light"));
  const ink = () =>
    p.evaluate(() => {
      const [watch, more] = document.querySelectorAll(".lhero__card--active .lhero__actions button");
      const header = document.querySelector(".header");
      return {
        watch: getComputedStyle(watch).backgroundColor,
        more: getComputedStyle(more).color,
        page: getComputedStyle(document.body).color,
        header: getComputedStyle(header).getPropertyValue("--text").trim(),
        flag: document.documentElement.dataset.headerOver ?? "",
        glow: getComputedStyle(document.querySelector(".lhero__glowbox")).display,
      };
    });
  const scrollTo = async (y) => {
    await p.evaluate((y) => (document.querySelector(".stream").scrollTop = y), y);
    await p.waitForTimeout(250);
  };
  const top = await ink();
  await scrollTo(260); // the hero half under the header
  const under = await ink();
  await scrollTo(4000); // rows under the header
  const rows = await ink();
  // Light's page ink is near-black (0.145); the picture's is dark's, 0.985.
  const PIC = "oklch(0.985 0 0)";
  // Lightness, whichever space it comes back in (a transition reads oklab).
  const L = (c) => Number(/^okl(?:ch|ab)\(([\d.]+)/.exec(c)?.[1] ?? NaN);
  check(
    "in light, the hero's Watch Now stays light and More Info's words stay light on the art",
    L(top.watch) === 0.985 && L(top.more) === 0.985 && L(top.page) === 0.145,
    JSON.stringify({ watch: top.watch, more: top.more, page: top.page }),
  );
  check(
    "the header takes the picture's ink while the hero is under it, and gives it back",
    top.flag === "" && under.flag === "picture" && under.header === PIC && rows.flag === "" && rows.header === "oklch(0.145 0 0)",
    JSON.stringify({ top: top.flag, under: [under.flag, under.header], rows: [rows.flag, rows.header] }),
  );
  // Dark only (plan 022): light on a light page isn't light.
  await p.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await scrollTo(0);
  const dark = await ink();
  check("the glow behind the card is dark only: gone in light, drawn in dark", top.glow === "none" && dark.glow === "block", JSON.stringify({ light: top.glow, dark: dark.glow }));
  await ctx.close();
}
{
  // The hero is the shelf's no more than the shelf is this one's: leaving the
  // tab takes the header's ink with it, whichever style set it.
  const ctx = await context({ reduced: true });
  const p = await openStream(ctx, { mouse: null, ready: false });
  await p.waitForSelector(".lhero__card--active .on-picture button", { timeout: 15_000 });
  await p.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await p.evaluate(() => (document.querySelector(".stream").scrollTop = 260));
  await p.waitForTimeout(300);
  const under = await p.evaluate(() => document.documentElement.dataset.headerOver ?? "");
  await goTo(p, "discover");
  await p.waitForTimeout(400);
  const left = await p.evaluate(() => document.documentElement.dataset.headerOver ?? "");
  check("leaving Stream clears the header's picture ink", under === "picture" && left === "", JSON.stringify({ under, left }));
  await ctx.close();
}
{
  // A pick whose details fail, or never come, stays out of the hero, and a
  // build waits on them for 4 seconds at most. Every movie's meta hangs or
  // 404s here, so only the four series can be in it.
  const ctx = await context({ reduced: true });
  await ctx.route(/localhost:8084\/meta\/movie\/tt1000/, () => {}); // never answers
  await ctx.route(/localhost:8084\/meta\/movie\/tt4000/, (r) => r.fulfill({ status: 404, body: "no" }));
  const t0 = Date.now();
  const p = await openStream(ctx, { mouse: null, ready: false });
  const up = await p.waitForSelector(".lhero__card", { timeout: 12_000 }).then(() => true, () => false);
  const took = Date.now() - t0;
  const cards = await p.evaluate(() =>
    [...document.querySelectorAll(".lhero__card")].map((c) => ({
      title: c.querySelector(".lhero__title")?.textContent ?? "",
      art: c.querySelector(".lhero__art")?.getAttribute("src") ?? "",
    })),
  );
  check(
    "the hero leaves out a title whose details fail or never come, rather than showing its preview",
    up && cards.length > 0 && cards.every((c) => c.title.startsWith("Fake Series") && c.art.includes("/bg/")),
    JSON.stringify(cards.map((c) => [c.title, c.art.replace(/^.*\/(\w+\/\w+\.png)$/, "$1")])),
  );
  check("and waits on them for 4 seconds at most", up && took < 9_000, `${took}ms`);
  await ctx.close();
}
{
  // The art fades in once it is decoded, rather than painting in as it
  // arrives: hidden while its bytes are held back here, shown after. The
  // posters in the rows do the same, over the card's placeholder.
  const ctx = await context({ reduced: true });
  let release;
  const held = new Promise((r) => (release = r));
  await ctx.route(/localhost:8084\/(bg|poster)\//, async (r) => {
    await held;
    await r.continue();
  });
  const p = await openStream(ctx, { mouse: null, ready: false });
  await p.waitForSelector(".lhero__card--active .lhero__art", { timeout: 15_000 });
  await p.waitForTimeout(500);
  const style = () =>
    p.evaluate(() => {
      const op = (el) => (el ? Number(getComputedStyle(el).opacity) : -1);
      const art = document.querySelector(".lhero__card--active .lhero__art");
      const glow = document.querySelector(".lhero__glowbox img.lhero__glow--lit");
      const poster = document.querySelector(".stream-card__poster");
      const wrap = poster?.closest(".stream-card__tilt");
      return {
        art: op(art),
        loaded: art?.hasAttribute("data-loaded") ?? false,
        glow: op(glow),
        poster: op(poster),
        placeholder: wrap ? getComputedStyle(wrap).backgroundColor : "",
      };
    });
  const before = await style();
  release();
  await p.waitForFunction(() => document.querySelector(".lhero__card--active .lhero__art")?.hasAttribute("data-loaded"), null, { timeout: 5_000 }).catch(() => {});
  await p.waitForTimeout(800);
  const after = await style();
  check(
    "the hero's art and its light stay hidden until the picture is in, then fade up",
    before.art === 0 && !before.loaded && before.glow === 0 && after.art === 1 && after.loaded && Math.abs(after.glow - 0.7) < 0.01,
    JSON.stringify({ before, after }),
  );
  check(
    "a row's poster does the same, over the card's placeholder",
    before.poster === 0 && !/rgba\(0, 0, 0, 0\)|transparent/.test(before.placeholder) && after.poster === 1,
    JSON.stringify({ before: [before.poster, before.placeholder], after: after.poster }),
  );
  await ctx.close();
}
{
  // A logo that loads is the title; one that fails falls back to the name in
  // type, where it used to be the browser's broken-image box. Every meta gets
  // a logo here: the series' load, the movies' 404.
  const ctx = await context({ reduced: true });
  await ctx.route(/localhost:8084\/meta\//, async (r) => {
    const res = await r.fetch();
    const json = await res.json();
    if (json.meta)
      json.meta.logo = `http://localhost:8084/${json.meta.type === "series" ? "poster" : "nope"}/logo.png`;
    await r.fulfill({ response: res, json });
  });
  const p = await openStream(ctx, { mouse: null, ready: false });
  await p.waitForSelector(".lhero__card", { timeout: 15_000 });
  await p.waitForTimeout(1000);
  const cards = await p.evaluate(() =>
    [...document.querySelectorAll(".lhero__card")].map((c) => {
      const logo = c.querySelector("img.lhero__logo");
      return {
        logo: logo ? logo.alt : null,
        loaded: logo?.hasAttribute("data-loaded") ?? false,
        title: c.querySelector("h2.lhero__title")?.textContent ?? null,
      };
    }),
  );
  const series = cards.filter((c) => (c.logo ?? c.title ?? "").startsWith("Fake Series"));
  const movies = cards.filter((c) => !(c.logo ?? c.title ?? "").startsWith("Fake Series"));
  check(
    "a hero logo that loads is the title, and one that fails falls back to the name",
    series.length > 0 &&
      movies.length > 0 &&
      series.every((c) => c.loaded && c.title === null) &&
      movies.every((c) => c.logo === null && /^(Fake|Extra) Movie/.test(c.title ?? "")),
    JSON.stringify(cards),
  );
  await ctx.close();
}
{
  // A refresh past the cache's 30 minutes draws a new random set, a second
  // after the tab painted the last one. The hero on screen keeps its titles;
  // the new ones are what the tab opens on next time. (Unseeded here: the
  // seeded shuffle would draw the same set twice.)
  const ctx = await context({ reduced: true });
  const p = await ctx.newPage();
  await p.addInitScript(({ style }) => {
    localStorage.setItem("btv:onboarded", "1");
    localStorage.setItem("blammytv.aiostreams", JSON.stringify({ v: 1, data: "http://localhost:8084/manifest.json" }));
    sessionStorage.setItem("btv:welcome-played", "1");
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("blammytv.heroStyle", JSON.stringify({ v: 1, data: style }));
    }
  }, { style: "large" });
  await p.goto("http://localhost:4173/");
  await goTo(p, "home");
  await p.waitForSelector(".lhero__card", { timeout: 15_000 });
  const mirror = () => p.evaluate(() => JSON.parse(localStorage.getItem("blammytv.vodCache") ?? "null")?.data ?? null);
  await p.waitForFunction(() => !!localStorage.getItem("blammytv.vodCache"), null, { timeout: 10_000 });
  // Age the mirror past the TTL, and hold the rebuild's manifest back so
  // the hero from the mirror can be read before the new build lands.
  await p.evaluate(() => {
    const m = JSON.parse(localStorage.getItem("blammytv.vodCache"));
    m.data.at = 0;
    localStorage.setItem("blammytv.vodCache", JSON.stringify(m));
  });
  await ctx.route(/localhost:8084\/manifest\.json/, async (r) => {
    await new Promise((res) => setTimeout(res, 1500));
    await r.continue();
  });
  await p.reload();
  await goTo(p, "home");
  await p.waitForSelector(".lhero__card", { timeout: 10_000 });
  const shown = await titles(p);
  const oldPicks = (await mirror()).featured.join();
  await p.waitForFunction(() => (JSON.parse(localStorage.getItem("blammytv.vodCache"))?.data?.at ?? 0) > 0, null, { timeout: 15_000 }).catch(() => {});
  await p.waitForTimeout(600);
  const after = await titles(p);
  const newPicks = ((await mirror())?.featured ?? []).join();
  check(
    "a refresh keeps the hero's titles on screen, and saves its own picks for next time",
    shown.length > 0 && JSON.stringify(after) === JSON.stringify(shown) && newPicks !== "" && newPicks !== oldPicks,
    JSON.stringify({ shown: shown.slice(0, 3), after: after.slice(0, 3), picksChanged: newPicks !== oldPicks }),
  );
  await ctx.close();
}

await browser.close();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
process.exit(fails.length ? 1 : 0);

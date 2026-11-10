// E2E: Settings → Appearance → Theme (plan 035). Four packs laid over the
// app's palette: Prism, Velvet and Lagoon (dark only), and Fluent (a Light face
// too: the "Fluent has a face for Light" section below). A pack changes colour, type,
// texture, light and transparency, and NEVER a radius, a shape or a layout
// (Adam, 1.3): "no pack changes a radius" below is that rule, tested.
//
// What can go wrong here is quiet, and none of it throws:
//   - a pack that leaks. No pack must be the base palette, token for token;
//     choosing Default after a pack must give it back exactly.
//   - a pack that wins in Light. Prism, Velvet and Lagoon are dark palettes; in
//     Light the attribute stays and nothing may match (the selector's :not).
//   - a hook that paints without a pack. Prism's three spots (the now-line,
//     the progress fill and LIVE dot, the hero's halo) must draw what they
//     always did when unset. The nav's pill and the focus ring are NOT among
//     them: every theme keeps the app's own.
//   - the accent. A pack that takes one (Velvet, Lagoon) has its own picker
//     and remembers its own pick; Prism has none; the default store is
//     untouched by all of it.
//   - first paint. The pack is on the root before React mounts.
//   - round 2 (1.3): Velvet's type, grain and footlight, Lagoon's see-through
//     floats (and plain cards) going opaque under reduced transparency, and
//     Fluent's Segoe stack and its Mica: native's answer at the IPC boundary
//     decides whether the base is #202020 or see-through, and leaving Fluent
//     asks native to take Mica off.
//
// The player's progress fill and LIVE dot are drawn by TheaterOverlay, which
// needs a player; they are probed here as the classes the overlay renders.
//
//   node scripts/fake-panel.mjs; node scripts/fake-aio.mjs   # :8081, :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-themes.mjs
import { createRequire } from "node:module";
import { goTo } from "./nav-settle.mjs";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${n}${d ? `: ${d}` : ""}`);
};

const APP = process.env.APP_URL ?? "http://localhost:4173/";
const PLAYLISTS = { v: 1, data: [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" }] };
const AIO = { v: 1, data: "http://localhost:8084/manifest.json" };

/** What each pack must resolve to (styles/packs.css), as the sheet writes it. */
const PACKS = {
  prism: { bg: "#000000", surface: "#111111", text: "#ffffff", accent: "#ffffff" },
  velvet: { bg: "#170d10", surface: "#251619", text: "#f6ece5", accent: "#e8bb6c" },
  lagoon: { bg: "#08191e", surface: "rgb(22 62 70 / 0.55)", text: "#eefbf8", accent: "#5fe1c1" },
  fluent: { bg: "#202020", surface: "rgb(255 255 255 / 0.0512)", text: "#ffffff", accent: "#60cdff" },
};
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/** A page that reaches nothing but this machine, signed in to the two fakes.
 * `store` is written ONCE per tab (the first load), so a reload keeps what the
 * page itself saved. */
async function open({ store = {}, scheme = "dark", reduced = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: scheme,
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await ctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ store, PLAYLISTS, AIO }) => {
      localStorage.setItem("btv:onboarded", "1"); localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
      sessionStorage.setItem("btv:welcome-played", "1");
      if (!sessionStorage.getItem("btv:themes-seeded")) {
        sessionStorage.setItem("btv:themes-seeded", "1");
        localStorage.setItem("blammytv.playlists", JSON.stringify(PLAYLISTS));
        localStorage.setItem("blammytv.aiostreams", JSON.stringify(AIO));
        for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: v.v ?? 1, data: v.data }));
      }
      // When the pack landed on the root, and when React first drew.
      window.__t = {};
      new MutationObserver(() => {
        if (document.documentElement.dataset.themePack && !window.__t.pack) window.__t.pack = performance.now();
        if (document.getElementById("root")?.firstChild && !window.__t.mount) window.__t.mount = performance.now();
      }).observe(document, { attributes: true, childList: true, subtree: true });
    },
    { store, PLAYLISTS, AIO },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap, .flc-title", { timeout: 20_000 });
  return { ctx, page, errors };
}

const root = (page, names) =>
  page.evaluate((names) => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
  }, names);

/** A token as a colour, [r, g, b, a], whichever form the browser resolves it
 * to (rgb(), or color(srgb ...) for a color-mix). Painted on a probe, so it is
 * what the page would draw. */
const tokenColor = (page, token, prop = "color") =>
  page.evaluate(
    ({ token, prop }) => {
      const probe = document.createElement("i");
      probe.style[prop] = `var(${token})`;
      document.body.append(probe);
      const s = getComputedStyle(probe)[prop];
      probe.remove();
      const n = (s.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
      const scale = s.startsWith("color(") ? 255 : 1;
      return [0, 1, 2].map((i) => Math.round(n[i] * scale)).concat(Math.round((n[3] ?? 1) * 100) / 100);
    },
    { token, prop },
  );
const near = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= 1 / (i === 3 ? 50 : 1));
const hexRgb = (hex, a = 1) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(a);

/** Every custom property the root has, resolved: the whole palette at once. */
const rootTokens = (page) =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries([...cs].filter((n) => n.startsWith("--")).sort().map((n) => [n, cs.getPropertyValue(n).trim()]));
  });

const style = (page, sel, props, pseudo) =>
  page.evaluate(
    ({ sel, props, pseudo }) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el, pseudo ?? null);
      return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    },
    { sel, props, pseudo },
  );

/** The three places Prism draws the ramp, each read where the app draws it (or
 * as the overlay's classes), and the base colour each falls back to. The nav's
 * pills are read too: no theme puts anything on them. */
async function hooks(page) {
  const pills = await page.evaluate(() =>
    // Fluent has no capsule (its title bar and pane replace it), so no pills.
    [".navcap__row--nav .navcap__pill", ".navcap__row--sub .navcap__pill"].filter((sel) => document.querySelector(sel)).map((sel) => {
      const cs = getComputedStyle(document.querySelector(sel));
      return { image: cs.backgroundImage, color: cs.backgroundColor };
    }),
  );
  const probes = await page.evaluate(() => {
    const host = document.createElement("div");
    host.innerHTML =
      '<div class="theater-seek"><div class="theater-seek__track"><div class="theater-seek__clip"><div class="theater-seek__fill"></div></div></div></div>' +
      '<div class="theater-live is-live"><span class="theater-live__dot"></span></div>' +
      '<div class="guide__nowline probe-nowline"></div>';
    document.body.append(host);
    const read = (sel, pseudo) => {
      const cs = getComputedStyle(host.querySelector(sel), pseudo ?? null);
      return { image: cs.backgroundImage, color: cs.backgroundColor, display: cs.display };
    };
    const out = {
      fill: read(".theater-seek__fill"),
      dot: read(".theater-live__dot"),
      dotGlow: read(".theater-live__dot", "::after"),
      probeLine: read(".probe-nowline"),
      probeLineGlow: read(".probe-nowline", "::before"),
    };
    host.remove();
    return out;
  });
  return { pills, ...probes };
}

/** Nothing painted: no image and no colour. A glow that fell back to a solid would pass an image check alone. */
const blank = (x) => x.image === "none" && x.color === "rgba(0, 0, 0, 0)";
/** The dither field is the shell's ::before (base.css, fed by --pack-bg-*). */
const dither = (page) => style(page, ".app-shell", ["background-image", "background-size", "opacity"], "::before");
// (onboarding's 0.022 reads back as 0.024: the browser keeps alpha in 8 bits.)
const isDithered = (d) =>
  (d["background-image"].match(/radial-gradient/g) ?? []).length === 2 &&
  d["background-image"].includes("rgba(255, 255, 255, 0.05)") && d["background-image"].includes("rgba(255, 255, 255, 0.024)") &&
  d["background-size"] === "4px 4px, 8px 8px" && d.opacity === "1";
const noDither = (d) => d["background-image"] === "none" && d.opacity === "0";
/** The cursor light: how many, where it is and whether it has shown. */
const glowOf = (page) =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll(".prism-glow")];
    const el = els[0];
    if (!el) return { count: 0 };
    const cs = getComputedStyle(el);
    const m = /matrix\(([^)]*)\)/.exec(cs.transform);
    const [, , , , x, y] = m ? m[1].split(",").map(Number) : [0, 0, 0, 0, 0, 0];
    return {
      count: els.length,
      inShell: !!el.closest(".app-shell"),
      live: el.classList.contains("is-live"),
      opacity: cs.opacity,
      display: cs.display,
      x, y,
      size: [cs.width, cs.height],
      zIndex: cs.zIndex,
      image: cs.backgroundImage,
    };
  });
const stops = (image) => [...image.matchAll(/rgba?\([^)]*\)/g)].map((m) => m[0]);

// ------------------------------------------------------------ Default first
const base = {};
{
  const { ctx, page, errors } = await open();
  const t = await root(page, ["--bg", "--surface", "--accent", "--text"]);
  check(
    "no pack: the root has no theme attribute, and the palette is the app's own",
    (await page.evaluate(() => document.documentElement.dataset.themePack)) === undefined &&
      t["--bg"] === "oklch(0.145 0 0)" && t["--accent"] === "oklch(0.922 0 0)" && t["--text"] === "oklch(0.985 0 0)",
    JSON.stringify(t),
  );
  base.tokens = await rootTokens(page);
  base.hooks = await hooks(page);
  const h = base.hooks;
  check(
    "no pack: none of the three draws the ramp",
    h.fill.image === "none" && blank(h.dotGlow) &&
      h.probeLine.image === "none" && blank(h.probeLineGlow) &&
      (await style(page, ".shero__glowbox", ["background-image"]))?.["background-image"] !== "conic-gradient",
    JSON.stringify({ fill: h.fill, dotGlow: h.dotGlow, line: h.probeLine }),
  );
  check(
    "no pack: the fill, the line and the dot are the accent, as they were",
    h.fill.color === t["--accent"] && h.probeLine.color === t["--accent"] && h.dot.color === t["--accent"],
    JSON.stringify({ fill: h.fill.color, line: h.probeLine.color, dot: h.dot.color, accent: t["--accent"] }),
  );
  check(
    "no pack: the nav's pills have no image on them",
    h.pills.every((p) => p.image === "none"),
    JSON.stringify(h.pills),
  );
  await goTo(page, "home");
  await page.waitForSelector(".shero__glowbox", { state: "attached", timeout: 20_000 });
  const glow = await style(page, ".shero__glowbox", ["background-image", "filter", "opacity"]);
  const track = await style(page, ".shero__glowtrack", ["display"]);
  check(
    "no pack: the hero's halo is the art's own copies, unfiltered",
    glow["background-image"] === "none" && glow.filter === "none" && glow.opacity === "1" && track.display === "flex",
    JSON.stringify({ glow, track }),
  );
  await goTo(page, "guide");
  await page.waitForSelector(".guide__nowline", { state: "attached", timeout: 20_000 });
  const line = await style(page, ".guide__nowline", ["background-image", "background-color"]);
  const lineGlow = await style(page, ".guide__nowline", ["background-image", "background-color"], "::before");
  check(
    "no pack: the Guide's now-line is the accent, with no glow",
    line["background-image"] === "none" && line["background-color"] === t["--accent"] && lineGlow["background-image"] === "none" && lineGlow["background-color"] === "rgba(0, 0, 0, 0)",
    JSON.stringify({ line, lineGlow }),
  );
  // The focus ring the app has: read on the first Tab stop.
  base.ring = await ringOf(page);
  check("no pack: Tab shows the app's own ring, on --focus-ring, with no animation", base.ring.style === "solid" && base.ring.width === "2px" && base.ring.animation === "none" && base.ring.color === base.ring.focusRing, JSON.stringify(base.ring));
  const d0 = await dither(page);
  await page.mouse.move(500, 400);
  await page.waitForTimeout(300);
  const g0 = await glowOf(page);
  check("no pack: no dither field and no cursor light, even with the pointer moving", noDither(d0) && g0.count === 0, JSON.stringify({ d0, g0 }));
  check("no pack: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/** The first keyboard focus: its outline, and the --focus-ring it should wear. */
async function ringOf(page) {
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || !el.matches(":focus-visible")) return null;
      const cs = getComputedStyle(el);
      const probe = document.createElement("i");
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--focus-ring");
      document.body.append(probe);
      const focusRing = getComputedStyle(probe).color;
      probe.remove();
      return { style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset, animation: cs.animationName, color: cs.outlineColor, focusRing };
    });
    if (r) return r;
  }
  return null;
}

// ----------------------------------------------------------- each pack, dark
for (const [key, want] of Object.entries(PACKS)) {
  const { ctx, page, errors } = await open({ store: { themePack: { data: key } } });
  const attr = await page.evaluate(() => document.documentElement.dataset.themePack);
  const t0 = await page.evaluate(() => window.__t);
  check(`${key}: a stored pack is on the root before React draws`, attr === key && t0.pack !== undefined && t0.mount !== undefined && t0.pack <= t0.mount, JSON.stringify(t0));
  const seen = async (where) => {
    const t = await root(page, ["--bg", "--surface", "--text", "--accent"]);
    const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(
      `${key}: --bg, --surface, --text and --accent are the pack's, and the page is painted in them, on ${where}`,
      t["--bg"] === want.bg && t["--surface"] === want.surface && t["--text"] === want.text && t["--accent"] === want.accent && body === rgb(want.bg),
      JSON.stringify({ t, body }),
    );
  };
  await goTo(page, "guide");
  await page.waitForSelector(".guide__nowline", { state: "attached", timeout: 20_000 });
  await seen("the Guide");
  const line = await style(page, ".guide__nowline", ["background-image"]);
  const lineGlow = await style(page, ".guide__nowline", ["background-image", "filter", "opacity"], "::before");
  await goTo(page, "home");
  // Fluent draws its own banner on Stream, not the hero's halo (so no glowbox).
  await page.waitForSelector(key === "fluent" ? ".fls-banner" : ".shero__glowbox", { state: "attached", timeout: 20_000 });
  await seen("Stream");
  const glow = await style(page, ".shero__glowbox", ["background-image", "filter", "opacity"]);
  const track = await style(page, ".shero__glowtrack", ["display"]);
  const h = await hooks(page);

  if (key === "prism") {
    const ramp = stops(line["background-image"]);
    check(
      "prism: the now-line is the brand ramp, top to bottom, with no glow beside it (Adam, 1.2)",
      ramp.length === 7 && ramp[0] === "rgb(255, 155, 155)" && ramp[6] === "rgb(255, 229, 127)" &&
        lineGlow["background-image"] === "none" && lineGlow.filter === "none",
      JSON.stringify({ line, lineGlow }),
    );
    const fill = stops(h.fill.image);
    check(
      "prism: the progress fill is the ramp",
      fill.length === 7 && fill[0] === "rgb(255, 155, 155)" && fill[6] === "rgb(255, 229, 127)",
      h.fill.image,
    );
    const dotGlow = stops(h.dotGlow.image);
    check(
      "prism: the LIVE dot has a faint ring of the mark's own stops, and is still the accent",
      /^conic-gradient/.test(h.dotGlow.image) && dotGlow.length === 7 && dotGlow[0] === "rgb(255, 147, 175)" && h.dot.color === rgb(want.accent),
      JSON.stringify({ glow: h.dotGlow.image, dot: h.dot.color }),
    );
    const halo = stops(glow["background-image"]);
    check(
      "prism: the hero's halo is the mark's ramp, blurred and faint, in place of the art's copies",
      /^conic-gradient/.test(glow["background-image"]) && halo.length === 7 && halo[0] === "rgb(255, 147, 175)" &&
        glow.filter === "blur(70px)" && glow.opacity === "0.28" && track.display === "none",
      JSON.stringify({ glow, track }),
    );
    const d = await dither(page);
    check("prism: the page carries onboarding's dither, two lattices at 4px and 8px", isDithered(d), JSON.stringify(d));
    const ring = await ringOf(page);
    check(
      "prism: the focus ring is the app's own, unchanged from Default",
      ring && ring.style === base.ring.style && ring.width === base.ring.width && ring.offset === base.ring.offset &&
        ring.animation === "none" && ring.color === ring.focusRing,
      JSON.stringify({ ring, base: base.ring }),
    );
  } else {
    check(
      `${key}: none of the ramp's hooks is set`,
      h.fill.image === "none" && blank(h.dotGlow) && line["background-image"] === "none" &&
        (key === "fluent" ? glow === null && track === null : key === "velvet" || (glow["background-image"] === "none" && track.display === "flex")),
      JSON.stringify({ fill: h.fill.image, line, glow }),
    );
    if (key === "velvet")
      check(
        "velvet: the hero's glow is the warm footlight, a radial and not the ramp, in place of the art's copies",
        /^radial-gradient/.test(glow["background-image"]) && glow["background-image"].includes("rgba(232, 150, 80, 0.85)") &&
          !/conic/.test(glow["background-image"]) && track.display === "none" && glow.filter === "blur(36px)",
        JSON.stringify({ glow, track }),
      );
    check(`${key}: its tokens beyond the four are the pack's (a sidebar, a plate on the card)`, (await root(page, ["--sidebar"]))["--sidebar"] !== base.tokens["--sidebar"]);
    await page.mouse.move(500, 400);
    await page.waitForTimeout(300);
    check(`${key}: no dither field and no cursor light`, noDither(await dither(page)) && (await glowOf(page)).count === 0);
  }
  // Fluent has no capsule to carry pills; the others keep both.
  check(
    `${key}: the nav's pills are the app's own, with no image on either`,
    key === "fluent" ? h.pills.length === 0 : h.pills.length === 2 && h.pills.every((p) => p.image === "none"),
    JSON.stringify(h.pills),
  );
  check(`${key}: no page errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ------------------------------------------------- Prism's cursor light
{
  const { ctx, page, errors } = await open({ store: { themePack: { data: "prism" } } });
  const before = await glowOf(page);
  check(
    "prism: the cursor light is mounted inside .app-shell and stays hidden until the pointer moves",
    before.count === 1 && before.inShell && !before.live && before.opacity === "0",
    JSON.stringify(before),
  );
  await page.mouse.move(600, 400);
  await page.waitForTimeout(900);
  const a = await glowOf(page);
  check(
    "prism: the pointer shows it, centred on the pointer (its box is 120px)",
    a.live && a.opacity === "1" && a.size.join() === "120px,120px" && Math.abs(a.x - 600) <= 2 && Math.abs(a.y - 400) <= 2,
    JSON.stringify(a),
  );
  check(
    "prism: it is onboarding's light, brighter: 0.16 at the centre, behind the content",
    a.image.includes("rgba(255, 255, 255, 0.16)") && a.image.includes("rgba(255, 255, 255, 0.05) 42%") && a.image.includes("66%") && a.zIndex === "-1",
    JSON.stringify({ image: a.image, z: a.zIndex }),
  );
  await page.mouse.move(1000, 300);
  await page.waitForTimeout(120);
  const mid = await glowOf(page);
  await page.waitForTimeout(1200);
  const b = await glowOf(page);
  check(
    "prism: it trails a moved pointer, then arrives",
    mid.x < 995 && mid.x > 600 && Math.abs(b.x - 1000) <= 2 && Math.abs(b.y - 300) <= 2,
    JSON.stringify({ mid: [mid.x, mid.y], arrived: [b.x, b.y] }),
  );
  // Behind the content, over the dither: after the shell's ::before in paint
  // order (it is the shell's first child; ::before comes first of all).
  check("prism: the page errors are none", errors.length === 0, errors.join(" | "));
  await ctx.close();
}
{
  // A finger has no hover to light, and reduced motion keeps it off.
  const { ctx, page } = await open({ store: { themePack: { data: "prism" } } });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove", { pointerType: "touch", clientX: 300, clientY: 300 })));
  await page.waitForTimeout(300);
  const touch = await glowOf(page);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove", { pointerType: "pen", clientX: 300, clientY: 300 })));
  await page.waitForTimeout(300);
  const pen = await glowOf(page);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", clientX: 300, clientY: 300 })));
  await page.waitForTimeout(300);
  const mouse = await glowOf(page);
  check("prism: touch and pen do not light it, a mouse does", !touch.live && !pen.live && mouse.live, JSON.stringify({ touch: touch.live, pen: pen.live, mouse: mouse.live }));
  await ctx.close();
}
{
  const { ctx, page } = await open({ store: { themePack: { data: "prism" } }, reduced: true });
  await page.mouse.move(600, 400);
  await page.waitForTimeout(400);
  check(
    "prism with reduced motion: no cursor light at all, and the dither is still there",
    (await glowOf(page)).count === 0 && isDithered(await dither(page)),
    JSON.stringify({ glow: await glowOf(page), dither: await dither(page) }),
  );
  await ctx.close();
}

// ------------------------------------------------------- the video's hole
// The inverted player cuts a clip-path hole through .app-shell and shows the
// native video beneath the page. A layer outside the shell is not clipped and
// would paint over the video, so the dither (the shell's ::before) and the
// light (mounted in the shell) must both be cut. The page is made to look like
// the real mode: the root transparent over a magenta stand-in for the video,
// the shell painting the background, and a hole cut over the pointer.
{
  const { ctx, page } = await open({ store: { themePack: { data: "prism" } } });
  const HOLE = { l: 500, t: 300, r: 900, b: 600 };
  await page.addStyleTag({
    content:
      // the page's own content out of the way, so only the shell's layers show
      ".app-shell > .header, .app-shell > .app-main { visibility: hidden !important; }",
  });
  await page.evaluate(() => {
    document.documentElement.classList.add("invert-player");
    document.documentElement.style.background = "#ff00ff";
  });
  /** Pixels in a rect that are not exactly the stand-in magenta, and the rect's size. */
  const notMagenta = async (r) => {
    const png = await page.screenshot({ clip: { x: r.l, y: r.t, width: r.r - r.l, height: r.b - r.t } });
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let bad = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] !== 255 || d[i + 1] !== 0 || d[i + 2] !== 255) bad++;
      return { bad, of: d.length / 4 };
    }, png.toString("base64"));
  };
  // Positive controls, before any hole: the dither draws dots on the black shell.
  const outside = { l: 20, t: 700, r: 120, b: 780 };
  const lit = async (r) => {
    const png = await page.screenshot({ clip: { x: r.l, y: r.t, width: r.r - r.l, height: r.b - r.t } });
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let max = 0;
      let dots = 0;
      for (let i = 0; i < d.length; i += 4) {
        max = Math.max(max, d[i]);
        if (d[i] > 0) dots++;
      }
      return { max, dots };
    }, png.toString("base64"));
  };
  const dots = await lit(outside);
  check("the hole check can see the dither: dots on the black shell, outside any hole", dots.dots > 100 && dots.max < 40, JSON.stringify(dots));
  // The light beside the hole is painted, so a clean hole is not just a light that never shows.
  await page.mouse.move(420, 450);
  await page.waitForTimeout(900);
  await page.addStyleTag({ content: ".prism-glow { display: block !important; opacity: 1 !important; transition: none !important; }" });
  const beside = await lit({ l: 400, t: 430, r: 440, b: 470 });
  check("and the light, beside the hole", beside.max > 25, JSON.stringify(beside));
  // Now the pointer over the hole's middle, and the hole cut around it.
  await page.mouse.move(700, 450);
  await page.waitForTimeout(1200);
  await page.evaluate(({ l, t, r, b }) => {
    const W = innerWidth;
    const H = innerHeight;
    document.querySelector(".app-shell").style.clipPath = `path("M0 0H${W}V${H}H0Z M${l} ${t}L${l} ${b}L${r} ${b}L${r} ${t}Z")`;
  }, HOLE);
  await page.waitForTimeout(150);
  const g = await glowOf(page);
  const hole = await notMagenta({ l: HOLE.l + 4, t: HOLE.t + 4, r: HOLE.r - 4, b: HOLE.b - 4 });
  check(
    "a player's hole is clean: no dither dot and no light over the video, with the light forced on",
    g.live && hole.bad === 0 && hole.of > 100_000,
    JSON.stringify({ glow: { x: g.x, y: g.y, live: g.live }, hole }),
  );
  // And by the app's own rule the light is off while a hole is cut.
  await page.evaluate(() => {
    for (const s of [...document.querySelectorAll("style")]) if (s.textContent.includes(".prism-glow { display: block")) s.remove();
  });
  check("and the light is off while a hole is cut", (await glowOf(page)).display === "none");
  await ctx.close();
}

// ------------------------------------------------- solid, with effects off
{
  const { ctx, page } = await open({ store: { themePack: { data: "prism" } } });
  // Windows' "Transparency effects" off reaches the page as this media query.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  await page.waitForTimeout(100);
  const h = await hooks(page);
  const accent = (await root(page, ["--accent"]))["--accent"];
  check(
    "prism with transparency effects off: no dot glow, no line glow, and the fills are the accent",
    blank(h.dotGlow) && h.fill.image === "none" && h.fill.color === rgb(accent) &&
      h.probeLine.image === "none" && h.probeLine.color === rgb(accent) && blank(h.probeLineGlow),
    JSON.stringify({ fill: h.fill, line: h.probeLine, accent }),
  );
  await page.mouse.move(500, 400);
  await page.waitForTimeout(300);
  check(
    "prism with transparency effects off: no dither and no cursor light",
    (await dither(page)).opacity === "0" && (await glowOf(page)).display === "none",
    JSON.stringify({ d: await dither(page), g: await glowOf(page) }),
  );
  await goTo(page, "home");
  await page.waitForSelector(".shero__glowbox", { state: "attached", timeout: 20_000 });
  const glow = await style(page, ".shero__glowbox", ["background-image", "filter", "opacity"]);
  const track = await style(page, ".shero__glowtrack", ["display"]);
  check("prism with transparency effects off: the hero keeps the art's own glow", glow["background-image"] === "none" && glow.filter === "none" && glow.opacity === "1" && track.display === "flex", JSON.stringify({ glow, track }));
  await ctx.close();
}

// ------------------------------------------------ round 2 (1.3), shared bits
/** What a page reports of the things the rule says no pack may change. A card
 * (the poster), a button, a menu (Ctrl+K's panel) and a dialog, read where the
 * app draws them. */
async function radii(page) {
  return page.evaluate(async () => {
    const r = (el) => (el ? getComputedStyle(el).borderRadius : null);
    const out = {};
    out.card = r(document.querySelector(".stream-card__poster"));
    out.tilt = r(document.querySelector(".stream-card__tilt"));
    out.button = r(document.querySelector(".navcap__search") ?? document.querySelector("button"));
    // A menu and a dialog the way the components draw them: Ctrl+K is a dialog
    // with the popover glass, and a bare dialog-content is the plain one.
    const probe = document.createElement("div");
    probe.innerHTML = '<div data-slot="dialog-content" class="rounded-lg" id="p-dialog"></div><div class="rounded-md bg-popover" id="p-menu"></div>';
    document.body.append(probe);
    out.dialog = r(probe.querySelector("#p-dialog"));
    out.menu = r(probe.querySelector("#p-menu"));
    probe.remove();
    return out;
  });
}
const flatten = (o) => JSON.stringify(Object.entries(o).sort());

/** A page with native answering at the IPC boundary (isTauri() is then true)
 * and recording what it was asked: window_mica gets `mica` for an answer. */
async function nativePage({ store = {}, mica = true, scheme = "dark" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  await ctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ store, PLAYLISTS, AIO, mica }) => {
      localStorage.setItem("btv:onboarded", "1"); localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
      sessionStorage.setItem("btv:welcome-played", "1");
      if (!sessionStorage.getItem("btv:themes-seeded")) {
        sessionStorage.setItem("btv:themes-seeded", "1");
        localStorage.setItem("blammytv.playlists", JSON.stringify(PLAYLISTS));
        localStorage.setItem("blammytv.aiostreams", JSON.stringify(AIO));
        for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: v.v ?? 1, data: v.data }));
      }
      window.__calls = [];
      let cb = 0;
      const listeners = {};
      window.__TAURI_INTERNALS__ = {
        transformCallback: (f) => { const id = ++cb; window["_" + id] = f; return id; },
        convertFileSrc: (p) => p,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
        invoke: (cmd, args) => {
          window.__calls.push([cmd, args]);
          if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
          if (cmd === "plugin:event|listen") { (listeners[args.event] ??= []).push(args.handler); return Promise.resolve(++cb); }
          if (cmd === "window_mica") return Promise.resolve(args.on ? mica : false);
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    },
    { store, PLAYLISTS, AIO, mica },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap, .flc-title", { timeout: 20_000 });
  return { ctx, page, errors };
}
const micaCalls = (page) => page.evaluate(() => window.__calls.filter((c) => c[0] === "window_mica").map((c) => c[1].on));
/** The face each window_mica question named (dark: true is Dark). */
const micaFaces = (page) => page.evaluate(() => window.__calls.filter((c) => c[0] === "window_mica").map((c) => c[1].dark));
const micaCount = (page, n) => page.waitForFunction((n) => window.__calls.filter((c) => c[0] === "window_mica").length === n, n, { timeout: 5000 }).catch(() => {});
const bodyBg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
/** What paints the page's base: the body, or the shell where the inverted player is on (base.css). */
const paintBg = (page) =>
  page.evaluate(() => getComputedStyle(document.documentElement.classList.contains("invert-player") ? document.querySelector(".app-shell") : document.body).backgroundColor);
const shellBg = (page) => page.evaluate(() => getComputedStyle(document.querySelector(".app-shell")).backgroundColor);
/** The families a page has actually loaded, by name. */
const loadedFaces = (page) =>
  page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")));
const fontOf = (page, token) =>
  page.evaluate((token) => {
    const probe = document.createElement("i");
    probe.style.fontFamily = `var(${token})`;
    document.body.append(probe);
    const f = getComputedStyle(probe).fontFamily;
    probe.remove();
    return f;
  }, token);

// ----------------------------------------------- no pack changes a radius
// The rule (Adam, 1.3): "I don't want to edit the corner radius of elements.
// I think the themes should still be Shadcn at the core." Default's computed
// corners are read first, then every pack's, on the same elements.
{
  const dflt = await open();
  await goTo(dflt.page, "discover");
  await dflt.page.locator(".stream-card__poster").first().waitFor({ timeout: 20_000 });
  const want = await radii(dflt.page);
  check(
    "radii: Default's card, tilt, button, dialog and menu all have a corner to compare",
    Object.values(want).every((v) => v !== null && v !== "0px"),
    JSON.stringify(want),
  );
  const RADIUS_TOKENS = ["--radius", "--radius-card", "--radius-chip", "--radius-pic", "--radius-track", "--radius-pill"];
  const wantTok = await root(dflt.page, RADIUS_TOKENS);
  await dflt.ctx.close();
  for (const key of Object.keys(PACKS)) {
    const { ctx, page } = await open({ store: { themePack: { data: key } } });
    await goTo(page, "discover");
    await page.locator(".stream-card__poster").first().waitFor({ timeout: 20_000 });
    const got = await radii(page);
    // Fluent is the Windows 11 app now (8px cards, 4px controls): the plan
    // (035, "Tier 3") exempts a tier-3 pack from the corner check. Its tokens
    // are still held to Default's below. themePack.ts lists it as tier 3.
    if (key !== "fluent") check(`radii: ${key} leaves every corner as Default has it`, flatten(got) === flatten(want), JSON.stringify({ got, want }));
    const tok = await root(page, RADIUS_TOKENS);
    check(`radii: ${key} leaves the radius tokens alone`, JSON.stringify(tok) === JSON.stringify(wantTok), JSON.stringify({ tok, wantTok }));
    await ctx.close();
  }
}

// ------------------------------------------------------------------ Velvet
{
  const { ctx, page, errors } = await open({ store: { themePack: { data: "velvet" } } });
  await goTo(page, "discover");
  await page.locator(".stream-card__poster").first().waitFor({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const head = await fontOf(page, "--font-headline");
  const text = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check(
    "velvet: headings resolve to Bodoni Moda and text to Figtree",
    head.startsWith('"Bodoni Moda Variable"') && text.startsWith('"Figtree Variable"'),
    JSON.stringify({ head, text }),
  );
  const faces = await loadedFaces(page);
  check(
    "velvet: both files are loaded, because something is set in them",
    faces.some((f) => f.startsWith("Bodoni Moda")) && faces.some((f) => f.startsWith("Figtree")),
    faces.join(", "),
  );
  const grain = await style(page, ".app-shell", ["background-image", "background-size", "position", "pointer-events", "z-index", "content"], "::after");
  check(
    "velvet: the film grain is on the shell, a 160px tile of noise drawn from an inline SVG, and never takes a click",
    grain["background-image"].startsWith('url("data:image/svg+xml,') && grain["background-image"].includes("feTurbulence") &&
      grain["background-size"] === "160px 160px" && grain["pointer-events"] === "none" && grain.position === "absolute",
    JSON.stringify({ ...grain, "background-image": grain["background-image"].slice(0, 60) }),
  );
  const tile = await page.evaluate(() => {
    const m = /url\("data:image\/svg\+xml,([^"]*)"\)/.exec(getComputedStyle(document.querySelector(".app-shell"), "::after").backgroundImage);
    return m ? decodeURIComponent(m[1]) : "";
  });
  check("velvet: the tile is 160px square at 15%", /width='160'/.test(tile) && /height='160'/.test(tile) && /opacity='\.15'/.test(tile), tile.slice(0, 120));
  const vig = await style(page, ".stream-card__tilt", ["box-shadow", "border-radius"], "::after");
  check(
    "velvet: a poster's corners are darkened by an inset shadow of 90px at 0.55 black, and its radius is untouched",
    /inset/.test(vig["box-shadow"]) && vig["box-shadow"].includes("rgba(0, 0, 0, 0.55)") && vig["box-shadow"].includes("90px") &&
      vig["border-radius"] === (await style(page, ".stream-card__tilt", ["border-radius"]))["border-radius"],
    JSON.stringify(vig),
  );
  check("velvet: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();

  // Only under Velvet: Default and the others draw no grain, no vignette, and fetch no font.
  for (const key of ["none", "prism", "lagoon", "fluent"]) {
    const o = await open({ store: key === "none" ? {} : { themePack: { data: key } } });
    await goTo(o.page, "discover");
    await o.page.locator(".stream-card__poster").first().waitFor({ timeout: 20_000 });
    await o.page.evaluate(() => document.fonts.ready);
    await o.page.waitForTimeout(300);
    const g = await style(o.page, ".app-shell", ["content", "background-image"], "::after");
    const v = await style(o.page, ".stream-card__tilt", ["content", "box-shadow"], "::after");
    const f = await loadedFaces(o.page);
    check(
      `${key}: no film grain, no darkened corners, and neither Velvet font is loaded`,
      g.content === "none" && v.content === "none" && !f.some((x) => /^(Bodoni Moda|Figtree)/.test(x)),
      JSON.stringify({ g, v, faces: f.filter((x) => /Bodoni|Figtree/.test(x)) }),
    );
    await o.ctx.close();
  }
}

// ------------------------------------------------------------------ Lagoon
{
  const { ctx, page, errors } = await open({ store: { themePack: { data: "lagoon" } } });
  await goTo(page, "discover");
  await page.locator(".stream-card__poster").first().waitFor({ timeout: 20_000 });
  const fx = (sel) => style(page, sel, ["backdrop-filter", "background-color"]);
  // The floating layers: the header's capsule, the settings panel, a dialog, a menu's glass.
  const nav = await fx(".navcap");
  await page.keyboard.press("Control+k");
  await page.locator(".palette").waitFor({ timeout: 5000 });
  const palette = await fx(".palette");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.locator(".settings").waitFor({ timeout: 10_000 });
  const sheet = await fx(".settings");
  const probe = await page.evaluate(() => {
    const host = document.createElement("div");
    host.innerHTML = '<div data-slot="dialog-content" class="bg-background" id="d"></div>';
    document.body.append(host);
    const cs = getComputedStyle(host.querySelector("#d"));
    const out = { filter: cs.backdropFilter, bg: cs.backgroundColor };
    host.remove();
    return out;
  });
  const GLASS = "blur(24px) saturate(1.6)";
  check(
    "lagoon: the header, Ctrl+K's menu glass, the settings panel and a dialog all see through, blur 24px and saturate 1.6",
    [nav["backdrop-filter"], palette["backdrop-filter"], sheet["backdrop-filter"], probe.filter].every((f) => f === GLASS),
    JSON.stringify({ nav, palette, sheet, probe }),
  );
  const alpha = (c) => (/rgba\(.*,\s*([\d.]+)\)$/.exec(c) ? Number(/rgba\(.*,\s*([\d.]+)\)$/.exec(c)[1]) : c.startsWith("color(") ? Number(/\/\s*([\d.]+)\)/.exec(c)?.[1] ?? 1) : 1);
  check(
    "lagoon: those layers are translucent (a ground you can see through), the dialog's too",
    [palette["background-color"], sheet["background-color"], probe.bg].every((c) => alpha(c) < 1),
    JSON.stringify({ palette: palette["background-color"], sheet: sheet["background-color"], dialog: probe.bg }),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  const card = await style(page, ".stream-card__poster", ["backdrop-filter", "background-color"]);
  const tilt = await style(page, ".stream-card__tilt", ["backdrop-filter"]);
  const rowsAny = await page.evaluate(() => [...document.querySelectorAll("*")].filter((e) => {
    const cs = getComputedStyle(e);
    return (e.classList.contains("stream-card__poster") || e.classList.contains("stream-card__tilt") || e.classList.contains("stream-card")) && cs.backdropFilter !== "none";
  }).length);
  check(
    "lagoon: a card is the translucent wash with no backdrop blur (rows hold hundreds of posters, and WebView2 pays for each blurred layer while it scrolls)",
    card["backdrop-filter"] === "none" && tilt["backdrop-filter"] === "none" && rowsAny === 0 && alpha(card["background-color"]) < 1,
    JSON.stringify({ card, tilt, rowsAny }),
  );
  check("lagoon: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}
{
  // Windows' "Transparency effects" off reaches the page as this media query.
  // Playwright's emulateMedia has no reducedTransparency, so it goes through
  // CDP, as Prism's check above does.
  const { ctx, page } = await open({ store: { themePack: { data: "lagoon" } } });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  await page.waitForTimeout(100);
  await goTo(page, "discover");
  await page.locator(".stream-card__poster").first().waitFor({ timeout: 20_000 });
  const t = await root(page, ["--surface", "--float-bg", "--float-blur", "--sheet-blur", "--glass-fx", "--page-ambient"]);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.locator(".settings").waitFor({ timeout: 10_000 });
  const sheet = await style(page, ".settings", ["backdrop-filter", "background-color"]);
  const nav = await style(page, ".navcap", ["backdrop-filter"]);
  const card = await style(page, ".stream-card__poster", ["background-color"]);
  const body = await style(page, "body", ["background-image"]);
  check(
    "lagoon with transparency effects off: opaque cards and floats, no blur anywhere, and no lit page",
    t["--surface"] === "#102d34" && t["--float-bg"] === "#102d34" && t["--float-blur"] === "none" && t["--sheet-blur"] === "none" &&
      t["--glass-fx"] === "none" && t["--page-ambient"] === "none" &&
      sheet["backdrop-filter"] === "none" && /^rgb\(16, 45, 52\)$/.test(sheet["background-color"]) && nav["backdrop-filter"] === "none" &&
      card["background-color"] === "rgb(16, 45, 52)" && !/gradient/.test(body["background-image"]),
    JSON.stringify({ t, sheet, nav, card, body }),
  );
  await ctx.close();
}
{
  // The page lit by the picture: Stream publishes the hero's colours to the
  // root, and only under Lagoon. The fake's art is a flat colour, so the
  // lights are that colour, in the canvas's four places.
  const { ctx, page } = await open({ store: { themePack: { data: "lagoon" } } });
  await goTo(page, "home");
  await page.waitForSelector(".shero__ambient", { state: "attached", timeout: 20_000 });
  const inline = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--page-ambient"));
  await page.waitForTimeout(1500);
  const lit = await inline();
  const sheetLights = (await root(page, ["--page-ambient"]))["--page-ambient"];
  check(
    "lagoon: the page wears the lights (the canvas's teal and amber until a hero's colours are read, then the picture's own), four of them",
    (sheetLights.match(/radial-gradient/g) ?? []).length === 4,
    JSON.stringify({ lit: lit.slice(0, 80), sheetLights: sheetLights.slice(0, 80) }),
  );
  // The art is cross-origin to the page: a host that sends no CORS header
  // leaves the stylesheet's lights, and a host that does gets its colours read.
  // Which the fake does is not this check's business; what must hold is that
  // the page never ends up with a half-written value.
  check("lagoon: what Stream publishes is four radial lights, or nothing at all", lit === "" || (lit.match(/radial-gradient/g) ?? []).length === 4, lit.slice(0, 100));
  await page.evaluate(() => {
    document.documentElement.dataset.themePack = "prism";
  });
  await page.waitForTimeout(300);
  check("leaving Lagoon puts nothing on the root", (await inline()) === "");
  await ctx.close();
  const d = await open();
  await goTo(d.page, "home");
  await d.page.waitForSelector(".shero__ambient", { state: "attached", timeout: 20_000 });
  await d.page.waitForTimeout(800);
  check("no pack: Stream publishes no lights", (await d.page.evaluate(() => document.documentElement.style.getPropertyValue("--page-ambient"))) === "");
  await d.ctx.close();
}

// ------------------------------------------------------------------ Fluent
{
  const { ctx, page, errors } = await open({ store: { themePack: { data: "fluent" } } });
  const text = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  const head = await fontOf(page, "--font-headline");
  check(
    "fluent: text is Segoe UI Variable Text and headings Segoe UI Variable Display, then Segoe UI, then the app's own stack",
    text.startsWith('"Segoe UI Variable Text", "Segoe UI", "Geist Variable"') && head.startsWith('"Segoe UI Variable Display", "Segoe UI", "Geist Variable"'),
    JSON.stringify({ text, head }),
  );
  check(
    "fluent, no Mica (the browser build): the base is a solid #202020 and the page has not been marked",
    (await bodyBg(page)) === "rgb(32, 32, 32)" && (await page.evaluate(() => document.documentElement.dataset.mica)) === undefined,
    await bodyBg(page),
  );
  const t = await root(page, ["--text", "--text-muted", "--text-dim", "--accent", "--accent-ink", "--focus-ring"]);
  check(
    "fluent: text is white, #cfcfcf (78.6%) and #999999 (54.4%), the accent is Windows' blue and the focus ring is white",
    t["--text"] === "#ffffff" && t["--text-muted"] === "#cfcfcf" && t["--text-dim"] === "#999999" && t["--accent"] === "#60cdff" && t["--accent-ink"] === "#000000" && t["--focus-ring"] === "#ffffff",
    JSON.stringify(t),
  );
  const ring = await ringOf(page);
  check(
    "fluent: Tab shows a 2px white ring over a 1px black inner ring",
    ring && ring.width === "2px" && ring.color === "rgb(255, 255, 255)" && ring.offset === "1px" &&
      (await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow)).includes("rgb(0, 0, 0) 0px 0px 0px 1px"),
    JSON.stringify(ring),
  );
  check("fluent: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}
{
  // With Mica: native answers yes at the IPC boundary.
  const { ctx, page, errors } = await nativePage({ store: { themePack: { data: "fluent" } }, mica: true });
  await page.waitForFunction(() => document.documentElement.dataset.mica === "on", null, { timeout: 5000 }).catch(() => {});
  check("fluent with Mica: native was asked to turn it on, once, and the page is marked", JSON.stringify(await micaCalls(page)) === "[true]" && (await page.evaluate(() => document.documentElement.dataset.mica)) === "on", JSON.stringify(await micaCalls(page)));
  check(
    "fluent with Mica: the base is see-through (body and shell), so Mica shows",
    (await bodyBg(page)) === "rgba(0, 0, 0, 0)" && (await shellBg(page)) === "rgba(0, 0, 0, 0)",
    JSON.stringify({ body: await bodyBg(page), shell: await shellBg(page) }),
  );
  // The in-app mode: the inverted player's flag, which makes the shell the thing that paints.
  await page.evaluate(() => document.documentElement.classList.add("invert-player"));
  check("  and in the inverted player's mode the shell is see-through too", (await shellBg(page)) === "rgba(0, 0, 0, 0)", await shellBg(page));
  await page.evaluate(() => document.documentElement.classList.remove("invert-player"));
  // Windows' transparency effects off: the OS draws Mica as a colour, so the base is solid again.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  await page.waitForTimeout(100);
  check("  and with transparency effects off the base is the solid #202020 again", (await paintBg(page)) === "rgb(32, 32, 32)", await paintBg(page));
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "no-preference" }] });
  // Leaving Fluent: native is asked to take Mica off, and the base is solid at once.
  await goTo(page, "home");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  const themes = page.getByRole("group", { name: "Theme" });
  await themes.waitFor({ timeout: 10_000 });
  for (const other of ["Velvet", "Lagoon", "Prism", "Default"]) {
    await themes.getByRole("button", { name: "Fluent", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.mica === "on", null, { timeout: 5000 });
    const before = (await micaCalls(page)).length;
    await themes.getByRole("button", { name: other, exact: true }).click();
    await page.waitForTimeout(100);
    const calls = await micaCalls(page);
    check(
      `switching from Fluent to ${other} asks native to take Mica off, and the mark is gone`,
      calls.length === before + 1 && calls[calls.length - 1] === false && (await page.evaluate(() => document.documentElement.dataset.mica)) === undefined,
      JSON.stringify(calls),
    );
  }
  check("fluent with Mica: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}
{
  // Native says no (Windows 10, or the call failed): the base stays solid.
  const { ctx, page } = await nativePage({ store: { themePack: { data: "fluent" } }, mica: false });
  await page.waitForTimeout(500);
  check(
    "fluent where Mica can't apply: native was asked, said no, and the base is the solid #202020",
    JSON.stringify(await micaCalls(page)) === "[true]" && (await paintBg(page)) === "rgb(32, 32, 32)" && (await page.evaluate(() => document.documentElement.dataset.mica)) === undefined,
    JSON.stringify({ calls: await micaCalls(page), bg: await paintBg(page) }),
  );
  await ctx.close();
  // A profile that never wears Fluent never calls native for Mica at all.
  for (const key of ["none", "prism", "velvet", "lagoon"]) {
    const o = await nativePage({ store: key === "none" ? {} : { themePack: { data: key } } });
    await o.page.waitForTimeout(300);
    check(`${key}: native is never asked about Mica`, (await micaCalls(o.page)).length === 0, JSON.stringify(await micaCalls(o.page)));
    await o.ctx.close();
  }
  // Light: Fluent has a face for it, so Mica is asked for with dark: false,
  // and the base is see-through there as in Dark.
  const l = await nativePage({ scheme: "light", store: { theme: { data: "light" }, themePack: { data: "fluent" } } });
  await l.page.waitForFunction(() => document.documentElement.dataset.mica === "on", null, { timeout: 5000 }).catch(() => {});
  check(
    "light with Fluent stored: native is asked for Mica in Light (dark: false), once, and the page is marked",
    JSON.stringify(await micaCalls(l.page)) === "[true]" && JSON.stringify(await micaFaces(l.page)) === "[false]" && (await l.page.evaluate(() => document.documentElement.dataset.mica)) === "on",
    JSON.stringify({ on: await micaCalls(l.page), dark: await micaFaces(l.page) }),
  );
  check("light Mica: the base is see-through (body and shell), so Mica shows", (await paintBg(l.page)) === "rgba(0, 0, 0, 0)", await paintBg(l.page));
  await l.ctx.close();
  // Light without Mica (Windows 10, the browser build): a solid light base.
  const nl = await nativePage({ scheme: "light", mica: false, store: { theme: { data: "light" }, themePack: { data: "fluent" } } });
  await nl.page.waitForTimeout(300);
  check("light, native says no Mica: the base is solid light and the page is not marked", (await paintBg(nl.page)) === "oklch(0.965 0 0)" && (await nl.page.evaluate(() => document.documentElement.dataset.mica)) === undefined, await paintBg(nl.page));
  await nl.ctx.close();
  // The face flips with the page open (Match Windows): native is asked again with the new face.
  const fl = await nativePage({ store: { theme: { data: "system" }, themePack: { data: "fluent" } } });
  await fl.page.waitForFunction(() => document.documentElement.dataset.mica === "on", null, { timeout: 5000 }).catch(() => {});
  await fl.page.emulateMedia({ colorScheme: "light" });
  await micaCount(fl.page, 2);
  check("fluent: dark then Light asks native again, with dark: false", JSON.stringify(await micaFaces(fl.page)) === "[true,false]" && JSON.stringify(await micaCalls(fl.page)) === "[true,true]", JSON.stringify(await micaFaces(fl.page)));
  await fl.page.emulateMedia({ colorScheme: "dark" });
  await micaCount(fl.page, 3);
  check("  and back to dark asks with dark: true", JSON.stringify(await micaFaces(fl.page)) === "[true,false,true]", JSON.stringify(await micaFaces(fl.page)));
  await fl.page.emulateMedia({ colorScheme: "light" });
  await micaCount(fl.page, 4);
  // Leaving Fluent from Light takes Mica off.
  await fl.page.locator("button[aria-label='Settings'], .flc-pane [data-key='settings']").first().click();
  await fl.page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await fl.page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Velvet", exact: true }).click();
  await micaCount(fl.page, 5);
  const offs = await micaCalls(fl.page);
  check("fluent in Light, then Velvet: native is asked to take Mica off, and the mark is gone", offs.length === 5 && offs[4] === false && (await fl.page.evaluate(() => document.documentElement.dataset.mica)) === undefined, JSON.stringify(offs));
  await fl.ctx.close();
}

// ------------------------------------------------------------ Light ignores
{
  const { ctx, page, errors } = await open({ scheme: "light", store: { theme: { data: "light" }, themePack: { data: "prism" } } });
  const state = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, pack: document.documentElement.dataset.themePack }));
  const t = await root(page, ["--bg", "--surface", "--text", "--accent"]);
  const h = await hooks(page);
  check(
    "light: the pack is stored and on the root, and the palette is Light's own",
    state.theme === "light" && state.pack === "prism" && t["--bg"] === "oklch(0.965 0 0)" && t["--surface"] === "oklch(1 0 0)" &&
      t["--text"] === "oklch(0.145 0 0)" && t["--accent"] === "oklch(0.205 0 0)",
    JSON.stringify({ state, t }),
  );
  check(
    "light: none of Prism's hooks draws",
    h.fill.image === "none" && blank(h.dotGlow) && h.probeLine.image === "none" && blank(h.probeLineGlow),
    JSON.stringify({ fill: h.fill.image, dot: h.dotGlow.image, line: h.probeLine }),
  );
  await page.mouse.move(500, 400);
  await page.waitForTimeout(300);
  check("light: no dither field and no cursor light", noDither(await dither(page)) && (await glowOf(page)).count === 0);
  await goTo(page, "home");
  await page.waitForSelector(".shero__glowbox", { state: "attached", timeout: 20_000 });
  const glow = await style(page, ".shero__glowbox", ["display", "background-image"]);
  check("light: the hero's halo is as Light has it (none drawn), not Prism's", glow.display === "none" && glow["background-image"] === "none", JSON.stringify(glow));
  // The note, and the Accent row, in Light.
  await page.locator("button[aria-label='Settings']").click();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await page.getByRole("group", { name: "Theme" }).waitFor({ timeout: 10_000 });
  check("light: the Theme row says Prism is dark only", await page.locator('[data-setting="theme-pack"]').getByText("Prism is dark only.", { exact: true }).isVisible());
  check("light: the Accent row is there, since the pack is not", await page.locator('[data-setting="accent"]').count() === 1 && await page.getByRole("button", { name: "Default, follows light and dark" }).count() === 1);
  // And back to Dark: the pack is showing, the note is gone.
  await page.getByRole("group", { name: "Appearance" }).getByRole("button", { name: "Dark", exact: true }).click();
  await page.waitForTimeout(150);
  check(
    "light then Dark: Prism is on, the note is gone and the Accent row is gone",
    (await root(page, ["--bg"]))["--bg"] === "#000000" &&
      (await page.locator('[data-setting="theme-pack"]').getByText(/ is dark only\./).count()) === 0 &&
      (await page.locator('[data-setting="accent"]').count()) === 0,
  );
  check("light: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ----------------------------------------------- Fluent has a face for Light
// One accent: the root's, which is Windows' light blue until a pick, and a
// toggle, the nav's pill and Watch all draw it. The note about dark-only
// themes is Velvet's and the others', not Fluent's.
{
  const { ctx, page, errors } = await open({ scheme: "light", store: { theme: { data: "light" }, themePack: { data: "fluent" } } });
  const BLUE = "rgb(0, 103, 192)";
  const bg = (sel, pseudo) => page.evaluate(({ sel, pseudo }) => getComputedStyle(document.querySelector(sel), pseudo).backgroundColor, { sel, pseudo });
  const tokens = await root(page, ["--accent", "--accent-ink", "--fl-accent", "--fl-on-accent"]);
  check("fluent, Light: the root accent is Windows' light blue, white ink on it, and --fl-accent follows", JSON.stringify(tokens) === JSON.stringify({ "--accent": "#0067c0", "--accent-ink": "#ffffff", "--fl-accent": "#0067c0", "--fl-on-accent": "#ffffff" }), JSON.stringify(tokens));
  await page.waitForSelector(".fl-btn--accent", { timeout: 20_000 });
  const watch = await bg(".fl-btn--accent");
  const pill = await bg('.flc-ni[aria-current="page"]', "::before");
  check("fluent, Light: the nav pill and Watch are the one accent", watch === BLUE && pill === BLUE, JSON.stringify({ watch, pill }));
  await page.locator("button[aria-label='Settings'], .flc-pane [data-key='settings']").first().click();
  await page.getByRole("tab", { name: "Playback", exact: true }).click();
  await page.locator(".toggle").first().waitFor({ timeout: 10_000 });
  if ((await page.locator(".toggle--on").count()) === 0) await page.locator(".toggle").first().click();
  await page.locator(".toggle--on").first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600); // the track fades to its colour
  const tog = await bg(".toggle--on");
  check("fluent, Light: a toggle that is on is the same accent", tog === BLUE, tog);
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  const accent = page.locator('[data-setting="accent"]');
  await accent.waitFor({ timeout: 10_000 });
  const swatches = accent.getByRole("group", { name: "Accent color" }).locator("button");
  check("fluent, Light: the Accent row leads with Fluent's own swatch, chosen", (await swatches.first().getAttribute("aria-label")) === "Fluent" && (await swatches.first().getAttribute("aria-pressed")) === "true", String(await swatches.first().getAttribute("aria-label")));
  check("fluent, Light: no dark-only note", (await page.getByText(/ is dark only\./).count()) === 0);
  const cardBg = await page.locator('[data-swatch="fluent"]').evaluate((e) => getComputedStyle(e).backgroundColor);
  check("fluent, Light: its theme card draws the light layers", cardBg === "rgb(243, 243, 243)", cardBg);
  // A pick in Light is Light's own: Dark keeps the blue it opens on.
  await accent.getByRole("button", { name: "Green", exact: true }).click();
  await page.waitForTimeout(150);
  const picked = await root(page, ["--accent", "--fl-accent"]);
  check("fluent, Light: picking Green changes the accent, and --fl-accent with it", picked["--accent"] !== "#0067c0" && picked["--fl-accent"] === picked["--accent"], JSON.stringify(picked));
  await page.getByRole("group", { name: "Appearance" }).getByRole("button", { name: "Dark", exact: true }).click();
  await page.waitForTimeout(250);
  const dark = await root(page, ["--accent", "--fl-accent"]);
  check("fluent: Dark still opens on its own blue after a pick in Light", dark["--accent"] === "#60cdff" && dark["--fl-accent"] === "#60cdff", JSON.stringify(dark));
  check("fluent, Dark: the first swatch is Fluent's and is the one chosen", (await swatches.first().getAttribute("aria-label")) === "Fluent" && (await swatches.first().getAttribute("aria-pressed")) === "true");
  await page.getByRole("group", { name: "Appearance" }).getByRole("button", { name: "Light", exact: true }).click();
  await page.waitForTimeout(250);
  const back = await root(page, ["--accent"]);
  check("fluent: and back in Light, the Green pick is still there", back["--accent"] === picked["--accent"], JSON.stringify({ back, picked }));
  check("fluent: the Default accent store is untouched", (await page.evaluate(() => localStorage.getItem("blammytv.accent"))) === null);
  check("fluent, Light: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}
// Velvet in Light is as it was: the default accent, the note, Default's swatch.
{
  const { ctx, page } = await open({ scheme: "light", store: { theme: { data: "light" }, themePack: { data: "velvet" } } });
  await page.locator("button[aria-label='Settings'], .flc-pane [data-key='settings']").first().click();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await page.getByRole("group", { name: "Theme" }).waitFor({ timeout: 10_000 });
  check("velvet, Light: the dark-only note shows", await page.locator('[data-setting="theme-pack"]').getByText("Velvet is dark only.", { exact: true }).isVisible());
  check("velvet, Light: the accent is the default's, not a pack's", (await root(page, ["--accent"]))["--accent"] === "oklch(0.205 0 0)");
  check("velvet, Light: its card is still Velvet's dark one", (await page.locator('[data-swatch="velvet"]').evaluate((e) => getComputedStyle(e).backgroundColor)) === "rgb(23, 13, 16)");
  check("velvet, Light: the Accent row is the default one", /^Default/.test((await page.locator('[data-setting="accent"]').getByRole("group", { name: "Accent color" }).locator("button").first().getAttribute("aria-label")) ?? ""));
  await ctx.close();
}

// -------------------------------------------------- the picker, and accents
{
  const { ctx, page, errors } = await open();
  await page.locator("button[aria-label='Settings']").click();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  const themes = page.getByRole("group", { name: "Theme" });
  await themes.waitFor({ timeout: 10_000 });
  const names = await themes.locator("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  check("the Theme row has six cards: Default, Prism, Velvet, Lagoon, Fluent, Classic", names.join() === "Default,Prism,Velvet,Lagoon,Fluent,Classic", names.join());
  check("Default is chosen on a fresh profile", (await themes.locator("button[aria-pressed='true']").getAttribute("aria-label")) === "Default");
  const swatches = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll("[data-swatch]")].map((e) => [e.getAttribute("data-swatch"), getComputedStyle(e).backgroundColor])),
  );
  check(
    "each card is drawn in its own page colour",
    swatches.prism === rgb(PACKS.prism.bg) && swatches.velvet === rgb(PACKS.velvet.bg) && swatches.lagoon === rgb(PACKS.lagoon.bg) && swatches.fluent === rgb(PACKS.fluent.bg),
    JSON.stringify(swatches),
  );
  const prismCard = await themes.getByRole("button", { name: "Prism" }).evaluate((el) => el.innerHTML);
  check("Prism's card shows the ramp, the others a single accent", /linear-gradient/.test(prismCard) && !/linear-gradient/.test(await themes.getByRole("button", { name: "Velvet" }).evaluate((el) => el.innerHTML)));
  const accentGroup = () => page.getByRole("group", { name: "Accent color" });
  const pick = async (name) => {
    await themes.getByRole("button", { name: name, exact: true }).click();
    await page.waitForTimeout(120);
  };
  const pressed = async () => (await accentGroup().locator("button[aria-pressed='true']").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).join();
  const live = () => root(page, ["--bg", "--accent", "--accent-ink"]);

  await pick("Prism");
  check("choosing Prism applies it live, and the Accent row is hidden", (await live())["--bg"] === PACKS.prism.bg && (await page.locator('[data-setting="accent"]').count()) === 0);

  await pick("Velvet");
  check(
    "Velvet: the Accent row is back, its first swatch is Velvet's brass, chosen",
    (await accentGroup().locator("button").first().getAttribute("aria-label")) === "Velvet" && (await pressed()) === "Velvet" && (await live())["--accent"] === PACKS.velvet.accent,
    await pressed(),
  );
  const first = await accentGroup().locator("button").first().evaluate((e) => getComputedStyle(e).backgroundColor);
  check("Velvet's swatch is the brass", first === rgb(PACKS.velvet.accent), first);
  // With no pick the derived tokens are the sheet's own values, as they were.
  const velvetOwn = [await tokenColor(page, "--focus-ring"), await tokenColor(page, "--plate-ink"), await tokenColor(page, "--tint-on", "backgroundColor")];
  check(
    "Velvet, no pick: the focus ring and the plate ink are the brass, the selection tint is the brass at 18%",
    near(velvetOwn[0], hexRgb("#e8bb6c")) && near(velvetOwn[1], hexRgb("#e8bb6c")) && near(velvetOwn[2], hexRgb("#e8bb6c", 0.18)),
    JSON.stringify(velvetOwn),
  );
  await accentGroup().getByRole("button", { name: "Blue", exact: true }).click();
  await page.waitForTimeout(100);
  const blue = await live();
  check("a pick under Velvet is on the page, with white ink on it", blue["--accent"] === "#3730ff" && blue["--accent-ink"] === "oklch(0.985 0 0)", JSON.stringify(blue));
  const velvetBlue = [await tokenColor(page, "--focus-ring"), await tokenColor(page, "--plate-ink"), await tokenColor(page, "--tint-on", "backgroundColor")];
  check(
    "  and the focus ring and the selection tint follow it; the plate ink keeps the brass (a dark pick would fail 4.5:1 on the plate)",
    near(velvetBlue[0], hexRgb("#3730ff")) && near(velvetBlue[1], hexRgb("#e8bb6c")) && near(velvetBlue[2], hexRgb("#3730ff", 0.18)),
    JSON.stringify(velvetBlue),
  );

  await pick("Lagoon");
  check(
    "Lagoon: its own first swatch, chosen; Velvet's blue is not carried over",
    (await accentGroup().locator("button").first().getAttribute("aria-label")) === "Lagoon" && (await pressed()) === "Lagoon" && (await live())["--accent"] === PACKS.lagoon.accent,
    `${await pressed()} ${(await live())["--accent"]}`,
  );
  const lagoonOwn = [await tokenColor(page, "--focus-ring"), await tokenColor(page, "--tint-on", "backgroundColor")];
  check(
    "Lagoon, no pick: the focus ring is the aqua, the selection tint the aqua at 20%",
    near(lagoonOwn[0], hexRgb("#5fe1c1")) && near(lagoonOwn[1], hexRgb("#5fe1c1", 0.2)),
    JSON.stringify(lagoonOwn),
  );
  await accentGroup().getByRole("button", { name: "Green", exact: true }).click();
  await page.waitForTimeout(100);
  check("a pick under Lagoon is on the page", (await live())["--accent"] === "#2cad57");
  const lagoonGreen = [await tokenColor(page, "--focus-ring"), await tokenColor(page, "--tint-on", "backgroundColor")];
  check(
    "  and Lagoon's focus ring and selection tint follow it",
    near(lagoonGreen[0], hexRgb("#2cad57")) && near(lagoonGreen[1], hexRgb("#2cad57", 0.2)),
    JSON.stringify(lagoonGreen),
  );

  await pick("Velvet");
  check("Velvet again gives back the blue it was given", (await pressed()) === "Blue" && (await live())["--accent"] === "#3730ff", `${await pressed()} ${(await live())["--accent"]}`);
  await pick("Lagoon");
  check("and Lagoon its green", (await pressed()) === "Green" && (await live())["--accent"] === "#2cad57");

  await pick("Default");
  const dflt = await live();
  check(
    "Default is the app's own again: its Accent row with the default swatch chosen, no pack attribute, no inline accent",
    (await pressed()) === "Default, follows light and dark" && dflt["--bg"] === "oklch(0.145 0 0)" && dflt["--accent"] === "oklch(0.922 0 0)" &&
      (await page.evaluate(() => document.documentElement.dataset.themePack)) === undefined,
    JSON.stringify(dflt),
  );
  check(
    "the default accent store was never written by any of it",
    (await page.evaluate(() => localStorage.getItem("blammytv.accent"))) === null,
  );
  // A pick under Default, then a pack and back: the default pick comes back.
  await accentGroup().getByRole("button", { name: "Yellow", exact: true }).click();
  await pick("Velvet");
  check("the default's yellow gives way to Velvet's blue under Velvet", (await live())["--accent"] === "#3730ff");
  await pick("Default");
  check("and is back on Default", (await live())["--accent"] === "#ffd500");

  // Back to the base, token for token.
  await accentGroup().getByRole("button", { name: /Default/ }).click();
  await pick("Prism");
  await pick("Default");
  const again = await rootTokens(page);
  const moved = Object.keys(base.tokens).filter((k) => again[k] !== base.tokens[k]);
  check(`Default after a pack is the base palette again, ${Object.keys(base.tokens).length} tokens, none moved`, Object.keys(base.tokens).length > 100 && moved.length === 0, moved.slice(0, 6).map((k) => `${k}: ${base.tokens[k]} -> ${again[k]}`).join("; "));

  // The export and the palette.
  await pickAndSave(page);
  check("no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/** Lagoon, with a pick, then: the file the app would export, Ctrl+K's index. */
async function pickAndSave(page) {
  const themes = page.getByRole("group", { name: "Theme" });
  if (!(await themes.isVisible().catch(() => false))) {
    await page.locator("button[aria-label='Settings']").click();
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  }
  await themes.getByRole("button", { name: "Lagoon", exact: true }).click();
  await page.getByRole("group", { name: "Accent color" }).getByRole("button", { name: "Purple", exact: true }).click();
  const file = await page.evaluate(async () => {
    const { buildSettingsFile } = await import("/src/features/settings/settingsExport.ts");
    return buildSettingsFile({ logins: false }).keys;
  });
  check(
    "the export carries the theme and what each theme remembers",
    file.themePack?.data === "lagoon" && file.themeAccents?.data?.lagoon?.accent === "#a200ff",
    JSON.stringify({ themePack: file.themePack, themeAccents: file.themeAccents }),
  );
  const found = await page.evaluate(async () => {
    const { findSettings } = await import("/src/features/settings/settingsIndex.ts");
    return ["theme", "velvet", "palette"].map((q) => findSettings(q).some((r) => r.id === "theme-pack"));
  });
  check("Ctrl+K finds the row by Theme, a pack's name or palette", found.every(Boolean), JSON.stringify(found));
}

// ---------------------------------- Match Windows flips with Appearance open
// The page read Light from the root while it drew, and nothing told it when
// Windows changed: the Accent row kept a Velvet swatch in Light, and "Themes
// are dark only." never showed.
{
  const { ctx, page, errors } = await open({ store: { theme: { data: "system" }, themePack: { data: "velvet" } } });
  await page.locator("button[aria-label='Settings']").click();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  const accent = page.locator('[data-setting="accent"]');
  await accent.waitFor({ timeout: 10_000 });
  const firstSwatch = () => accent.getByRole("group", { name: "Accent color" }).locator("button").first().getAttribute("aria-label");
  check("Match Windows, dark, Velvet: the Accent row leads with Velvet and there is no dark-only note", (await firstSwatch()) === "Velvet" && (await page.getByText(/ is dark only\./).count()) === 0);
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.getByText("Velvet is dark only.").waitFor({ timeout: 3000 }).catch(() => {});
  check("  Windows goes Light: the note shows without leaving the page", (await page.getByText("Velvet is dark only.").count()) === 1);
  check("  and the Accent row is the default one, not Velvet's", /^Default/.test((await firstSwatch()) ?? ""), String(await firstSwatch()));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByText("Velvet is dark only.").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check("  and back to dark, Velvet's again", (await page.getByText(/ is dark only\./).count()) === 0 && (await firstSwatch()) === "Velvet");
  check("Match Windows: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ----------------------------------------------------- it survives a reload
{
  const { ctx, page } = await open();
  await page.locator("button[aria-label='Settings']").click();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Velvet", exact: true }).click();
  await page.getByRole("group", { name: "Accent color" }).getByRole("button", { name: "Blue", exact: true }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap, .flc-title", { timeout: 20_000 });
  const t0 = await page.evaluate(() => window.__t);
  const t = await root(page, ["--bg", "--accent"]);
  check(
    "after a reload the pack and its accent are back before React draws",
    (await page.evaluate(() => document.documentElement.dataset.themePack)) === "velvet" && t["--bg"] === PACKS.velvet.bg && t["--accent"] === "#3730ff" && t0.pack <= t0.mount,
    JSON.stringify({ t, t0 }),
  );
  await page.locator("button[aria-label='Settings']").click();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  const themes = page.getByRole("group", { name: "Theme" });
  await themes.waitFor();
  check(
    "and Settings shows Velvet chosen, with the blue chosen in its Accent row",
    (await themes.locator("button[aria-pressed='true']").getAttribute("aria-label")) === "Velvet" &&
      (await page.getByRole("group", { name: "Accent color" }).locator("button[aria-pressed='true']").getAttribute("aria-label")) === "Blue",
  );
  // Reset Appearance takes it all back.
  const row = page.locator('[data-setting="reset-appearance"]');
  await row.scrollIntoViewIfNeeded();
  const reset = row.getByRole("button", { name: "Reset" });
  await reset.click();
  await row.getByRole("button").first().click();
  await page.waitForTimeout(200);
  const after = await root(page, ["--bg", "--accent"]);
  check(
    "Reset Appearance takes the theme back to Default and forgets each theme's accent",
    (await page.evaluate(() => document.documentElement.dataset.themePack)) === undefined && after["--bg"] === "oklch(0.145 0 0)" &&
      (await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.themeAccents") ?? "{}").data)) !== undefined &&
      Object.keys(await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.themeAccents") ?? "{}").data ?? {})).length === 0,
    JSON.stringify(after),
  );
  await ctx.close();
}

await browser.close();
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);

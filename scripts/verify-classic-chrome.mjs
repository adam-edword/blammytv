// E2E: Classic's chrome fixes (plan 035, tier 3) and the logo rule.
//
// What can go wrong here is quiet:
//   - THE LOGO. "The logo is a box, the logo should never change no matter
//     what" (Adam, 2026-11-08). Classic drew a conic square, Fluent's title bar
//     another, and Classic's `border-radius: 0 !important` flattened the What's
//     New and boot tile. Every theme now draws ui/BrandMark, the capsule's own
//     clipped plate. A clip-path is also a hit region, so the shape is read by
//     asking what is under three points: the ring, a corner, the hole.
//   - THE PRESSED TAB. `.cl-btn` was two rules at one weight (the toolbar's
//     and the push button's); the later sheet won and the tab you were on never
//     looked pressed. The toolbar is `.cl-tb` now.
//   - READABILITY OVER VIDEO. Packs keep their own ink on a picture; on Classic's
//     grey that was navy and black on a dark scrim. Contrast is computed from
//     the computed colours, against the worst case under the scrim (the scrim's
//     own alpha over white), not against whatever this headless page has behind.
//   - MULTI-VIEW'S BAR, sized for the capsule, sat on the toolbar.
//   - A dead x in the Go To box, a stale address bar, a toolbar that wrapped.
//
// The native side is stubbed (verify-miniguide's way) for the player pages.
//
//   node scripts/fake-panel.mjs; node scripts/fake-aio.mjs; node scripts/fake-m3u.mjs
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-classic-chrome.mjs
//   SHOTS=<dir> ...   # also leaves a picture of each fix there
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
const PANEL = process.env.PANEL_URL ?? "http://localhost:8081";
const SHOTS = process.env.SHOTS;
const PLAYLISTS = { v: 1, data: [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" }] };
const AIO = { v: 1, data: "http://localhost:8084/manifest.json" };
const CLASSIC = { themePack: "classic", multiviewNoticeSeen: true };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/** A page that reaches nothing but this machine. */
async function open({ store = CLASSIC, width = 1440, scheme = "dark", version } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  if (version)
    await ctx.route("**/src/lib/version.ts*", (r) =>
      r.fulfill({ contentType: "text/javascript", body: `export const APP_VERSION = "${version}";` }),
    );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ store, PLAYLISTS, AIO, whats }) => {
      localStorage.setItem("btv:onboarded", "1");
      localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: whats }));
      sessionStorage.setItem("btv:welcome-played", "1");
      if (!sessionStorage.getItem("btv:chrome-seeded")) {
        sessionStorage.setItem("btv:chrome-seeded", "1");
        localStorage.setItem("blammytv.playlists", JSON.stringify(PLAYLISTS));
        localStorage.setItem("blammytv.aiostreams", JSON.stringify(AIO));
        for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: 1, data: v }));
      }
    },
    { store, PLAYLISTS, AIO, whats: version ? "1.0" : "999.0" },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  return { ctx, page };
}
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/chrome-${name}.png` });
};
const address = (page) => page.locator("[data-cl=address]").innerText().then((t) => t.replace(/\s+/g, " ").trim());

/** What a brand mark is: the ring answers a hit test, a corner and the hole do
 * not (the clip-path is the hit region), and it is the capsule's own path. */
const markShape = (page, sel) =>
  page.evaluate((sel) => {
    const b = document.querySelector(sel);
    if (!b) return { found: false };
    const r = b.getBoundingClientRect();
    const i = b.querySelector("i");
    const hit = (x, y) => document.elementFromPoint(r.left + x, r.top + y) === i;
    const clip = getComputedStyle(i).clipPath;
    const w = r.width;
    return {
      found: true,
      size: Math.round(w),
      path: clip.includes("evenodd") && clip.includes("M 571.5 0 C 814.551 0") && clip.includes("M 510.54 243.84"),
      ring: hit(w * 0.06, w / 2),
      corner: !hit(0.5, 0.5),
      hole: !hit(w / 2, w / 2),
      square: [b, i].some((e) => getComputedStyle(e).backgroundColor !== "rgba(0, 0, 0, 0)"),
    };
  }, sel);
const isMark = (m, size) => m.found && m.size === size && m.path && m.ring && m.corner && m.hole && !m.square;

// ---------------------------------------------------------- 1. the logo
{
  const { ctx, page } = await open();
  await page.waitForSelector(".cl-header", { timeout: 20_000 });
  await goTo(page, "guide");
  const old = await page.locator(".cl-mark, .cl-logo").count();
  check("the logo: no conic squares are left in Classic's chrome", old === 0, String(old));
  const menu = await markShape(page, ".cl-menu .brand-mark");
  check("the logo: the menu bar's mark is the real path, 16px, ring and hole", isMark(menu, 16), JSON.stringify(menu));
  const addr = await markShape(page, ".cl-field .brand-mark");
  check("the logo: the address bar's mark is the real path, 16px", isMark(addr, 16), JSON.stringify(addr));
  const home = await markShape(page, '[data-dest="hub"] .brand-mark');
  check("the logo: the Home button's mark is the real path, 22px", isMark(home, 22), JSON.stringify(home));
  // Classic flattens every corner; the mark is a clip, so it cannot be.
  const flat = await page.evaluate(() => getComputedStyle(document.querySelector(".cl-tools > button")).borderRadius);
  check("the logo: Classic's corner reset is still on around it", flat === "0px", flat);
  const colours = await page.evaluate(() => {
    const i = document.querySelector(".cl-menu .brand-mark i");
    const cap = getComputedStyle(i).backgroundImage;
    return cap.includes("conic-gradient") && cap.includes("rgb(255, 147, 175)") && cap.includes("rgb(131, 255, 168)");
  });
  check("the logo: and its colours are the app's own stops", colours);
  await shot(page, "header-guide");
  await page.keyboard.press("Control+k");
  const box = page.locator(".palette--classic");
  await box.waitFor();
  // The box zooms in as it opens; a hit test mid-animation can miss the ring.
  await page.waitForFunction(() => document.querySelector(".palette--classic")?.getAnimations({ subtree: true }).every((a) => a.playState !== "running"));
  const goto = await markShape(page, ".palette--classic .brand-mark");
  check("the logo: the Go To box's mark is the real path, 34px", isMark(goto, 34), JSON.stringify(goto));
  await shot(page, "goto");

  // ---- the x closes the box, as Escape and Cancel do
  await page.waitForTimeout(300);
  check("Go To: the box opens with the field focused, not the x", await page.evaluate(() => document.activeElement?.tagName === "INPUT" && !!document.activeElement.closest(".palette--classic")), await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
  const x = box.locator("button.cl-x");
  check("Go To: the x is a button named Close", (await x.count()) === 1 && (await x.getAttribute("aria-label")) === "Close");
  await x.click({ timeout: 3000 }).catch(() => {});
  await box.waitFor({ state: "detached", timeout: 3000 }).then(
    () => check("Go To: the x closes the box", true),
    () => check("Go To: the x closes the box", false, "still open"),
  );
  await page.keyboard.press("Control+k");
  await box.waitFor();
  await page.keyboard.press("Escape");
  await box.waitFor({ state: "detached", timeout: 3000 }).then(
    () => check("Go To: Escape still closes it", true),
    () => check("Go To: Escape still closes it", false),
  );
  await ctx.close();
}
{
  // ---- Fluent's title bar wears the same mark
  const { ctx, page } = await open({ store: { themePack: "fluent" } });
  await page.waitForSelector(".flc-title", { timeout: 20_000 });
  const m = await markShape(page, ".flc-title .brand-mark");
  check("the logo: Fluent's title bar mark is the real path, 16px", isMark(m, 16), JSON.stringify(m));
  check("the logo: and it has no old square", (await page.locator(".flc-title__mark").count()) === 0);
  await shot(page, "fluent-mark");
  await ctx.close();
}
{
  // ---- the boot and What's New tile: the same shape in Classic as in Default
  const radii = async (store) => {
    const { ctx, page } = await open({ store, version: "1.2.0" });
    await page.locator(".wn .boot-scene.is-settled").waitFor({ timeout: 25_000 }).catch(async () => {
      await page.getByRole("button", { name: "Skip", exact: true }).click().catch(() => {});
      await page.locator(".wn .boot-scene.is-settled").waitFor({ timeout: 15_000 });
    });
    const r = await page.evaluate(() =>
      [".boot-frame", ".boot-sheet", ".boot-paint-fit", ".boot-paint", ".boot-screen"].map(
        (s) => `${s}=${getComputedStyle(document.querySelector(`.wn ${s}`)).borderRadius}`,
      ),
    );
    await shot(page, `whatsnew-${store.themePack ?? "default"}`);
    await ctx.close();
    return r;
  };
  const d = await radii({});
  const c = await radii(CLASSIC);
  check("the logo: What's New's tile is rounded in Default", d.some((x) => !x.endsWith("=0px")), d.join(" "));
  check("the logo: and the same radii in Classic (the reset leaves the tile alone)", d.join() === c.join(), c.join(" "));
}

// ------------------------------------------- 2. the tab you are on is pressed
{
  const { ctx, page } = await open();
  await page.waitForSelector(".cl-header", { timeout: 20_000 });
  await page.waitForTimeout(400);
  const pressed = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".cl-tools > [data-dest]")].map((b) => {
        const cs = getComputedStyle(b);
        return { dest: b.dataset.dest, current: b.getAttribute("aria-current") === "page", bold: cs.fontWeight === "700", pressed: cs.boxShadow.startsWith("rgb(64, 64, 64) 1px 1px"), checker: cs.backgroundImage.includes("conic-gradient") };
      }),
    );
  const say = (rows) => JSON.stringify(rows.filter((r) => r.current || r.bold || r.pressed));
  let rows = await pressed();
  const cur = rows.find((r) => r.current);
  check("pressed: on a fresh load the current tab is pressed, bold and checkered", !!cur && cur.bold && cur.pressed && cur.checker, say(rows));
  check("pressed: and no other tab is", rows.filter((r) => r.pressed || r.bold).length === 1, say(rows));
  const dests = rows.map((r) => r.dest);
  for (const d of dests) {
    await goTo(page, d);
    // Off the button: a hovered one wears the hover rule, which hides a lost press.
    await page.mouse.move(720, 480);
    await page.waitForTimeout(150);
    rows = await pressed();
    const on = rows.find((r) => r.current);
    check(`pressed: ${d} is pressed when it is the current tab, and alone`, on?.dest === d && on.bold && on.pressed && on.checker && rows.filter((r) => r.pressed).length === 1, say(rows));
  }
  await goTo(page, "multiview");
  await page.waitForTimeout(300);
  await shot(page, "multiview-pressed");
  await goTo(page, "guide");
  await page.waitForTimeout(300);
  await shot(page, "guide-pressed");
  // The push button keeps its own look.
  await ctx.close();
}
{
  // The push button the toolbar used to share a class with.
  const { ctx, page } = await open();
  await goTo(page, "guide");
  await page.locator(".guide__card").first().click();
  const b = page.locator(".cl-hero__btns .cl-btn").first();
  await b.waitFor({ timeout: 10_000 });
  const cs = await b.evaluate((el) => {
    const s = getComputedStyle(el);
    return { w: s.minWidth, h: s.height, shadow: s.boxShadow.includes("inset") };
  });
  // 23px: Windows 2000's push button, the one every Classic screen draws (plan 035, "the same piece looks the same everywhere").
  check("pressed: the Guide's push buttons are still push buttons (84px, 23px, raised)", cs.w === "84px" && cs.h === "23px" && cs.shadow, JSON.stringify(cs));
  await ctx.close();
}

// ------------------------------------------------------------ 3. the address
{
  const { ctx, page } = await open({ store: { ...CLASSIC, startupTab: "stream" } });
  await page.waitForSelector(".cl-header", { timeout: 20_000 });
  await goTo(page, "home");
  await page.waitForSelector(".stream-card", { timeout: 30_000 });
  const stream = await address(page);
  check("address: Stream home reads BlammyTV › Stream › Home", stream === "BlammyTV › Stream › Home", stream);
  await page.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
  await page.locator(".clt-film .clt-lr").first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(300);
  const film = await address(page);
  check("address: a film's page reads BlammyTV › Stream › Fake Movie One", film === "BlammyTV › Stream › Fake Movie One", film);
  await shot(page, "film-address");
  await page.locator('[data-cl="settings"]').click();
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.waitFor();
  await dlg.locator('.cl-tabs [role="tab"]', { hasText: "Appearance" }).click();
  await page.waitForTimeout(200);
  const set = await address(page);
  check("address: with Settings open it reads BlammyTV › Settings › Appearance", set === "BlammyTV › Settings › Appearance", set);
  await dlg.locator('.cl-tabs [role="tab"]', { hasText: "Playback" }).click();
  await page.waitForTimeout(200);
  check("address: and follows the tab", (await address(page)) === "BlammyTV › Settings › Playback", await address(page));
  await dlg.locator("button.cl-x[aria-label='Close settings']").click();
  await dlg.waitFor({ state: "detached" });
  await page.waitForTimeout(200);
  const back = await address(page);
  check("address: closing Settings gives the film's page back", back === "BlammyTV › Stream › Fake Movie One", back);
  await goTo(page, "discover");
  await page.waitForTimeout(300);
  check("address: Discover keeps its search band, not an address", (await page.locator("[data-cl=address]").count()) === 0 && (await page.locator("#cl-search").count()) === 1);
  await ctx.close();
}

// ------------------------------------------------- 4. a narrow window
for (const width of [1100, 900]) {
  const { ctx, page } = await open({ width });
  await page.waitForSelector(".cl-header", { timeout: 20_000 });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const tools = document.querySelector(".cl-tools");
    const labels = [...document.querySelectorAll(".cl-tb__t")].filter((l) => getComputedStyle(l).display !== "none");
    const oneLine = labels.every((l) => {
      const cs = getComputedStyle(l);
      const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25;
      return l.getBoundingClientRect().height <= line * 1.3;
    });
    return {
      compact: document.querySelector(".cl-header").hasAttribute("data-compact"),
      shown: labels.length,
      oneLine,
      fits: tools.scrollWidth <= tools.clientWidth,
      unnamed: [...tools.querySelectorAll("button")].filter((b) => !(b.getAttribute("aria-label") || "").trim() && !b.textContent.trim()).length,
      tipped: [...tools.querySelectorAll("button")].filter((b) => !b.title).length,
      tall: Math.round(document.querySelector(".cl-header").getBoundingClientRect().height),
    };
  });
  check(`narrow ${width}: no label wraps`, m.oneLine, JSON.stringify(m));
  check(`narrow ${width}: the toolbar fits the window`, m.fits, JSON.stringify(m));
  check(`narrow ${width}: every button is still named, with a tooltip`, m.unnamed === 0 && m.tipped === 0, JSON.stringify(m));
  if (width === 900) check("narrow 900: the labels have gone to icons", m.compact && m.shown === 0, JSON.stringify(m));
  check(`narrow ${width}: the header is the one height (two rows and the address bar)`, m.tall === 104, String(m.tall));
  await shot(page, `narrow-${width}`);
  await ctx.close();
}
{
  // Wide again: the labels come back.
  const { ctx, page } = await open({ width: 900 });
  await page.waitForSelector(".cl-header", { timeout: 20_000 });
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  check("narrow: widening the window brings the labels back", await page.evaluate(() => !document.querySelector(".cl-header").hasAttribute("data-compact") && getComputedStyle(document.querySelector(".cl-tb__t")).display !== "none"));
  await ctx.close();
}

// ------------------------------------------------ 5. over video: the player
/** The native side, stubbed (verify-miniguide). The player is a black hole;
 * what reaches it is an `inv_open`. */
const playerStub = ([panel]) => {
  window.__calls = [];
  window.__presenting = false;
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
      window.__calls.push([cmd, args]);
      if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
      if (cmd === "plugin:event|listen") return Promise.resolve(++cb);
      if (cmd === "mpv_status" && window.__presenting)
        return Promise.resolve(JSON.stringify({ pos: 10, dur: 0, presenting: true, ended: false, buffering: false, seekable: true, cacheDur: 0, dvrStart: 0, dvrEnd: 0, audio: [], subs: [], chapters: [] }));
      if (cmd === "mv_proxy_open") return Promise.resolve("http://127.0.0.1:9/mv/tok");
      if (cmd === "rec_list") return Promise.resolve([]);
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  MediaSource.isTypeSupported = () => true;
  if (!sessionStorage.getItem("__seeded")) {
    sessionStorage.setItem("__seeded", "1");
    localStorage.setItem("btv:onboarded", "1");
    localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
    localStorage.setItem("blammytv.themePack", JSON.stringify({ v: 1, data: "classic" }));
    localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
    localStorage.setItem("blammytv.recordingNotice", JSON.stringify({ v: 1, data: false }));
    localStorage.setItem("blammytv.playlists", JSON.stringify({ v: 1, data: [{ kind: "xtream", id: "p", name: "Pins", enabled: true, server: panel, username: "pins", password: "p" }] }));
    localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "live" }));
  }
  sessionStorage.setItem("btv:welcome-played", "1");
};
/** Contrast, from computed colours. Any CSS colour goes through a canvas, and a
 * translucent one is composited over `under` first. */
const CONTRAST = `(() => {
  const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = "#000"; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3]));
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  window.__contrast = (fg, bg) => { const b = rgba(bg); const f = over(rgba(fg), b.slice(0, 3)); const l1 = lum(f), l2 = lum(b.slice(0, 3)); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  window.__rgba = rgba;
})()`;
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(playerStub, [PANEL]);
  // The video is black behind the chrome; this page has none, so it gets the stand-in.
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style");
    s.textContent = "#inv-chrome{background:#000}";
    document.head.append(s);
  }));
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.locator(".guide__channel").first().waitFor({ timeout: 30_000 });
  await page.evaluate(CONTRAST);
  await page.waitForTimeout(500);
  await page.locator(".guide__card").nth(2).click();
  await page.locator(".mini-overlay").waitFor({ timeout: 10_000 });
  await page.evaluate(() => (window.__presenting = true));
  await page.locator(".mini-overlay .tune").waitFor({ state: "detached", timeout: 10_000 });
  await page.mouse.move(300, 200);
  await page.waitForTimeout(400);
  // ---- the mini player
  const mini = await page.evaluate(() => {
    const o = document.querySelector(".mini-overlay");
    const cs = getComputedStyle(o);
    return { r: cs.borderRadius, text: cs.getPropertyValue("--text").trim(), glass: cs.getPropertyValue("--glass").trim() };
  });
  check("player: the mini player's panel has square corners", mini.r === "0px", mini.r);
  check("player: and it wears the picture's light ink, over dark glass", mini.text === "#ffffff" && mini.glass === "#1c1c1c", JSON.stringify(mini));
  const miniBtn = page.locator(".mini-overlay .overlay__btn").first();
  await page.locator(".mini-overlay").hover();
  await page.waitForTimeout(300);
  const mb = await miniBtn.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fg: s.color, bg: s.backgroundColor };
  });
  const mbRatio = await page.evaluate(([f, b]) => window.__contrast(f, b), [mb.fg, mb.bg]);
  check("player: the mini player's buttons read (contrast >= 4.5 against their own fill)", mbRatio >= 4.5, `${mbRatio.toFixed(1)} ${JSON.stringify(mb)}`);
  await shot(page, "mini");
  // ---- the theater
  await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
  await page.locator(".theater-overlay").waitFor({ timeout: 5000 });
  await page.mouse.move(800, 300);
  await page.mouse.move(820, 330);
  await page.waitForTimeout(600);
  const t = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const col = (s) => (q(s) ? getComputedStyle(q(s)).color : null);
    // The scrim's own colour at its 60% stop, over white video: the worst case.
    const bar = getComputedStyle(q(".theater-bar")).backgroundImage;
    const stop = [...bar.matchAll(/rgba?\(([^)]*)\)\s*(\d+)%/g)].map((m) => ({ c: `rgba(${m[1]})`, at: Number(m[2]) })).find((s) => s.at === 60);
    const grp = q(".theater-controls__group");
    const btn = grp?.querySelector("button");
    const track = getComputedStyle(q(".theater-seek__track")).backgroundColor;
    return {
      scrim: stop?.c,
      name: col(".theater-bar__name"),
      title: col(".theater-bar__title"),
      source: col(".theater-bar__source"),
      desc: col(".theater-bar__desc"),
      time: q(".theater-seek__labels span") ? getComputedStyle(q(".theater-seek__labels span")).color : null,
      groupBg: getComputedStyle(grp).backgroundColor,
      icon: btn ? getComputedStyle(btn).color : null,
      fill: getComputedStyle(q(".theater-seek__fill")).backgroundColor,
      track,
      corners: getComputedStyle(q(".theater-overlay"), "::before").display,
      radius: getComputedStyle(q("#inv-chrome")).borderRadius,
      shell: getComputedStyle(q(".theater-overlay")).borderRadius,
    };
  });
  const ratio = (fg, bg) => page.evaluate(([f, b]) => window.__contrast(f, b), [fg, bg]);
  // Over white video: 80% black is #333.
  const WHITE_UNDER = await page.evaluate((s) => { const c = window.__rgba(s); return `rgb(${[0, 1, 2].map((i) => Math.round(c[i] * c[3] + 255 * (1 - c[3]))).join(",")})`; }, t.scrim ?? "rgba(0,0,0,0.8)");
  for (const k of ["name", "title", "source", "desc", "time"]) {
    const r = t[k] ? await ratio(t[k], WHITE_UNDER) : 0;
    check(`player: the theater's ${k} is light on the scrim (contrast ${r.toFixed(1)} >= 4.5 over bright video)`, r >= 4.5, `${t[k]} on ${WHITE_UNDER}`);
  }
  const ir = await ratio(t.icon ?? "#000", t.groupBg);
  check(`player: the control icons read on their bar (contrast ${ir.toFixed(1)} >= 4.5)`, ir >= 4.5, `${t.icon} on ${t.groupBg}`);
  const fr = await ratio(t.fill, "rgb(0,0,0)");
  const kr = await ratio(t.track, "rgb(0,0,0)");
  check(`player: the progress fill (${fr.toFixed(1)}) and its track (${kr.toFixed(1)}) show against black`, fr >= 4.5 && kr >= 3 && t.fill !== t.track, `${t.fill} / ${t.track}`);
  check("player: the theater is square (no rounded wedges, no radius)", t.corners === "none" && t.radius === "0px" && t.shell === "0px", JSON.stringify({ c: t.corners, r: t.radius, s: t.shell }));
  await shot(page, "theater");
  await ctx.close();
}

// -------------------------------------------- 6. Multi-View's bar and tiles
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(playerStub, [PANEL]);
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.locator(".guide__channel").first().waitFor({ timeout: 30_000 });
  await page.evaluate(CONTRAST);
  await goTo(page, "multiview");
  await page.locator(".mvtab").waitFor();
  await page.waitForTimeout(400);
  const add = async (name) => {
    const empty = page.locator(".mvtile--empty");
    if (await empty.count()) await empty.first().click();
    else await page.locator(".mvbar__add").click();
    await page.locator(".mvpick__input").fill(name);
    await page.locator(".mvpick__row", { hasText: name }).first().click();
    await page.locator(".mvpick__input").waitFor({ state: "detached" });
  };
  await add("Pin Channel 1");
  await add("Pin Channel 2");
  await page.locator(".mvtile__state .state__title").first().waitFor({ timeout: 10_000 });
  await page.mouse.move(700, 600);
  await page.waitForTimeout(400);
  const g = await page.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const hdr = r(".cl-header"), bar = r(".mvbar"), stage = r(".mvtab__stage");
    const hit = (s) => {
      const e = document.querySelector(s);
      if (!e) return false;
      const b = e.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return !!top && e.contains(top);
    };
    const css = (s, p) => getComputedStyle(document.querySelector(s))[p];
    return {
      header: hdr.bottom,
      bar: bar.top,
      barBottom: bar.bottom,
      stage: stage.top,
      reachable: ["[data-cl=back]", "[data-cl=goto]", "[data-cl=settings]"].map(hit),
      addBg: css(".mvbar__add", "backgroundColor"),
      addFg: css(".mvbar__add", "color"),
      addShadow: css(".mvbar__add", "boxShadow"),
      tileBg: css(".mvtile", "backgroundColor"),
      title: css(".mvtile__state .state__title", "color"),
      sub: document.querySelector(".mvtile__state .state__sub") ? css(".mvtile__state .state__sub", "color") : null,
      chip: css(".mvmeter", "backgroundColor"),
      chipFg: css(".mvmeter", "color"),
    };
  });
  check("multi-view: the bar starts at or below the header's bottom edge", g.bar >= g.header, `${g.bar} vs ${g.header}`);
  check("multi-view: the tiles start below the bar", g.stage >= g.barBottom, `${g.stage} vs ${g.barBottom}`);
  check("multi-view: Back, Go To and Settings can be clicked (nothing sits on them)", g.reachable.every(Boolean), JSON.stringify(g.reachable));
  check("multi-view: Add Channel is a raised Classic button, black on grey", g.addBg === "rgb(212, 208, 200)" && g.addFg === "rgb(0, 0, 0)" && g.addShadow.includes("inset"), JSON.stringify({ bg: g.addBg, fg: g.addFg }));
  const chipR = await page.evaluate(([f, b]) => window.__contrast(f, b), [g.chipFg, g.chip]);
  check(`multi-view: the streams chip reads (contrast ${chipR.toFixed(1)})`, chipR >= 4.5, `${g.chipFg} on ${g.chip}`);
  const tileBg = await page.evaluate(() => {
    const t = document.querySelector(".mvtile__state");
    let e = t;
    while (e && getComputedStyle(e).backgroundColor === "rgba(0, 0, 0, 0)") e = e.parentElement;
    return getComputedStyle(e).backgroundColor;
  });
  const tr = await page.evaluate(([f, b]) => window.__contrast(f, b), [g.title, tileBg]);
  check(`multi-view: a tile's message is light on the dark tile (contrast ${tr.toFixed(1)} >= 4.5)`, tr >= 4.5, `${g.title} on ${tileBg}`);
  await shot(page, "multiview-tiles");
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);

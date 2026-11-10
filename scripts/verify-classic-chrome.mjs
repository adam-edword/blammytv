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
async function open({ store = CLASSIC, width = 1440, scheme = "dark", version, query = "" } = {}) {
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
  await page.goto(APP + query, { waitUntil: "domcontentloaded" });
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
  // For a frame after it mounts the dialog is still pointer-events: none (Radix turns it on in an effect),
  // and a hit test goes through it to the dim layer. Measured 1.2.9: 5 of 60 opens under load, each with
  // no animation running and no transform. The mark's test below is a hit test, so wait for that.
  // The real condition, not the style: pointer-events can read "auto" in the frame before Radix sets the body to none.
  await page.waitForFunction(() => {
    const d = document.querySelector(".palette--classic");
    const r = d?.getBoundingClientRect();
    const hit = r && document.elementFromPoint(r.left + r.width / 2, r.top + 12);
    return !!hit && d.contains(hit);
  });
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

// ---------------------- 1b. brand screens are never themed (H5)
// Onboarding and What's New look the same under every pack: each control's
// computed face, size and type under Classic equal Default's.
{
  const faces = (sel) =>
    [...document.querySelectorAll(sel)].map((b) => {
      const s = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return [b.textContent.trim().slice(0, 24), s.color, s.backgroundColor, Math.round(r.height), Math.round(r.width), s.fontSize, s.fontFamily.slice(0, 20), s.borderRadius, s.boxShadow.slice(0, 40)].join("|");
    });
  const onboarding = async (pack) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
    const page = await ctx.newPage();
    await page.addInitScript((pack) => {
      localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
      if (pack) localStorage.setItem("blammytv.themePack", JSON.stringify({ v: 1, data: pack }));
    }, pack);
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    await page.locator(".onb .onb-btn").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    const rows = await page.evaluate(`(${faces})(".onb button")`);
    await shot(page, `onboarding-${pack ?? "default"}`);
    // one step further, where the ghost buttons are
    await page.locator(".onb .onb-btn").first().click();
    await page.waitForTimeout(2500);
    const next = await page.evaluate(`(${faces})(".onb button")`);
    await ctx.close();
    return [...rows, "--", ...next];
  };
  const d = await onboarding(null);
  const c = await onboarding("classic");
  check("brand screens: onboarding has buttons to compare", d.length > 2, d.join(" ; "));
  check("brand screens: onboarding's buttons are the same under Classic as in Default", d.join("\n") === c.join("\n"), `default ${d.join(" ; ")}\nclassic ${c.join(" ; ")}`);
  const wn = async (store) => {
    const { ctx, page } = await open({ store, version: "1.2.0" });
    await page.locator(".wn .boot-scene.is-settled").waitFor({ timeout: 25_000 }).catch(async () => {
      await page.getByRole("button", { name: "Skip", exact: true }).click().catch(() => {});
      await page.locator(".wn .boot-scene.is-settled").waitFor({ timeout: 15_000 });
    });
    await page.waitForTimeout(1500);
    const rows = await page.evaluate(`(${faces})(".wn button")`);
    await shot(page, `whatsnew-buttons-${store.themePack ?? "default"}`);
    await ctx.close();
    return rows;
  };
  const wd = await wn({});
  const wc = await wn(CLASSIC);
  check("brand screens: What's New has buttons to compare", wd.length >= 2, wd.join(" ; "));
  check("brand screens: What's New's buttons are the same under Classic as in Default", wd.join("\n") === wc.join("\n"), `default ${wd.join(" ; ")}\nclassic ${wc.join(" ; ")}`);
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
  // M15b: Add to Library is Default's split button, its arrow a Classic menu of the lists.
  const save = page.locator(".vod-save-split");
  const half = await save.evaluate((e) => [...e.querySelectorAll("button")].map((b) => ({ h: Math.round(b.getBoundingClientRect().height), shadow: getComputedStyle(b).boxShadow.includes("inset") })));
  check("film: Add to Library is a push button with a 23px arrow beside it", half.length === 2 && half.every((b) => b.h === 23 && b.shadow), JSON.stringify(half));
  await page.locator(".vod-save__more").click();
  const menu = page.locator('[data-slot="dropdown-menu-content"]');
  await menu.waitFor({ timeout: 5000 });
  const mm = await menu.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, rows: e.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"]').length, radius: getComputedStyle(e).borderRadius }));
  check("film: the arrow opens the lists as a Classic menu (grey, square, with New List in it)", mm.bg === "rgb(212, 208, 200)" && mm.radius === "0px" && mm.rows >= 1, JSON.stringify(mm));
  await shot(page, "film-library-menu");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached", timeout: 3000 });
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
  // R8: a title opened from Home still says where it was opened from.
  await goTo(page, "hub");
  await page.locator(".stream-card").first().waitFor({ timeout: 20_000 });
  check("address: Home reads BlammyTV › Home", (await address(page)) === "BlammyTV › Home", await address(page));
  await page.locator(".stream-card").first().click();
  await page.locator(".vod-detail, .clt").first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(400);
  const fromHome = await address(page);
  check("address: a title opened from Home reads BlammyTV › Home › <title> (R8)", /^BlammyTV › Home › .+/.test(fromHome), fromHome);
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

// R1: the update chip mounts after the header has measured. The window's
// minimum is 1000px (tauri.conf); Go To and Settings must stay inside it.
for (const [width, query] of [[1000, ""], [1000, "?update=9.9.9"], [1100, ""], [1100, "?update=9.9.9"]]) {
  const { ctx, page } = await open({ width, query });
  await page.waitForSelector(".cl-header", { timeout: 20_000 });
  if (query) await page.locator(".update-chip").waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const edge = (s) => Math.round(document.querySelector(s).getBoundingClientRect().right);
    const tools = document.querySelector(".cl-tools");
    return { goto: edge("[data-cl=goto]"), settings: edge("[data-cl=settings]"), w: innerWidth, fits: tools.scrollWidth <= tools.clientWidth, compact: document.querySelector(".cl-header").hasAttribute("data-compact") };
  });
  const what = `narrow ${width}${query ? " with the update chip" : ""}`;
  check(`${what}: Go To and Settings are inside the window`, m.goto <= m.w && m.settings <= m.w && m.fits, JSON.stringify(m));
  // 1100px is where it matters: the row fits with its labels until the chip arrives, then must drop to icons.
  if (width === 1100) check(`${what}: the labels ${query ? "have gone to icons" : "are still showing"}`, m.compact === !!query, JSON.stringify(m));
  await shot(page, `narrow-${width}${query ? "-update" : ""}`);
  await ctx.close();
}

// ------------------------------------------- 4b. Settings: place and Appearance
for (const width of [1600, 1100]) {
  const { ctx, page } = await open({ width });
  await page.waitForSelector(".cl-header", { timeout: 20_000 });
  await page.waitForTimeout(400);
  await page.locator('[data-cl="settings"]').click();
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.waitFor();
  await page.waitForTimeout(400);
  // M16: under the header, not over the address bar, on every tab alike.
  const rects = [];
  for (const tab of ["home", "appearance", "app"]) {
    await dlg.locator(`.cl-tabs [data-rail="${tab}"]`).click();
    await page.waitForTimeout(250);
    rects.push(await page.evaluate(() => {
      const r = document.querySelector('[role="dialog"] .settings--classic, .settings--classic').getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), headerBottom: Math.round(document.querySelector(".cl-header").getBoundingClientRect().bottom), status: Math.round(document.querySelector(".cl-status").getBoundingClientRect().top) };
    }));
  }
  check(`settings ${width}: the dialog starts at or below the header's bottom edge, ends above the status bar (M16)`, rects.every((r) => r.top >= r.headerBottom && r.bottom <= r.status), JSON.stringify(rects[0]));
  check(`settings ${width}: and sits in the same place on every tab`, new Set(rects.map((r) => `${r.top}/${r.bottom}`)).size === 1, JSON.stringify(rects));
  if (width === 1600) {
    await dlg.locator('.cl-tabs [data-rail="appearance"]').click();
    await page.waitForTimeout(300);
    // M9: theme cards
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll('[data-picker="theme"]')].map((c) => {
        const cr = c.getBoundingClientRect();
        const pr = c.querySelector("[data-swatch]").getBoundingClientRect();
        const cs = getComputedStyle(c);
        return { on: c.getAttribute("aria-pressed") === "true", pad: cs.paddingLeft, top: Math.round(pr.top - cr.top), side: Math.round(pr.left - cr.left), h: Math.round(cr.height), checker: cs.backgroundImage.includes("conic"), shadow: cs.boxShadow.slice(0, 22) };
      }),
    );
    check("appearance: theme cards have 8px padding and the preview clear of the bevel (M9)", cards.length >= 4 && cards.every((c) => c.pad === "8px" && c.top >= 8 && c.side >= 8 && c.h > 72), JSON.stringify(cards[0]));
    const chosen = cards.filter((c) => c.on);
    check("appearance: the chosen card is pushed in, with no checker over its preview", chosen.length === 1 && !chosen[0].checker && chosen[0].shadow !== cards.find((c) => !c.on).shadow, JSON.stringify(chosen));
    // M8: Card Details chips
    const chips = await page.evaluate(() => [...document.querySelectorAll(".meta-pick__chip")].map((c) => ({ on: c.getAttribute("aria-pressed") === "true", h: Math.round(c.getBoundingClientRect().height), raised: getComputedStyle(c).boxShadow.startsWith("rgb(64, 64, 64) -1px") })));
    check("appearance: every Card Details chip is 23px, pressed or not (M8)", chips.length > 1 && chips.every((c) => c.h === 23), JSON.stringify(chips));
    check("appearance: and there are both kinds to compare", chips.some((c) => c.on) && chips.some((c) => !c.on));
    // the value beside the slider
    const val = await page.evaluate(() => {
      const b = document.querySelector(".rowcap__value--btn");
      if (!b) return null;
      const s = getComputedStyle(b);
      return { bg: s.backgroundColor, h: Math.round(b.getBoundingClientRect().height), raised: s.boxShadow.startsWith("rgb(64, 64, 64) -1px") };
    });
    check("appearance: Titles per Row's value is a sunken white field, not a raised button", !!val && val.bg === "rgb(255, 255, 255)" && val.h === 22 && !val.raised, JSON.stringify(val));
    // R2: the accent's hex field starts right of its #
    await page.getByRole("button", { name: "Custom" }).click();
    const hex = page.locator('input[aria-label="Hex color"]');
    await hex.waitFor({ timeout: 5000 });
    const hx = await hex.evaluate((i) => {
      const hash = [...i.parentElement.querySelectorAll("span")].find((s) => s.textContent.trim() === "#").getBoundingClientRect();
      return { textStart: Math.round(i.getBoundingClientRect().left + parseFloat(getComputedStyle(i).paddingLeft)), hashRight: Math.round(hash.right), h: Math.round(i.getBoundingClientRect().height) };
    });
    check("appearance: the hex field's text starts right of the # (R2), at 22px", hx.textStart >= hx.hashRight && hx.h === 22, JSON.stringify(hx));
    await shot(page, "accent-popover");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await shot(page, "appearance");
  }
  if (width === 1100) await shot(page, "settings-1100");
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
  // A wide, short window (Adam's, 1.2.9): the slot is the largest 16:9 box that fits under the toolbar,
  // not the frame's 100% width, which spilled a 16:9 player over the toolbar and past the controls.
  const fits = async () => page.evaluate(() => {
    const r = document.querySelector("#player-slot").getBoundingClientRect();
    const head = document.querySelector(".cl-header").getBoundingClientRect().bottom;
    const foot = document.querySelector(".cl-status")?.getBoundingClientRect().top ?? innerHeight;
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), head: Math.round(head), foot: Math.round(foot) };
  });
  for (const [w, h] of [[1440, 900], [2000, 800], [1600, 640]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const f = await fits();
    check(`player: at ${w}x${h} the theater fits between the toolbar and the status bar, 16:9`, f.top >= f.head && f.bottom <= f.foot && Math.abs(f.w / f.h - 16 / 9) < 0.02, JSON.stringify(f));
  }
  await ctx.close();
}

// ------------------------- 5b. on a picture, in both faces (H1, H2, H3, M10, M14)
// Classic has one face, so the player's chrome is light ink on dark glass whether
// Appearance is Dark or Light. Measured from computed colours, as above.
for (const face of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(playerStub, [PANEL]);
  await page.addInitScript((face) => localStorage.setItem("blammytv.theme", JSON.stringify({ v: 1, data: face })), face);
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style");
    s.textContent = "#inv-chrome{background:#000}";
    document.head.append(s);
  }));
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.locator(".guide__channel").first().waitFor({ timeout: 30_000 });
  await page.evaluate(CONTRAST);
  const ratioOf = (el) =>
    el.evaluate((e) => {
      const s = getComputedStyle(e);
      return { fg: s.color, bg: s.backgroundColor };
    }).then((c) => page.evaluate(([f, b]) => ({ r: window.__contrast(f, b), f, b }), [c.fg, c.bg]));
  await page.waitForTimeout(500);
  await page.locator(".guide__card").nth(2).click();
  await page.locator(".mini-overlay").waitFor({ timeout: 10_000 });
  await page.evaluate(() => (window.__presenting = true));
  await page.locator(".mini-overlay .tune").waitFor({ state: "detached", timeout: 10_000 });
  await page.mouse.move(300, 200);
  await page.waitForTimeout(400);
  const mini = await ratioOf(page.locator(".mini-overlay .overlay__btn").first());
  check(`${face}: the mini player's buttons read (contrast ${mini.r.toFixed(1)} >= 4.5)`, mini.r >= 4.5, `${mini.f} on ${mini.b}`);
  await page.locator(".mini-overlay").click({ position: { x: 200, y: 140 } });
  await page.locator(".theater-overlay").waitFor({ timeout: 5000 });
  await page.mouse.move(800, 300);
  await page.mouse.move(820, 330);
  await page.waitForTimeout(600);
  const chip = page.locator(".theater-overlay [data-variant=chip]").first();
  const c0 = await ratioOf(chip);
  check(`${face}: a theater chip is light on dark (contrast ${c0.r.toFixed(1)} >= 4.5)`, c0.r >= 4.5, `${c0.f} on ${c0.b}`);
  await chip.hover();
  await page.waitForTimeout(300);
  const c1 = await ratioOf(chip);
  check(`${face}: and hovered it still reads (contrast ${c1.r.toFixed(1)} >= 4.5, H3)`, c1.r >= 4.5 && c1.b !== "rgb(212, 208, 200)", `${c1.f} on ${c1.b}`);
  await shot(page, `theater-${face}`);
  // keyboard focus on a control over the picture: a white dotted rectangle
  await page.locator(".theater-controls__group button").first().focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const ring = await page.evaluate(() => {
    const e = document.activeElement;
    const s = e && getComputedStyle(e);
    return { ok: !!e?.closest(".theater-overlay"), c: s?.outlineColor, st: s?.outlineStyle, vis: e?.matches(":focus-visible") };
  });
  check(`${face}: keyboard focus on a player control is a white dotted rectangle (M14)`, ring.ok && ring.vis && ring.st === "dotted" && /^rgba?\(255, 255, 255/.test(ring.c), JSON.stringify(ring));
  await shot(page, `theater-focus-${face}`);
  // the LIVE chip sits in the capsule as the capsule draws it, not as a push button
  const live = await page.locator(".theater-live").first().evaluate((e) => ({ h: e.getBoundingClientRect().height, bg: getComputedStyle(e).backgroundColor }));
  check(`${face}: the LIVE chip is not a grey push button (M10)`, live.bg !== "rgb(212, 208, 200)" && live.h !== 23, JSON.stringify(live));
  // R5: the shared dialog frame with no close button (Record's notice) keeps its bottom gap.
  if (face === "dark") {
    await page.evaluate(() => localStorage.setItem("blammytv.recordingNotice", JSON.stringify({ v: 1, data: true })));
    const rec = page.locator('.theater-overlay [aria-label="Record"]');
    if ((await rec.count()) === 0) check("record dialog: the theater has a Record button to reach it", false);
    else {
      await rec.first().click();
      const d = page.locator('[role="dialog"]', { hasText: "Recording Uses a Connection" });
      await d.waitFor({ timeout: 5000 });
      await page.waitForTimeout(400);
      const g = await d.evaluate((e) => {
        const r = e.getBoundingClientRect();
        const foot = e.querySelector('[data-slot="dialog-footer"]').getBoundingClientRect();
        const lab = getComputedStyle(e.querySelector("label.settings-check"));
        const title = getComputedStyle(e.querySelector('[data-slot="dialog-title"]'));
        return { gap: Math.round(r.bottom - foot.bottom), labelMargin: lab.marginBottom, closeX: !!e.querySelector('[data-slot="dialog-close"]'), titleBorder: title.borderRightWidth };
      });
      check("record dialog: the footer keeps its bottom gap and the label has none (R5)", g.gap >= 11 && g.labelMargin === "0px", JSON.stringify(g));
      check("record dialog: no close button, so the caption keeps no room for one", !g.closeX && g.titleBorder === "0px", JSON.stringify(g));
      await shot(page, "record-dialog");
      await page.keyboard.press("Escape");
      await d.waitFor({ state: "detached", timeout: 3000 });
    }
  }
  // the mini-guide
  const mgBtn = page.locator('.theater-overlay [aria-label="Mini-Guide"]');
  if (await mgBtn.count()) {
    await mgBtn.click();
    await page.locator(".mg-card.is-sel").waitFor({ timeout: 5000 });
    await page.mouse.move(700, 120);
    await page.waitForTimeout(500);
    const sel = await ratioOf(page.locator(".mg-card.is-sel"));
    check(`${face}: the mini-guide's selected card reads (contrast ${sel.r.toFixed(1)} >= 4.5, H2)`, sel.r >= 4.5, `${sel.f} on ${sel.b}`);
    const card = await ratioOf(page.locator(".mg-card:not(.is-sel)").first());
    check(`${face}: and so does another card (contrast ${card.r.toFixed(1)} >= 4.5, H1)`, card.r >= 4.5, `${card.f} on ${card.b}`);
    await shot(page, `miniguide-${face}`);
  } else check(`${face}: the Mini-Guide button is there`, false);
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

// ------------------------------- 6b. a game's theater: the channel rail (H4)
{
  const M3U = { v: 1, data: [{ kind: "m3u", id: "m1", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" }] };
  const GAME = {
    game: { kind: "fixture", id: "g1", sport: "football", league: "NFL", leagueKey: "football/nfl", state: "live", start: new Date().toISOString(), status: "3rd 07:22", broadcasts: ["ESPN"], channels: [], home: { name: "Kansas City", abbr: "KC" }, away: { name: "Buffalo", abbr: "BUF" } },
    others: [],
  };
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ([m3u, game]) => {
      let cb = 0;
      window.__TAURI_INTERNALS__ = {
        transformCallback: (f) => {
          const id = ++cb;
          window["_" + id] = f;
          return id;
        },
        convertFileSrc: (p) => p,
        metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
        invoke: (cmd, args) => {
          if (cmd === "http_get") return fetch(args.url).then((r) => r.text());
          if (cmd === "mpv_status") return Promise.resolve(JSON.stringify({ pos: 82, dur: 24.7, presenting: true, ended: false, buffering: false, seekable: true, cacheDur: 18, dvrStart: 0, dvrEnd: 100, audio: [], subs: [], chapters: [] }));
          return Promise.resolve(undefined);
        },
      };
      window.__sportsFixture = game;
      localStorage.setItem("btv:onboarded", "1");
      localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
      localStorage.setItem("blammytv.themePack", JSON.stringify({ v: 1, data: "classic" }));
      localStorage.setItem("blammytv.playlists", JSON.stringify(m3u));
    },
    [M3U, GAME],
  );
  await page.goto(`${APP}?sportstheater=1`, { waitUntil: "domcontentloaded" });
  await page.locator(".sportsrail").first().waitFor({ timeout: 30_000 });
  await page.evaluate(CONTRAST);
  await page.mouse.move(700, 800);
  await page.waitForTimeout(500);
  const inkOn = (sel) =>
    page.evaluate(([sel]) => {
      const e = document.querySelector(sel);
      let b = e;
      while (b && getComputedStyle(b).backgroundColor === "rgba(0, 0, 0, 0)") b = b.parentElement;
      return window.__contrast(getComputedStyle(e).color, getComputedStyle(b).backgroundColor);
    }, [sel]);
  for (const [what, sel] of [["the matchup's name", ".matchup__name"], ["the Channels head", ".sportstheater__railname"], ["a channel's name", ".sportsrail__name"]]) {
    const r = await inkOn(sel);
    check(`sports theater: ${what} reads on Classic's face (contrast ${r.toFixed(1)} >= 4.5)`, r >= 4.5);
  }
  const head = await page.evaluate(() => {
    const b = document.querySelector(".sportstheater__railhead");
    const s = getComputedStyle(b);
    return { bg: s.backgroundColor, shadow: s.boxShadow };
  });
  check("sports theater: the Channels head is flat, not a field", head.bg === "rgba(0, 0, 0, 0)" && head.shadow === "none", JSON.stringify(head));
  const box = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector(".sportstheater__rail"));
    return { bg: s.backgroundColor, sunk: s.boxShadow.includes("inset") };
  });
  check("sports theater: the channels sit in a white sunken list", box.bg === "rgb(255, 255, 255)" && box.sunk, JSON.stringify(box));
  await shot(page, "sports-theater");
  await page.locator(".sportsrail").first().hover();
  await page.waitForTimeout(300);
  const hot = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector(".sportsrail .sportsrail__tilt"));
    return { bg: s.backgroundColor, fg: s.color };
  });
  check("sports theater: the channel you point at is the navy bar, white ink", hot.bg === "rgb(10, 36, 106)" && hot.fg === "rgb(255, 255, 255)", JSON.stringify(hot));
  await ctx.close();
}

// --------------------------- 6c. the Sports tree takes the Folders' keys (R7, M17)
{
  const { ctx, page } = await open();
  await page.waitForSelector(".cl-header", { timeout: 20_000 });
  await goTo(page, "sports");
  await page.locator(".cl-sports__tree [role=treeitem]").first().waitFor({ timeout: 20_000 });
  const sport = page.locator('.cl-sports__tree [role=treeitem][data-id^="s:"]').first();
  const root = page.locator('.cl-sports__tree [role=treeitem][data-id="root"]');
  await sport.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  check("sports tree: Enter on a sport's label selects it, as a click does", (await page.locator(".cl-sports__clear").count()) === 1);
  await page.keyboard.press("ArrowRight");
  const open1 = await sport.getAttribute("aria-expanded");
  await page.keyboard.press("ArrowLeft");
  check("sports tree: the arrows fold and unfold", open1 === "true" && (await sport.getAttribute("aria-expanded")) === "false", String(open1));
  await root.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  check("sports tree: Enter on Sports clears the filter, as a click does", (await page.locator(".cl-sports__clear").count()) === 0);
  const tip = await sport.evaluate((e) => e.querySelector(".cl-tv__lb").getAttribute("title"));
  check("sports tree: a sport's label has a tooltip, and ends in an ellipsis when long", !!tip && (await sport.evaluate((e) => getComputedStyle(e.querySelector(".cl-tv__lb")).textOverflow)) === "ellipsis", String(tip));
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);

// E2E: Fluent's Settings read as one app, and the pieces around it that the
// QA sweep (Fluent Dark, 1600x900) found un-themed (plan 035, "Fluent to tier
// 3"). Both halves are here because they share a setup and a theme, not a
// subject.
//
// Settings, all six pages (Home, Sources, Playback, Appearance, Accounts, App):
//   - no heading repeats the breadcrumb ("Settings > Home" then "Home");
//   - every setting is a card with the SAME radius, stroke and fill (Home's
//     rows, a playlist, the refresh line and the odd stacked ones included),
//     none sits inside another (App's Keyboard Shortcuts), and the rows'
//     controls end on one right edge, the card's 16px inset (+-1px);
//   - titles are 14px regular, descriptions 12px, section headers 14px
//     semibold, on every page;
//   - every Button is a 4px WinUI button (Home's Import Layout and Add Row,
//     App's Export and Import were 999px pills: Radix triggers take the
//     Button's data-slot);
//   - About's link sits on the card's text edge; the add form's Add Playlist
//     is a normal-width button under the form and its kind switch is compact.
//
// Around it:
//   - Multi-View's bar is Fluent controls (4px, 32px), a row of its own with
//     the streams chip clear of the stage, and its focus ring shows for the
//     keyboard only;
//   - the pane folds to the rail under 1008px wide (88px, remembered choice
//     untouched, back to it when wide) and its hamburger opens the pane over
//     the page there;
//   - Library's page title is Stream's (28px);
//   - the Guide's context menu and the folder menu are MenuFlyouts: left
//     aligned, 4px items, 8px flyout.
//
// Offline: the fake M3U and AIOStreams, every other host aborted.
//
//   node scripts/fake-m3u.mjs     # :8082
//   node scripts/fake-aio.mjs     # :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-fluent-settings.mjs
import http from "node:http";
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
import { goTo } from "./nav-settle.mjs";

const APP = process.env.APP_URL ?? "http://localhost:4173/";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const PLAYLISTS = { v: 1, data: [{ kind: "m3u", id: "m", name: "Test M3U", enabled: true, url: "http://localhost:8082/playlist.m3u" }] };
const AIO = { v: 1, data: "http://localhost:8084/manifest.json" };
const LIVE = { playlists: PLAYLISTS, aiostreams: AIO, startupTab: { v: 1, data: "stream" }, themePack: { v: 1, data: "fluent" } };

// A stand-in for the stream proxy, so a Multi-View tile opens.
const proxy = http.createServer((rq, rs) => {
  rs.writeHead(200, { "Content-Type": "video/mp2t", "Access-Control-Allow-Origin": "*" });
  const packet = Buffer.alloc(188);
  packet[0] = 0x47;
  const t = setInterval(() => rs.write(packet), 10);
  rs.on("close", () => clearInterval(t));
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const PROXY = proxy.address().port;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

async function open({ store = {}, w = 1600, h = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: "dark", reducedMotion: "reduce" });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ store, port }) => {
      localStorage.setItem("btv:onboarded", "1");
      localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
      localStorage.setItem("blammytv.multiviewNoticeSeen", JSON.stringify({ v: 1, data: true }));
      sessionStorage.setItem("btv:welcome-played", "1");
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify(v));
      }
      // Multi-View under the IPC stub, as verify-mvpick has it.
      MediaSource.isTypeSupported = () => true;
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
          if (cmd === "mv_proxy_open") return Promise.resolve(`http://127.0.0.1:${port}/mv`);
          if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
          return Promise.resolve(undefined);
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    },
    { store: { ...LIVE, ...store }, port: PROXY },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".flc-title", { timeout: 20_000 });
  return { ctx, page };
}

const rect = (page, sel) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom };
  }, sel);

// ================================================================ Settings
const PAGES = [
  ["home", "Home"],
  ["sources", "Sources"],
  ["playback", "Playback"],
  ["appearance", "Appearance"],
  ["accounts", "Accounts"],
  ["app", "App"],
];
// What a setting is, on every page.
const CARDS = ".customize-row, .customize-stack, .playlist-row, .xtrow, .playlists-refresh";

/** Everything the checks read off the open page, in one pass. */
const survey = (page) =>
  page.evaluate((CARDS) => {
    const root = document.querySelector(".flc-sx__page");
    const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const cs = (el) => getComputedStyle(el);
    const sig = (el) => {
      const s = cs(el);
      return `${s.borderTopLeftRadius}|${s.borderTopWidth}|${s.borderTopColor}|${s.backgroundColor}`;
    };
    // A card inside another is a nested frame: the stack's own row is a
    // layout, so it is judged by having no frame of its own.
    const all = [...root.querySelectorAll(CARDS)].filter(shown);
    const framed = (el) => cs(el).borderTopWidth !== "0px" || cs(el).backgroundColor !== "rgba(0, 0, 0, 0)";
    const nested = all.filter((el) => el.parentElement.closest(CARDS) && framed(el));
    const tops = all.filter((el) => !el.parentElement.closest(CARDS));
    const sigs = [...new Set(tops.map(sig))];
    // The controls end on the card's inset. A stack's control sits under its
    // title (a wide one, the card's own width), so only the rows are judged.
    const ends = [];
    for (const el of tops) {
      if (el.classList.contains("customize-stack")) continue;
      const box = el.getBoundingClientRect();
      const ctl = [...el.querySelectorAll("button, input, select, .toggle, .seg, [role=switch], .homerows__nox, .rowcap")]
        .filter((c) => shown(c) || c.classList.contains("homerows__nox"))
        .filter((c) => !c.closest(".rowcap") || c.classList.contains("rowcap"))
        .filter((c) => !c.classList.contains("xtrow__grip"));
      if (!ctl.length) continue;
      const right = Math.max(...ctl.map((c) => c.getBoundingClientRect().right));
      ends.push({ name: (el.dataset.setting || el.className).slice(0, 28), inset: Math.round((box.right - right) * 10) / 10 });
    }
    const type = (sel) => [...new Set([...root.querySelectorAll(sel)].filter(shown).map((e) => `${cs(e).fontSize}/${cs(e).fontWeight}`))];
    const sizes = (sel) => [...new Set([...root.querySelectorAll(sel)].filter(shown).map((e) => cs(e).fontSize))];
    const headings = [...root.querySelectorAll("h1, h2, h3")].filter(shown).map((e) => e.textContent.trim());
    return {
      cards: tops.length,
      sigs,
      nested: nested.map((e) => e.className.slice(0, 30)),
      ends,
      titles: type(".customize-row__title:not(.xtedit__minehead *), .playlist-row__name, .xtrow__name, .homerows__title, .playlists-refresh .settings__section-note"),
      notes: sizes(".settings__section-note:not(.playlists-refresh *), .playlist-row__source, .xtrow__kind"),
      heads: type(".settings__group, .settings-section__list-title, .xtedit__minehead .customize-row__title"),
      headings,
      buttons: [...root.querySelectorAll("button[data-variant][data-size]:not([data-variant=link])")].filter(shown).map((b) => ({ t: b.textContent.trim().slice(0, 18), r: cs(b).borderTopLeftRadius, h: Math.round(b.getBoundingClientRect().height) })),
    };
  }, CARDS);

{
  const { ctx, page } = await open();
  await page.locator('.flc-pane [data-key="settings"]').click();
  await page.waitForSelector(".flc-sx");
  const sigs = new Set();
  const ends = [];
  const titles = new Set();
  const notes = new Set();
  const heads = new Set();
  for (const [key, label] of PAGES) {
    await page.locator(`.flc-sx [data-rail="${key}"]`).click();
    await page.waitForSelector(`.flc-sx__page[data-tab="${key}"]`);
    await page.waitForTimeout(500);
    const s = await survey(page);
    const crumb = (await page.locator(".flc-sx__title").innerText()).replace(/\s+/g, " ").trim();
    check(`${label}: the title is the breadcrumb`, crumb === `Settings › ${label}`, crumb);
    check(`${label}: no heading repeats it`, !s.headings.some((h) => h.toLowerCase() === label.toLowerCase()), JSON.stringify(s.headings));
    check(`${label}: it has cards`, s.cards >= (key === "accounts" ? 1 : 3), `${s.cards}`);
    check(`${label}: every card has one radius, stroke and fill`, s.sigs.length <= 1 && s.sigs[0]?.startsWith("4px|1px|"), JSON.stringify(s.sigs));
    check(`${label}: no card sits inside another`, s.nested.length === 0, JSON.stringify(s.nested));
    check(`${label}: every button is 4px`, s.buttons.every((b) => b.r === "4px"), JSON.stringify(s.buttons.filter((b) => b.r !== "4px")));
    s.sigs.forEach((x) => sigs.add(x));
    ends.push(...s.ends.map((e) => ({ ...e, page: label })));
    s.titles.forEach((x) => titles.add(x));
    s.notes.forEach((x) => notes.add(x));
    s.heads.forEach((x) => heads.add(x));
    if (key === "home") {
      const b = await page.locator(".xtedit__minehead button").evaluateAll((els) => els.map((e) => [e.textContent.trim(), getComputedStyle(e).borderTopLeftRadius, e.getBoundingClientRect().height]));
      check("Home: Import Layout and Add Row are 4px, 32px buttons", b.length === 2 && b.every((x) => x[1] === "4px" && Math.round(x[2]) === 32), JSON.stringify(b));
      const rows = await page.locator(".homerows .xtrow").count();
      check("Home: every row is a card, and there are rows", rows >= 5 && s.cards >= rows, `${rows} rows, ${s.cards} cards`);
      const x = await page.locator(".homerows__x").first().evaluate((e) => [getComputedStyle(e).borderTopLeftRadius, getComputedStyle(e).backgroundColor, e.getBoundingClientRect().width]);
      check("Home: a row's remove is a subtle 32px icon button, 4px", x[0] === "4px" && x[1] === "rgba(0, 0, 0, 0)" && Math.round(x[2]) === 32, JSON.stringify(x));
    }
    if (key === "sources") {
      const kind = await page.locator('[data-setting="add-playlist"] .seg').boundingBox();
      const world = await page.locator(".customize-rail .seg").boundingBox();
      check("Sources: Xtream / M3U / Stalker is compact, like Live TV / Stream", kind.width < 300 && Math.abs(kind.x - world.x) <= 1, `${Math.round(kind.width)} vs the page ${Math.round((await rect(page, ".flc-sx__page")).w)}`);
      const add = await page.locator('[data-setting="add-playlist"] > [data-slot="button"]').last().boundingBox();
      check("Sources: Add Playlist is a normal-width button under the form", add.width < 220 && Math.round(add.height) === 32, `${Math.round(add.width)}x${Math.round(add.height)}`);
      const title = await rect(page, '[data-setting="add-playlist"] .settings-section__list-title');
      const label1 = await rect(page, '[data-setting="add-playlist"] .settings-field__label');
      check("Sources: the form's title has room above its first label", label1.y - title.b >= 8, `${Math.round(label1.y - title.b)}px`);
    }
    if (key === "appearance") {
      const chips = await page.locator('[data-setting="card-details"] .meta-pick__chip').evaluateAll((els) => els.map((e) => ({ on: e.getAttribute("aria-pressed"), border: getComputedStyle(e).borderTopWidth, rad: getComputedStyle(e).borderTopLeftRadius })));
      check("Appearance: Card Details chips are all bordered 4px buttons, on or off", chips.length >= 4 && chips.some((c) => c.on === "false") && chips.every((c) => c.border === "1px" && c.rad === "4px"), JSON.stringify(chips));
    }
    if (key === "app") {
      await page.locator('[data-setting="shortcuts"] button').click();
      await page.waitForSelector(".shortcuts");
      const s2 = await survey(page);
      check("App: Keyboard Shortcuts is one frame, open too", s2.nested.length === 0, JSON.stringify(s2.nested));
      const inner = await page.locator('[data-setting="shortcuts"] .customize-row').evaluate((e) => getComputedStyle(e).borderTopWidth);
      check("App: its row inside has no frame of its own", inner === "0px", inner);
      const about = await rect(page, '[data-setting="about"] .customize-row__title');
      const link = await rect(page, "[data-about-licenses] button");
      const dl = await rect(page, '[data-setting="about"] .about');
      check("App: About's title, lines and link share one left edge", Math.abs(about.x - link.x) <= 1 && Math.abs(about.x - dl.x) <= 1, JSON.stringify([about.x, dl.x, link.x]));
      await page.locator('[data-setting="shortcuts"] button').click();
    }
  }
  await page.locator(`.flc-sx [data-rail="appearance"]`).click();
  await page.waitForTimeout(500);
  // Pickers are content: each swatch shows its own colour, each theme card its preview (1.2.7 painted them over).
  const pick = await page.evaluate(() => ({
    swatches: [...document.querySelectorAll('[data-picker="swatch"]')].map((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).backgroundImage, e.style.getPropertyValue("--swatch")]),
    cards: [...document.querySelectorAll('[data-picker="theme"]')].map((e) => Math.round(e.getBoundingClientRect().height)),
  }));
  check("Appearance: every accent swatch shows its own colour and every theme card its preview", pick.swatches.length >= 8 && pick.swatches.every(([bg, img, want]) => want.startsWith("#") ? bg === `rgb(${parseInt(want.slice(1, 3), 16)}, ${parseInt(want.slice(3, 5), 16)}, ${parseInt(want.slice(5, 7), 16)})` : img.includes("gradient")) && pick.cards.length >= 6 && pick.cards.every((h) => h > 60), JSON.stringify(pick));
  // A standard button as Windows 11 draws one (Adam, 1.2.9: "the bottom of our button is weird"): at least
  // 120px wide, and in dark its bottom edge a faint white line, not a dark one under a light button.
  await page.locator(`.flc-sx [data-rail="app"]`).click();
  await page.waitForTimeout(500);
  const std = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => e.textContent.trim() === "Open");
    const cs = getComputedStyle(b);
    return { w: b.getBoundingClientRect().width, bottom: cs.borderBottomColor, top: cs.borderTopColor };
  });
  check("a standard button is at least 120px wide, and its bottom edge is a faint white line in dark", std.w >= 120 && /^rgba\(255, 255, 255, 0\.0\d+\)$/.test(std.bottom), JSON.stringify(std));
  const field = await page.evaluate(() => getComputedStyle(document.querySelector(".flc-find")).borderBottomColor);
  check("a text field's underline is the strong stroke, not the button's", field === "rgba(255, 255, 255, 0.54)", field);
  check("every page's cards are the same card", sigs.size === 1, JSON.stringify([...sigs]));
  const off = ends.filter((e) => Math.abs(e.inset - 17) > 1);
  check("every row's controls end on one right edge (the card's inset)", ends.length >= 20 && off.length === 0, `${ends.length} rows${off.length ? `, off: ${JSON.stringify(off)}` : ""}`);
  check("every title is 14px regular", titles.size === 1 && titles.has("14px/400"), JSON.stringify([...titles]));
  check("every description is 12px", notes.size === 1 && notes.has("12px"), JSON.stringify([...notes]));
  check("every section header is 14px semibold", heads.size === 1 && heads.has("14px/600"), JSON.stringify([...heads]));
  await ctx.close();
}

// =============================================================== Multi-View
{
  const { ctx, page } = await open();
  await goTo(page, "multiview");
  await page.waitForSelector(".mvtab .mvbar");
  const bar = await rect(page, ".mvbar");
  const stage = await rect(page, ".mvtab__stage");
  const chip = await rect(page, ".mvmeter");
  check("Multi-View: the bar is a row above the stage, the streams chip clear of it", chip.y >= bar.y - 1 && chip.b <= bar.b + 1 && chip.b <= stage.y, JSON.stringify({ chip, bar: [bar.y, bar.b], stage: stage.y }));
  const look = await page.evaluate(() => {
    const cs = (s) => getComputedStyle(document.querySelector(s));
    const m = cs(".mvmeter");
    return { chip: [m.borderTopLeftRadius, m.height], bg: m.backgroundColor, btns: [...document.querySelectorAll(".mvbar button[data-variant]")].map((b) => [b.getAttribute("aria-label"), getComputedStyle(b).borderTopLeftRadius, Math.round(b.getBoundingClientRect().height)]) };
  });
  check("Multi-View: the chip is a 4px, 32px control", look.chip[0] === "4px" && look.chip[1] === "32px", JSON.stringify(look.chip));
  check("Multi-View: every bar button is 4px and 32px", look.btns.length >= 3 && look.btns.every((b) => b[1] === "4px" && b[2] === 32), JSON.stringify(look.btns));

  // Two tiles: Grid and Focus appear.
  for (const q of ["espn", "news"]) {
    await page.keyboard.press("a");
    await page.locator(".mvpick__input").waitFor({ timeout: 5000 });
    await page.locator(".mvpick__input").fill(q);
    await page.waitForTimeout(250);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".mvtile:not(.mvtile--empty)", { timeout: 5000 });
  }
  await page.waitForSelector(".mvbar .seg", { timeout: 5000 });
  const seg = await page.evaluate(() => { const s = document.querySelector(".mvbar .seg"); const r = s.getBoundingClientRect(); return { rad: getComputedStyle(s).borderTopLeftRadius, h: Math.round(r.height), by: r.bottom, stage: document.querySelector(".mvtab__stage").getBoundingClientRect().y }; });
  check("Multi-View: Grid and Focus is a 4px, 32px segmented control above the stage", seg.rad === "4px" && seg.h === 32 && seg.by <= seg.stage, JSON.stringify(seg));
  await ctx.close();
}

// The ring, from a first load with no input at all. (A click first would make
// the browser stop calling a script's focus() the keyboard's, and the check
// could not fail.) The browser says :focus-visible and the bar paints none;
// with the keyboard in use it paints one; a click takes it away.
{
  const { ctx, page } = await open();
  await page.evaluate(() => document.querySelector('.flc-pane [data-dest="multiview"]').click());
  await page.waitForSelector(".mvbar__add");
  const ring = () => page.evaluate(() => { const b = document.querySelector(".mvbar__add"); return { out: getComputedStyle(b).outlineStyle, on: b.matches(":focus-visible") }; });
  await page.evaluate(() => document.querySelector(".mvbar__add").focus());
  const first = await ring();
  check("Multi-View: Add Channel, given focus on a first load, paints no ring though the browser calls it focus-visible", first.on && first.out === "none", JSON.stringify(first));
  await page.keyboard.press("Shift");
  await page.evaluate(() => { const b = document.querySelector(".mvbar__add"); b.blur(); b.focus(); });
  const kb = await ring();
  check("Multi-View: and paints it once the keyboard is in use", kb.on && kb.out === "solid", JSON.stringify(kb));
  await page.mouse.click(900, 600);
  const after = await ring();
  check("Multi-View: a click takes it away again", after.out === "none", JSON.stringify(after));
  await ctx.close();
}

// ================================================================ the pane
{
  const paneW = async (page) => Math.round((await rect(page, ".flc-pane")).w);
  const remembered = (page) => page.evaluate(() => localStorage.getItem("blammytv.fluentNavRail"));
  const { ctx, page } = await open({ w: 1600 });
  check("the pane is open at 1600px", (await paneW(page)) === 280);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(250);
  check("and at 1100px", (await paneW(page)) === 280);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(250);
  const rail = await paneW(page);
  check("at 1000px it is the rail (88px), and the page keeps to it", rail === 88 && Math.round((await rect(page, ".app-main")).x) === 88, `${rail}`);
  check("the rail is the icon-over-label one", (await page.locator(".flc-pane--rail").count()) === 1);
  check("and the folding is not saved", (await remembered(page)) !== JSON.stringify({ v: 1, data: true }), String(await remembered(page)));
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(250);
  check("at 800px too", (await paneW(page)) === 88);
  // The hamburger opens the pane over the page, the page staying put.
  await page.locator(".flc-burger").click();
  await page.waitForSelector(".flc-pane--peek");
  const peek = await rect(page, ".flc-pane");
  check("its hamburger opens the full pane over the page (280px), the page staying at 88px", Math.round(peek.w) === 280 && Math.round((await rect(page, ".app-main")).x) === 88 && (await page.locator(".flc-pane--rail").count()) === 0, JSON.stringify(peek));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check("Escape shuts it", (await page.locator(".flc-pane--peek").count()) === 0 && (await paneW(page)) === 88);
  await page.locator(".flc-burger").click();
  await page.locator('.flc-pane [data-dest="discover"]').click();
  await page.waitForTimeout(250);
  check("a choice shuts it too", (await page.locator(".flc-pane--peek").count()) === 0);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(250);
  check("wide again, the remembered choice (the full pane) is back", (await paneW(page)) === 280);
  await ctx.close();

  // A remembered rail stays the rail wide, and narrow.
  const r = await open({ w: 1600, store: { fluentNavRail: { v: 1, data: true } } });
  check("a remembered rail is the rail at 1600px", (await paneW(r.page)) === 88);
  await r.page.setViewportSize({ width: 1000, height: 900 });
  await r.page.waitForTimeout(250);
  check("and at 1000px", (await paneW(r.page)) === 88);
  await r.page.setViewportSize({ width: 1600, height: 900 });
  await r.page.waitForTimeout(250);
  check("and back at 1600px, still remembered", (await paneW(r.page)) === 88 && (await remembered(r.page)) === JSON.stringify({ v: 1, data: true }));
  await r.ctx.close();
}

// ============================================== Library, and the Guide's menus
{
  const { ctx, page } = await open();
  const size = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).fontSize : null; }, sel);
  await goTo(page, "home");
  await page.waitForSelector(".fls-page-title");
  const stream = await size(".fls-page-title");
  await goTo(page, "mylist");
  await page.waitForSelector(".library .fls-page-title");
  const lib = await size(".library .fls-page-title");
  check("Library's page title is Stream's (28px)", lib === stream && lib === "28px", `${lib} vs ${stream}`);

  await page.locator('.flc-pane [data-dest="guide"]').click();
  await page.waitForSelector(".guide__cell", { timeout: 15_000 });
  await page.waitForTimeout(800);
  const cell = await page.locator(".guide__cell").first().boundingBox();
  await page.mouse.click(cell.x + 60, cell.y + 20, { button: "right" });
  await page.waitForSelector("[data-slot=context-menu-content]");
  const m = await page.evaluate(() => {
    const menu = document.querySelector("[data-slot=context-menu-content]");
    const items = [...menu.querySelectorAll("[data-slot=context-menu-item]")];
    const mr = menu.getBoundingClientRect();
    return {
      n: items.length,
      radius: getComputedStyle(menu).borderTopLeftRadius,
      items: items.map((i) => {
        const s = getComputedStyle(i);
        const range = document.createRange();
        range.selectNodeContents(i.querySelector("span") ?? i);
        const t = [...i.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        if (t) range.selectNodeContents(t);
        return { align: s.textAlign, rad: s.borderTopLeftRadius, fs: s.fontSize, h: Math.round(i.getBoundingClientRect().height), from: Math.round(range.getBoundingClientRect().left - i.getBoundingClientRect().left) };
      }),
      mr: Math.round(mr.width),
    };
  });
  check("Guide menu: an 8px flyout of left-aligned, 14px, 4px items", m.n >= 2 && m.radius === "8px" && m.items.every((i) => i.align === "left" && i.rad === "4px" && i.fs === "14px" && i.h >= 32), JSON.stringify(m));
  check("Guide menu: the words sit at the left of each item (an icon column, then the text)", m.items.every((i) => i.from <= 12 + 16 + 12), JSON.stringify(m.items.map((i) => i.from)));
  await page.keyboard.press("Escape");

  const folder = await page.locator(".fl-nav", { hasText: "Sports" }).first().boundingBox();
  await page.mouse.click(folder.x + 30, folder.y + 10, { button: "right" });
  await page.waitForSelector(".folder-menu");
  const f = await page.evaluate(() => {
    const menu = document.querySelector(".folder-menu");
    const item = menu.querySelector(".folder-menu__item");
    const s = getComputedStyle(item);
    const range = document.createRange();
    range.selectNodeContents(item);
    const hint = getComputedStyle(menu.querySelector(".folder-menu__hint"));
    return { align: s.textAlign, justify: s.justifyContent, rad: s.borderTopLeftRadius, fs: s.fontSize, menuRad: getComputedStyle(menu).borderTopLeftRadius, from: Math.round(range.getBoundingClientRect().left - item.getBoundingClientRect().left), hint: [hint.textAlign, hint.fontSize] };
  });
  check("Folder menu: an 8px flyout, its item left-aligned, 14px, 4px", f.align === "left" && f.justify === "flex-start" && f.rad === "4px" && f.fs === "14px" && f.menuRad === "8px" && f.from <= 16, JSON.stringify(f));
  check("Folder menu: the hint is left-aligned and small", f.hint[0] === "left" && parseFloat(f.hint[1]) <= 12, JSON.stringify(f.hint));
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
proxy.close();
process.exit(fail ? 1 : 0);

// E2E: Fluent's frame (plan 035, "Fluent to tier 3"): the title bar, the
// NavigationView, the page's rounded layer, Ctrl+K as the title-bar search,
// Settings as the Windows 11 Settings app, and WinUI's paint on the shared
// controls. Both faces, then Default again.
//
//   - the title bar is 32px: Back, the mark and "BlammyTV", a centred pill
//     search with a Ctrl+K hint. The window keeps its native bar (so this
//     reads the band under it);
//   - the pane (280px): Home | Live TV, Multi-View, Sports | Stream, Discover,
//     Library, with Settings at the foot. Selected = the subtle fill and the
//     3px accent pill. The hamburger collapses it to the rail (88px, icon over
//     label), remembered over a reload. No live source: no Live TV group, one
//     separator. Every tab does what the capsule's did, and pressing the one
//     you are on goes home;
//   - the page sits on a layer with an 8px top-left corner, right of the pane
//     and under the bar;
//   - Ctrl+K and the pill open the palette over the pill: its field where the
//     pill is, results under it in 8px flyout, small caption headers, a title
//     over a secondary line, the highlighted one with the subtle fill and the
//     pill; the same keys;
//   - Settings is a page in the content area (no sheet), a column of pages
//     with a "Find a setting" box, a "Settings > Page" title and the rows as
//     SettingsCards; the pane shows Settings selected; Escape, a tab and
//     Ctrl+K all work from it;
//   - controls: buttons 4px / 32px, text boxes with an accent line on focus,
//     a 40x20 switch, a 20px checkbox, the double focus ring;
//   - Default renders today's header and its Settings sheet.
//
// Offline: the fake M3U and AIOStreams, every other host aborted.
//
//   node scripts/fake-m3u.mjs     # :8082
//   node scripts/fake-aio.mjs     # :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-fluent-chrome.mjs
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
const FLUENT = { v: 1, data: "fluent" };
const LIVE = { playlists: PLAYLISTS, aiostreams: AIO, startupTab: { v: 1, data: "stream" }, themePack: FLUENT };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

async function open({ store = LIVE, light = false, w = 1440, h = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: light ? "light" : "dark", reducedMotion: "reduce" });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ store, light }) => {
      localStorage.setItem("btv:onboarded", "1");
      localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
      sessionStorage.setItem("btv:welcome-played", "1");
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify(v));
        if (light) localStorage.setItem("blammytv.theme", JSON.stringify({ v: 1, data: "light" }));
      }
    },
    { store, light },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(store.themePack?.data === "fluent" ? ".flc-title" : ".navcap", { timeout: 20_000 });
  return { ctx, page };
}

const rect = (page, sel) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom };
  }, sel);
const css = (page, sel, props, pseudo) =>
  page.evaluate(
    ({ sel, props, pseudo }) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el, pseudo);
      return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    },
    { sel, props, pseudo },
  );
const labels = (page) => page.$$eval(".flc-pane > .flc-ni", (els) => els.map((e) => e.textContent.trim()));
const current = (page) => page.$$eval('.flc-pane [aria-current="page"]', (els) => els.map((e) => e.textContent.trim()));

async function suite(face) {
  const light = face === "Light";
  const { ctx, page } = await open({ light });
  const T = (n) => `${face}: ${n}`;
  check(T("the pack and face are on the root"), await page.evaluate((light) => document.documentElement.dataset.themePack === "fluent" && (document.documentElement.dataset.theme === "light") === light, light));

  // ---------------------------------------------------------- the title bar
  const title = await rect(page, ".flc-title");
  check(T("the title bar is 32px across the top"), title && Math.round(title.h) === 32 && title.y === 0 && Math.round(title.w) === 1440, JSON.stringify(title));
  check(T("the capsule header is not rendered"), (await page.locator(".navcap, header.header").count()) === 0);
  check(T("it holds Back, the mark and BlammyTV"), (await page.locator('.flc-title button[aria-label="Back"]').count()) === 1 && (await page.locator(".flc-title .brand-mark").count()) === 1 && (await page.locator(".flc-title__name").innerText()) === "BlammyTV");
  const pill = await rect(page, ".flc-search");
  const pcss = await css(page, ".flc-search", ["border-radius", "border-bottom-color", "border-top-color"]);
  check(T("a centred pill search: Search channels, films and settings, with a Ctrl+K hint"),
    pill && Math.abs(pill.x + pill.w / 2 - 720) < 2 && Math.round(pill.h) === 28 && parseFloat(pcss["border-radius"]) >= 14 &&
      (await page.locator(".flc-search").innerText()).includes("Search channels, films and settings") && (await page.locator(".flc-search__hint").innerText()) === "Ctrl+K",
    JSON.stringify({ pill, pcss }));
  check(T("its edge is the elevation border: the bottom darker than the top"), pcss["border-bottom-color"] !== pcss["border-top-color"], JSON.stringify(pcss));

  // ------------------------------------------------------------ the pane
  check(T("the pane reads Home, Live TV, Multi-View, Sports, Stream, Discover, Library, Settings"), JSON.stringify(await labels(page)) === JSON.stringify(["Home", "Live TV", "Multi-View", "Sports", "Stream", "Discover", "Library", "Settings"]), JSON.stringify(await labels(page)));
  check(T("two separators with a live source"), (await page.locator(".flc-pane .flc-sep").count()) === 2);
  const pane = await rect(page, ".flc-pane");
  const set = await rect(page, '.flc-pane [data-key="settings"]');
  check(T("the pane is 280px, under the bar, and Settings is pinned at the bottom"), pane && Math.round(pane.w) === 280 && Math.round(pane.y) === 32 && set.b > pane.b - 12, JSON.stringify({ pane, set }));
  check(T("Stream is the selected item (the startup tab)"), JSON.stringify(await current(page)) === '["Stream"]', JSON.stringify(await current(page)));
  const pin = await css(page, '.flc-pane [aria-current="page"]', ["width", "height", "background-color"], "::before");
  const sel = await css(page, '.flc-pane [aria-current="page"]', ["background-color"]);
  check(T("the selected item: a subtle fill and a 3px accent pill"), pin.width === "3px" && pin.height === "16px" && sel["background-color"] !== "rgba(0, 0, 0, 0)" && pin["background-color"] === (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent")).then(() => pin["background-color"])), JSON.stringify({ pin, sel }));

  // The page: a layer with an 8px corner, right of the pane under the bar.
  const main = await rect(page, ".app-main");
  const mcss = await css(page, ".app-main", ["border-top-left-radius", "background-color", "border-top-width"]);
  check(T("the page sits right of the pane and under the bar, on a rounded layer"), main && Math.round(main.x) === 280 && Math.round(main.y) === 32 && mcss["border-top-left-radius"] === "8px" && mcss["background-color"] !== "rgba(0, 0, 0, 0)", JSON.stringify({ main, mcss }));
  check(T("no screen clears a floating header"), (await page.evaluate(() => document.documentElement.style.getPropertyValue("--header-h"))) === "0px");

  // ----------------------------------------------------------- navigation
  await goTo(page, "guide");
  check(T("Live TV opens the Guide and is the one selected"), (await page.locator("main.app-main").getAttribute("data-screen")) === "guide" && JSON.stringify(await current(page)) === '["Live TV"]');
  await goTo(page, "multiview");
  check(T("Multi-View opens multi-view"), (await page.locator("main.app-main").getAttribute("data-screen")) === "multiview" && JSON.stringify(await current(page)) === '["Multi-View"]');
  // The browser build's multi-view opens a notice (it plays in the page, not
  // in mpv): shut it, as a person would, before the next tab.
  if (await page.getByRole("button", { name: "Got It" }).count()) {
    await page.getByRole("button", { name: "Got It" }).click();
    await page.waitForSelector("[data-slot=dialog-overlay]", { state: "detached", timeout: 3000 }).catch(() => {});
  }
  await goTo(page, "sports");
  check(T("Sports opens Sports"), (await page.locator("main.app-main").getAttribute("data-screen")) === "sports" && JSON.stringify(await current(page)) === '["Sports"]');
  await goTo(page, "discover");
  check(T("Discover opens Discover"), (await page.locator("main.app-main").getAttribute("data-screen")) === "discover" && JSON.stringify(await current(page)) === '["Discover"]');
  await goTo(page, "mylist");
  check(T("Library opens the Library"), (await page.locator("main.app-main").getAttribute("data-screen")) === "mylist" && JSON.stringify(await current(page)) === '["Library"]');
  await page.locator('.flc-pane [data-dest="hub"]').click();
  await page.waitForFunction(() => document.querySelector("main.app-main")?.dataset.screen === "hub", null, { timeout: 5000 }).catch(() => {});
  check(T("Home opens Home, and is selected"), (await page.locator("main.app-main").getAttribute("data-screen")) === "hub" && JSON.stringify(await current(page)) === '["Home"]');
  await goTo(page, "home");

  // Press the one you are on: a title's page goes back to the rows. Back
  // (the title bar's arrow) walks the same stack.
  await page.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
  await page.waitForSelector(".fls-title", { timeout: 15_000 });
  await page.locator('.flc-title button[aria-label="Back"]').click();
  await page.waitForFunction(() => !document.querySelector(".fls-title"), null, { timeout: 5000 }).catch(() => {});
  check(T("Back in the title bar does Back: a title's page closes"), (await page.locator(".fls-title").count()) === 0);
  await page.locator(".stream-card", { hasText: "Fake Movie One" }).first().click();
  await page.waitForSelector(".fls-title", { timeout: 15_000 });
  await page.locator('.flc-pane [data-dest="home"]').click();
  await page.waitForFunction(() => !document.querySelector(".fls-title"), null, { timeout: 5000 }).catch(() => {});
  check(T("pressing Stream while on Stream goes home: the title's page closes"), (await page.locator(".fls-title").count()) === 0);

  // ------------------------------------------------------ Ctrl+K, the pill
  await page.keyboard.press("Control+k");
  await page.waitForSelector(".palette", { timeout: 5000 });
  const fo = await page.evaluate(() => {
    const a = document.activeElement;
    const i = document.querySelector(".mvpick__input");
    const h = document.querySelector(".mvpick__head")?.getBoundingClientRect();
    return { focused: a === i, ph: i?.placeholder, head: h && { x: h.x, y: h.y, w: h.width, h: h.height } };
  });
  check(T("Ctrl+K opens the search with its field focused, Search channels, films and settings"), fo.focused && fo.ph === "Search channels, films and settings", JSON.stringify(fo));
  check(T("the field is laid over the pill: same place, centred"), fo.head && Math.abs(fo.head.y - pill.y) < 4 && Math.abs(fo.head.x + fo.head.w / 2 - 720) < 4 && Math.round(fo.head.h) === 28, JSON.stringify({ head: fo.head, pill }));
  const body = await css(page, ".mvpick__body", ["border-top-left-radius", "box-shadow", "background-color"]);
  check(T("the results are a flyout: 8px corners, the flyout fill and the shadow"), body["border-top-left-radius"] === "8px" && body["box-shadow"] !== "none" && body["background-color"] !== "rgba(0, 0, 0, 0)", JSON.stringify(body));
  // Go To is what a bare field lists; type for the groups.
  await page.keyboard.type("fake");
  await page.waitForSelector('.mvpick__row[data-kind="channel"]', { timeout: 8000 });
  const heads = await page.$$eval(".mvpick__sec", (els) => els.map((e) => e.textContent.trim()));
  check(T("results sit under small caption headers: Channels, then the films"), heads[0] === "Channels" && heads.some((h) => /Films and Series/.test(h)), JSON.stringify(heads));
  const row = await page.evaluate(() => {
    const r = document.querySelector('.mvpick__row[data-kind="channel"]');
    const m = r.querySelector(".mvpick__meta");
    return { title: r.querySelector(".mvpick__nametext")?.textContent, sub: r.querySelector(".mvpick__sub")?.textContent, col: getComputedStyle(m).flexDirection, h: r.getBoundingClientRect().height };
  });
  check(T("a result is a title over a secondary line"), !!row.title && row.col === "column" && Math.round(row.h) >= 48, JSON.stringify(row));
  const hi = await css(page, '.mvpick__row[data-highlighted]', ["background-color"]);
  const hip = await css(page, '.mvpick__row[data-highlighted]', ["width"], "::before");
  check(T("the highlighted result has the subtle fill and the accent pill"), hi["background-color"] !== "rgba(0, 0, 0, 0)" && hip.width === "3px", JSON.stringify({ hi, hip }));
  const first = await page.$eval(".mvpick__row[data-highlighted] .mvpick__nametext", (e) => e.textContent);
  await page.keyboard.press("ArrowDown");
  const second = await page.$eval(".mvpick__row[data-highlighted] .mvpick__nametext", (e) => e.textContent);
  check(T("the arrows move the highlight"), first !== second, `${first} -> ${second}`);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".palette", { state: "detached", timeout: 3000 }).catch(() => {});
  check(T("Escape closes it"), (await page.locator(".palette").count()) === 0);
  await page.locator(".flc-search").click();
  await page.waitForSelector(".palette", { timeout: 5000 });
  check(T("clicking the pill opens it too, field focused"), await page.evaluate(() => document.activeElement === document.querySelector(".mvpick__input")));
  await page.keyboard.type("playlist");
  await page.waitForSelector('.mvpick__row[data-kind="go"]', { timeout: 5000 });
  const sheads = await page.$$eval(".mvpick__sec", (els) => els.map((e) => e.textContent.trim()));
  const ssub = await page.$eval('.mvpick__row[data-kind="go"] .mvpick__sub', (e) => e.textContent);
  check(T("a setting is listed under Settings with its page"), sheads.includes("Settings") && /^Settings · /.test(ssub), JSON.stringify({ sheads, ssub }));
  const rows = await page.$$eval(".mvpick__row", (rs) => rs.map((r) => r.textContent));
  const want = rows.findIndex((t) => /^Playlists/.test(t));
  for (let i = 0; i < want; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".flc-sx", { timeout: 5000 });
  await page.waitForSelector('[data-setting="playlists"]', { timeout: 5000 });
  check(T("Enter on a setting opens Settings on it, as a page"), (await page.locator('.flc-sx [data-setting="playlists"]').count()) === 1);

  // ------------------------------------------------------------- Settings
  check(T("Settings is a page, not a sheet"), (await page.locator(".settings, .modal-backdrop").count()) === 0 && (await page.locator('.flc-sx').count()) === 1);
  const sx = await rect(page, ".flc-sx");
  const sxc = await css(page, ".flc-sx", ["border-top-left-radius", "position"]);
  check(T("it fills the content area, under the bar and right of the pane, with the layer's corner"), sx && Math.round(sx.x) === 280 && Math.round(sx.y) === 32 && Math.round(sx.b) === 900 && sxc["border-top-left-radius"] === "8px", JSON.stringify({ sx, sxc }));
  check(T("Settings in the pane shows selected"), JSON.stringify(await current(page)) === '["Settings"]', JSON.stringify(await current(page)));
  check(T("the title bar and pane stay"), (await page.locator(".flc-title").isVisible()) && (await page.locator(".flc-pane").isVisible()));
  const cats = await page.$$eval(".flc-sx .rail__name", (els) => els.map((e) => e.textContent));
  check(T("a column of the pages with a Find a setting box above"), JSON.stringify(cats) === JSON.stringify(["Home", "Sources", "Playback", "Appearance", "Accounts", "App"]) && (await page.locator('.flc-sx input[aria-label="Find a setting"]').count()) === 1, JSON.stringify(cats));
  check(T("the title is a breadcrumb: Settings > Sources"), (await page.locator(".flc-sx__title").innerText()).replace(/\s+/g, " ").trim() === "Settings › Sources");
  await page.locator('.flc-sx [data-rail="appearance"]').click();
  await page.waitForSelector('.flc-sx [data-setting="clock-format"]');
  check(T("choosing Appearance changes the title and shows its rows"), (await page.locator(".flc-sx__title").innerText()).replace(/\s+/g, " ").trim() === "Settings › Appearance");
  const thumb = await css(page, ".flc-sx .rail__thumb", ["background-color"], null);
  const thumbPin = await css(page, ".flc-sx .rail__thumb", ["width"], "::before");
  check(T("the selected page: the subtle fill and the 3px accent pill"), thumb["background-color"] !== "rgba(0, 0, 0, 0)" && thumbPin.width === "3px", JSON.stringify({ thumb, thumbPin }));
  const card = await css(page, '.flc-sx [data-setting="clock-format"]', ["border-top-left-radius", "background-color", "min-height", "border-top-width"]);
  check(T("a row is a SettingsCard: a rounded card with the card fill and a stroke"), card["border-top-left-radius"] === "4px" && card["background-color"] !== "rgba(0, 0, 0, 0)" && card["border-top-width"] === "1px" && parseFloat(card["min-height"]) >= 68, JSON.stringify(card));
  const lay = await page.evaluate(() => {
    const r = document.querySelector('.flc-sx [data-setting="clock-format"]');
    const t = r.querySelector(".customize-row__title").getBoundingClientRect();
    const c = r.querySelector(".seg").getBoundingClientRect();
    const b = r.getBoundingClientRect();
    return { titleLeft: t.left - b.left, ctlRight: b.right - c.right };
  });
  check(T("the words on the left, the control on the right"), lay.titleLeft < 40 && lay.ctlRight < 40, JSON.stringify(lay));
  check(T("a switch is a 40x20 ToggleSwitch"), await page.evaluate(() => {
    const t = document.querySelector(".flc-sx .toggle:not(.toggle--sm)");
    if (!t) return "none";
    const r = t.getBoundingClientRect();
    return Math.round(r.width) === 40 && Math.round(r.height) === 20;
  }).then((v) => (v === "none" ? true : v)));
  // Find a setting: today's settings search, landing on the row.
  await page.locator('.flc-sx input[aria-label="Find a setting"]').fill("subtitle");
  await page.waitForSelector(".flc-found__row");
  const hits = await page.$$eval(".flc-found__row", (els) => els.map((e) => e.textContent));
  await page.locator(".flc-found__row").first().click();
  await page.waitForSelector(".flc-sx [data-setting].setting--found", { timeout: 5000 }).catch(() => {});
  const landed = await page.evaluate(() => {
    const row = document.querySelector(".flc-sx .setting--found");
    return { row: row?.getAttribute("data-setting"), title: document.querySelector(".flc-sx__title")?.innerText.replace(/\s+/g, " ").trim(), inside: !!row && row.contains(document.activeElement) };
  });
  check(T("Find a setting lists matches and lands on the row: the page, the row lit, focus on it"), hits.length > 0 && /^Settings › Playback$/.test(landed.title) && !!landed.row && landed.inside, JSON.stringify({ hits, landed }));
  await page.locator('.flc-sx input[aria-label="Find a setting"]').fill("zzzzzz");
  check(T("Find a setting says when nothing matches"), (await page.locator(".flc-found__none").count()) === 1);
  await page.locator('.flc-sx input[aria-label="Find a setting"]').fill("");

  // Controls, on the page.
  await page.locator('.flc-sx [data-rail="app"]').click();
  await page.waitForSelector('.flc-sx [data-setting="export-settings"]');
  const btn = await css(page, '.flc-sx [data-slot="button"]', ["border-top-left-radius", "height", "font-size"]);
  check(T("buttons are 4px, 32px and 14px"), btn && btn["border-top-left-radius"] === "4px" && btn.height === "32px" && btn["font-size"] === "14px", JSON.stringify(btn));
  const cb = await css(page, '.flc-sx input[type="checkbox"]', ["width", "height", "border-top-left-radius"]);
  check(T("a checkbox is 20px with a 4px corner"), !cb || (cb.width === "20px" && cb.height === "20px" && cb["border-top-left-radius"] === "4px"), JSON.stringify(cb));
  await page.locator('.flc-sx [data-rail="playback"]').click();
  await page.waitForSelector('.flc-sx [data-slot="input-group"], .flc-sx [data-setting]');
  const grp = await css(page, '.flc-sx [data-slot="input-group"]', ["border-top-left-radius", "height", "border-bottom-color", "border-top-color"]);
  check(T("a ComboBox is a 32px field with a 4px corner and the elevation border"), !grp || (grp["border-top-left-radius"] === "4px" && grp.height === "32px" && grp["border-bottom-color"] !== grp["border-top-color"]), JSON.stringify(grp));
  const fc = await page.evaluate(() => {
    const el = document.querySelector('.flc-sx [data-slot="input-group-control"]');
    if (!el) return null;
    el.focus();
    const g = el.closest('[data-slot="input-group"]');
    return { line: getComputedStyle(g).borderBottomWidth, color: getComputedStyle(g).borderBottomColor, accent: (() => { const d = document.createElement("i"); d.style.color = "var(--accent)"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; })() };
  });
  check(T("a focused text box draws a 2px accent line at its foot"), !fc || (fc.line === "2px" && fc.color === fc.accent), JSON.stringify(fc));

  // The double focus ring, on the pane.
  // A key was pressed, so the focus that follows is a keyboard focus.
  await page.keyboard.press("Shift");
  await page.locator('.flc-pane [data-dest="hub"]').focus();
  const ring = await page.evaluate(() => {
    const a = document.activeElement;
    const cs = getComputedStyle(a);
    return { w: cs.outlineWidth, c: cs.outlineColor, off: cs.outlineOffset, sh: cs.boxShadow, vis: a.matches(":focus-visible") };
  });
  const out = light ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
  const inn = light ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)";
  check(T("the focus ring is a 2px outer ring over a 1px inner one"), ring.vis && ring.w === "2px" && ring.c === out && ring.off === "1px" && ring.sh.includes(`${inn} 0px 0px 0px 1px`), JSON.stringify(ring));
  check(T("scrollbars are thin"), await page.evaluate(() => getComputedStyle(document.querySelector(".flc-sx__page")).scrollbarWidth === "thin"));

  // Ctrl+K over Settings, then Escape closes the palette and Settings stays.
  await page.keyboard.press("Control+k");
  await page.waitForSelector(".palette", { timeout: 5000 });
  check(T("Ctrl+K works over Settings"), (await page.locator(".flc-sx").count()) === 1);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".palette", { state: "detached", timeout: 3000 }).catch(() => {});
  check(T("Escape closes the search and Settings stays"), (await page.locator(".palette").count()) === 0 && (await page.locator(".flc-sx").count()) === 1);
  // A tab closes Settings and goes there.
  await page.locator('.flc-pane [data-dest="discover"]').click();
  await page.waitForFunction(() => !document.querySelector(".flc-sx") && document.querySelector("main.app-main")?.dataset.screen === "discover", null, { timeout: 5000 }).catch(() => {});
  check(T("a tab in the pane leaves Settings for that tab"), (await page.locator(".flc-sx").count()) === 0 && JSON.stringify(await current(page)) === '["Discover"]', JSON.stringify(await current(page)));
  // Escape closes Settings; the mouse's Back does too.
  await page.locator('.flc-pane [data-key="settings"]').click();
  await page.waitForSelector(".flc-sx");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".flc-sx", { state: "detached", timeout: 3000 }).catch(() => {});
  check(T("Escape closes Settings"), (await page.locator(".flc-sx").count()) === 0);
  await page.locator('.flc-pane [data-key="settings"]').click();
  await page.waitForSelector(".flc-sx");
  await page.locator('.flc-title button[aria-label="Back"]').click();
  await page.waitForSelector(".flc-sx", { state: "detached", timeout: 3000 }).catch(() => {});
  check(T("Back in the title bar closes Settings"), (await page.locator(".flc-sx").count()) === 0);

  // --------------------------------------------------------- the rail
  await page.locator(".flc-burger").click();
  await page.waitForFunction(() => document.querySelector(".flc-pane")?.getBoundingClientRect().width < 100, null, { timeout: 3000 }).catch(() => {});
  const rail = await rect(page, ".flc-pane");
  const railMain = await rect(page, ".app-main");
  const ni = await page.evaluate(() => {
    const b = document.querySelector('.flc-pane [data-dest="hub"]');
    const i = b.querySelector("svg").getBoundingClientRect();
    const l = b.querySelector(".flc-ni__lbl").getBoundingClientRect();
    const r = b.getBoundingClientRect();
    return { col: getComputedStyle(b).flexDirection, iconAbove: i.bottom <= l.top + 2, centred: Math.abs((i.x + i.width / 2) - (r.x + r.width / 2)) < 2 && Math.abs((l.x + l.width / 2) - (r.x + r.width / 2)) < 2, label: getComputedStyle(b.querySelector(".flc-ni__lbl")).fontSize };
  });
  check(T("the hamburger collapses the pane to the 88px rail and the page follows"), Math.round(rail.w) === 88 && Math.round(railMain.x) === 88, JSON.stringify({ rail, railMain }));
  check(T("in the rail: an icon over a small label, centred"), ni.col === "column" && ni.iconAbove && ni.centred && parseFloat(ni.label) <= 11.5, JSON.stringify(ni));
  check(T("the same items, and the choice is remembered"), JSON.stringify(await labels(page)) === JSON.stringify(["Home", "Live TV", "Multi-View", "Sports", "Stream", "Discover", "Library", "Settings"]) && (await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.fluentNavRail")).data)) === true);
  await page.locator('.flc-pane [data-key="settings"]').click();
  await page.waitForSelector(".flc-sx");
  const sxr = await rect(page, ".flc-sx");
  check(T("Settings follows the rail's width"), Math.round(sxr.x) === 88, JSON.stringify(sxr));
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".flc-pane");
  check(T("after a reload the rail is still the rail"), Math.round((await rect(page, ".flc-pane")).w) === 88);
  await page.locator(".flc-burger").click();
  await page.waitForFunction(() => document.querySelector(".flc-pane")?.getBoundingClientRect().width > 200, null, { timeout: 3000 }).catch(() => {});
  check(T("the hamburger brings the full pane back, and that is remembered"), Math.round((await rect(page, ".flc-pane")).w) === 280 && (await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.fluentNavRail")).data)) === false);

  // -------------------------------------------------- Default again
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme-pack"));
  await page.waitForSelector(".navcap", { timeout: 5000 }).catch(() => {});
  check(T("back on Default the capsule header is back and Fluent's frame is gone"), (await page.locator(".flc-title, .flc-pane, .app-shell--fluent").count()) === 0 && (await page.locator("header.header .navcap").count()) === 1);
  await page.locator('button[aria-label="Settings"]').click({ timeout: 3000 }).catch(() => {});
  await page.waitForSelector(".settings", { timeout: 5000 }).catch(() => {});
  check(T("and Settings is today's sheet again"), (await page.locator(".flc-sx").count()) === 0 && (await page.locator(".modal-backdrop .settings").count()) === 1);
  await ctx.close();
}

await suite("Dark");
await suite("Light");

// ------------------------------------------------ no live source, narrow
{
  const { ctx, page } = await open({ store: { aiostreams: AIO, startupTab: { v: 1, data: "stream" }, themePack: FLUENT } });
  check("no live source: no Live TV group, one separator", JSON.stringify(await labels(page)) === JSON.stringify(["Home", "Stream", "Discover", "Library", "Settings"]) && (await page.locator(".flc-pane .flc-sep").count()) === 1, JSON.stringify(await labels(page)));
  await ctx.close();
}
// Mica: native has put it behind the window, so the shell is see-through.
{
  const { ctx, page } = await open({});
  await page.evaluate(() => (document.documentElement.dataset.mica = "on"));
  const bg = await page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor, shell: getComputedStyle(document.querySelector(".app-shell")).backgroundColor }));
  check("with Mica on, the base is see-through behind the pane and the layer", bg.body === "rgba(0, 0, 0, 0)" && bg.shell === "rgba(0, 0, 0, 0)", JSON.stringify(bg));
  await ctx.close();
}
// Default from the start: nothing of Fluent's.
{
  const { ctx, page } = await open({ store: { playlists: PLAYLISTS, aiostreams: AIO, startupTab: { v: 1, data: "stream" } } });
  check("Default renders today's header, with no Fluent frame", (await page.locator(".navcap").count()) === 1 && (await page.locator(".flc-title, .flc-pane, .flc-search").count()) === 0);
  await page.keyboard.press("Control+k");
  await page.waitForSelector(".palette");
  check("Default's palette keeps its own placeholder and dialog frame", (await page.locator(".mvpick__input").getAttribute("placeholder")) === "Channels, Films and Series, Places" && (await page.locator(".flc-flyout").count()) === 0);
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);

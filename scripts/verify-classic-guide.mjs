// E2E: Classic's Live TV guide (plan 035, "Classic across the app").
//
// With the Classic pack on, the Live tab is three parts: a folders tree in
// place of the sidebar, a sunken preview frame with the channel's text and
// Watch, Record and Add to Favorites beside it, and the guide's grid drawn as
// Classic (raised time and channel headers, white cells with grey lines, a
// navy selected cell, a red now-line). It is the same Guide: the same rows,
// the same virtualization step, the same data, so the checks that matter are
// that picking, hovering, scrolling and the buttons still do what they did.
// With the pack off, the normal sidebar and hero are back.
//
// The pack is switched on the root directly (the pack itself is a separate
// piece of work), and the native player's hole is not exercised here: only
// that #player-slot is still the one slot, inside the frame.
//
//   node scripts/fake-panel.mjs     # :8081
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-classic-guide.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");

const URL = process.env.APP_URL ?? "http://localhost:4173/";
const PANEL = process.env.PANEL_URL ?? "http://localhost:8081";
let fail = 0;
const check = (n, ok, d = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? `: ${d}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript((panel) => {
  localStorage.setItem("btv:onboarded", "1");
  localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
  sessionStorage.setItem("btv:welcome-played", "1");
  localStorage.setItem(
    "blammytv.playlists",
    JSON.stringify({ v: 1, data: [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: panel, username: "u", password: "p" }] }),
  );
  localStorage.setItem("blammytv.startupTab", JSON.stringify({ v: 1, data: "live" }));
}, PANEL);
await page.goto(URL);
await page.waitForSelector(".guide__row", { timeout: 20_000 });

const setPack = (on) =>
  page.evaluate((on) => {
    if (on) document.documentElement.dataset.themePack = "classic";
    else delete document.documentElement.dataset.themePack;
  }, on);
const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const css = (sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);
const names = () => page.$$eval(".guide__card", (els) => els.map((e) => e.querySelector(".guide__card-name")?.textContent ?? ""));
const stored = (k) => page.evaluate((k) => JSON.parse(localStorage.getItem(`blammytv.${k}`) ?? "null")?.data ?? [], k);
const row = (label) => page.locator(`.cl-tv__row:has(.cl-tv__lb:text-is("${label}"))`);
// The text node only: a channel with no logo wears its first letter in the heading.
const heroName = () =>
  page.locator(".cl-hero__name").evaluate((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim());
const rgb = (r, g, b) => `rgb(${r}, ${g}, ${b})`;

// ---------------------------------------------------------------- Default
await setPack(false);
await settle();
const defNames = await names();
check("Default: the sidebar and Hero draw as before", (await page.locator(".live-sidebar").count()) === 1 && (await page.locator(".hero__details").count()) === 1);
check("Default: no Classic parts", (await page.locator(".cl-folders, .cl-hero, .cl-pv, .cl-tv").count()) === 0);
check("Default: the channel logo is 40px", (await page.locator(".guide__card .chlogo").first().evaluate((e) => e.getBoundingClientRect().width)) === 40);
check("Default: the row step is 68px", await page.evaluate(() => {
  const [a, b] = [...document.querySelectorAll(".guide__row")];
  return b.getBoundingClientRect().top - a.getBoundingClientRect().top === 68;
}));

// ---------------------------------------------------------------- Classic
await setPack(true);
await page.waitForSelector(".cl-tv");
await settle();
check("Classic: the sidebar is gone, the folders tree is there", (await page.locator(".live-sidebar").count()) === 0 && (await page.locator('.cl-folders [role="tree"]').count()) === 1);
check("Classic: the hero is Classic's, with one #player-slot in the frame", (await page.locator(".hero__details").count()) === 0 && (await page.locator(".cl-pv #player-slot.hero__preview").count()) === 1 && (await page.locator("#player-slot").count()) === 1);
check("Classic: the same channels, in the same order", JSON.stringify(await names()) === JSON.stringify(defNames), `${(await names()).length} rows`);

// The tree: roles, the rows the sidebar had, selection.
const items = await page.$$eval('[role="treeitem"]', (els) => els.map((e) => ({ t: e.textContent, lvl: e.getAttribute("aria-level"), exp: e.getAttribute("aria-expanded"), sel: e.getAttribute("aria-selected") })));
check("Tree: Live TV, the four modes, the source and its folders", ["Live TV", "All Channels", "Favorites", "Recents", "Recordings", "Test (", "Sports", "News"].every((t) => items.some((i) => i.t?.startsWith(t))), items.map((i) => i.t).join(" | "));
check("Tree: Live TV and the source are expanded", items[0].exp === "true" && items.find((i) => i.t?.startsWith("Test"))?.exp === "true");
check("Tree: levels run 1, 2, 3", items[0].lvl === "1" && items[1].lvl === "2" && items.find((i) => i.t === "News")?.lvl === "3");
check("Tree: All Channels is the selected row", items.filter((i) => i.sel === "true").map((i) => i.t).join() === "All Channels");
check("Tree: selection is navy with white text", (await css(".cl-tv__row[aria-selected=true] .cl-tv__lb", "backgroundColor")) === rgb(10, 36, 106) && (await css(".cl-tv__row[aria-selected=true] .cl-tv__lb", "color")) === rgb(255, 255, 255));
check("Tree: Tahoma, in a sunken white box", /Tahoma/.test(await css(".cl-tv", "fontFamily")) && (await css(".cl-folders__box", "backgroundColor")) === rgb(255, 255, 255) && (await css(".cl-folders__box", "boxShadow")) !== "none");
check("Tree: dotted lines are drawn", (await page.locator(".cl-tv__g--ell, .cl-tv__g--tee").count()) > 0 && /dotted/.test(await page.locator(".cl-tv__g--tee").first().evaluate((e) => getComputedStyle(e, "::after").borderTopStyle + getComputedStyle(e, "::before").borderLeftStyle)));

// Picking a folder filters the guide, as the sidebar's folder did.
await row("News").click();
await settle();
const newsNames = await names();
check("Pick a folder: the guide is that folder's channels", newsNames.length > 0 && newsNames.length < defNames.length && newsNames.every((n) => defNames.includes(n)), newsNames.join(", "));
check("Pick a folder: it is the selected row", (await row("News").getAttribute("aria-selected")) === "true" && (await row("All Channels").getAttribute("aria-selected")) === "false");
await row("All Channels").click();
await settle();
check("All Channels: every channel is back", JSON.stringify(await names()) === JSON.stringify(defNames));

// Explorer's rule: a click on a label selects it, only the box or a double click folds.
check("Tree: labels are 12px on 18px rows", await page.evaluate(() => {
  const lb = document.querySelector('.cl-tv__row[data-node="m:favorites"] .cl-tv__lb');
  return getComputedStyle(lb).fontSize === "12px" && lb.closest(".cl-tv__row").getBoundingClientRect().height === 18;
}));
const srcRow = () => page.locator(".cl-tv__row", { hasText: "Test (" });
await srcRow().locator(".cl-tv__lb").click();
check("Tree: a click on a source's label does not fold it, or take the selection", (await srcRow().getAttribute("aria-expanded")) === "true" && (await row("All Channels").getAttribute("aria-selected")) === "true");
await row("Live TV").locator(".cl-tv__lb").click();
check("Tree: nor does a click on Live TV", (await row("Live TV").getAttribute("aria-expanded")) === "true");
await srcRow().locator(".cl-tv__lb").dblclick();
check("Tree: a double click on the label folds it", (await srcRow().getAttribute("aria-expanded")) === "false");
await srcRow().locator(".cl-tv__lb").dblclick();
check("Tree: and opens it again", (await srcRow().getAttribute("aria-expanded")) === "true");
await srcRow().locator(".cl-tv__bx").click();
check("Tree: the box folds it and leaves the selection alone", (await srcRow().getAttribute("aria-expanded")) === "false" && (await row("All Channels").getAttribute("aria-selected")) === "true");
await srcRow().locator(".cl-tv__bx").click();
check("Tree: and opens it", (await srcRow().getAttribute("aria-expanded")) === "true");

// Keyboard: arrows move, Enter picks, Left and Right fold.
await row("All Channels").focus();
await page.keyboard.press("ArrowDown");
check("Keys: ArrowDown moves the focus to the next row", await page.evaluate(() => document.activeElement?.textContent === "Favorites"));
await page.keyboard.press("End");
check("Keys: End goes to the last row", await page.evaluate(() => document.activeElement?.textContent === "Adult Swim"));
await page.keyboard.press("ArrowLeft");
check("Keys: Left on a leaf goes up to its source", await page.evaluate(() => document.activeElement?.textContent?.startsWith("Test") ?? false));
await page.keyboard.press("ArrowLeft");
const folded = await page.locator('[role="treeitem"]').count();
check("Keys: Left on an open source folds it", (await page.locator('[role="treeitem"][aria-expanded="false"]').count()) === 1 && folded === 6, `${folded} rows`);
await page.keyboard.press("ArrowRight");
check("Keys: Right on a folded source opens it", (await page.locator('[role="treeitem"]').count()) > folded);
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Enter");
await settle();
check("Keys: Enter on a folder picks it", (await names()).length < defNames.length && (await page.evaluate(() => document.querySelector('[role="treeitem"][aria-selected="true"]')?.textContent)) === "Sports");
await page.locator(".cl-tv__row", { hasText: "Test" }).locator(".cl-tv__bx").click();
check("The +/- box folds a source", (await page.locator('[role="treeitem"][aria-expanded="false"]').count()) === 1);
await page.locator(".cl-tv__row", { hasText: "Test" }).locator(".cl-tv__bx").click();
await row("All Channels").click();
await settle();

// The folder's right-click menu is still there.
await row("News").click({ button: "right" });
check("Right-click a folder: the Hide menu opens", (await page.locator(".folder-menu").innerText()).includes("Hide “News”"));
const fmenu = await page.evaluate(() => {
  const m = document.querySelector(".folder-menu");
  const it = m.querySelector(".folder-menu__item");
  const cm = getComputedStyle(m);
  const ci = getComputedStyle(it);
  const range = document.createRange();
  range.selectNodeContents(it);
  return {
    shadow: cm.boxShadow,
    bg: cm.backgroundColor,
    radius: cm.borderRadius,
    gap: Math.round(range.getBoundingClientRect().left - it.getBoundingClientRect().left),
    justify: ci.justifyContent,
    align: ci.textAlign,
    itemShadow: ci.boxShadow,
    itemWidth: Math.round(it.getBoundingClientRect().width),
    menuWidth: Math.round(m.getBoundingClientRect().width),
  };
});
check("Folder menu: bevelled on the grey face, square corners", fmenu.shadow.includes("inset") && fmenu.shadow.includes("rgb(64, 64, 64)") && fmenu.bg === rgb(212, 208, 200) && fmenu.radius === "0px", JSON.stringify(fmenu));
check("Folder menu: the item is left-aligned, flat, and runs the menu's width", fmenu.justify === "flex-start" && fmenu.align === "left" && fmenu.gap <= 12 && fmenu.itemShadow === "none" && fmenu.itemWidth >= fmenu.menuWidth - 12, JSON.stringify(fmenu));
await page.locator(".folder-menu__item").hover();
await page.waitForTimeout(400);
check("Folder menu: the item takes the navy highlight under the pointer", (await css(".folder-menu__item", "backgroundColor")) === rgb(10, 36, 106) && (await css(".folder-menu__item", "color")) === rgb(255, 255, 255));
await page.keyboard.press("Escape");

// The Fix Guide dialog wears the Classic dialog frame, as Settings does.
await page.locator(".guide__card").first().click({ button: "right" });
await page.getByRole("menuitem", { name: "Fix Guide…" }).click();
await page.locator(".cl-dlg").waitFor();
const fix = await page.evaluate(() => {
  const d = document.querySelector(".cl-dlg");
  const t = d.querySelector('[data-slot="dialog-title"]');
  const x = d.querySelector('[data-slot="dialog-close"]');
  const ct = getComputedStyle(t);
  const cx = getComputedStyle(x);
  const dr = d.getBoundingClientRect();
  const tr = t.getBoundingClientRect();
  return {
    bar: ct.backgroundImage,
    barH: Math.round(tr.height),
    ink: ct.color,
    x: cx.boxShadow,
    xBg: cx.backgroundColor,
    xW: Math.round(x.getBoundingClientRect().width),
    face: getComputedStyle(d).backgroundColor,
    radius: getComputedStyle(d).borderRadius,
    inside: [...d.children].every((c) => c.getBoundingClientRect().right <= dr.right + 0.5),
  };
});
check("Fix Guide: a navy gradient title bar, 18px, white text", fix.bar.includes("linear-gradient") && fix.bar.includes("rgb(10, 36, 106)") && fix.barH === 18 && fix.ink === rgb(255, 255, 255), JSON.stringify(fix));
check("Fix Guide: the close button is a small bevelled button, not a bare glyph", fix.x.includes("inset") && fix.xBg === rgb(212, 208, 200) && fix.xW === 16, JSON.stringify(fix));
check("Fix Guide: on the grey face, square, with everything inside the frame", fix.face === rgb(212, 208, 200) && fix.radius === "0px" && fix.inside, JSON.stringify(fix));
await page.keyboard.press("Escape");
await page.locator(".cl-dlg").waitFor({ state: "detached" });

// Modes.
await row("Favorites").click();
await settle();
check("Favorites: the mode shows (nothing starred yet)", (await page.locator(".guide-empty").count()) === 1 && (await page.locator('[role="treeitem"][aria-selected="true"]').innerText()) === "Favorites");
await row("All Channels").click();
await settle();

// ---------------------------------------------------------------- Preview
const first = (await names())[0];
check("Preview: the channel's name and its channel and folder", (await heroName()) === first && /^Channel \d+ · \S/.test(await page.locator(".cl-hero__dim").first().innerText()), await page.locator(".cl-hero__dim").first().innerText());
const info = await page.locator(".cl-hero__info").innerText();
check("Preview: Now with its times, and Next", /Now: .+/.test(info) && /\d:\d\d [AP]M – \d{1,2}:\d\d [AP]M \(\d+ min\)/.test(info) && /Next: .+ at \d{1,2}:\d\d [AP]M/.test(info), info.replace(/\n+/g, " | "));
const slot = await page.locator("#player-slot").boundingBox();
const frame = await page.locator(".cl-pv").boundingBox();
check("Preview: the slot is 16:9 and sits in a 3px black frame", Math.abs(slot.width / slot.height - 16 / 9) < 0.01 && Math.abs(slot.x - frame.x - 3) < 1 && Math.abs(slot.y - frame.y - 3) < 1 && (await css(".cl-pv", "backgroundColor")) === rgb(0, 0, 0) && (await css(".cl-pv", "boxShadow")) !== "none", `${slot.width}x${slot.height}`);
check("Preview: the hero's height is fixed (it did not move with the text)", (await page.locator(".cl-hero").evaluate((e) => e.getBoundingClientRect().height)) === 273);
check("Preview: Watch, Record and Add to Favorites are Classic buttons", JSON.stringify(await page.$$eval(".cl-hero__btns .cl-btn", (b) => b.map((x) => x.textContent))) === JSON.stringify(["Watch", "Record", "Add to Favorites"]) && (await css(".cl-hero__btns .cl-btn", "borderRadius")) === "0px" && (await css(".cl-hero__btns .cl-btn", "boxShadow")) !== "none");

// Hovering a cell previews its programme and channel, as before.
const second = (await names())[1];
await page.locator(`[data-channel] .guide__card[aria-label^="${second}"]`).hover();
await settle();
check("Hover a channel: the preview follows it", (await heroName()) === second, await heroName());
const later = page.locator(`.guide__row:has(.guide__card[aria-label^="${first}"]) .guide__cell:not(.guide__cell--live):not(.guide__cell--pinned)`).first();
if (await later.count()) {
  await later.hover();
  await settle();
  check("Hover a later programme: Now becomes Later", /^Later:/.test(await page.locator(".cl-hero__gap").first().innerText()), await page.locator(".cl-hero__gap").first().innerText());
}

// Add to Favorites.
await page.locator(`.guide__card[aria-label^="${first}"]`).hover();
await settle();
const favBtn = page.locator(".cl-hero__btns .cl-btn", { hasText: /Favorites/ });
await favBtn.click();
const favId = (await stored("favorites"))[0];
check("Add to Favorites: the channel is starred", !!favId && (await favBtn.innerText()) === "Remove from Favorites" && (await favBtn.getAttribute("aria-pressed")) === "true");
await row("Favorites").click();
await settle();
check("Favorites: the starred channel is listed", JSON.stringify(await names()) === JSON.stringify([first]));
await favBtn.click();
check("Remove from Favorites: it is unstarred", (await stored("favorites")).length === 0 && (await favBtn.innerText()) === "Add to Favorites");
await row("All Channels").click();
await settle();

// Watch tunes the channel on show.
await page.locator(`.guide__card[aria-label^="${second}"]`).hover();
await settle();
await page.locator(".cl-hero__btns .cl-btn", { hasText: "Watch" }).click();
await settle();
const recent = (await stored("recents"))[0];
check("Watch: the channel on show is tuned (first in Recents)", !!recent && (await page.locator(`.guide__channel--selected .guide__card-name`).innerText()) === second, recent);

// Record: wired to the same button (a browser has no recorder, so it says why).
await page.locator(".cl-hero__btns .cl-btn", { hasText: "Record" }).click();
await page.waitForSelector('.cl-rec__why, [role="dialog"]', { timeout: 5000 }).catch(() => {});
check("Record: pressing it starts the recording flow", (await page.locator('.cl-rec__why, [role="dialog"]').count()) > 0, (await page.locator(".cl-rec__why").allInnerTexts()).join());
await page.keyboard.press("Escape");

// ------------------------------------------------------------------- Grid
const g = await page.evaluate(() => {
  const r = (s) => document.querySelector(s)?.getBoundingClientRect();
  const rows = [...document.querySelectorAll(".guide__row")];
  const ticks = [...document.querySelectorAll(".guide__tick")];
  return {
    step: rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top,
    tick: ticks[1].getBoundingClientRect().left - ticks[0].getBoundingClientRect().left,
    tickW: ticks[0].getBoundingClientRect().width,
    tickH: ticks[0].getBoundingClientRect().height,
    rulerH: r(".guide__ruler").height,
    logo: r(".guide__card .chlogo").width,
    nowW: r(".guide__nowline").width,
    cellBottom: r(".guide__cell").bottom,
    rowBottom: rows[0].getBoundingClientRect().bottom,
  };
});
check("Grid: the row step is still 68px (the virtualization's)", g.step === 68, String(g.step));
check("Grid: time headers are raised buttons a half hour wide, the ruler's height", g.tick === 285 && g.tickW === 285 && g.tickH === g.rulerH && (await css(".guide__tick", "backgroundColor")) === rgb(212, 208, 200) && (await css(".guide__tick", "boxShadow")) !== "none", `${g.tickW}x${g.tickH}`);
check("Grid: the channel logo is 16px", g.logo === 16);
check("Grid: channel headers are raised, square, Tahoma", (await css(".guide__card", "borderRadius")) === "0px" && (await css(".guide__card", "boxShadow")) !== "none" && /Tahoma/.test(await css(".guide__card", "fontFamily")));
check("Grid: the corner says Channel", (await page.evaluate(() => getComputedStyle(document.querySelector(".guide__corner"), "::before").content)) === '"Channel"');
check("Grid: a cell reaches the bottom of its row", Math.abs(g.cellBottom - g.rowBottom) < 1.5, `${g.cellBottom} vs ${g.rowBottom}`);
const plain = page.locator(".guide__row:not(:has(.guide__channel--selected)) .guide__cell:not(.guide__cell--blank)").first();
check("Grid: programmes are white with thin grey lines", (await plain.evaluate((e) => getComputedStyle(e).backgroundColor)) === rgb(255, 255, 255) && (await plain.evaluate((e) => getComputedStyle(e).borderLeftColor)) === rgb(180, 180, 180) && (await plain.evaluate((e) => getComputedStyle(e).borderBottomWidth)) === "1px");
const sel = page.locator(".guide__row:has(.guide__channel--selected) .guide__cell--live").first();
check("Grid: the selected cell is navy with a dotted focus rectangle", (await sel.evaluate((e) => getComputedStyle(e).backgroundColor)) === rgb(10, 36, 106) && (await sel.evaluate((e) => getComputedStyle(e).outlineStyle)) === "dotted");
check("Grid: the now-line is red and 2px", g.nowW === 2 && (await css(".guide__nowline", "backgroundColor")) === rgb(224, 0, 0));
check("Grid: cell times are hidden (the aria-label still has them)", (await css(".guide__cell-time", "display")) === "none" && /\d:\d\d [AP]M – \d{1,2}:\d\d [AP]M/.test((await plain.getAttribute("aria-label")) ?? ""));

// Selecting and scrolling work as they did: a cell click selects its channel,
// and the row window follows the scroll.
await page.locator(`.guide__row:has(.guide__card[aria-label^="${first}"]) .guide__cell`).first().click();
await settle();
check("Click a cell: its channel is the selected one", (await page.locator(".guide__channel--selected .guide__card-name").innerText()) === first);
await page.locator(`.guide__card[aria-label^="${second}"]`).focus();
await page.keyboard.press("Enter");
await settle();
check("Keys: Enter on a channel header selects it", (await page.locator(".guide__channel--selected .guide__card-name").innerText()) === second);
await page.locator(".guide").evaluate((e) => { e.scrollLeft = 600; });
await settle();
await page.waitForTimeout(150);
check("Scroll right: the ruler and cells move together, the headers stay put", await page.evaluate(() => {
  const t = document.querySelector(".guide__tick").getBoundingClientRect();
  const c = document.querySelector(".guide__corner").getBoundingClientRect();
  return t.left < c.left + 5 && c.left === document.querySelector(".guide").getBoundingClientRect().left;
}));
await page.locator(".guide").evaluate((e) => { e.scrollLeft = 0; });

// ------------------------------------------------------------ Back to Default
await setPack(false);
await settle();
check("Default again: the sidebar and Hero are back, the Classic parts gone", (await page.locator(".live-sidebar").count()) === 1 && (await page.locator(".hero__details").count()) === 1 && (await page.locator(".cl-folders, .cl-pv, .cl-hero, .cl-tv").count()) === 0 && (await page.locator(".guide__card .chlogo").first().evaluate((e) => e.getBoundingClientRect().width)) === 40);
check("Default again: the Guide's cells are rounded again", (await css(".guide__cell", "borderRadius")) !== "0px");

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);

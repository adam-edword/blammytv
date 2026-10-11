// E2E: Settings in five pages (plan 025, P1: the move; v0.11.26).
//
// Settings was two tabs, General and Customize. It is five pages in a rail
// down the left of the card: Sources (what you watch), Playback (how it
// plays), Appearance (how it looks), Accounts (who you are) and App (the app
// itself). P1 moves what was there and adds no setting, so the checks are
// about a row having MOVED and not been lost, and about everything that
// names a page still going to the right one:
//
//   - the rail: five pages in order, each with its line, a vertical tablist;
//   - every page's rows, by label, and none anywhere twice;
//   - the arrows and Home/End between pages, and the page following;
//   - Settings opens where it was left, and an old stored "general" or
//     "customize" opens a real page (Sources, Appearance);
//   - the palette: a place per page, and "Settings" opens where it was left;
//   - a narrow card: the rail is the segmented row, and nothing is lost to
//     the swap;
//   - Reset Appearance takes two presses (it took one, the 0.9.79 audit's LB2);
//   - the Danger Zone boxes are gone;
//   - Escape closes Settings and focus goes back to the gear;
//   - the copy that said "Connect your AIOStreams manifest" says sign in.
//
// The primitive itself (its keys, its thumb, its chip) is verify-kit's K2b.
//
//   node scripts/fake-panel.mjs   # :8081
//   node scripts/fake-aio.mjs     # :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-settings-pages.mjs
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

const XTREAM = { v: 1, data: [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" }] };
const AIO = { v: 1, data: "http://localhost:8084/manifest.json" };
const PAGES = ["Sources", "Playback", "Appearance", "Accounts", "App"];
const BLURBS = ["What you watch", "How it plays", "How it looks", "Who you are", "The app itself"];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

/**
 * A page of its own, in a context of its own. `store` is written as
 * { key: envelope } under blammytv.*, raw: the value is stored as given, so a
 * stored page can be a string the app no longer has. `tauri` stands in for the
 * native side where a row only exists there (Trakt, MyAnimeList, Updates).
 */
async function open({ store = {}, raw = {}, width = 1440, height = 900, tauri = false, path = "" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: "dark" });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ store, raw, tauri }) => {
      localStorage.setItem("btv:onboarded", "1");
      sessionStorage.setItem("btv:welcome-played", "1");
      // Once: a reload in a check must see what the check left.
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify(v));
        for (const [k, v] of Object.entries(raw)) localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: 1, data: v }));
      }
      if (tauri) {
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
            if (cmd === "trakt_status") return Promise.resolve({ configured: true, connected: false });
            if (cmd === "mal_status") return Promise.resolve({ configured: true, connected: false });
            if (cmd === "frontend_status") return Promise.resolve({ serving: "", pending: "" });
            if (cmd === "frontend_check") return Promise.resolve("");
            return Promise.resolve(undefined);
          },
        };
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      }
    },
    { store, raw, tauri },
  );
  await page.goto(APP + path, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap", { timeout: 20_000 });
  return { ctx, page };
}
const SEEDED = { playlists: XTREAM, aiostreams: AIO, startupTab: { v: 1, data: "stream" } };
const gear = (page) => page.getByRole("button", { name: "Settings", exact: true }).first();
const openSettings = async (page) => {
  await gear(page).click();
  await page.locator(".settings__body").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(400);
};
const rail = (page) => page.getByRole("tablist", { name: "Settings", exact: true });
const tab = (page, name) => rail(page).getByRole("tab", { name, exact: true });
/** The page showing, by the rail's own mark. */
const current = (page) => rail(page).locator("[role=tab][aria-selected=true]").getAttribute("aria-label");
const titles = (page) => page.locator(".settings__body .customize-row__title").allInnerTexts();
const closeSettings = async (page) => {
  await page.keyboard.press("Escape");
  await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
};

// ------------------------------------------------------------------ the rail
{
  const { ctx, page } = await open({ store: SEEDED });
  await openSettings(page);
  const shape = await rail(page).evaluate((el) => {
    const tabs = [...el.querySelectorAll("[role=tab]")];
    return {
      orient: el.getAttribute("aria-orientation"),
      names: tabs.map((t) => t.getAttribute("aria-label")),
      blurbs: tabs.map((t) => document.getElementById(t.getAttribute("aria-describedby") ?? "")?.textContent),
      text: tabs.map((t) => t.textContent),
      icons: tabs.map((t) => !!t.querySelector(".rail__icon svg")),
      stops: tabs.map((t) => t.tabIndex),
    };
  });
  check("the rail lists the five pages in order", JSON.stringify(shape.names) === JSON.stringify(PAGES), JSON.stringify(shape.names));
  check("  each with its line under the name", JSON.stringify(shape.blurbs) === JSON.stringify(BLURBS), JSON.stringify(shape.blurbs));
  check(
    "  and a mark, a name and a line to read, in a vertical tablist with one tab stop",
    shape.orient === "vertical" && shape.icons.every(Boolean) && shape.text.every((t, i) => t.includes(PAGES[i]) && t.includes(BLURBS[i])) && shape.stops.filter((s) => s === 0).length === 1,
    JSON.stringify(shape),
  );
  check("a fresh profile opens on Sources", (await current(page)) === "Sources", String(await current(page)));
  const header = await page.evaluate(() => {
    const t = document.querySelector(".settings__title")?.textContent;
    return { title: t, tabsInHeader: document.querySelectorAll(".settings__header [role=tab]").length, close: !!document.querySelector(".settings__header [aria-label='Close settings']") };
  });
  check("the header is the title and the close, the tabs having gone to the rail", header.title === "Settings" && header.tabsInHeader === 0 && header.close, JSON.stringify(header));

  // ----------------------------------------------------------- every page's rows
  // One list per page of the rows the two old tabs held, by label. A row that
  // moved shows up where it was filed; a row lost or left behind fails the
  // page it should be on. Sources' rows are the playlist and AIOStreams
  // screens, unchanged: the pill, and the playlist the seed put there.
  await tab(page, "Sources").click();
  await page.locator(".playlist-row").first().waitFor({ timeout: 15_000 });
  const src = await page.evaluate(() => ({
    eyebrow: document.querySelector(".settings__group")?.textContent,
    pill: [...document.querySelectorAll(".settings__body .customize-rail [role=tab]")].map((t) => t.textContent),
    playlist: document.querySelector(".playlist-row__name")?.textContent,
    add: !!document.querySelector(".settings__body form, .settings__body .settings-form"),
  }));
  check(
    "Sources: the Live TV / Stream pill, and the playlist list under it",
    /sources/i.test(src.eyebrow ?? "") && src.pill.join() === "Live TV,Stream" && src.playlist === "Test",
    JSON.stringify(src),
  );
  await page.locator(".customize-rail").getByRole("tab", { name: "Stream", exact: true }).click();
  await page.waitForTimeout(500);
  const stream = await page.evaluate(() => document.querySelector(".settings__body")?.innerText ?? "");
  check("  and Stream's pane is AIOStreams' sign-in", /AIOStreams/i.test(stream) && /Connect|Sign in|address/i.test(stream), stream.slice(0, 120).replace(/\n/g, " | "));

  await tab(page, "Playback").click();
  await page.waitForTimeout(300);
  const play = await titles(page);
  // Plan 025, P3a (v0.11.28): Skip Behavior became Skipping, and Up Next's two
  // rows joined it. This list changed with them, in the plan's order: what
  // happens as one episode ends and the next begins, then the languages.
  check(
    "Playback: One-Click Play, Auto Source Failover, Autoplay Next Episode, Up Next Card, Skipping, Preferred Language, and nothing else",
    JSON.stringify(play) ===
      JSON.stringify(["One-Click Play Movies", "Auto Source Failover", "Autoplay Next Episode", "Up Next Card", "Skipping", "Preferred Language"]),
    JSON.stringify(play),
  );
  const playCtl = await page.evaluate(() => {
    const group = (name) =>
      [...document.querySelectorAll(`.settings__body [role=group][aria-label='${name}'] button`)].map((b) => b.getAttribute("aria-label")).join();
    return {
      sw: [...document.querySelectorAll(".settings__body [role=switch]")].map((s) => s.getAttribute("aria-label")),
      lang: [...document.querySelectorAll(".settings__body [role=combobox]")].map((s) => s.getAttribute("aria-label")),
      autoplay: group("Autoplay next episode"),
      card: group("Up next card"),
      skip: ["Intro", "Recap", "Credits", "Preview"].map(group),
      oldSkip: group("Skip button"),
    };
  });
  check(
    "  with their controls: three switches (the third is Skipping's combine), two language pickers, the autoplay's four, the card's three, and Skipping's four lines of three",
    playCtl.sw.join() === "One-click play,Auto source failover,Combine credits and preview" &&
      playCtl.lang.join() === "Preferred audio language,Preferred subtitle language" &&
      playCtl.autoplay === "Off,5s,10s,20s" &&
      playCtl.card === "At the credits,Last minute,Never" &&
      playCtl.skip.every((g) => g === "Button,Automatic,Off") &&
      playCtl.oldSkip === "",
    JSON.stringify(playCtl),
  );

  await tab(page, "Appearance").click();
  await page.waitForTimeout(300);
  const look = await titles(page);
  check(
    "Appearance, on Stream: the interface, the carousel, the cards, the overlay, the row size, and Reset Appearance last",
    JSON.stringify(look) ===
      JSON.stringify(["Accent", "Appearance", "Startup Tab", "Clock Format", "Featured Carousel", "Hero Slider Sources", "Card Details", "Player Overlay", "Catalog Row Size", "Reset Appearance"]),
    JSON.stringify(look),
  );
  await page.getByRole("tablist", { name: "Media" }).getByRole("tab", { name: "Live TV", exact: true }).click();
  await page.waitForTimeout(300);
  const lookLive = await titles(page);
  check(
    "  and on Live TV: Channel Numbers, between the interface and Reset Appearance",
    JSON.stringify(lookLive) === JSON.stringify(["Accent", "Appearance", "Startup Tab", "Clock Format", "Channel Numbers", "Reset Appearance"]),
    JSON.stringify(lookLive),
  );
  // Nothing of Playback's is on Appearance, nor the other way.
  check("  and none of Playback's rows are here", !look.concat(lookLive).some((t) => play.includes(t)), JSON.stringify(look.filter((t) => play.includes(t))));

  // The whole of Settings: no row filed twice, and no Danger Zone left.
  const everything = [...play, ...look, ...lookLive.filter((t) => !look.includes(t))];
  check("  no row is on two pages", new Set(everything).size === everything.length, JSON.stringify(everything));
  const dz = [];
  for (const p of PAGES) {
    await tab(page, p).click();
    await page.waitForTimeout(250);
    dz.push(await page.evaluate(() => document.querySelectorAll(".danger-zone").length + (/danger zone/i.test(document.querySelector(".settings__body")?.innerText ?? "") ? 1 : 0)));
  }
  check("the Danger Zone boxes are gone, on every page", dz.every((n) => n === 0), JSON.stringify(dz));

  // -------------------------------------------------------- arrows and the page
  await tab(page, "Sources").click();
  await tab(page, "Sources").focus();
  await page.keyboard.press("ArrowDown");
  const afterDown = await current(page);
  await page.keyboard.press("ArrowDown");
  const afterDown2 = await current(page);
  await page.keyboard.press("ArrowUp");
  const afterUp = await current(page);
  await page.keyboard.press("End");
  const afterEnd = await current(page);
  await page.keyboard.press("Home");
  const afterHome = await current(page);
  check(
    "the arrows move between pages, Home and End jump",
    afterDown === "Playback" && afterDown2 === "Appearance" && afterUp === "Playback" && afterEnd === "App" && afterHome === "Sources",
    JSON.stringify({ afterDown, afterDown2, afterUp, afterEnd, afterHome }),
  );
  await page.keyboard.press("End");
  await page.waitForTimeout(300);
  const onApp = await page.evaluate(() => ({
    panel: document.querySelector(".settings [role=tabpanel]")?.getAttribute("aria-label"),
    focus: document.activeElement?.getAttribute("aria-label"),
    rows: [...document.querySelectorAll(".settings__body .customize-row__title")].map((e) => e.textContent),
  }));
  check(
    "  and the page follows: App's rows, the focus still on the rail",
    onApp.panel === "App" && onApp.focus === "App" && onApp.rows.includes("Replay Onboarding") && onApp.rows.includes("Clear All Login Info"),
    JSON.stringify(onApp),
  );
  await closeSettings(page);
  await ctx.close();
}

// -------------------------------------------- the rows that only the app has
// Trakt, MyAnimeList and the update row answer from the native side, so they
// are read with the native side stubbed.
{
  const { ctx, page } = await open({ store: SEEDED, tauri: true });
  await openSettings(page);
  await tab(page, "Accounts").click();
  await page.locator(".trakt-row").first().waitFor({ timeout: 10_000 });
  await page.locator(".mal-row").first().waitFor({ timeout: 10_000 });
  const acc = await titles(page);
  const accEyebrow = await page.locator(".settings__group").allInnerTexts();
  check("Accounts: Trakt and MyAnimeList, and only them", acc.length === 2 && /^Trakt/.test(acc[0]) && /^MyAnimeList/.test(acc[1]) && /accounts/i.test(accEyebrow[0] ?? ""), JSON.stringify({ acc, accEyebrow }));
  await tab(page, "App").click();
  await page.locator(".customize-row", { hasText: "BlammyTV v" }).waitFor({ timeout: 10_000 });
  const app = await titles(page);
  check(
    "App: the update row, Replay Onboarding, and Clear All Login Info last",
    app.length === 3 && /^BlammyTV v/.test(app[0]) && app[1] === "Replay Onboarding" && app[2] === "Clear All Login Info",
    JSON.stringify(app),
  );
  await closeSettings(page);
  await ctx.close();
}

// -------------------------------------------- opens where it was left, and old values
{
  const { ctx, page } = await open({ store: SEEDED });
  await openSettings(page);
  await tab(page, "Accounts").click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.settingsTab") ?? "null"));
  await closeSettings(page);
  await openSettings(page);
  check(
    "the page you leave on is the page Settings opens on next time",
    (await current(page)) === "Accounts" && stored?.data === "accounts",
    JSON.stringify({ stored, now: await current(page) }),
  );
  await tab(page, "Appearance").click();
  await closeSettings(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap");
  await openSettings(page);
  check("  and after a restart too", (await current(page)) === "Appearance", String(await current(page)));
  await ctx.close();
}
for (const [old, want] of [
  ["customize", "Appearance"],
  ["general", "Sources"],
  ["themes", "Sources"],
]) {
  const { ctx, page } = await open({ store: SEEDED, raw: { settingsTab: old } });
  await openSettings(page);
  const rows = (await titles(page)).length;
  const got = await current(page);
  check(
    old === "themes" ? `a stored page nobody has ("${old}") opens a real one, Sources` : `an old stored "${old}" opens ${want}`,
    got === want && (want === "Appearance" ? rows > 0 : true),
    JSON.stringify({ got, rows }),
  );
  await ctx.close();
}

// ------------------------------------------------------------------ the palette
{
  const { ctx, page } = await open({ store: SEEDED });
  await goTo(page, "home");
  const palette = page.locator(".palette");
  const ask = async (q) => {
    await page.keyboard.press("Control+k");
    await palette.waitFor({ timeout: 4000 });
    await page.keyboard.type(q);
    await page.waitForTimeout(300);
  };
  await page.keyboard.press("Control+k");
  await palette.waitFor({ timeout: 4000 });
  const places = await page.evaluate(() => [...document.querySelectorAll(".palette .mvpick__row .mvpick__nametext")].map((r) => r.textContent));
  // In the rail's order, right after the places that come before them.
  const at = places.indexOf("Settings");
  check(
    "the palette has a place for Settings, then one for each page in the rail's order",
    at >= 0 && JSON.stringify(places.slice(at, at + 6)) === JSON.stringify(["Settings", ...PAGES]),
    JSON.stringify(places),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await ask("playback");
  await page.keyboard.press("Enter");
  await page.locator(".settings").waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  check("the palette's Playback place opens Settings on Playback", (await current(page)) === "Playback", String(await current(page)));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.settingsTab") ?? "null")?.data);
  check("  and that is the page it keeps", saved === "playback", String(saved));
  await tab(page, "Accounts").click();
  await closeSettings(page);
  // "Settings" itself names no page: it opens where it was left.
  await ask("settings");
  await page.keyboard.press("Enter");
  await page.locator(".settings").waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  check('  and the palette\'s "Settings" place opens where it was left', (await current(page)) === "Accounts", String(await current(page)));
  await closeSettings(page);
  await ask("appearance");
  await page.keyboard.press("Enter");
  await page.locator(".settings").waitFor({ timeout: 5000 });
  await page.waitForTimeout(300);
  check("  and a typed place for another page goes there (Appearance)", (await current(page)) === "Appearance", String(await current(page)));
  await closeSettings(page);
  await ctx.close();
}

// --------------------------------------------------------------- a narrow card
{
  // The card is `min(786px, 100%)` of the window less 96px of margin: 700 is a
  // 604px card, under the 640 the rail gives way at; 760 is 664, over it.
  const { ctx, page } = await open({ store: SEEDED, width: 700, height: 800 });
  await openSettings(page);
  const row = await page.evaluate(() => {
    const list = document.querySelector(".settings [role=tablist][aria-label=Settings]");
    const tabs = [...(list?.querySelectorAll("[role=tab]") ?? [])];
    const boxes = tabs.map((t) => t.getBoundingClientRect());
    const card = document.querySelector(".settings").getBoundingClientRect();
    return {
      isSeg: !!list?.classList.contains("seg"),
      rail: document.querySelectorAll(".settings .rail").length,
      names: tabs.map((t) => t.getAttribute("aria-label")),
      // Names only: the line under each is not there.
      words: tabs.map((t) => t.textContent),
      level: boxes.every((b) => Math.abs(b.top - boxes[0].top) < 1.5),
      leftToRight: boxes.every((b, i) => i === 0 || b.left >= boxes[i - 1].right - 0.5),
      inCard: boxes.every((b) => b.left >= card.left && b.right <= card.right + 0.5) || list?.scrollWidth > list?.clientWidth,
      card: Math.round(card.width),
    };
  });
  check(
    "at a narrow card the rail is the segmented row: five pages, side by side, names only",
    row.isSeg && row.rail === 0 && row.names.join() === PAGES.join() && row.words.join() === PAGES.join() && row.level && row.leftToRight && row.inCard && row.card < 640,
    JSON.stringify(row),
  );
  await tab(page, "Playback").click();
  await page.waitForTimeout(300);
  const nowOn = await page.evaluate(() => ({
    sel: document.querySelector(".settings [role=tablist][aria-label=Settings] [role=tab][aria-selected=true]")?.getAttribute("aria-label"),
    panel: document.querySelector(".settings [role=tabpanel]")?.getAttribute("aria-label"),
  }));
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  const next = await page.evaluate(() => document.querySelector(".settings [role=tablist][aria-label=Settings] [role=tab][aria-selected=true]")?.getAttribute("aria-label"));
  check("  and it switches pages, by click and by →", nowOn.sel === "Playback" && nowOn.panel === "Playback" && next === "Appearance", JSON.stringify({ nowOn, next }));

  // The swap leaves the page alone: a half-typed field survives the card
  // going wide again (the page is not remounted).
  await tab(page, "Sources").click();
  await page.locator(".playlist-row").first().waitFor({ timeout: 10_000 });
  const field = page.getByPlaceholder("Living Room IPTV");
  await field.fill("Draft name");
  await field.evaluate((e) => (e.dataset.mark = "same"));
  await page.setViewportSize({ width: 760, height: 800 });
  await page.waitForTimeout(500);
  const wide = await page.evaluate(() => ({
    rail: document.querySelectorAll(".settings .rail").length,
    seg: document.querySelectorAll(".settings [role=tablist][aria-label=Settings].seg").length,
    sel: document.querySelector(".settings .rail [role=tab][aria-selected=true]")?.getAttribute("aria-label"),
    kept: document.querySelector("input[data-mark=same]")?.value,
    width: Math.round(document.querySelector(".settings").getBoundingClientRect().width),
  }));
  check(
    "  and widening the window brings the rail back on the same page, the half-typed field still there",
    wide.rail === 1 && wide.seg === 0 && wide.sel === "Sources" && wide.kept === "Draft name" && wide.width >= 640,
    JSON.stringify(wide),
  );
  await page.setViewportSize({ width: 700, height: 800 });
  await page.waitForTimeout(500);
  const narrowAgain = await page.evaluate(() => ({
    rail: document.querySelectorAll(".settings .rail").length,
    kept: document.querySelector("input[data-mark=same]")?.value,
  }));
  check("  and narrowing it again takes the rail away, the field still there", narrowAgain.rail === 0 && narrowAgain.kept === "Draft name", JSON.stringify(narrowAgain));
  await ctx.close();
}

// ------------------------------------------------------------ Reset Appearance
{
  const { ctx, page } = await open({ store: SEEDED, raw: { settingsTab: "appearance" } });
  await openSettings(page);
  const themeNow = () => page.evaluate(() => document.documentElement.dataset.theme ?? "dark");
  const accentNow = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--accent"));
  await page.getByRole("group", { name: "Appearance", exact: true }).getByRole("button", { name: "Light", exact: true }).click();
  await page.getByRole("group", { name: "Accent color" }).getByRole("button", { name: "Blue", exact: true }).click();
  await page.waitForTimeout(150);
  const before = { theme: await themeNow(), accent: await accentNow() };
  check("Reset Appearance: set up, the app is light and blue", before.theme === "light" && before.accent !== "", JSON.stringify(before));
  const reset = page.getByRole("button", { name: "Reset", exact: true });
  await reset.click();
  await page.waitForTimeout(200);
  const armed = { theme: await themeNow(), accent: await accentNow(), label: await page.getByRole("button", { name: "Click again to confirm" }).count() };
  check(
    "  one press only arms it: nothing is reset, and it asks again",
    armed.theme === "light" && armed.accent === before.accent && armed.label === 1,
    JSON.stringify(armed),
  );
  await page.getByRole("button", { name: "Click again to confirm" }).click();
  await page.waitForTimeout(250);
  const done = { theme: await themeNow(), accent: await accentNow(), label: await page.getByRole("button", { name: "Reset", exact: true }).count() };
  check("  the second press resets: dark, the default accent, and the button is Reset again", done.theme === "dark" && done.accent === "" && done.label === 1, JSON.stringify(done));
  // And left alone, it disarms (Clear All Login Info's four seconds).
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  const armedNow = await page.getByRole("button", { name: "Click again to confirm" }).waitFor({ timeout: 2000 }).then(() => true, () => false);
  const disarmed = await page.getByRole("button", { name: "Reset", exact: true }).waitFor({ timeout: 6000 }).then(() => true, () => false);
  check("  and an armed Reset left alone goes back to Reset by itself", armedNow && disarmed, JSON.stringify({ armedNow, disarmed }));
  // Reset leaves Startup Tab alone: it is behaviour, and the button promises appearance.
  await page.getByRole("group", { name: "Start on" }).getByRole("button", { name: "Live TV", exact: true }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByRole("button", { name: "Click again to confirm" }).click();
  await page.waitForTimeout(200);
  const startup = await page.evaluate(() => JSON.parse(localStorage.getItem("blammytv.startupTab") ?? "null")?.data);
  check("  and it leaves Startup Tab where it was (v0.9.79's call)", startup === "live", String(startup));
  await ctx.close();
}

// --------------------------------------------------- Escape, and focus to the gear
{
  const { ctx, page } = await open({ store: SEEDED });
  await gear(page).focus();
  await page.keyboard.press("Enter");
  await page.locator(".settings__body").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await tab(page, "Playback").click();
  await page.keyboard.press("Escape");
  const shut = await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false);
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => ({ focus: document.activeElement?.getAttribute("aria-label"), tips: document.querySelectorAll("[data-slot=tooltip-content]:not([data-state=closed])").length }));
  check("Escape closes Settings and focus goes back to the gear, without its tooltip", shut && back.focus === "Settings" && back.tips === 0, JSON.stringify({ shut, ...back }));
  await ctx.close();
}

// ------------------------------------------------------- the stale manifest copy
{
  const { ctx, page } = await open({ store: { startupTab: { v: 1, data: "stream" } } });
  await openSettings(page);
  const want = /Sign in to your AIOStreams in Settings → Sources → Stream/;
  await tab(page, "Playback").click();
  await page.waitForTimeout(300);
  const playNote = (await page.locator(".settings__body").innerText()).replace(/\n/g, " ");
  check("with no AIOStreams, Playback says to sign in, not to connect a manifest", want.test(playNote) && !/manifest/i.test(playNote), playNote.slice(0, 160));
  await tab(page, "Appearance").click();
  await page.waitForTimeout(300);
  const lookNote = (await page.locator(".settings__body").innerText()).replace(/\n/g, " ");
  check("  and so does Appearance, on its Stream pill", want.test(lookNote) && !/manifest/i.test(lookNote), lookNote.slice(0, 200));
  await closeSettings(page);
  await goTo(page, "discover");
  const empty = await page.locator(".discover").innerText({ timeout: 10_000 }).then((t) => t.replace(/\n/g, " "), () => "");
  check("  and Discover's empty state does too", want.test(empty) && !/manifest/i.test(empty), empty);
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);

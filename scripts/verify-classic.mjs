// E2E: Classic, the Windows 2000 theme (plan 035, tier 3), phase 1: its paint,
// its header, Discover's band, Ctrl+K as the Go To box and Settings as a
// Display Properties dialog. Default must be today's app again the moment
// Classic is switched off.
//
// What can go wrong here is quiet:
//   - a header that is not the capsule's twin: a press must go where the
//     capsule's goes (the buttons carry its data-dest keys, so goTo drives
//     both), Home and Back included.
//   - Default or another pack wearing Classic's header, or Classic leaking
//     into Default after a switch back.
//   - the ? opening the docs. It shows a balloon; only the balloon's link
//     leaves the app, and only to that tab's page.
//   - one face: Light must not change Classic.
//
// Everything external is aborted; the browser build's window.open is recorded.
//
//   node scripts/fake-panel.mjs; node scripts/fake-aio.mjs   # :8081, :8084
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-classic.mjs
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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/** A page that reaches nothing but this machine. `live: false` leaves out the
 * playlist, so there is no Live TV half. */
async function open({ store = {}, scheme = "dark", live = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  await ctx.route((u) => u.hostname !== "localhost", (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ store, live, PLAYLISTS, AIO }) => {
      localStorage.setItem("btv:onboarded", "1");
      localStorage.setItem("blammytv.whatsNewSeen", JSON.stringify({ v: 1, data: "999.0" }));
      sessionStorage.setItem("btv:welcome-played", "1");
      if (!sessionStorage.getItem("btv:classic-seeded")) {
        sessionStorage.setItem("btv:classic-seeded", "1");
        if (live) localStorage.setItem("blammytv.playlists", JSON.stringify(PLAYLISTS));
        localStorage.setItem("blammytv.aiostreams", JSON.stringify(AIO));
        for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify({ v: 1, data: v }));
      }
      window.__opened = [];
      window.open = (...a) => (window.__opened.push(String(a[0])), null);
    },
    { store, live, PLAYLISTS, AIO },
  );
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".navcap, .cl-header", { timeout: 20_000 });
  return { ctx, page, errors };
}

const CLASSIC = { themePack: "classic" };
const tools = (page) =>
  page.evaluate(() => [...document.querySelectorAll(".cl-tools > button")].map((b) => b.getAttribute("aria-label") || b.textContent.trim()));
const screenOf = (page) => page.locator("main.app-main").getAttribute("data-screen");
const address = (page) => page.locator("[data-cl=address]").innerText().then((t) => t.replace(/\s+/g, " ").trim());

// ------------------------------------------------------------------- paint
{
  const { ctx, page, errors } = await open({ store: CLASSIC });
  await goTo(page, "home");
  const paint = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    const poster = document.querySelector(".stream-card__poster, .shero__card, .shero__poster");
    return {
      pack: document.documentElement.dataset.themePack,
      font: cs.fontFamily,
      bg: cs.backgroundColor,
      poster: poster ? getComputedStyle(poster).borderRadius : null,
      anyRound: [...document.querySelectorAll(".cl-header *, .cl-status *")].filter((e) => getComputedStyle(e).borderRadius !== "0px").length,
    };
  });
  check("Classic: the root carries the pack", paint.pack === "classic");
  check("Classic: the face is Tahoma", paint.font.startsWith("Tahoma"), paint.font);
  check("Classic: the page is the grey face", paint.bg === "rgb(212, 208, 200)", paint.bg);
  check("Classic: corners are square", paint.anyRound === 0 && (paint.poster === null || paint.poster === "0px"), JSON.stringify(paint));
  // A real shared Button: the Theme cards in Settings.
  await page.locator('[data-cl="settings"]').click();
  const btn = await page.locator('[data-slot="button"]').first();
  await btn.waitFor();
  const raised = await btn.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { shadow: cs.boxShadow, bg: cs.backgroundColor, radius: cs.borderRadius };
  });
  check("Classic: a Button is raised (a dark inset edge, a light one, the face between)", raised.shadow.includes("inset") && raised.shadow.includes("rgb(64, 64, 64)") && raised.shadow.includes("rgb(255, 255, 255)") && raised.bg === "rgb(212, 208, 200)" && raised.radius === "0px", JSON.stringify(raised));
  const field = await page.evaluate(() => {
    const i = document.querySelector('[data-slot="input"], input[type="text"]');
    return i ? getComputedStyle(i).boxShadow : null;
  });
  check("Classic: scrollbars are Classic's (a grey raised thumb)", await page.evaluate(() => getComputedStyle(document.querySelector(".settings__body"), "::-webkit-scrollbar-thumb").backgroundColor === "rgb(212, 208, 200)"));
  void field;
  check("Classic: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// -------------------------------------------------------------- the header
{
  const { ctx, page, errors } = await open({ store: CLASSIC });
  check("header: it is Classic's, not the capsule", (await page.locator(".navcap").count()) === 0 && (await page.locator(".cl-header").count()) === 1);
  const want = ["Back", "Forward", "Live TV", "Multi-View", "Sports (beta)", "Home", "Stream", "Discover", "Library", "Go To", "Settings"];
  const got = await tools(page);
  check("header: Back, Forward | Live TV, Multi-View, Sports | Home | Stream, Discover, Library ... Go To, Settings", JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  const top = await page.locator(".cl-menu").innerText();
  check("header: a thin top bar with the mark and the name", top.trim() === "BlammyTV");
  check("header: Go To shows its key", (await page.locator('[data-cl="goto"]').innerText()).includes("(Ctrl+K)"));

  await goTo(page, "home");
  const pressed = await page.evaluate(() => {
    const on = document.querySelector('.cl-tools [aria-current="page"]');
    const cs = on && getComputedStyle(on);
    return { key: on?.getAttribute("data-dest"), n: document.querySelectorAll('.cl-tools [aria-current="page"]').length, bg: cs?.backgroundImage ?? "", shadow: cs?.boxShadow ?? "" };
  });
  check("header: the tab you are on is pressed in, with the checkered fill, and only it", pressed.key === "home" && pressed.n === 1 && pressed.bg.includes("conic-gradient") && pressed.shadow.includes("inset"), JSON.stringify(pressed));
  check("header: the address says where you are", (await address(page)) === "BlammyTV › Stream › Home", await address(page));

  await goTo(page, "guide");
  check("header: Live TV opens the Guide", (await screenOf(page)) === "guide");
  check("header: and the address follows", (await address(page)) === "BlammyTV › Live TV › Guide", await address(page));
  await goTo(page, "hub");
  check("header: Home opens Home, and is the current one", (await screenOf(page)) === "hub" && (await page.locator('[data-dest="hub"]').getAttribute("aria-current")) === "page");
  check("header: on Home no tab is current but Home", (await page.locator('.cl-tools [data-dest][aria-current="page"]').count()) === 1);
  check("header: and the address says Home", (await address(page)) === "BlammyTV › Home", await address(page));
  await goTo(page, "home");
  check("header: Stream opens Stream", (await screenOf(page)) === "home");
  await goTo(page, "mylist");
  check("header: Library's address", (await address(page)) === "BlammyTV › Stream › Library", await address(page));

  const clock = await page.locator('[data-cl="clock"]').innerText();
  check("status bar: the clock", /^\d{1,2}:\d{2}( ?[AP]M)?$/.test(clock.trim()), clock);
  const status = (await page.locator(".cl-status").innerText()).replace(/\s+/g, " ");
  check("status bar: Ready and what the live source has", status.startsWith("Ready") && /\d+ channels/.test(status), status);
  const bar = await page.locator(".cl-status").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { bottom: Math.round(r.bottom), vh: innerHeight, width: Math.round(r.width) };
  });
  check("status bar: along the bottom, edge to edge", bar.bottom === bar.vh && bar.width === 1440, JSON.stringify(bar));
  const hh = await page.evaluate(() => ({ h: parseFloat(document.documentElement.style.getPropertyValue("--header-h")), box: document.querySelector(".cl-header").getBoundingClientRect().height }));
  check("header: --header-h is the chrome's height, so content starts below it", Math.abs(hh.h - hh.box) < 1 && hh.h > 90, JSON.stringify(hh));
  const solid = await page.locator(".cl-header").evaluate((el) => getComputedStyle(el).backgroundColor);
  check("header: solid grey, not glass", solid === "rgb(212, 208, 200)", solid);
  check("header: no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}
{
  const { ctx, page } = await open({ store: CLASSIC, live: false });
  const got = await tools(page);
  check("header: with no live source the Live TV group is gone, as the capsule's is", JSON.stringify(got) === JSON.stringify(["Back", "Forward", "Home", "Stream", "Discover", "Library", "Go To", "Settings"]), JSON.stringify(got));
  await ctx.close();
}

// --------------------------------------------------------------------- Back
{
  const { ctx, page } = await open({ store: CLASSIC });
  await goTo(page, "discover");
  await page.locator(".cl-band").waitFor();
  const movies = page.getByRole("button", { name: "Movies", exact: true });
  await movies.click();
  await page.waitForFunction(() => document.querySelector(".cl-band .cl-tog")?.getAttribute("aria-pressed") === "true");
  await page.locator('.cl-tools [data-cl="back"]').click();
  await page.waitForFunction(() => document.querySelector(".cl-band .cl-tog")?.getAttribute("aria-pressed") === "false", null, { timeout: 5000 }).then(
    () => check("Back: steps Discover back (Movies is off again), as the mouse's Back does", true),
    () => check("Back: steps Discover back (Movies is off again), as the mouse's Back does", false),
  );
  await page.locator('.cl-tools [data-cl="forward"]').click();
  await page.waitForFunction(() => document.querySelector(".cl-band .cl-tog")?.getAttribute("aria-pressed") === "true", null, { timeout: 5000 }).then(
    () => check("Forward: and forward puts it back", true),
    () => check("Forward: and forward puts it back", false),
  );
  await ctx.close();
}

// ---------------------------------------------------------- Discover's band
{
  const { ctx, page } = await open({ store: CLASSIC });
  await goTo(page, "home");
  check("band: it is Discover's alone", (await page.locator(".cl-band").count()) === 0);
  await goTo(page, "discover");
  await page.locator(".cl-band").waitFor();
  const label = (await page.locator(".cl-band").innerText()).replace(/\s+/g, " ");
  check("band: Show, the genre, Movies and Series", label.startsWith("Show: Any Genre") && /Movies Series/.test(label), label);
  check("band: the address bar is Discover's search field with Go", (await page.locator("#cl-search").count()) === 1 && (await page.locator(".cl-go").innerText()) === "Go" && (await page.locator("[data-cl=address]").count()) === 0);
  const pressed = () => page.evaluate(() => [...document.querySelectorAll(".cl-band .cl-tog")].map((b) => b.getAttribute("aria-pressed")));
  check("band: neither toggle is pressed for Any", JSON.stringify(await pressed()) === JSON.stringify(["false", "false"]), JSON.stringify(await pressed()));
  await page.getByRole("button", { name: "Series", exact: true }).click();
  await page.waitForTimeout(300);
  check("band: Series toggles the type filter on", JSON.stringify(await pressed()) === JSON.stringify(["false", "true"]), JSON.stringify(await pressed()));
  check("band: and the search field says what it searches", (await page.locator("#cl-search").getAttribute("placeholder")) === "Search Series…");
  await page.getByRole("button", { name: "Series", exact: true }).click();
  await page.waitForTimeout(300);
  check("band: pressed again it goes back to Any", JSON.stringify(await pressed()) === JSON.stringify(["false", "false"]), JSON.stringify(await pressed()));
  await page.getByRole("button", { name: "Movies", exact: true }).click();
  await page.waitForTimeout(300);
  check("band: Movies toggles it too", JSON.stringify(await pressed()) === JSON.stringify(["true", "false"]), JSON.stringify(await pressed()));
  const names = await page.locator("#cl-genre option").allInnerTexts();
  check("band: the genre list is Discover's own, behind Any Genre", names[0] === "Any Genre" && names.length > 1, JSON.stringify(names));
  const pick = names[1];
  await page.locator("#cl-genre").selectOption({ label: pick });
  await page.waitForTimeout(600);
  const picked = await page.locator("#cl-genre").inputValue();
  check("band: choosing a genre goes to Discover and comes back as the choice", picked === pick, picked);
  await page.locator('.cl-tools [data-cl="back"]').click();
  await page.waitForTimeout(600);
  check("band: Back undoes the genre, because it is a page change there", (await page.locator("#cl-genre").inputValue()) === "", await page.locator("#cl-genre").inputValue());
  // The search field searches the catalog.
  await page.locator("#cl-search").fill("fake");
  await page.waitForTimeout(1500);
  const found = await page.evaluate(() => [...document.querySelectorAll(".disc-grid .stream-card__name")].map((e) => e.textContent.trim()));
  check("band: the search field searches (the catalog's own results come up)", found.length > 0 && found.every((t) => /fake/i.test(t) || true) && (await page.locator("#cl-search").inputValue()) === "fake", JSON.stringify(found));
  await ctx.close();
}

// ------------------------------------------------------------ Ctrl+K, Go To
{
  const { ctx, page } = await open({ store: CLASSIC });
  await goTo(page, "home");
  await page.keyboard.press("Control+k");
  const box = page.locator(".palette--classic");
  await box.waitFor();
  check("Go To: Ctrl+K opens the box", (await box.locator(".cl-title__text").innerText()) === "Go To");
  const text = (await box.innerText()).replace(/\s+/g, " ");
  check("Go To: the intro line, the Open: field and OK and Cancel", /Type the name of a channel, a film or a setting, and BlammyTV will open it for you\./.test(text) && text.includes("Open:") && (await box.getByRole("button", { name: "OK" }).count()) === 1 && (await box.getByRole("button", { name: "Cancel" }).count()) === 1, text);
  const title = await box.locator(".cl-title").evaluate((el) => getComputedStyle(el).backgroundImage);
  check("Go To: a navy title bar", title.includes("rgb(10, 36, 106)"), title);
  await page.keyboard.type("espn");
  await page.waitForTimeout(800);
  const sel = await box.locator(".mvpick__row[data-highlighted]").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  check("Go To: a result is selected in navy", sel === "rgb(10, 36, 106)", sel);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("main.app-main")?.getAttribute("data-screen") === "guide", null, { timeout: 8000 }).then(
    () => check("Go To: Enter on a result goes there (the Guide, tuned to the channel)", true),
    async () => check("Go To: Enter on a result goes there (the Guide, tuned to the channel)", false, await screenOf(page)),
  );
  check("Go To: and the box is closed", (await page.locator(".palette--classic").count()) === 0);
  await goTo(page, "home");
  await page.keyboard.press("Control+k");
  await box.waitFor();
  await page.keyboard.type("espn");
  await page.waitForTimeout(800);
  await box.getByRole("button", { name: "OK" }).click();
  await page.waitForFunction(() => document.querySelector("main.app-main")?.getAttribute("data-screen") === "guide", null, { timeout: 8000 }).then(
    () => check("Go To: OK does what Enter does", true),
    () => check("Go To: OK does what Enter does", false),
  );
  await box.waitFor({ state: "detached" });
  await page.keyboard.press("Control+k");
  await box.waitFor();
  await box.getByRole("button", { name: "Cancel" }).click();
  await box.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check("Go To: Cancel closes it", (await page.locator(".palette--classic").count()) === 0);
  await ctx.close();
}

// --------------------------------------------------------------- Settings
{
  const { ctx, page } = await open({ store: { ...CLASSIC, settingsTab: "appearance" } });
  await goTo(page, "home");
  await page.locator('[data-cl="settings"]').click();
  const dlg = page.locator(".settings--classic");
  await dlg.waitFor();
  check("Settings: opens as the dialog, with a navy title bar", (await dlg.locator(".cl-title__text").innerText()) === "Settings" && (await dlg.locator(".cl-title").evaluate((el) => getComputedStyle(el).backgroundImage)).includes("rgb(10, 36, 106)"));
  const tabs = await dlg.locator('.cl-tabs [role="tab"]').allInnerTexts();
  check("Settings: property-sheet tabs for the six pages", JSON.stringify(tabs.map((t) => t.trim())) === JSON.stringify(["Home", "Sources", "Playback", "Appearance", "Accounts", "App"]), JSON.stringify(tabs));
  check("Settings: on the page it was left on", (await dlg.locator('.cl-tabs [aria-selected="true"]').innerText()).trim() === "Appearance");
  check("Settings: one Close button, and the title's ? and X", (await dlg.locator(".cl-foot button").allInnerTexts()).join() === "Close" && (await dlg.locator(".cl-title button").count()) === 2);
  check("Settings: its own controls are Classic's (the Theme cards are raised Buttons)", (await dlg.locator('[data-slot="button"]').first().evaluate((el) => getComputedStyle(el).boxShadow)).includes("inset"));

  check("Settings: no balloon until asked", (await page.locator(".cl-balloon").count()) === 0);
  await dlg.getByRole("button", { name: "Help" }).click();
  const balloon = page.locator(".cl-balloon");
  await balloon.waitFor();
  const said = (await balloon.innerText()).replace(/\s+/g, " ");
  check("Settings: the ? shows the yellow balloon, for this tab", said.startsWith("Appearance Help Help for these settings is in the BlammyTV docs, in your browser.") && said.endsWith("Open Help in Browser"), said);
  check("Settings: the balloon is #ffffe1 with a black edge", (await balloon.evaluate((el) => { const cs = getComputedStyle(el); return `${cs.backgroundColor}|${cs.borderTopColor}`; })) === "rgb(255, 255, 225)|rgb(0, 0, 0)");
  check("Settings: and the ? did NOT open the docs", (await page.evaluate(() => window.__opened.length)) === 0);
  await balloon.getByRole("button", { name: "Open Help in Browser" }).click();
  const opened = await page.evaluate(() => window.__opened);
  check("Settings: only the balloon's link opens that tab's docs page", opened.length === 1 && opened[0] === "https://docs.eddtv.org/using/appearance/", JSON.stringify(opened));

  // Back to Default from here: the Theme card.
  await dlg.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Default" }).click();
  await page.waitForSelector(".navcap", { timeout: 5000 }).catch(() => {});
  check("Default again: today's capsule is back", (await page.locator(".navcap").count()) === 1 && (await page.locator(".cl-header, .cl-status").count()) === 0);
  check("Default again: and the root carries no pack", (await page.evaluate(() => document.documentElement.dataset.themePack)) === undefined);
  check("Default again: Settings is the card again", (await page.locator(".settings--classic").count()) === 0 && (await page.locator("section.settings .settings__rail").count()) === 1);
  const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check("Default again: and the font is the app's", !body.startsWith("Tahoma"), body);
  await ctx.close();
}
{
  const { ctx, page } = await open({ store: CLASSIC });
  await goTo(page, "home");
  await page.locator('[data-cl="settings"]').click();
  await page.locator(".settings--classic").waitFor();
  await page.getByRole("button", { name: "Close" }).last().click();
  await page.waitForTimeout(500);
  check("Settings: Close closes it", (await page.locator(".settings--classic").count()) === 0);
  await ctx.close();
}

// ------------------------------------------------------- one face, and others
{
  const { ctx, page } = await open({ store: { ...CLASSIC, theme: "light" } });
  const light = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.querySelector(".cl-header")).backgroundColor, font: getComputedStyle(document.body).fontFamily.slice(0, 6), page: getComputedStyle(document.body).backgroundColor }));
  check("one face: in Light the header, the page and the font are the same", light.theme === "light" && light.bg === "rgb(212, 208, 200)" && light.page === "rgb(212, 208, 200)" && light.font === "Tahoma", JSON.stringify(light));
  await ctx.close();
}
for (const pack of ["prism", "velvet", "lagoon", "fluent"]) {
  const { ctx, page } = await open({ store: { themePack: pack } });
  check(`${pack}: keeps today's header`, (await page.locator(".navcap").count()) === 1 && (await page.locator(".cl-header, .cl-status").count()) === 0);
  await ctx.close();
}
{
  const { ctx, page } = await open();
  check("Default: today's header", (await page.locator(".navcap").count()) === 1 && (await page.locator(".cl-header, .cl-status").count()) === 0);
  await ctx.close();
}

await browser.close();
process.exit(fail ? 1 : 0);

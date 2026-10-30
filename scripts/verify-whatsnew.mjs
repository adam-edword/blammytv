// E2E: What's New (app/WhatsNew.tsx, features/whatsnew/).
//
// The screen a launch shows once after an update, and Settings → App → What's
// New shows on demand. Full screen in onboarding's world, entered through the
// cold-boot animation on the launch that shows it.
//
// The build under test is 1.0.x, below the release the data file announces
// (1.2), so a page that wants the screen is served a version.ts that says 1.2.0
// (a route, nothing in the source changes). One section leaves it alone: a dev
// build below the release must not show it.
//
// Sections:
//   - an upgraded profile: the screen over nothing, its copy, its dialog
//     semantics and headings, the lockup at the top with the page below it,
//     Continue stores the release and shows the app, a reload does not show it
//     again, the changelog and Back, Escape (page and changelog)
//   - the rule: a first run gets onboarding and no What's New, finishing
//     onboarding stamps the release, a build below the release shows nothing
//   - the boot: it plays, the lockup rests mid-screen and then rises to the top,
//     a skip (Space, Escape, a click) lands on the finished page with no
//     animation and does not press anything, an ordinary launch's boot is the
//     one it always was
//   - on demand: Settings → App → What's New opens it with no boot, Continue and
//     Escape return to Settings with focus on its button; Ctrl+K finds it
//   - nothing plays under it: Start On Live TV with the native side stubbed, no
//     play call and no way to reach the Guide until Continue
//   - reduced motion, light theme, a short window
//
//   node scripts/fake-panel.mjs   # :8081
//   (vite on :4173)
//   PW_FROM=<dir-with-node_modules>/x.js node scripts/verify-whatsnew.mjs
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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
const seenKey = "blammytv.whatsNewSeen";
const SEEN_1_0 = { [seenKey.slice("blammytv.".length)]: { v: 1, data: "1.0" } };

/** The native side, stubbed as verify-live-idle does: http_get answered by the
 * page's fetch so the fake panel loads, every other command logged and met with
 * nothing. */
const TAURI = () => {
  window.__tauriCalls = [];
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
      window.__tauriCalls.push(cmd);
      if (cmd === "http_get") return fetch(args.url).then((r) => r.arrayBuffer());
      return Promise.resolve(undefined);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
};

/**
 * A page of its own. `version` is what version.ts says (null leaves the real
 * 1.0.x), `played` whether this session's cold-boot welcome has already played
 * (the usual harness seed; false lets a boot run), `onboarded` the completed
 * flag, `store` the keys under blammytv.
 */
async function open({
  store = {},
  version = "1.2.0",
  played = true,
  onboarded = true,
  width = 1600,
  height = 900,
  reducedMotion = "no-preference",
  colorScheme = "dark",
  tauri = false,
  url = APP,
  wait = true,
} = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion });
  await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort());
  if (version)
    await ctx.route("**/src/lib/version.ts*", (r) =>
      r.fulfill({ contentType: "text/javascript", body: `export const APP_VERSION = "${version}";` }),
    );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(
    ({ store, played, onboarded }) => {
      if (onboarded) localStorage.setItem("btv:onboarded", "1");
      if (played) sessionStorage.setItem("btv:welcome-played", "1");
      // Once: a reload in a check must see what the check left.
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        for (const [k, v] of Object.entries(store)) localStorage.setItem(`blammytv.${k}`, JSON.stringify(v));
      }
    },
    { store, played, onboarded },
  );
  if (tauri) await page.addInitScript(TAURI);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (wait) await page.locator(".wn").waitFor({ timeout: 20_000 });
  return { ctx, page };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dialog = (page) => page.getByRole("dialog", { name: "What’s New", exact: true });
const wnGone = (page, ms = 5000) => page.locator(".wn").waitFor({ state: "detached", timeout: ms }).then(() => true, () => false);
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), seenKey);
const storedSeen = async (page) => JSON.parse((await stored(page)) ?? "null")?.data ?? null;
const focused = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName}:${(a.textContent ?? "").trim().slice(0, 24)}` : "none";
  });
/** The lockup (the boot scene's tile and wordmark), the title, the window. */
const lockup = (page) =>
  page.evaluate(() => {
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, cy: b.y + b.height / 2 };
    };
    const h1 = document.querySelector(".wn h1")?.getBoundingClientRect();
    const s = Math.max(innerWidth / 1920, innerHeight / 1167);
    return {
      tile: r(document.querySelector(".wn .boot-frame")),
      word: r(document.querySelector(".wn .boot-wordmark")),
      wordOpacity: Number(getComputedStyle(document.querySelector(".wn .boot-wordmark")).opacity),
      h1top: h1 ? h1.top : null,
      vw: innerWidth,
      vh: innerHeight,
      s,
    };
  });
const near = (a, b, tol) => Math.abs(a - b) <= tol;
/** Where the risen lockup's tile should sit: its middle 52px plus half its
 * height down from the top, 76 wide times the window's boot scale times .62. */
const atTop = (l) => {
  const size = 76 * l.s * 0.62;
  return near(l.tile.cy, 52 + size / 2, 2.5) && near(l.tile.w, size, 2.5) && l.word.cy < l.tile.cy + 8 && l.wordOpacity > 0.99;
};

// ============================================================ 1. the screen
{
  const { ctx, page } = await open({ store: SEEN_1_0 });
  await page.locator(".wn-stage.is-in").waitFor();
  check("an upgraded profile launches into What’s New", await dialog(page).isVisible());
  check("it is a modal dialog", (await dialog(page).getAttribute("aria-modal")) === "true");
  const labelled = await page.evaluate(() => {
    const d = document.querySelector(".wn");
    return document.getElementById(d.getAttribute("aria-labelledby"))?.textContent;
  });
  check("labelled by its title", labelled === "What’s New", String(labelled));
  check("focus lands on Continue", (await focused(page)) === "BUTTON:Continue", await focused(page));
  check("the eyebrow says the version", (await page.locator(".wn-eyebrow").textContent()) === "Version 1.2");
  check(
    "the sub line is the mockup’s",
    (await page.locator(".wn .onb-sub").textContent()) === "A Home of your own and live TV you can record, pause and rewind.",
  );
  const heads = await page.locator(".wn-head h2").allTextContents();
  check("two headliners: Home and Record Live TV", heads.join("|") === "Home|Record Live TV", heads.join("|"));
  const homeText = await page.locator(".wn-head p").first().textContent();
  check(
    "the Home card’s copy, curly quote and all",
    homeText ===
      "Click the logo for one page of everything in the order you set in Settings → Home: Continue Watching, your catalogs, starred channels, today’s games and recordings.",
    homeText,
  );
  const also = await page.locator(".wn-also li b").allTextContents();
  check(
    "Also New has the four items",
    also.join("|") === "Pop Out in VLC|Themes|Genres as Rows|Find Titles With Ctrl+K",
    also.join("|"),
  );
  check("the illustrations are hidden from a screen reader", await page.evaluate(() =>
    [...document.querySelectorAll(".wn svg")].length >= 6 &&
    [...document.querySelectorAll(".wn svg")].every((s) => s.closest("[aria-hidden=true]")),
  ));
  check("the lockup is hidden from a screen reader too", await page.evaluate(() => document.querySelector(".wn-lockup")?.getAttribute("aria-hidden") === "true"));
  const outline = await page.evaluate(() =>
    [...document.querySelectorAll(".wn h1, .wn h2, .wn h3")].map((h) => `${h.tagName}:${h.textContent}`).join("|"),
  );
  check("real headings: an h1, then an h2 each for Home, Record Live TV and Also New", outline === "H1:What’s New|H2:Home|H2:Record Live TV|H2:Also New", outline);
  const cover = await page.evaluate(() => {
    const r = document.querySelector(".wn").getBoundingClientRect();
    return { w: r.width >= innerWidth, h: r.height >= innerHeight, bg: getComputedStyle(document.querySelector(".wn")).backgroundColor };
  });
  check("it covers the window in true black", cover.w && cover.h && cover.bg === "rgb(0, 0, 0)", JSON.stringify(cover));
  check("the dither is onboarding’s own", (await page.locator(".wn .onb-dither").count()) === 1);
  check("the app shell is inert behind it", await page.$eval(".app-shell > .header", (el) => el.hasAttribute("inert")));
  check("and flagged as covered, so the screens stand down", await page.evaluate(() => document.documentElement.dataset.nativeHidden === "1"));
  const l = await lockup(page);
  check("the lockup is at the top and the page is below it", atTop(l) && l.h1top > l.tile.y + l.tile.h, JSON.stringify({ tile: l.tile, h1top: l.h1top }));
  check("the lockup is the app’s boot scene, not a copy", (await page.locator(".wn .boot-scene .boot-frame .boot-sheet").count()) === 1);
  const tag = await page.evaluate(() => getComputedStyle(document.querySelector(".wn")).colorScheme);
  check("dark whatever the theme", tag.includes("dark"), tag);

  // Continue stores the release and the app is there.
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  check("Continue closes it", await wnGone(page));
  check("and stores the release as seen", (await storedSeen(page)) === "1.2", String(await stored(page)));
  await goTo(page, "home");
  check("the app is behind it, no longer inert", !(await page.$eval(".app-shell > .header", (el) => el.hasAttribute("inert"))));
  check("and its clips are open again", await page.evaluate(() => document.documentElement.dataset.nativeHidden === undefined));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".navcap").waitFor({ timeout: 20_000 });
  await sleep(1200);
  check("a reload does not show it again", (await page.locator(".wn").count()) === 0);
  await ctx.close();
}

// ============================================================ 2. the changelog
{
  const { ctx, page } = await open({ store: SEEN_1_0 });
  await page.locator(".wn-stage.is-in").waitFor();
  await page.getByRole("button", { name: "See Full Changelog", exact: true }).click();
  await page.locator("#wn-log-title").waitFor();
  check("See Full Changelog shows the changelog", (await page.locator("#wn-log-title").textContent()) === "Changelog");
  check("the dialog is labelled by it now", (await page.locator(".wn").getAttribute("aria-labelledby")) === "wn-log-title");
  check("focus lands on Back", (await focused(page)) === "BUTTON:Back", await focused(page));
  const outline = await page.evaluate(() =>
    [...document.querySelectorAll(".wn h1, .wn h2, .wn h3")].map((h) => `${h.tagName}:${h.textContent}`),
  );
  check(
    "headings: h1, an h2 per release (newest first), an h3 per section",
    outline[0] === "H1:Changelog" &&
      outline[1] === "H2:1.2NewOctober 30, 2026" &&
      outline.includes("H3:Record Live TV") &&
      outline.indexOf("H2:1.0October 21, 2026") > outline.indexOf("H3:Also New") &&
      outline.at(-1) === "H3:Signed",
    outline.join("|"),
  );
  // 1.2 carries its date since release day (it had none before).
  check("the newest release is tagged New, and both releases carry their dates", (await page.locator(".wn-tag").count()) === 1 && (await page.locator(".wn-log h2 small").count()) === 2);
  check(
    "a bullet’s lead-in is bold, as structure",
    (await page.locator(".wn-log li b").first().textContent()) === "Click the logo for Home" &&
      (await page.locator(".wn-log li").first().textContent()).startsWith("Click the logo for Home: Continue Watching"),
  );
  check("1.0’s entry is there", (await page.locator(".wn-log").textContent()).includes("The installer and the app are code-signed so Windows names the publisher."));
  check("no BlammyTV eyebrow over the changelog", (await page.locator(".wn-eyebrow").count()) === 0);
  const l = await lockup(page);
  check("the lockup stays at the top", atTop(l), JSON.stringify(l.tile));
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.locator("#wn-title").waitFor();
  check("Back returns to What’s New, focus on Continue", (await focused(page)) === "BUTTON:Continue", await focused(page));
  check("and stores nothing", (await stored(page)) === JSON.stringify({ v: 1, data: "1.0" }));
  await page.getByRole("button", { name: "See Full Changelog", exact: true }).click();
  await page.locator("#wn-log-title").waitFor();
  await page.keyboard.press("Escape");
  check("Escape on the changelog closes the whole screen", await wnGone(page));
  check("and stores the release", (await storedSeen(page)) === "1.2");
  await ctx.close();
}
{
  const { ctx, page } = await open({ store: SEEN_1_0 });
  await page.locator(".wn-stage.is-in").waitFor();
  await page.keyboard.press("Escape");
  check("Escape closes What’s New", await wnGone(page));
  check("and stores the release", (await storedSeen(page)) === "1.2");
  await ctx.close();
}

// ============================================================ 3. the rule
{
  // A first run: onboarding, never What's New; finishing stamps the release.
  const { ctx, page } = await open({ onboarded: false, wait: false });
  await page.locator(".onb").first().waitFor({ timeout: 20_000 });
  await sleep(1200);
  check("a fresh profile gets onboarding", (await page.locator(".onb:not(.wn)").count()) === 1);
  check("and no What’s New over it or beside it", (await page.locator(".wn").count()) === 0 && (await dialog(page).count()) === 0);
  check("nothing stored while setup is still running", (await stored(page)) === null);
  await page.getByRole("button", { name: "Skip Setup", exact: true }).click();
  check("finishing onboarding stamps the release as seen", (await storedSeen(page)) === "1.2", String(await stored(page)));
  await page.locator(".onb").waitFor({ state: "detached", timeout: 15_000 });
  check("and What’s New does not follow it", (await page.locator(".wn").count()) === 0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".navcap").waitFor({ timeout: 20_000 });
  await sleep(1200);
  check("nor on the next launch", (await page.locator(".wn").count()) === 0 && (await page.locator(".onb").count()) === 0);
  await ctx.close();
}
{
  // A dev build below the release. It used the real version.ts while that
  // read 1.0.x; at 1.2.0 the real one is the release, so a 1.0.x is served.
  const { ctx, page } = await open({ version: "1.0.49", wait: false, store: SEEN_1_0 });
  await page.locator(".navcap").waitFor({ timeout: 20_000 });
  await sleep(1500);
  check("a 1.0.x build does not show 1.2’s screen", (await page.locator(".wn").count()) === 0);
  check("and stores nothing", (await storedSeen(page)) === "1.0");
  await ctx.close();
}

// ============================================================ 4. the boot
{
  const { ctx, page } = await open({ store: SEEN_1_0, played: false, wait: false });
  await page.locator(".wn").waitFor({ timeout: 20_000 });
  check("the boot plays instead of the cold-boot overlay", (await page.locator(".boot-overlay").count()) === 0);
  check("the page waits for it: no Continue yet", await page.evaluate(() => getComputedStyle(document.querySelector(".wn-stage")).display === "none"));
  check("with a Skip button over it", (await page.getByRole("button", { name: "Skip", exact: true }).count()) === 1);
  check("and the app’s own scene is the one running", (await page.locator(".wn .boot-scene:not(.is-settled)").count()) === 1);
  await page.locator(".wn .boot-scene.is-shrink").waitFor({ timeout: 8000 });
  check("the frame shrinks and springs", true);
  // The beat: the wordmark is in, the lockup has not risen.
  await page.waitForFunction(
    () => Number(getComputedStyle(document.querySelector(".wn .boot-wordmark")).opacity) > 0.99 && !document.querySelector(".wn-lockup.is-risen"),
    null,
    { timeout: 8000, polling: 40 },
  );
  const mid = await lockup(page);
  check(
    "the lockup rests mid-screen first, tile left of the middle",
    near(mid.tile.cy, mid.vh / 2, 2.5) && near(mid.tile.w, 76 * mid.s, 2.5) && mid.tile.x + mid.tile.w / 2 < mid.vw / 2,
    JSON.stringify(mid.tile),
  );
  await page.locator(".wn-lockup.is-risen").waitFor({ timeout: 8000 });
  // The rise is a 900ms transition on the wall clock; a busy box takes longer
  // to draw it, so wait for the tile to arrive rather than for a time.
  await page
    .waitForFunction(
      () => {
        const y = document.querySelector(".wn .boot-frame").getBoundingClientRect().y;
        const was = window.__tileY;
        window.__tileY = y;
        return was !== undefined && was === y && y < 100;
      },
      null,
      { timeout: 15_000, polling: 150 },
    )
    .catch(() => {});
  const top = await lockup(page);
  check("then rises to the top and shrinks to .62", atTop(top), JSON.stringify({ tile: top.tile, s: top.s }));
  check("with What’s New’s content below it", top.h1top > top.tile.y + top.tile.h && (await page.locator(".wn-stage.is-in").count()) === 1);
  check("focus on Continue, and no Skip button left", (await focused(page)) === "BUTTON:Continue" && (await page.getByRole("button", { name: "Skip", exact: true }).count()) === 0, await focused(page));
  check("the boot counted as this session’s welcome", await page.evaluate(() => sessionStorage.getItem("btv:welcome-played") === "1"));
  // It scrolls away with the page: not sticky.
  await ctx.close();
}
for (const [how, act] of [
  ["Space", (p) => p.keyboard.press(" ")],
  ["Escape", (p) => p.keyboard.press("Escape")],
  ["a click", (p) => p.mouse.click(400, 300)],
]) {
  const { ctx, page } = await open({ store: SEEN_1_0, played: false, wait: false });
  await page.locator(".wn").waitFor({ timeout: 20_000 });
  await sleep(1500);
  const before = await page.locator(".wn-stage.is-booting").count();
  await act(page);
  await sleep(80);
  const l = await lockup(page);
  check(`${how} skips: the page is up at once, the lockup already at the top`, before === 1 && atTop(l) && (await page.locator(".wn-stage.is-in").count()) === 1, JSON.stringify(l.tile));
  await sleep(1300);
  const l2 = await lockup(page);
  check(`${how} skips with no animation: the lockup has not moved since`, near(l.tile.y, l2.tile.y, 0.5) && near(l.word.x, l2.word.x, 0.5));
  check(`${how} only skips: it is still open, nothing stored, focus on Continue`, (await dialog(page).count()) === 1 && (await stored(page)) === JSON.stringify({ v: 1, data: "1.0" }) && (await focused(page)) === "BUTTON:Continue", await focused(page));
  check(`${how} lands on the settled scene`, (await page.locator(".wn .boot-scene.is-settled").count()) === 1);
  await ctx.close();
}
{
  // An ordinary launch's boot, with nothing new to say.
  const { ctx, page } = await open({ store: { whatsNewSeen: { v: 1, data: "1.2" } }, played: false, wait: false });
  await page.locator(".boot-overlay").waitFor({ timeout: 10_000 });
  check("an ordinary launch plays the cold-boot overlay as it always did", (await page.locator(".boot-overlay .boot-scene:not(.is-settled)").count()) === 1);
  await sleep(1500);
  check("and no What’s New", (await page.locator(".wn").count()) === 0);
  await page.locator(".boot-overlay").waitFor({ state: "detached", timeout: 25_000 });
  check("the overlay leaves and the app is there", (await page.locator(".navcap").count()) === 1 && (await page.locator(".wn").count()) === 0);
  await ctx.close();
}

// ============================================================ 5. on demand
async function openSettingsApp(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.locator(".settings__body").waitFor({ timeout: 8000 });
  await page.getByRole("tablist", { name: "Settings", exact: true }).getByRole("tab", { name: "App", exact: true }).click();
  await page.locator('[data-setting="whats-new"]').waitFor({ timeout: 8000 });
  await sleep(300);
}
const onRowButton = (page) =>
  page.waitForFunction(() => {
    const a = document.activeElement;
    return a?.tagName === "BUTTON" && !!a.closest('[data-setting="whats-new"]');
  }, null, { timeout: 5000 }).then(() => true, () => false);
{
  const { ctx, page } = await open({ store: { whatsNewSeen: { v: 1, data: "1.2" } }, wait: false });
  await page.locator(".navcap").waitFor({ timeout: 20_000 });
  await goTo(page, "home");
  check("nothing shows by itself once it has been seen", (await page.locator(".wn").count()) === 0);
  await openSettingsApp(page);
  const row = page.locator('[data-setting="whats-new"]');
  check("Settings → App has a What’s New row with an Open button", (await row.locator(".customize-row__title").textContent()) === "What’s New" && (await row.getByRole("button", { name: "Open", exact: true }).count()) === 1);
  const order = await page.locator(".settings__body .customize-row__title, .settings__body .settings__group").allTextContents();
  // No update row in a plain browser (there is no native side to ask), so the
  // row is the first after the group heading; with one it follows it.
  const at = order.indexOf("What’s New");
  check("it sits at the top of the page with Updates, before Keyboard Shortcuts", at >= 1 && at <= 2 && order[at + 1] === "Keyboard Shortcuts" && (at === 1 || order[1].startsWith("BlammyTV v")), order.slice(0, 5).join("|"));
  await row.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator(".wn").waitFor({ timeout: 5000 });
  const settingsClosed = await page.locator(".settings").waitFor({ state: "detached", timeout: 5000 }).then(() => true, () => false);
  check("it opens over the app and Settings steps out of the way", settingsClosed && (await dialog(page).isVisible()));
  const l = await lockup(page);
  check("on the finished page at once: lockup at the top, no boot, no Skip", atTop(l) && (await page.locator(".wn .boot-scene.is-settled").count()) === 1 && (await page.getByRole("button", { name: "Skip", exact: true }).count()) === 0, JSON.stringify(l.tile));
  check("focus on Continue", (await focused(page)) === "BUTTON:Continue", await focused(page));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator(".settings__body").waitFor({ timeout: 8000 });
  check("Continue returns to Settings, on the App page", (await page.locator(".wn").count()) === 0 && (await page.locator('[data-setting="whats-new"]').count()) === 1);
  check("with focus on the button that opened it", await onRowButton(page), await focused(page));
  // And Escape does the same.
  await page.keyboard.press("Tab");
  await page.locator('[data-setting="whats-new"]').getByRole("button", { name: "Open", exact: true }).click();
  await page.locator(".wn").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".settings__body").waitFor({ timeout: 8000 });
  check("Escape returns to Settings with focus on the button too", await onRowButton(page), await focused(page));
  check("it stored the release as seen, as it already was", (await storedSeen(page)) === "1.2");
  await ctx.close();
}
{
  // Ctrl+K finds it.
  const { ctx, page } = await open({ store: { whatsNewSeen: { v: 1, data: "1.2" } }, wait: false });
  await page.locator(".navcap").waitFor({ timeout: 20_000 });
  await goTo(page, "home");
  for (const q of ["what's new", "changelog", "release notes", "what"]) {
    await page.keyboard.press("Control+k");
    await page.locator(".palette").waitFor({ timeout: 4000 });
    await page.keyboard.type(q);
    await sleep(300);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".palette .mvpick__group")]
        .filter((g) => g.querySelector(".mvpick__sec")?.textContent === "Settings")
        .flatMap((g) => [...g.querySelectorAll(".mvpick__row .mvpick__nametext")].map((r) => r.textContent)),
    );
    check(`Ctrl+K finds What’s New by “${q}”`, rows.includes("What’s New"), rows.join("|"));
    await page.keyboard.press("Escape");
    await page.locator(".palette").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    await sleep(200);
  }
  await page.keyboard.press("Control+k");
  await page.locator(".palette").waitFor({ timeout: 4000 });
  await page.keyboard.type("changelog");
  await sleep(300);
  await page.keyboard.press("Enter");
  await page.locator(".settings__body").waitFor({ timeout: 8000 });
  check("picking it lands Settings on the App page, on the row", await onRowButton(page), await focused(page));
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator(".wn").waitFor();
  await page.keyboard.press("Control+k");
  await sleep(300);
  check("Ctrl+K does nothing over What’s New", (await page.locator(".palette").count()) === 0);
  await ctx.close();
}

// ============================================================ 6. nothing plays under it
{
  const PLAYLIST = { v: 1, data: [{ kind: "xtream", id: "t", name: "Test", enabled: true, server: "http://localhost:8081", username: "u", password: "p" }] };
  const { ctx, page } = await open({
    store: { ...SEEN_1_0, playlists: PLAYLIST, startupTab: { v: 1, data: "live" } },
    tauri: true,
    wait: false,
  });
  await page.locator(".wn").waitFor({ timeout: 20_000 });
  await page.locator(".guide__channel button").first().waitFor({ state: "attached", timeout: 30_000 });
  await page.locator(".wn-stage.is-in").waitFor();
  const calls = () => page.evaluate(() => window.__tauriCalls.filter((c) => c === "inv_open"));
  check("Start On Live TV: the Guide is loaded under it and nothing has played", (await calls()).length === 0);
  const at = await page.evaluate(() => {
    const r = document.querySelector(".guide__channel button").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(at.x, at.y);
  await sleep(500);
  check("a click where a channel is lands on the screen, not the channel", (await calls()).length === 0 && (await dialog(page).count()) === 1);
  // The keyboard cannot walk into the Guide either: focus never leaves.
  let escaped = 0;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => !!document.activeElement?.closest(".app-shell"))) escaped++;
  }
  check("40 Tabs never reach the app behind it", escaped === 0, `${escaped} escaped`);
  check("and still nothing has played", (await calls()).length === 0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await wnGone(page);
  await sleep(300);
  await page.mouse.click(at.x, at.y);
  const played = await page
    .waitForFunction(() => window.__tauriCalls.includes("inv_open"), null, { timeout: 5000 })
    .then(() => true, () => false);
  check("the same click plays once Continue has been pressed (so the checks above could have failed)", played);
  await ctx.close();
}

// ============================================================ 7. reduced motion, theme, a short window
{
  const { ctx, page } = await open({ store: SEEN_1_0, played: false, reducedMotion: "reduce" });
  const l = await lockup(page);
  check("reduced motion: no boot, the finished page at once", atTop(l) && (await page.locator(".wn-stage.is-in").count()) === 1 && (await page.locator(".boot-overlay").count()) === 0, JSON.stringify(l.tile));
  const anim = await page.evaluate(() => [...document.querySelectorAll(".wn-stage > *")].map((el) => getComputedStyle(el).animationName));
  check("no entrance animation", anim.length > 0 && anim.every((a) => a === "none"), anim.join(","));
  check("and no trailing light", (await page.locator(".wn .onb-cursor-glow").count()) === 0);
  await ctx.close();
}
{
  const { ctx, page } = await open({ store: { ...SEEN_1_0, theme: { v: 1, data: "light" } }, colorScheme: "light" });
  await page.locator(".wn-stage.is-in").waitFor();
  const c = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".wn button")].find((x) => x.textContent === "Continue");
    return { shell: document.documentElement.dataset.theme, bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color, page: getComputedStyle(document.querySelector(".wn")).backgroundColor, h1: getComputedStyle(document.querySelector(".wn h1")).color };
  });
  check("light theme: it is dark all the same", c.shell === "light" && c.page === "rgb(0, 0, 0)" && c.h1 === "rgb(255, 255, 255)" && c.bg === "rgb(255, 255, 255)" && c.color === "rgb(0, 0, 0)", JSON.stringify(c));
  await ctx.close();
}
{
  const { ctx, page } = await open({ store: SEEN_1_0, width: 1200, height: 420 });
  await page.locator(".wn-stage.is-in").waitFor();
  await sleep(800);
  const m = await page.evaluate(() => {
    const w = document.querySelector(".wn");
    return { scroll: w.scrollHeight, client: w.clientHeight, overflowY: getComputedStyle(w).overflowY };
  });
  check("a short window scrolls the page", m.scroll > m.client + 100 && m.overflowY === "auto", JSON.stringify(m));
  await page.mouse.move(600, 200);
  await page.mouse.wheel(0, 4000);
  await sleep(500);
  const after = await page.evaluate(() => {
    const w = document.querySelector(".wn");
    const b = [...w.querySelectorAll("button")].find((x) => x.textContent === "See Full Changelog").getBoundingClientRect();
    const t = document.querySelector(".wn .boot-frame").getBoundingClientRect();
    return { top: w.scrollTop, buttonBottom: b.bottom, vh: innerHeight, tileBottom: t.bottom };
  });
  check("the buttons come into reach at the bottom", after.top > 0 && after.buttonBottom <= after.vh + 1, JSON.stringify(after));
  check("and the lockup has scrolled away with the page", after.tileBottom < 0, JSON.stringify(after));
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
process.exit(fail ? 1 : 0);

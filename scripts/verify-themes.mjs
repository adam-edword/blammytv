// E2E: theme-pack engine via the standalone Themes panel (v0.6.0 rework).
// Themes popped out of the Customize → Theme sub-tab into their own modal
// (ThemesModal), launched from a rail button that CLOSES Settings. Covers:
// the launcher (opens Themes, closes Settings), the Free pack cards
// (classic/void/slate/paper), persistence (data-theme-pack +
// "blammytv.themePack"), survival across reload, an out-of-band "payload"
// pack applying by dataset attr alone, and the dark-only-pack vs light-theme
// interaction (the Light toggle now lives in Customize → Display).
//
// Run: build the app, then from apps/app: `pnpm preview --port 4173`.
//   PW_FROM=<dir-containing-playwright-core>/x.js node scripts/verify-themes.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); };

const URL = "http://localhost:4173/";

const newPage = async (init = {}, opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ...opts });
  const page = await ctx.newPage();
  await page.addInitScript((seed) => {
    sessionStorage.setItem("btv:welcome-played", "1");
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, { "btv:onboarded": "1", ...init });
  return page;
};

const openSettings = async (page) => {
  await page.goto(URL);
  await page.waitForSelector(".header", { timeout: 8000 });
  await page.locator("button[aria-label='Settings']").click();
  await page.waitForSelector(".settings", { timeout: 8000 });
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.waitForSelector(".customize-rail", { timeout: 8000 });
};
// Settings -> Customize -> Themes launcher (closes Settings, opens Themes).
const openThemes = async (page) => {
  await openSettings(page);
  await page.locator(".themes-launch").click();
  await page.waitForSelector(".themes-modal", { timeout: 8000 });
};
const card = (page, id) => page.locator(`.tcard[data-pack="${id}"]`);
const isActive = (page, id) => card(page, id).evaluate((el) => el.classList.contains("tcard--active"));
// The sun/moon pill in the Themes panel (light/dark moved there in v0.6.0).
const sunSeg = (page) => page.locator('.theme-pill [aria-label="Light mode"]');
const sunOff = (page) => sunSeg(page).evaluate((el) => el.classList.contains("theme-pill__seg--off"));
const pickAndWait = async (page, id) => {
  await card(page, id).click();
  await page.waitForFunction((x) => document.documentElement.dataset.themePack === x, id, { timeout: 5000 }).catch(() => null);
};
const readState = (page) => page.evaluate(() => ({
  pack: document.documentElement.dataset.themePack ?? null,
  theme: document.documentElement.dataset.theme ?? null,
  surface: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
  bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
  storedPack: JSON.parse(localStorage.getItem("blammytv.themePack") ?? "null"),
}));

// 1: launcher opens Themes and closes Settings; Free cards; classic active.
{
  const page = await newPage();
  await openSettings(page);
  check("the Themes launcher is present in Customize",
    (await page.locator(".themes-launch").count()) === 1);

  await page.locator(".themes-launch").click();
  await page.waitForSelector(".themes-modal", { timeout: 8000 });
  const themesUp = (await page.locator(".settings.themes-modal").count()) === 1;
  const settingsGone = await page.evaluate(() => !document.querySelector(".settings:not(.themes-modal)"));
  check("clicking it opens the Themes panel AND closes Settings", themesUp && settingsGone);

  const freeIds = await page.locator(".themes-shelf__row").first().locator(".tcard").evaluateAll((els) => els.map((e) => e.getAttribute("data-pack")).sort());
  check("the Free shelf shows slate/classic/void/paper/nebula",
    ["slate", "classic", "void", "paper", "nebula"].every((id) => freeIds.includes(id)), JSON.stringify(freeIds));
  check("BlammyTV (slate) is the active card by default", await isActive(page, "slate"));
  await page.close();
}

// 2: picking void — dataset, token, persist, active-card move, reload, reopen.
{
  const page = await newPage();
  await openThemes(page);
  const before = await readState(page);
  await pickAndWait(page, "void");
  const after = await readState(page);
  check("picking void sets dataset.themePack", after.pack === "void", String(after.pack));
  check("picking void changes --surface vs classic",
    after.surface !== "" && after.surface !== before.surface, `${before.surface} -> ${after.surface}`);
  check("picking void persists {v:1,data:void}",
    JSON.stringify(after.storedPack) === JSON.stringify({ v: 1, data: "void" }), JSON.stringify(after.storedPack));
  check("active-card class moved to void (off classic)",
    (await isActive(page, "void")) && !(await isActive(page, "classic")));

  await page.reload();
  await page.waitForSelector(".header", { timeout: 8000 });
  const reloaded = await page.evaluate(() => document.documentElement.dataset.themePack ?? null);
  check("themePack survives reload (applied at first paint)", reloaded === "void", String(reloaded));

  await openThemes(page);
  check("re-opening Themes shows void active", await isActive(page, "void"));
  await page.close();
}

// 3: the Theme Style pill (in the Themes panel) — the default BlammyTV/slate
// is dark-only (sun disabled); classic enables it; a dark-only pick while
// light is on forces data-theme back to dark.
{
  const page = await newPage();
  await openThemes(page);
  check("sun is DISABLED on the dark-only default (BlammyTV)", await sunOff(page));
  await card(page, "classic").click();
  await page.waitForFunction(() => !document.documentElement.dataset.themePack, null, { timeout: 5000 }).catch(() => null);
  check("picking classic enables the sun", !(await sunOff(page)));
  await sunSeg(page).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light", null, { timeout: 5000 }).catch(() => null);
  check("sun flips data-theme to light",
    (await page.evaluate(() => document.documentElement.dataset.theme)) === "light");
  await pickAndWait(page, "void");
  const st = await readState(page);
  check("picking dark-only void while light is on forces data-theme back to dark",
    st.pack === "void" && st.theme !== "light", JSON.stringify(st));
  await page.close();
}

// 4: paper's light variant is a real, distinct token set.
{
  const page = await newPage();
  await openThemes(page);
  const classicDark = await readState(page);
  await pickAndWait(page, "paper");
  const paperDark = await readState(page);
  check("paper (dark) --bg differs from classic's --bg",
    paperDark.bg !== "" && paperDark.bg !== classicDark.bg, `${classicDark.bg} vs ${paperDark.bg}`);
  // Flip to light with the sun pill (paper stays the committed pack).
  await sunSeg(page).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light", null, { timeout: 5000 }).catch(() => null);
  const paperLight = await readState(page);
  check("paper + light: data-theme=light and themePack=paper both stick",
    paperLight.theme === "light" && paperLight.pack === "paper", JSON.stringify(paperLight));
  check("paper's light --bg differs from paper's own dark --bg",
    paperLight.bg !== "" && paperLight.bg !== paperDark.bg, `${paperDark.bg} -> ${paperLight.bg}`);
  await page.close();
}

// 5: synthetic payload — an unknown pack id applies purely by dataset attr +
// a scoped style block (injectPackCss's contract, proven from the outside).
{
  const page = await newPage();
  await page.goto(URL);
  await page.waitForSelector(".header", { timeout: 8000 });
  const surface = await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = ':root[data-theme-pack="testpack"]{--surface:#123456}';
    document.head.appendChild(style);
    document.documentElement.dataset.themePack = "testpack";
    return getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
  });
  check("synthetic payload pack applies via dataset attr + scoped CSS", surface === "#123456", surface);
  await page.close();
}

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);

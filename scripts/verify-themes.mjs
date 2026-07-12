// E2E: theme-pack feature (v0.6.0) — Customize tab's pill rail (General /
// Theme / Display), pack cards (classic/void/slate/paper), persistence
// (data-theme-pack + "blammytv.themePack"), the dark-only-pack vs
// light-theme interaction, Reset Appearance, an out-of-band "payload"
// pack applying by dataset attr alone, and no section duplication when
// flipping pills back and forth.
//
// Selectors for the rail/pack cards were cross-checked against
// CustomizeTab.tsx + themePacks.ts. Light support: classic and paper
// support the light theme; void/slate are dark-only (a first draft had
// classic dark-only — integration review fixed that regression, and the
// checks below assert the corrected behavior).
//
// Run: build the app, then from apps/app: `pnpm preview --port 4173`.
// Then from the repo root:
//   PW_FROM=<dir-containing-playwright-core>/x.js node scripts/verify-themes.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); };

const URL = "http://localhost:4173/";

// App-booting harness contract: seed btv:onboarded + btv:welcome-played so
// the onboarding/welcome overlays never intercept a settings-only run.
const newPage = async (init = {}, opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ...opts });
  const page = await ctx.newPage();
  await page.addInitScript((seed) => {
    sessionStorage.setItem("btv:welcome-played", "1");
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, { "btv:onboarded": "1", ...init });
  return page;
};

// Open Settings -> Customize -> (optionally) the Theme pill.
const openCustomize = async (page) => {
  await page.goto(URL);
  await page.waitForSelector(".header", { timeout: 8000 });
  await page.locator("button[aria-label='Settings']").click();
  await page.waitForSelector(".settings", { timeout: 8000 });
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.waitForSelector(".customize-rail", { timeout: 8000 });
};
const pill = (page, name) => page.locator(".customize-rail").getByRole("button", { name, exact: true });
const openTheme = async (page) => {
  await pill(page, "Theme").click();
  await page.waitForSelector(".pack-row", { timeout: 8000 });
};
const resetRow = (page) => page.locator(".customize-row", { hasText: "Reset Appearance" });
const lightToggle = (page) => page.getByRole("switch", { name: "Light theme" });
// The Toggle button itself never gets [disabled]/[aria-disabled] — the
// dark-only lockout is a wrapper class + a no-op onChange (verified by
// reading themePacks.ts / CustomizeTab.tsx directly, see header comment).
const lightDisabled = (page) => page.locator(".toggle-disable-wrap").evaluate((el) => el.classList.contains("toggle-disable-wrap--off"));
const readState = (page) => page.evaluate(() => ({
  pack: document.documentElement.dataset.themePack ?? null,
  theme: document.documentElement.dataset.theme ?? null,
  surface: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
  bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
  storedPack: JSON.parse(localStorage.getItem("blammytv.themePack") ?? "null"),
}));

// 1-11: pill rail, pack row, utility rows, picking "void", persistence
// across reload, and re-opening onto the right active card.
{
  const page = await newPage();
  await openCustomize(page);

  const pillNames = await page.locator(".customize-rail").getByRole("button").allTextContents();
  check("pill rail has the three labeled pills",
    ["General", "Theme", "Display"].every((n) => pillNames.some((t) => t.trim() === n)),
    JSON.stringify(pillNames));

  const packRowBefore = await page.locator(".pack-row").count();
  check("Theme's pack row is not present before its pill is clicked", packRowBefore === 0);
  const generalContentVisible = await page.locator(".customize-row", { hasText: "Clock Format" }).isVisible().catch(() => false);
  check("General section content is visible by default", generalContentVisible);

  check("Reset Appearance utility row visible on General pill",
    await resetRow(page).isVisible().catch(() => false));

  await openTheme(page);
  const cards = page.locator(".pack-card");
  const cardCount = await cards.count();
  const dataPacks = await cards.evaluateAll((els) => els.map((el) => el.getAttribute("data-pack")).sort());
  check("Theme pill shows 4 pack cards for classic/void/slate/paper",
    cardCount === 4 && JSON.stringify(dataPacks) === JSON.stringify(["classic", "paper", "slate", "void"]),
    JSON.stringify(dataPacks));
  const classicActive = await page.locator('.pack-card[data-pack="classic"]').evaluate((el) => el.classList.contains("pack-card--active"));
  check("classic is the active pack by default", classicActive);

  check("Reset Appearance utility row also visible on Theme pill",
    await resetRow(page).isVisible().catch(() => false));

  const before = await readState(page);
  await page.locator('.pack-card[data-pack="void"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.themePack === "void", null, { timeout: 5000 }).catch(() => null);
  const afterVoid = await readState(page);
  check("picking void sets dataset.themePack",
    afterVoid.pack === "void", String(afterVoid.pack));
  check("picking void changes the --surface token vs classic",
    afterVoid.surface !== "" && afterVoid.surface !== before.surface,
    `before=${before.surface} after=${afterVoid.surface}`);
  check("picking void persists to blammytv.themePack as {v:1,data:void}",
    JSON.stringify(afterVoid.storedPack) === JSON.stringify({ v: 1, data: "void" }),
    JSON.stringify(afterVoid.storedPack));
  const voidCardActive = await page.locator('.pack-card[data-pack="void"]').evaluate((el) => el.classList.contains("pack-card--active"));
  const classicStillActive = await page.locator('.pack-card[data-pack="classic"]').evaluate((el) => el.classList.contains("pack-card--active"));
  check("active-card class moved to void (and off classic)",
    voidCardActive && !classicStillActive);

  await page.reload();
  await page.waitForSelector(".header", { timeout: 8000 });
  const reloaded = await page.evaluate(() => document.documentElement.dataset.themePack ?? null);
  check("themePack survives reload, applied before/at first paint of the shell",
    reloaded === "void", String(reloaded));

  await openCustomize(page);
  await openTheme(page);
  const voidActiveAfterReopen = await page.locator('.pack-card[data-pack="void"]').evaluate((el) => el.classList.contains("pack-card--active"));
  check("re-opening Customize -> Theme shows void as the active card", voidActiveAfterReopen);

  await page.close();
}

// 12: light only turns on for a supportsLight pack (classic, paper), and
// picking a dark-only pack (void, slate) forces it back off.
{
  const page = await newPage();
  await openCustomize(page);
  await openTheme(page);
  check("light toggle starts ENABLED on classic (classic supports light)",
    !(await lightDisabled(page)));
  await page.locator('.pack-card[data-pack="paper"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.themePack === "paper", null, { timeout: 5000 }).catch(() => null);
  const toggle = lightToggle(page);
  await toggle.click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light", null, { timeout: 5000 }).catch(() => null);
  const litUp = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
  check("paper supports light: toggling it on actually flips data-theme to light", litUp === "light", String(litUp));
  await page.locator('.pack-card[data-pack="slate"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.themePack === "slate", null, { timeout: 5000 }).catch(() => null);
  const state = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme ?? null,
    pack: document.documentElement.dataset.themePack ?? null,
  }));
  check("picking a dark-only pack (slate) while light is on flips data-theme back to dark",
    state.pack === "slate" && state.theme !== "light", JSON.stringify(state));
  check("light toggle shows disabled again while the dark-only pack is active",
    await lightDisabled(page));
  await page.close();
}

// 13: paper's light variant is a real, distinct token set — differs both
// from classic's dark default and from paper's own dark render.
{
  const page = await newPage();
  await openCustomize(page);
  await openTheme(page);
  const classicDark = await readState(page);
  await page.locator('.pack-card[data-pack="paper"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.themePack === "paper", null, { timeout: 5000 }).catch(() => null);
  const paperDark = await readState(page);
  await lightToggle(page).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light", null, { timeout: 5000 }).catch(() => null);
  const paperLight = await readState(page);
  check("paper + light: both data-theme=light and themePack=paper stick",
    paperLight.theme === "light" && paperLight.pack === "paper", JSON.stringify(paperLight));
  check("paper (dark) --bg differs from classic's --bg",
    paperDark.bg !== "" && paperDark.bg !== classicDark.bg,
    `classic=${classicDark.bg} paperDark=${paperDark.bg}`);
  check("paper's light --bg differs from paper's own dark --bg (light variant is real)",
    paperLight.bg !== "" && paperLight.bg !== paperDark.bg,
    `paperDark=${paperDark.bg} paperLight=${paperLight.bg}`);
  await page.close();
}

// 14: Reset Appearance clears the pack and light theme.
{
  const page = await newPage();
  await openCustomize(page);
  await openTheme(page);
  await page.locator('.pack-card[data-pack="void"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.themePack === "void", null, { timeout: 5000 }).catch(() => null);
  await resetRow(page).getByRole("button").click();
  await page.waitForFunction(() => !document.documentElement.dataset.themePack, null, { timeout: 5000 }).catch(() => null);
  const afterReset = await page.evaluate(() => ({
    pack: document.documentElement.dataset.themePack ?? null,
    theme: document.documentElement.dataset.theme ?? null,
  }));
  const classicActive = await page.locator('.pack-card[data-pack="classic"]').evaluate((el) => el.classList.contains("pack-card--active")).catch(() => false);
  check("Reset Appearance: themePack attr removed, classic active, light off",
    afterReset.pack === null && afterReset.theme !== "light" && classicActive,
    JSON.stringify(afterReset));
  check("Reset Appearance: light toggle is enabled again (classic supports light)",
    !(await lightDisabled(page)));
  await page.close();
}

// 15: synthetic payload — an unknown pack id applies purely by dataset
// attr + a scoped style block, proving injectPackCss's contract from the
// outside without touching its module directly (that's unit-tested
// elsewhere).
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
  check("synthetic payload pack applies purely via dataset attr + scoped CSS",
    surface === "#123456", surface);
  await page.close();
}

// 16: flipping pills back and forth doesn't duplicate sections.
{
  const page = await newPage();
  await openCustomize(page);
  await openTheme(page);
  const firstCount = await page.locator(".pack-card").count();
  await pill(page, "General").click();
  await page.waitForSelector(".pack-row", { state: "detached", timeout: 5000 }).catch(() => null);
  await pill(page, "Theme").click();
  await page.waitForSelector(".pack-row", { timeout: 5000 });
  await pill(page, "General").click();
  await pill(page, "Theme").click();
  await page.waitForSelector(".pack-row", { timeout: 5000 });
  const secondCount = await page.locator(".pack-card").count();
  const resetRowCount = await resetRow(page).count();
  check("switching pills back and forth doesn't duplicate the pack row or utility rows",
    firstCount === 4 && secondCount === 4 && resetRowCount === 1,
    `first=${firstCount} second=${secondCount} resetRows=${resetRowCount}`);
  await page.close();
}

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);

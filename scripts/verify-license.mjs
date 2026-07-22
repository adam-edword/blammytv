// E2E: paid-theme license flow (v0.6.0 rework) — the Themes panel's license
// row (key input + Activate), the keybox /validate round trip, ownership
// gating (a premium card's price link disappears once owned), commit +
// fail-open persistence, error copy for unknown/activation-limit/malformed
// keys, and Remove license tearing it back down.
//
// The license input moved out of the old Customize -> Theme "Premium Themes"
// row into the standalone Themes panel (.themes-license), launched from the
// Customize rail's Themes button (which closes Settings). Intense CSS is
// BUNDLED, so the license only gates whether picking a premium pack COMMITS.
//
// Run:
//   1. build the app, then from apps/app: `pnpm preview --port 4173`
//   2. `node scripts/fake-keybox.mjs &`                  (keybox on :8085)
//   3. PW_FROM=<dir-containing-playwright-core>/x.js node scripts/verify-license.mjs
import { createRequire } from "node:module";
const req = createRequire(process.env.PW_FROM ?? import.meta.url);
const { chromium } = req("playwright-core");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); };

const URL = "http://localhost:4173/";
const KEYBOX_URL = "http://localhost:8085";
const DEAD_KEYBOX_URL = "http://localhost:8086";

const PASS_KEY = "BTV-TEST-PASS-0000-0000";
const SOLO_KEY = "BTV-TEST-SOLO-0000-0000";
const FULL_KEY = "BTV-TEST-FULL-0000-0000";
const UNKNOWN_KEY = "BTV-TEST-NOPE-0000-0000";

// terminal's BUNDLED --surface (intense-packs.css) — proves it renders from
// the bundle, not a payload. (nebula went free in v0.6.0; terminal is the
// reference premium now.)
const TERMINAL_SURFACE = "#04140a";

const newPage = async (init = {}, opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ...opts });
  const page = await ctx.newPage();
  await page.addInitScript((seed) => {
    sessionStorage.setItem("btv:welcome-played", "1");
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, { "btv:onboarded": "1", "blammytv.keyboxUrl": KEYBOX_URL, ...init });
  return page;
};

// Settings -> Customize -> Themes launcher (closes Settings, opens Themes).
const openThemes = async (page) => {
  await page.goto(URL);
  await page.waitForSelector(".header", { timeout: 8000 });
  await page.locator("button[aria-label='Settings']").click();
  await page.waitForSelector(".settings", { timeout: 8000 });
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.locator(".themes-launch").click();
  await page.waitForSelector(".themes-modal", { timeout: 8000 });
};

const licenseRow = (page) => page.locator(".themes-license");
const keyInput = (page) => licenseRow(page).getByPlaceholder("BTV-XXXX-XXXX-XXXX-XXXX");
const activateBtn = (page) => licenseRow(page).getByRole("button", { name: "Activate", exact: true });
const removeBtn = (page) => licenseRow(page).getByRole("button", { name: "Remove license" });
const terminalLock = (page) => page.locator('.tcard[data-pack="terminal"] .tcard__price');

const activate = async (page, key) => {
  await keyInput(page).fill(key);
  await activateBtn(page).click();
};

const readState = (page) => page.evaluate(() => ({
  pack: document.documentElement.dataset.themePack ?? null,
  surface: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
  storedPack: JSON.parse(localStorage.getItem("blammytv.themePack") ?? "null"),
}));

const waitForRowText = async (page, substring, timeoutMs = 5000) => {
  const start = Date.now();
  let text = "";
  while (Date.now() - start < timeoutMs) {
    text = (await licenseRow(page).innerText().catch(() => "")).toLowerCase();
    if (text.includes(substring)) return text;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return text;
};

// 1-6: terminal present-but-locked; activating PASS unlocks it (price gone,
// Remove state); picking it COMMITS the bundled render; survives a reload.
let snapshot;
{
  const page = await newPage();
  await openThemes(page);

  check("the license row is present in the Themes panel",
    await licenseRow(page).isVisible().catch(() => false));
  check("terminal shows a price link while unowned", (await terminalLock(page).count()) === 1);

  await activate(page, PASS_KEY);
  await removeBtn(page).waitFor({ timeout: 8000 }).catch(() => null);
  check("activating a valid key (PASS) shows the unlocked state (Remove license)",
    await removeBtn(page).isVisible().catch(() => false));
  check("terminal's price link is gone once owned", (await terminalLock(page).count()) === 0);

  await page.locator('.tcard[data-pack="terminal"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.themePack === "terminal", null, { timeout: 5000 }).catch(() => null);
  const state = await readState(page);
  check("owning terminal COMMITS it (dataset + bundled --surface + persisted)",
    state.pack === "terminal" && state.surface === TERMINAL_SURFACE &&
      JSON.stringify(state.storedPack) === JSON.stringify({ v: 1, data: "terminal" }), JSON.stringify(state));

  await page.reload();
  await page.waitForSelector(".header", { timeout: 8000 });
  const reloaded = await readState(page);
  check("terminal survives a reload with the fixture still up",
    reloaded.pack === "terminal" && reloaded.surface === TERMINAL_SURFACE, JSON.stringify(reloaded));

  snapshot = await page.evaluate(() => ({ ...localStorage }));
  await page.close();
}

// 7: fail-open — owned entitlement + terminal selected, DEAD keybox host still
// renders terminal from the BUNDLE (no cache needed).
{
  const page = await newPage({ ...snapshot, "blammytv.keyboxUrl": DEAD_KEYBOX_URL });
  await page.goto(URL);
  await page.waitForSelector(".header", { timeout: 8000 });
  const state = await readState(page);
  check("fail-open: dead keybox host still renders bundled terminal",
    state.pack === "terminal" && state.surface === TERMINAL_SURFACE, JSON.stringify(state));
  await page.close();
}

// 8: unknown key -> "That key wasn't recognized — check for typos".
{
  const page = await newPage();
  await openThemes(page);
  await activate(page, UNKNOWN_KEY);
  const text = await waitForRowText(page, "wasn't recognized");
  check("unknown key shows the \"wasn't recognized\" error and stays unowned",
    text.includes("wasn't recognized") && (await terminalLock(page).count()) === 1, text);
  await page.close();
}

// 9: activation-limit key -> "This key is already active on 3 machines".
{
  const page = await newPage();
  await openThemes(page);
  await activate(page, FULL_KEY);
  const text = await waitForRowText(page, "already active on 3 machines");
  check("BTV-TEST-FULL (activation_limit) shows \"already active on 3 machines\"",
    text.includes("already active on 3 machines"), text);
  await page.close();
}

// 10: solo key -> terminal owned (its price link clears).
{
  const page = await newPage();
  await openThemes(page);
  await activate(page, SOLO_KEY);
  await removeBtn(page).waitFor({ timeout: 8000 }).catch(() => null);
  check("solo key unlocks terminal (price link clears)", (await terminalLock(page).count()) === 0);
  await page.close();
}

// 11-12: Remove license returns the row to input state and resets an active
// premium pack to classic.
{
  const page = await newPage();
  await openThemes(page);
  await activate(page, PASS_KEY);
  await removeBtn(page).waitFor({ timeout: 8000 }).catch(() => null);
  await page.locator('.tcard[data-pack="terminal"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.themePack === "terminal", null, { timeout: 5000 }).catch(() => null);

  await removeBtn(page).click();
  await keyInput(page).waitFor({ timeout: 8000 }).catch(() => null);
  check("Remove license: row returns to the key-input state, terminal re-locks",
    (await keyInput(page).isVisible().catch(() => false)) && (await terminalLock(page).count()) === 1);

  const state = await readState(page);
  check("Remove license: active premium pack resets to the default (BlammyTV)",
    state.pack === "slate", String(state.pack));
  await page.close();
}

// 13: malformed key ("hello") -> "That doesn't look like a BlammyTV key",
// rejected client-side WITHOUT calling /validate (proved via /__count).
{
  const before = await (await fetch(`${KEYBOX_URL}/__count`)).json();
  const page = await newPage();
  await openThemes(page);
  await activate(page, "hello");
  const text = await waitForRowText(page, "doesn't look like a blammytv key");
  const after = await (await fetch(`${KEYBOX_URL}/__count`)).json();
  check("malformed key (\"hello\") shows the shape error without calling /validate",
    text.includes("doesn't look like a blammytv key") && after.validate === before.validate,
    `validateBefore=${before.validate} validateAfter=${after.validate}`);
  await page.close();
}

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);

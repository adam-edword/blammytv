// E2E: paid-theme license flow (v0.6.0) — Customize -> Theme pill's
// "Premium Themes" row (key input + Activate), the keybox /validate +
// /payload round trip, unlocked packs joining .pack-row as additional
// .pack-card[data-pack] entries, cached-payload fail-open on reload with a
// DEAD keybox host, error copy for unknown/activation-limit/malformed
// keys, and Remove license tearing the whole thing back down.
//
// Structural conventions (pill rail, .pack-row, .pack-card[data-pack],
// openCustomize/openTheme) are copied verbatim from verify-themes.mjs.
// Everything specific to the license row below is a BEST-EFFORT GUESS at
// selectors, made from house conventions elsewhere in CustomizeTab.tsx
// (the "Reset Appearance" row is `.customize-row` filtered by hasText —
// "Premium Themes" is assumed to follow the same pattern) — the
// integrator building the UI in parallel should reconcile against the
// real markup:
//   - premium row:      .customize-row with text "Premium Themes"
//   - key input:         placeholder "BTV-XXXX-XXXX-XXXX-XXXX", inside that row
//   - activate button:   accessible name "Activate", inside that row
//   - unlocked state:    accessible name "Remove license", inside that row
//   - error copy:        no assumed class — read as the premium row's own
//                         text; the exact strings ("wasn't recognized",
//                         "already active on 3 machines", "doesn't look
//                         like a BlammyTV key") are NOT guesses — they're
//                         copied verbatim from ActivateResult.message in
//                         apps/app/src/features/settings/license.ts, which
//                         landed mid-task (the .customize-row/"Premium
//                         Themes" container and button/input selectors
//                         around it are still guesses; CustomizeTab.tsx's
//                         markup hadn't landed as of writing)
//
// App-side contract this exercises (see keybox CONTRACTS in the task/
// HANDOFF): localStorage RAW key "blammytv.keyboxUrl" (no {v,data}
// envelope) selects the keybox base URL; cached payloads live under the
// standard-envelope "blammytv.license.payloads" and must re-apply at boot
// with NO network call (fail-open) if the keybox host is unreachable.
//
// Run:
//   1. build the app, then from apps/app: `pnpm preview --port 4173`
//   2. `node scripts/fake-keybox.mjs &`                  (keybox on :8085)
//   3. from the repo root:
//      PW_FROM=<dir-containing-playwright-core>/x.js node scripts/verify-license.mjs
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

// App-booting harness contract (from verify-themes.mjs): seed
// btv:onboarded + btv:welcome-played so onboarding never intercepts a
// settings-only run. blammytv.keyboxUrl is a RAW string (no {v,data}
// envelope) per the license CONTRACTS — every page gets it pointed at the
// fixture by default; individual tests override it via `init`.
const newPage = async (init = {}, opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ...opts });
  const page = await ctx.newPage();
  await page.addInitScript((seed) => {
    sessionStorage.setItem("btv:welcome-played", "1");
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, { "btv:onboarded": "1", "blammytv.keyboxUrl": KEYBOX_URL, ...init });
  return page;
};

// Open Settings -> Customize -> Theme pill (verbatim from verify-themes.mjs).
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

// License-row helpers (see selector-assumption note in the header comment).
const premiumRow = (page) => page.locator(".customize-row", { hasText: "Premium Themes" });
const keyInput = (page) => premiumRow(page).getByPlaceholder("BTV-XXXX-XXXX-XXXX-XXXX");
const activateBtn = (page) => premiumRow(page).getByRole("button", { name: "Activate", exact: true });
const removeBtn = (page) => premiumRow(page).getByRole("button", { name: "Remove license" });

const activate = async (page, key) => {
  await keyInput(page).fill(key);
  await activateBtn(page).click();
};

const readState = (page) => page.evaluate(() => ({
  pack: document.documentElement.dataset.themePack ?? null,
  surface: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
}));

const packIds = async (page) =>
  page.locator(".pack-row .pack-card").evaluateAll((els) => els.map((el) => el.getAttribute("data-pack")).sort());

// Error copy is confirmed (not guessed) — apps/app/src/features/settings/
// license.ts landed mid-task with the exact ActivateResult.message strings,
// used verbatim below. Poll for the premium row's text to CONTAIN the
// expected substring — a Playwright-side poll (repeated locator reads),
// not an in-page sampler.
const waitForRowText = async (page, substring, timeoutMs = 5000) => {
  const start = Date.now();
  let text = "";
  while (Date.now() - start < timeoutMs) {
    text = (await premiumRow(page).innerText().catch(() => "")).toLowerCase();
    if (text.includes(substring)) return text;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return text;
};

// 1-8: activation, the unlocked packs joining the pack row, picking nebula
// (dataset attr + token + injected <style>), and persistence across a
// reload with the fixture still up.
let snapshot;
{
  const page = await newPage();
  await openCustomize(page);
  await openTheme(page);

  check("Premium Themes row is present below the pack cards",
    await premiumRow(page).isVisible().catch(() => false));

  const before = await packIds(page);
  await activate(page, PASS_KEY);
  await removeBtn(page).waitFor({ timeout: 8000 }).catch(() => null);
  check("activating a valid key (PASS) shows the unlocked state (Remove license control)",
    await removeBtn(page).isVisible().catch(() => false));

  const after = await packIds(page);
  check("nebula and ember join .pack-row as additional pack-cards after PASS activation",
    after.includes("nebula") && after.includes("ember"),
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

  await page.locator('.pack-card[data-pack="nebula"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.themePack === "nebula", null, { timeout: 5000 }).catch(() => null);
  const state = await readState(page);
  check("clicking nebula sets dataset.themePack", state.pack === "nebula", String(state.pack));
  check("clicking nebula applies its --surface token (#14101d)",
    state.surface === "#14101d", state.surface);
  const styleCount = await page.locator('style[data-pack-css="nebula"]').count();
  check("clicking nebula injects <style data-pack-css=\"nebula\"> into head", styleCount === 1, String(styleCount));

  await page.reload();
  await page.waitForSelector(".header", { timeout: 8000 });
  const reloaded = await readState(page);
  check("nebula (attr + token) survives a reload with the fixture still up",
    reloaded.pack === "nebula" && reloaded.surface === "#14101d",
    JSON.stringify(reloaded));

  snapshot = await page.evaluate(() => ({ ...localStorage }));
  await page.close();
}

// 9: THE fail-open proof — a fresh context carrying the same localStorage
// (cached license payloads + themePack selection) but pointed at a DEAD
// keybox host still renders nebula, purely from the cached payload, no
// network required.
{
  const page = await newPage({ ...snapshot, "blammytv.keyboxUrl": DEAD_KEYBOX_URL });
  await page.goto(URL);
  await page.waitForSelector(".header", { timeout: 8000 });
  const state = await readState(page);
  check("fail-open: dead keybox host still renders nebula from the cached payload",
    state.pack === "nebula" && state.surface === "#14101d",
    JSON.stringify(state));
  await page.close();
}

// 10: unknown key -> plain-language error ("That key wasn't recognized —
// check for typos", per license.ts's activate()), no packs added.
{
  const page = await newPage();
  await openCustomize(page);
  await openTheme(page);
  await activate(page, UNKNOWN_KEY);
  const text = await waitForRowText(page, "wasn't recognized");
  const packs = await packIds(page);
  check("unknown key shows the \"wasn't recognized\" error and adds no packs",
    text.includes("wasn't recognized") && !packs.includes("nebula") && !packs.includes("ember"),
    `text=${JSON.stringify(text)} packs=${JSON.stringify(packs)}`);
  await page.close();
}

// 11: activation-limit key -> "This key is already active on 3 machines"
// (per license.ts's activate(); also satisfies the contract's looser
// "mentioning machines/limit" requirement).
{
  const page = await newPage();
  await openCustomize(page);
  await openTheme(page);
  await activate(page, FULL_KEY);
  const text = await waitForRowText(page, "already active on 3 machines");
  check("BTV-TEST-FULL (activation_limit) shows \"already active on 3 machines\"",
    text.includes("already active on 3 machines"), text);
  await page.close();
}

// 12: solo key -> only nebula unlocks, not ember.
{
  const page = await newPage();
  await openCustomize(page);
  await openTheme(page);
  await activate(page, SOLO_KEY);
  await removeBtn(page).waitFor({ timeout: 8000 }).catch(() => null);
  const packs = await packIds(page);
  check("solo key unlocks only nebula, not ember",
    packs.includes("nebula") && !packs.includes("ember"), JSON.stringify(packs));
  await page.close();
}

// 13-14: Remove license tears the row and the unlocked packs back down,
// and resets an active premium pack to classic.
{
  const page = await newPage();
  await openCustomize(page);
  await openTheme(page);
  await activate(page, PASS_KEY);
  await removeBtn(page).waitFor({ timeout: 8000 }).catch(() => null);
  await page.locator('.pack-card[data-pack="nebula"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.themePack === "nebula", null, { timeout: 5000 }).catch(() => null);

  await removeBtn(page).click();
  await keyInput(page).waitFor({ timeout: 8000 }).catch(() => null);
  const packs = await packIds(page);
  const styleCount = await page.locator("style[data-pack-css]").count();
  check("Remove license: row returns to input state, premium pack-cards and pack-css styles are gone",
    (await keyInput(page).isVisible().catch(() => false)) &&
      !packs.includes("nebula") && !packs.includes("ember") && styleCount === 0,
    `packs=${JSON.stringify(packs)} styleCount=${styleCount}`);

  const state = await readState(page);
  check("Remove license: active premium pack resets to classic (dataset.themePack removed)",
    state.pack === null, String(state.pack));
  await page.close();
}

// 15: malformed key ("hello") -> "That doesn't look like a BlammyTV key"
// (per license.ts's isValidKeyShape() gate in activate() — rejected before
// callValidate() is ever reached), WITHOUT ever calling /validate. Proved
// via the fixture's GET /__count request counter rather than a dead port,
// since this must stay on the live fixture to prove the rejection happens
// client-side, not because the network was unreachable.
{
  const before = await (await fetch(`${KEYBOX_URL}/__count`)).json();
  const page = await newPage();
  await openCustomize(page);
  await openTheme(page);
  await activate(page, "hello");
  const text = await waitForRowText(page, "doesn't look like a blammytv key");
  const after = await (await fetch(`${KEYBOX_URL}/__count`)).json();
  check("malformed key (\"hello\") shows \"doesn't look like a BlammyTV key\" without calling /validate",
    text.includes("doesn't look like a blammytv key") && after.validate === before.validate,
    `text=${JSON.stringify(text)} validateBefore=${before.validate} validateAfter=${after.validate}`);
  await page.close();
}

await browser.close();
const pass = results.filter(Boolean).length;
console.log(`${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
